/**
 * Talk to the receptionist (Gate A, simulation only). A page on this Mac where a person plays the caller, typing or
 * speaking, and sees beside the conversation what the runtime did: each tool the model called and what it got back,
 * replies the runtime held back and why, the fictional spa's diary, the texts that went to the sandbox, and the
 * owner's LINE, where the person can answer the owner's questions as the owner.
 *
 * Fictional spa, its own database (`rcpt_talk`), the sandbox transport: nothing reaches a phone, LINE or a calendar.
 * Free local models only (Ollama on this Mac), so a conversation costs nothing. The server answers this Mac only.
 *
 *   npm run db:start && npm run talk        → http://127.0.0.1:4520
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { withSystem, withTenant } from '../../src/db.ts';
import { drain } from '../../src/handlers.ts';
import { lineWebhook, LINE_CHANNEL_SECRET } from '../../src/inbound.ts';
import { lineSignature } from '../../src/messaging/channels.ts';
import { seed, A, NUM } from '../seed.ts';
import { Call } from '../session.ts';
import { Receptionist } from '../model/receptionist.ts';
import { CompatClient, PROVIDERS } from '../model/free-models.ts';

process.env.RCPT_DB = 'rcpt_talk'; // read lazily by db() on first use, so setting it here is in time
const DB = 'rcpt_talk';
const PORT = Number(process.env.PORT ?? 4520);
const PAGE = path.join(import.meta.dirname, 'page.html');
const BUSINESS = 'ร้านสปาตัวอย่าง (Sample Day Spa)';
/** The two models measured on the 16 scenarios (sim/model/FINDINGS.md). */
const MODELS = [
  { id: 'gemma4:12b', label: 'Gemma 4 12B', note: '16 of 16 scenarios (16 Nov 2026)' },
  { id: 'gpt-oss:20b', label: 'gpt-oss 20B', note: '14 of 16 scenarios, larger and slower' },
];
/** Fictional caller numbers (INV-12). */
const CALLERS = { new: '+66812349001', returning: '+66812349002' } as const;
const client = new CompatClient({ provider: 'ollama' });

/**
 * The receptionist's voice: Gemini's speech models, as in O2's video voice-overs (the owner, 18 Nov 2026: "make it sound
 * more human like the voice over for our o2 videos"). The free tier allows about 10 takes a day per model and 3 a
 * minute, so the models take turns, every line is kept in .data/tts (a repeated sentence costs nothing), and when all
 * are used up the page falls back to the Mac's voice. What the receptionist says goes to Google's free tier, which may
 * use it to improve its products: fictional data only.
 */
