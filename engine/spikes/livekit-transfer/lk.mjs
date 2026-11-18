// Shared helpers for the spike: clients, trunks, SIPp processes.
import { readFileSync, mkdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { RoomServiceClient, SipClient, AccessToken } from 'livekit-server-sdk';

export const DIR = import.meta.dirname;
const env = Object.fromEntries(readFileSync(path.join(DIR, '.env'), 'utf8').trim().split('\n').map(l => l.split('=')));
export const HTTP = 'http://127.0.0.1:7880', WS = 'ws://127.0.0.1:7880';
export const rooms = new RoomServiceClient(HTTP, env.LK_KEY, env.LK_SECRET);
export const sip = new SipClient(HTTP, env.LK_KEY, env.LK_SECRET);
export const BUSINESS = '+6620000101', STAFF = '+6620000999';

export async function token(room, identity) {
  const t = new AccessToken(env.LK_KEY, env.LK_SECRET, { identity });
  t.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return t.toJwt();
}

/** Trunks: inbound for the business number, an individual room per call, outbound to the staff phone (SIPp on this Mac). */
export async function ensureTrunks() {
  for (const t of await sip.listSipInboundTrunk()) await sip.deleteSipTrunk(t.sipTrunkId);
  for (const t of await sip.listSipOutboundTrunk()) await sip.deleteSipTrunk(t.sipTrunkId);
  for (const r of await sip.listSipDispatchRule()) await sip.deleteSipDispatchRule(r.sipDispatchRuleId);
  const inbound = await sip.createSipInboundTrunk('rcpt-business', [BUSINESS]);
  await sip.createSipDispatchRule({ type: 'individual', roomPrefix: 'call-' }, { trunkIds: [inbound.sipTrunkId], name: 'rcpt-calls' });
  const outbound = await sip.createSipOutboundTrunk('rcpt-staff', '192.168.5.2:5070', [BUSINESS], { transport: 1 /* UDP */ });
  return { inbound: inbound.sipTrunkId, outbound: outbound.sipTrunkId };
}

/** Every SIPp this run started, so none outlives a case that throws. */
export const children = new Set();

/** Start SIPp. Caller: dials the business and holds for holdMs. Staff: a UAS on :5070 running one scenario. */
export function sipp(kind, scenario, opts = {}) {
  mkdirSync(path.join(DIR, 'logs'), { recursive: true });
  const log = openSync(path.join(DIR, 'logs', `${kind}-${scenario}-${Date.now()}.log`), 'w');
  const args = kind === 'caller'
    ? ['127.0.0.1:5060', '-sf', path.join(DIR, 'scenarios', `${opts.scenario ?? 'caller'}.xml`), '-s', BUSINESS, '-i', '127.0.0.1', '-p', '5061', '-mi', '127.0.0.1', '-mp', '6000',
       '-m', '1', '-d', String(opts.holdMs ?? 40000), '-timeout', '120s', '-timeout_error', '-nostdin', '-trace_err']
    : ['-sf', path.join(DIR, 'scenarios', `${scenario}.xml`), '-i', '127.0.0.1', '-p', '5070', '-mi', '127.0.0.1', '-mp', '6100',
       '-m', '1', '-timeout', '120s', '-nostdin', '-trace_err', '-trace_msg'];
  if (opts.caseId) args.push('-key', 'caseid', opts.caseId);
  const p = spawn('sipp', args, { cwd: path.join(DIR, 'logs'), stdio: ['ignore', log, log] });
  children.add(p); p.on('exit', () => children.delete(p));
  return p;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function waitFor(fn, ms, step = 250) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); }
}
