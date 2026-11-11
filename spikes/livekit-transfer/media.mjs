// One phone's media in the spike: sends a tone as PCMU RTP (and, for the staff phone, one DTMF digit), and records
// which tones it hears, so the run can prove who heard whom and when. Started by SIPp (<exec command>) once a call is up.
// node ../media.mjs <role> <case> <local port> <remote ip> <remote port> <tone Hz> [digit at-ms payload-type]
import dgram from 'node:dgram';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';

const [role, caseId, lport, rip, rport, toneArg, digit, atArg, ptArg] = process.argv.slice(2);
const OUT = path.join(import.meta.dirname, 'logs', `media-${role}-${caseId}.json`);
const TONE = Number(toneArg), FREQS = [440, 700, 1000], FS = 8000, WIN = 800; // 100 ms windows
const startedAt = Date.now();

function ulawDecode(u) { u = ~u & 0xff; const exp = (u >> 4) & 7; let s = (((u & 0x0f) << 3) + 0x84) << exp; s -= 0x84; return u & 0x80 ? -s : s; }
function ulawEncode(s) {
  let sign = 0; if (s < 0) { sign = 0x80; s = -s; }
  s = Math.min(s, 32635) + 0x84;
  let exp = 7; for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}
function amplitude(x, f) { // Goertzel: amplitude of frequency f in the window
  const c = 2 * Math.cos(2 * Math.PI * f / FS); let s1 = 0, s2 = 0;
  for (const v of x) { const s0 = v + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.round(2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length);
}

const windows = []; let buf = [], received = 0, lastRx = 0, digitSentAt = null, done = false;
const save = () => writeFileSync(OUT, JSON.stringify({ role, caseId, startedAt, tone: TONE, digit: digit ?? null, digitSentAt, received, done, windows }));

const sock = dgram.createSocket('udp4');
sock.on('message', b => {
  if (b.length < 12) return;
  const cc = b[0] & 0x0f, pt = b[1] & 0x7f;
  let off = 12 + 4 * cc;
  if (b[0] & 0x10) off += 4 + 4 * b.readUInt16BE(off + 2);
  received++; lastRx = Date.now();
  if (pt !== 0) return;
  for (let i = off; i < b.length; i++) buf.push(ulawDecode(b[i]));
  while (buf.length >= WIN) {
    const x = buf.splice(0, WIN);
    const rms = Math.round(Math.sqrt(x.reduce((a, v) => a + v * v, 0) / WIN));
    windows.push({ t: Date.now(), rms, ...Object.fromEntries(FREQS.map(f => [`a${f}`, amplitude(x, f)])) });
  }
});
sock.bind(Number(lport), '127.0.0.1');

// Sending: 20 ms PCMU frames of the tone; the digit (RFC 4733) interrupts the tone for 260 ms at at-ms.
const ssrc = randomInt(2 ** 31); let seq = randomInt(2 ** 15), ts = randomInt(2 ** 31), phase = 0, sending = true;
const header = (pt, marker, t) => { const h = Buffer.alloc(12); h[0] = 0x80; h[1] = (marker ? 0x80 : 0) | pt; h.writeUInt16BE(seq++ & 0xffff, 2); h.writeUInt32BE(t >>> 0, 4); h.writeUInt32BE(ssrc, 8); return h; };
const send = b => sock.send(b, Number(rport), rip);
const audio = setInterval(() => {
  if (!sending) return;
  const p = Buffer.alloc(160);
  for (let i = 0; i < 160; i++) p[i] = ulawEncode(Math.round(6000 * Math.sin(2 * Math.PI * TONE * phase++ / FS)));
  send(Buffer.concat([header(0, false, ts), p])); ts += 160;
}, 20);

if (digit) setTimeout(async () => {
  sending = false;
  const pt = Number(ptArg) || 101, ev = '0123456789*#'.indexOf(digit), evTs = ts;
  const pkt = (marker, end, dur) => { const p = Buffer.alloc(4); p[0] = ev; p[1] = (end ? 0x80 : 0) | 10; p.writeUInt16BE(dur, 2); return Buffer.concat([header(pt, marker, evTs), p]); };
  for (let i = 1; i <= 10; i++) { send(pkt(i === 1, false, 160 * i)); await new Promise(r => setTimeout(r, 20)); }
  for (let i = 0; i < 3; i++) { send(pkt(false, true, 1600)); await new Promise(r => setTimeout(r, 20)); }
  digitSentAt = Date.now(); ts += 1600; sending = true;
}, Number(atArg) || 0);

const finish = () => { if (done) return; done = true; clearInterval(audio); clearInterval(tick); save(); sock.close(); process.exit(0); };
const tick = setInterval(() => {
  save();
  const idle = lastRx ? Date.now() - lastRx > 3000 : Date.now() - startedAt > 20000;
  if (idle || Date.now() - startedAt > 60000) finish();
}, 500);
process.on('SIGTERM', finish);