const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const VOICES = [
  { id: 'Sulafat', label: 'Sulafat · warm' }, { id: 'Achernar', label: 'Achernar · soft' }, { id: 'Vindemiatrix', label: 'Vindemiatrix · gentle' },
  { id: 'Kore', label: 'Kore · firm' }, { id: 'Charon', label: 'Charon · the O2 reels (male)' },
];
const NOTES = {
  th: "A warm, calm receptionist at a Thai day spa answering the phone in Thai. Natural, friendly and unhurried, like a real person talking, not an announcer. Say exactly the transcript.",
  en: "A warm, calm receptionist at a day spa in Bangkok answering the phone in English. Natural, friendly and unhurried, like a real person talking, not an announcer. Say exactly the transcript.",
};
const TTS_DIR = path.join(import.meta.dirname, '..', '..', '.data', 'tts');
/** Until when each model is resting: a minute for the per-minute limit, until the next Pacific midnight for the daily one. */
const resting = new Map<string, number>();
const pacificMidnight = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return Date.now() + ((24 - Number(p.hour)) * 60 - Number(p.minute)) * 60_000;
};
function wav(pcm: Buffer, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function speech(text: string, lang: 'th' | 'en', voice: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  const v = VOICES.some(x => x.id === voice) ? voice : VOICES[0].id;
  const file = path.join(TTS_DIR, createHash('sha256').update(`${v}|${lang}|${text}`).digest('hex').slice(0, 32) + '.wav');
  if (existsSync(file)) return readFileSync(file);
  if (!key) throw new HttpError(503, 'No Gemini key for the voice: the Mac voice is answering.');
  for (const model of TTS_MODELS) {
    if ((resting.get(model) ?? 0) > Date.now()) continue;
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(25_000), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: `### DIRECTOR'S NOTES\n${NOTES[lang]}\n\n### TRANSCRIPT\n${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } } }),
      });
    } catch { resting.set(model, Date.now() + 30_000); continue; }
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429) { resting.set(model, JSON.stringify(j).includes('PerDay') ? pacificMidnight() : Date.now() + 60_000); continue; }
    const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
    if (!r.ok || !part) { resting.set(model, Date.now() + 30_000); continue; }
    const pcm = Buffer.from(part.data, 'base64'), rate = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1] ?? 24000);
    const out = pcm.subarray(0, 4).toString() === 'RIFF' ? pcm : wav(pcm, rate);
    mkdirSync(TTS_DIR, { recursive: true }); writeFileSync(file, out);
    return out;
  }
  throw new HttpError(429, 'The Gemini voice is used up for now: the Mac voice is answering.');
}

/** The talk page's choice whether the greeting says it is an AI (the tenant policy ai_disclosure; asked, it always says so). */
async function setDisclosure(on: boolean) {
  const c = new pg.Client({ host: '127.0.0.1', port: 54421, user: 'rcpt', database: DB });
  await c.connect();
  try { await c.query(`update policies set body = body || jsonb_build_object('ai_disclosure', $2::boolean) where tenant_id = $1`, [A, on]); }
  finally { await c.end(); }
}

type Before = { since: number; tools: number; calls: number; events: number; held: number };
type Turn = { you: string; reply: string; source: 'model' | 'runtime' | 'error'; ms: number; calls: number;
  steps: Receptionist['toolLog']; events: string[]; held: string[] };
type Session = { n: number; call: Call; rec: Receptionist; lang: 'th' | 'en'; model: string; caller: string; ani: string | null;
  ended: boolean; busy: Before | null; log: Turn[]; startedAt: string };
let session: Session | null = null, counter = 0;
/** What the person sent as the owner on LINE (the sandbox keeps only what the system sends). */
const ownerSent: Array<{ at: string; text: string }> = [];

// Background jobs (texts, reminders, the owner's questions) run one drain at a time.
let chain: Promise<unknown> = Promise.resolve();
const tick = () => { const p = chain.then(() => drain(new Date())); chain = p.catch(() => {}); return p; };

async function warm(model: string) {
  // Load the model into memory now so the first reply is not also the model's load time; kept for 30 minutes.
  try { await fetch(`${PROVIDERS.ollama.baseURL}/api/generate`, { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: '30m' }) }); } catch { /* the first reply will say */ }
}

async function prebook() {
  // The returning caller ("บี") already has a 60-minute Thai massage the day after tomorrow at 15:00.
  const pre = (await Call.start({ dialed: NUM.A.dialed, ani: CALLERS.returning, lang: 'th', now: () => new Date() })).call;
  const r = await pre.book({ service: 'นวดไทย 60', when: 'มะรืนนี้บ่ายสาม', name: 'บี' });
  await pre.end();
  if (r.stage !== 'create' || !r.result.ok) throw new Error(`could not make the returning caller's booking (${r.stage})`);
}

async function start(o: { lang?: string; model?: string; caller?: string; fresh?: boolean; disclose?: boolean }) {
  const lang = o.lang === 'en' ? 'en' : 'th';
  const model = MODELS.some(m => m.id === o.model) ? o.model! : MODELS[0].id;
  const caller = ['new', 'returning', 'withheld'].includes(o.caller ?? '') ? o.caller! : 'new';
  const problems = await client.preflight([model]);
  if (problems.length) throw new HttpError(503, problems.join(' '));
  if (session && !session.ended) await end();
  void warm(model);
  if (o.fresh !== false) { await seed(DB); ownerSent.length = 0; }
  if (caller === 'returning' && o.fresh !== false) await prebook();
  await setDisclosure(o.disclose === true);
  const ani = caller === 'withheld' ? null : CALLERS[caller as 'new' | 'returning'];
  const { call, unrouted } = await Call.start({ dialed: NUM.A.dialed, ani, lang, now: () => new Date() });
  if (unrouted) throw new HttpError(500, 'The sample spa is missing from the talk database: start a fresh call.');
  session = { n: ++counter, call, rec: new Receptionist(client, call, model, BUSINESS), lang, model, caller, ani, ended: false, busy: null, log: [], startedAt: new Date().toISOString() };
  return sessionView();
}

async function say(text: string) {
  const s = session;
  if (!s || s.ended) throw new HttpError(409, 'No call is open: start one first.');
  if (s.busy) throw new HttpError(409, 'The receptionist is still answering.');
  const words = text.trim().slice(0, 600);
  if (!words) throw new HttpError(400, 'Say something first.');
  const b: Before = { since: Date.now(), tools: s.rec.toolLog.length, calls: s.rec.usage.calls, events: s.rec.events.length, held: s.rec.discarded.length };
  s.busy = b;
  let turn: Turn;
  try {
    const reply = await s.rec.respond(words);
    turn = { you: words, reply, source: s.rec.lastSource, ms: Date.now() - b.since, calls: s.rec.usage.calls - b.calls,
      steps: s.rec.toolLog.slice(b.tools), events: s.rec.events.slice(b.events), held: s.rec.discarded.slice(b.held) };
  } catch (e) {
    turn = { you: words, reply: `The model did not answer (${(e as Error).message.slice(0, 200)}). Is Ollama running? Try again.`, source: 'error',
      ms: Date.now() - b.since, calls: s.rec.usage.calls - b.calls, steps: s.rec.toolLog.slice(b.tools), events: s.rec.events.slice(b.events), held: s.rec.discarded.slice(b.held) };
  } finally {
    s.busy = null;
  }
  s.log.push(turn);
  await tick().catch(() => {});
  return turn;
}

async function end() {
  const s = session;
  if (!s || s.ended) return sessionView();
  s.ended = true;
  await s.call.end('caller');
  await tick().catch(() => {});
  return sessionView();
}

async function owner(o: { text?: string; postback?: string; label?: string }) {
  const now = new Date(), id = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const text = o.text?.trim().slice(0, 1000);
  if (!text && !o.postback) throw new HttpError(400, 'Write a reply first.');
  const ev = o.postback
    ? { webhookEventId: `talk-${id}`, type: 'postback', source: { type: 'user', userId: NUM.A.ownerLine }, postback: { data: o.postback } }
    : { webhookEventId: `talk-${id}`, type: 'message', source: { type: 'user', userId: NUM.A.ownerLine }, message: { id: `talk-m-${id}`, type: 'text', text } };
  const body = JSON.stringify({ events: [ev] });
  const r = await lineWebhook(body, lineSignature(body, LINE_CHANNEL_SECRET), now);
  ownerSent.push({ at: now.toISOString(), text: text ?? `(pressed "${o.label ?? 'a button'}")` });
  await tick().catch(() => {});
  return { status: r.status, results: r.results };
}

function sessionView() {
  const s = session;
  return {
    models: MODELS, callers: CALLERS, tts: { gemini: !!process.env.GEMINI_API_KEY, voices: VOICES },
    call: s && { n: s.n, lang: s.lang, model: s.model, caller: s.caller, ani: s.ani, ended: s.ended, startedAt: s.startedAt,
      conversationId: s.call.conversationId, greeting: s.call.turns[0]?.text ?? '', log: s.log,
      busy: s.busy && { seconds: (Date.now() - s.busy.since) / 1000, steps: s.rec.toolLog.slice(s.busy.tools), calls: s.rec.usage.calls - s.busy.calls } },
  };
}

async function state() {
  const t = (sql: string, p: unknown[] = []) => withTenant(A, async tx => (await tx.query(sql, p)).rows);
  const [diary, holds, questions, services, staff, hours, facts, policy, sandbox] = await Promise.all([
    t(`select a.id, a.starts_at, a.ends_at, a.status, a.source, a.version, a.created_by_conversation, c.preferred_name,
         v.name service, v.name_en service_en,
         (select r.display_name from slot_claims sc join resources r on r.tenant_id = sc.tenant_id and r.id = sc.resource_id
           where sc.tenant_id = a.tenant_id and sc.appointment_id = a.id order by sc.created_at desc limit 1) staff,
         (select right(ci.value, 4) from client_identities ci where ci.tenant_id = a.tenant_id and ci.client_id = a.client_id and ci.kind = 'phone' limit 1) phone4
       from appointments a join clients c on c.tenant_id = a.tenant_id and c.id = a.client_id
       join service_variants v on v.tenant_id = a.tenant_id and v.id = a.variant_id
       where a.ends_at > now() - interval '12 hours' order by a.starts_at`),
    t(`select lower(sc.span) starts_at, upper(sc.span) ends_at, sc.hold_expires_at, r.display_name staff from slot_claims sc
       join resources r on r.tenant_id = sc.tenant_id and r.id = sc.resource_id
       where sc.kind = 'hold' and sc.status = 'active' and sc.hold_expires_at > now() order by lower(sc.span)`),
    t(`select handle, question_text, status, terminal_outcome, outcome_reason, caller_name, target_last4, created_at, expires_at
       from pending_questions order by created_at desc`),
    t(`select name, name_en, duration_min, buffer_after_min, price_minor, currency, price_is_authoritative from service_variants order by name`),
    t(`select r.display_name, r.name_en, array_agg(v.name_en order by v.name_en) services from resources r
       join resource_services rs on rs.tenant_id = r.tenant_id and rs.resource_id = r.id
       join service_variants v on v.tenant_id = rs.tenant_id and v.id = rs.variant_id group by r.display_name, r.name_en order by r.name_en`),
    t(`select coalesce(r.name_en, 'Spa') who, h.weekday, h.opens::text, h.closes::text from business_hours h
       left join resources r on r.tenant_id = h.tenant_id and r.id = h.resource_id order by who, h.weekday`),
    t(`select topic, question_general, answer_text, version, provenance, approved_at from knowledge_articles
       where status = 'published' and topic <> 'canary' order by topic, version`),
    t(`select body from policies order by version desc limit 1`),
    withSystem(async tx => (await tx.query(`select id, channel, sender, recipient, body, quick_replies, at from sandbox_messages
       where tenant_id = $1 order by id`, [A])).rows),
  ]);
  const owners: string[] = [NUM.A.ownerLine, NUM.A.ownerSms];
  return {
    now: new Date().toISOString(), diary, holds, questions, services, staff, hours, facts, policy: policy[0]?.body ?? null,
    toCaller: sandbox.filter(m => !owners.includes(m.recipient)),
    ownerThread: [...sandbox.filter(m => owners.includes(m.recipient)).map(m => ({ from: 'system', ...m })),
      ...ownerSent.map(m => ({ from: 'owner', at: m.at, body: m.text, channel: 'line' }))]
      .sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime()),
  };
}

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function readJson(req: http.IncomingMessage): Promise<any> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += (c as Buffer).length; if (size > 20_000) throw new HttpError(413, 'Too long.'); chunks.push(c as Buffer); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw new HttpError(400, 'Not JSON.'); }
}

