// Screened transfer on self-hosted LiveKit (INV-09: only the staff phone's DTMF "1" during the whisper counts as a
// human taking the call). Runs S1–S6 against SIPp on this Mac and writes RESULTS.json. Usage: node spike.mjs [S1 ...]
//
// Self-hosted livekit-server v1.13 answers MoveParticipant with "not implemented" (it is a LiveKit Cloud feature), so
// screening happens in the caller's own room, gated: the caller may hear nothing while staff is being screened, the
// staff leg is unsubscribed from the caller the moment it joins, and only DTMF from the staff participant is read.
// The two phones (media.mjs) each send a tone and record what they hear: caller 700 Hz, staff/voicemail 1000 Hz,
// whisper 440 Hz.
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { Room, RoomEvent, AudioSource, AudioFrame, LocalAudioTrack, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { DIR, WS, BUSINESS, STAFF, rooms, sip, token, ensureTrunks, sipp, sleep, waitFor, children } from './lk.mjs';

const CASES = {
  S1: { staff: 'staff_accept', expect: 'bridged', title: 'human accepts (DTMF 1)' },
  S2: { staff: 'staff_voicemail', expect: 'returning:no_dtmf', title: 'voicemail answers, no DTMF' },
  S3: { staff: 'staff_decline', expect: 'returning:declined', title: 'staff declines (DTMF 2)' },
  S4: { staff: 'staff_noanswer', expect: 'returning:no_answer', title: 'rings, never answered' },
  S5: { staff: 'staff_busy', expect: 'returning:busy', title: 'busy (486)' },
  S6: { staff: 'staff_slow', expect: 'abandoned_during_transfer', title: 'caller hangs up during screening', callerHoldMs: 9000 },
  S7: { staff: 'staff_voicemail', caller: 'caller_presses_1', expect: 'returning:no_dtmf', title: 'caller presses 1 during screening (must not accept)' },
};
const SCREEN_MS = 10_000, RING_S = 20, HEARD = 500; // tone amplitude (of ~6000 sent) that counts as heard
const ALL = { permission: { canSubscribe: true, canPublish: true, canPublishData: true } };
const DEAF = { permission: { canSubscribe: false, canPublish: true, canPublishData: true } };
// GATE=mute (default): the caller's track is muted at the server while staff is screened, so whoever subscribes gets nothing.
// GATE=publish: the caller stops publishing instead (private, but livekit/sip v1.23 never republishes: no bridge audio).
// GATE=subscribe: only the staff leg is unsubscribed (it re-subscribes when it answers: the voicemail hears the caller).
const GATE = process.env.GATE ?? 'mute';
const SCREENING = GATE === 'publish' ? { permission: { canSubscribe: false, canPublish: false, canPublishData: true } } : DEAF;

/** 3 s whisper: a 440 Hz tone at 48 kHz in 10 ms frames (no speech provider at Gate A). */
async function whisper(room) {
  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack('whisper', source);
  const opts = new TrackPublishOptions(); opts.source = TrackSource.SOURCE_MICROPHONE;
  const pub = await room.localParticipant.publishTrack(track, opts);
  for (let f = 0; f < 300; f++) {
    const d = new Int16Array(480);
    for (let i = 0; i < 480; i++) d[i] = Math.round(4000 * Math.sin(2 * Math.PI * 440 * (f * 480 + i) / 48000));
    await source.captureFrame(new AudioFrame(d, 48000, 1, 480));
  }
  return pub;
}

/** No room may outlive a case: a leftover call room (its caller killed without a BYE) was once joined by mistake. */
async function cleanRooms() {
  for (const r of await rooms.listRooms()) await rooms.deleteRoom(r.name).catch(() => {});
  return waitFor(async () => (await rooms.listRooms()).length === 0, 10000);
}

/** SIPp's <exec> forks, so a media tap holds SIPp's sockets until it exits: wait until every port of a case is free. */
const PORTS = [5061, 5070, 7000, 7100];
const free = port => new Promise(r => { const s = dgram.createSocket('udp4'); s.once('error', () => r(false)); s.bind(port, '127.0.0.1', () => s.close(() => r(true))); });
const portsFree = () => waitFor(async () => (await Promise.all(PORTS.map(free))).every(Boolean), 20000, 250);

const mediaFile = (role, id) => path.join(DIR, 'logs', `media-${role}-${id}.json`);
const readMedia = (role, id) => existsSync(mediaFile(role, id)) ? JSON.parse(readFileSync(mediaFile(role, id), 'utf8')) : null;

/** Which tones a phone heard in [from, to) (case-relative ms). */
function heard(m, t0, from, to) {
  const w = (m?.windows ?? []).filter(x => x.t - t0 >= from && x.t - t0 < to);
  const any = k => w.filter(x => x[k] > HEARD).length >= 2;
  return { windows: w.length, whisper: any('a440'), caller: any('a700'), staff: any('a1000') };
}

async function runCase(id, trunks) {
  if (!(await cleanRooms())) throw new Error('rooms left over from an earlier case');
  if (!(await portsFree())) throw new Error('SIP or media ports still busy from an earlier case');
  for (const r of ['caller', 'staff']) rmSync(mediaFile(r, id), { force: true });
  const c = CASES[id], t0 = Date.now(), ms = () => Date.now() - t0, timeline = [];
  const mark = e => timeline.push([ms(), e]);
  const at = {};
  let callerGone = false, dtmf = null, callerTrack = null;

  const staffSipp = sipp('staff', c.staff, { caseId: id });
  const callerSipp = sipp('caller', id, { holdMs: c.callerHoldMs ?? 40000, caseId: id, scenario: c.caller });
  const callerExit = new Promise(r => callerSipp.on('exit', code => { mark(`caller sipp exit ${code}`); r(code); }));
  const info = await waitFor(async () => (await rooms.listRooms()).find(r => r.name.startsWith('call-')), 15000);
  if (!info) throw new Error('no call room');
  const callName = info.name;
  mark('call room created');

  // The runtime joins the caller's room (LiveKit answers the call once someone subscribes to the caller).
  const room = new Room();
  room.on(RoomEvent.ParticipantDisconnected, p => { if (p.identity.startsWith('sip_')) { callerGone = true; mark('caller left'); } });
  room.on(RoomEvent.DtmfReceived, (code, digit, p) => {
    if (p?.identity === 'staff') { if (!dtmf) { dtmf = digit; mark(`DTMF ${digit} from staff`); } }
    else mark(`DTMF ${digit} from ${p?.identity ?? 'unknown'} ignored`); // a caller pressing 1 must not accept for staff
  });
  let staffGate = null;
  room.on(RoomEvent.ParticipantConnected, p => {
    if (p.identity !== 'staff') return;
    mark('staff leg joined (dialling)');
    staffGate = rooms.updateSubscriptions(callName, 'staff', [callerTrack], false).then(() => mark('staff leg unsubscribed from caller'));
  });
  await room.connect(WS, await token(callName, 'runtime'), { autoSubscribe: true, dynacast: false });
  mark('runtime joined');
  const callerP = await waitFor(async () => (await rooms.listParticipants(callName)).find(p => p.identity.startsWith('sip_') && p.tracks.length), 10000);
  if (!callerP) throw new Error('caller has no track');
  callerTrack = callerP.tracks[0].sid;
  await sleep(1500); // the AI says "please hold while I find someone"

  // SM-9: the caller hears nothing while staff is screened (no whisper, no voicemail greeting).
  await rooms.updateParticipant(callName, callerP.identity, SCREENING);
  mark(GATE === 'publish' ? 'caller set to hear nothing and publish nothing' : 'caller set to hear nothing');
  if (GATE === 'mute') { await rooms.mutePublishedTrack(callName, callerP.identity, callerTrack, true); mark('caller track muted at the server'); }
  const unmuteCaller = async () => { if (GATE === 'mute') await rooms.mutePublishedTrack(callName, callerP.identity, callerTrack, false); };
  let outcome, whisperPub = null;
  try {
    at.dial = ms(); mark('dialling staff into the call room');
    await sip.createSipParticipant(trunks.outbound, STAFF, callName, { participantIdentity: 'staff', fromNumber: BUSINESS, waitUntilAnswered: true, ringingTimeout: RING_S, playDialtone: false });
    at.answer = ms(); mark('staff answered');
    await staffGate;
    const whisperDone = whisper(room).then(p => { whisperPub = p; mark('whisper played'); });
    await waitFor(async () => dtmf || callerGone, SCREEN_MS, 50); // first of: a digit, the caller leaving, the timeout
    at.decision = ms();
    if (callerGone) { outcome = 'abandoned_during_transfer'; }
    else if (dtmf === '1') {
      await whisperDone;
      await room.localParticipant.unpublishTrack(whisperPub.sid);
      await rooms.updateParticipant(callName, callerP.identity, ALL);
      await unmuteCaller();
      if (GATE === 'publish') {
        const back = await waitFor(async () => (await rooms.listParticipants(callName)).find(p => p.identity === callerP.identity)?.tracks[0]?.sid, 5000, 50);
        mark(back ? `caller track published again (${back === callerTrack ? 'same' : 'new'} sid)` : 'caller track NOT published again');
        if (back) callerTrack = back;
      }
      await rooms.updateSubscriptions(callName, 'staff', [callerTrack], true).catch(e => mark(`resubscribe: ${e.message}`));
      at.bridge = ms(); outcome = 'bridged';
      mark(`bridged ${at.bridge - at.answer} ms after staff answered`);
      await sleep(3000); // let both phones hear each other
    } else outcome = dtmf ? 'returning:declined' : 'returning:no_dtmf';
    if (outcome !== 'bridged') {
      await rooms.removeParticipant(callName, 'staff').catch(() => {});
      mark('staff leg removed');
      if (!callerGone) { await rooms.updateParticipant(callName, callerP.identity, ALL); await unmuteCaller(); mark('caller hears the AI again'); }
    }
  } catch (e) {
    const msg = String(e?.message ?? e);
    at.decision = ms(); mark(`createSipParticipant failed: ${msg.slice(0, 140)}`);
    outcome = callerGone ? 'abandoned_during_transfer' : /486|busy/i.test(msg) ? 'returning:busy' : /timed out|timeout|408|480|no answer|cancel|deadline/i.test(msg) ? 'returning:no_answer' : 'returning:error';
    if (!callerGone) { await rooms.updateParticipant(callName, callerP.identity, ALL).catch(() => {}); await unmuteCaller().catch(() => {}); }
  }
  const staffLeft = outcome === 'bridged' || !(await rooms.listParticipants(callName).catch(() => [])).some(p => p.identity === 'staff');
  mark(`outcome ${outcome}`);
  const end = ms();
  await room.disconnect();
  await cleanRooms();
  callerSipp.kill('SIGTERM'); staffSipp.kill('SIGTERM');
  await Promise.race([callerExit, sleep(3000)]);
  await waitFor(async () => { const a = readMedia('caller', id), b = readMedia('staff', id); return (a?.done ?? true) && (b?.done ?? true); }, 8000, 250);

  // What each phone heard. Screening = staff answered → decision; after = bridge → end.
  const callerM = readMedia('caller', id), staffM = readMedia('staff', id);
  const media = { caller_rx_packets: callerM?.received ?? 0, staff_rx_packets: staffM?.received ?? 0 };
  const checks = [];
  if (at.answer != null) {
    media.screening = { caller: heard(callerM, t0, at.answer, at.decision), staff: heard(staffM, t0, at.answer, at.decision) };
    checks.push(['caller heard no whisper or staff/voicemail audio while screening', !media.screening.caller.whisper && !media.screening.caller.staff]);
    checks.push(['staff/voicemail heard none of the caller while screening', !media.screening.staff.caller]);
    if (outcome !== 'abandoned_during_transfer' || at.decision - at.answer > 3500) checks.push(['staff heard the whisper', media.screening.staff.whisper]);
  }
  if (outcome === 'bridged') {
    media.after = { caller: heard(callerM, t0, at.bridge + 300, end), staff: heard(staffM, t0, at.bridge + 300, end) };
    checks.push(['after the bridge the caller hears staff', media.after.caller.staff]);
    checks.push(['after the bridge staff hears the caller', media.after.staff.caller]);
  } else if (at.answer != null) {
    const whole = heard(staffM, t0, at.answer, end);
    checks.push(['a staff leg that did not accept never heard the caller', !whole.caller]);
  }
  checks.push(['no staff leg left behind', staffLeft]);
  if (c.caller) checks.push(['the caller\'s digit was ignored', timeline.some(([, e]) => /from sip_.* ignored/.test(e))]);
  const pass = outcome === c.expect && checks.every(([, ok]) => ok);
  return { id, title: c.title, expect: c.expect, outcome, pass, at, checks, media, timeline };
}

// Evidence for the design: does this server support moving a participant between rooms? (A real participant, two real rooms.)
let moveProbe;
{
  await rooms.createRoom({ name: 'probe-a' }); await rooms.createRoom({ name: 'probe-b' });
  const p = new Room(); await p.connect(WS, await token('probe-a', 'probe'), { autoSubscribe: false });
  try { await rooms.moveParticipant('probe-a', 'probe', 'probe-b'); moveProbe = 'accepted'; } catch (e) { moveProbe = String(e?.message ?? e); }
  await p.disconnect(); await cleanRooms();
}
console.log(`MoveParticipant on this server: ${moveProbe}`);

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
const trunks = await ensureTrunks();
const results = [];
for (const id of ids) {
  let r;
  try { r = await runCase(id, trunks); }
  catch (e) { r = { id, title: CASES[id].title, expect: CASES[id].expect, outcome: `error: ${e.message}`, pass: false, checks: [], timeline: [] }; }
  finally { for (const p of children) p.kill('SIGKILL'); }
  results.push(r);
  console.log(`\n${id} ${r.title}: ${r.outcome} ${r.pass ? 'PASS' : `FAIL (expected ${r.expect})`}`);
  for (const [t, e] of r.timeline) console.log(`   ${String(t).padStart(6)} ms  ${e}`);
  for (const [name, ok] of r.checks) console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  await sleep(1000);
}
const file = path.join(DIR, process.env.RESULTS ?? 'RESULTS.json');
const prior = existsSync(file) && ids.length < Object.keys(CASES).length ? JSON.parse(readFileSync(file, 'utf8')) : null;
const merged = { gate: GATE, server: 'livekit-server v1.13 + livekit/sip v1.23 (self-hosted, colima)', moveParticipant: moveProbe, ran: new Date().toISOString(),
  cases: [...(Array.isArray(prior?.cases) ? prior.cases.filter(x => !ids.includes(x.id)) : []), ...results].sort((a, b) => a.id.localeCompare(b.id)) };
writeFileSync(file, JSON.stringify(merged, null, 2));
process.exit(results.every(r => r.pass) ? 0 : 1);