const server = http.createServer(async (req, res) => {
  const send = (status: number, body: unknown, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  // This Mac only: refuse other host names (a page elsewhere cannot rebind its name to this server).
  const host = (req.headers.host ?? '').toLowerCase();
  if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(host)) return send(421, { error: 'This server answers 127.0.0.1 only.' });
  try {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/') return send(200, readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/session') return send(200, sessionView());
    if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await state());
    if (req.method === 'POST') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: 'JSON only.' });
      const body = await readJson(req);
      if (url.pathname === '/api/start') return send(200, await start(body));
      if (url.pathname === '/api/say') return send(200, await say(String(body.text ?? '')));
      if (url.pathname === '/api/end') return send(200, await end());
      if (url.pathname === '/api/owner') return send(200, await owner(body));
      if (url.pathname === '/api/tts') return send(200, await speech(String(body.text ?? '').trim().slice(0, 600), body.lang === 'en' ? 'en' : 'th', String(body.voice ?? '')), 'audio/wav');
    }
    send(404, { error: 'Not here.' });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(status, { error: (e as Error).message });
  }
});

await seed(DB);
setInterval(() => { tick().catch(() => {}); }, 5_000).unref();
server.listen(PORT, '127.0.0.1', () => console.log(`Talk to the receptionist: http://127.0.0.1:${PORT} (fictional spa, sandbox messages, ${MODELS[0].label} on this Mac)`));
