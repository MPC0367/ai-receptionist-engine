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
import { createHash, randomUUID } from 'node:crypto';
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
import { spoken } from './spoken.ts';

process.env.RCPT_DB = 'rcpt_talk'; // read lazily by db() on first use, so setting it here is in time
const DB = 'rcpt_talk';
const PORT = Number(process.env.PORT ?? 4520);
const PAGE = path.join(import.meta.dirname, 'page.html');
const BUSINESS = 'ร้านสปาตัวอย่าง (Sample Day Spa)';
/**
 * The receptionist's model. Gemini 3.5 Flash-Lite answers in about a second on the free tier (the owner, 18 Nov 2026:
 * "increase the speed of the processor"), so it comes first when there is a key; Gemma and gpt-oss run on this Mac.
 */
const ALL_MODELS = [
  // Groq (the owner's choice, 18–20 Nov 2026, for steadily fast replies): ~0.5 s a request, but its free tier allows 8,000
  // tokens a minute per model (~3 receptionist requests), so "Fast" moves on to the next model the moment one is at its
  // limit: gpt-oss 120B, then 20B (its own allowance), then Gemini Flash-Lite.
  { id: 'fast', provider: 'chain' as const, label: 'Fast (Groq, with fallbacks)', note: 'about half a second a reply; moves to the next model if one is busy (the words go to Groq or Google)' },
  { id: 'openai/gpt-oss-120b', provider: 'groq' as const, label: 'gpt-oss 120B on Groq', note: 'fast: a fraction of a second a reply (Groq free tier; the words go to Groq)' },
  { id: 'openai/gpt-oss-20b', provider: 'groq' as const, label: 'gpt-oss 20B on Groq', note: 'fastest, smaller (Groq free tier; the words go to Groq)' },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini' as const, label: 'Gemini 3.5 Flash-Lite', note: 'fast: about a second a reply (free tier; the words go to Google)' },
  { id: 'gemma4:12b', provider: 'ollama' as const, label: 'Gemma 4 12B', note: 'on this Mac: 16 of 16 scenarios, 4 to 15 seconds a reply' },
  { id: 'gpt-oss:20b', provider: 'ollama' as const, label: 'gpt-oss 20B', note: 'on this Mac: 14 of 16 scenarios, slower' },
];
const MODELS = ALL_MODELS.filter(m => m.provider === 'ollama' || (m.provider === 'gemini' && process.env.GEMINI_API_KEY) || ((m.provider === 'groq' || m.provider === 'chain') && process.env.GROQ_API_KEY));
/** Fictional caller numbers (INV-12). */
const CALLERS = { new: '+66812349001', returning: '+66812349002' } as const;
const clients = { ollama: new CompatClient({ provider: 'ollama' }), gemini: new CompatClient({ provider: 'gemini', minIntervalMs: 0 }), groq: new CompatClient({ provider: 'groq', minIntervalMs: 0 }) };
/** Fail-fast clients for the chain: a model at its limit is skipped at once rather than waited for. */
const quick = { groq: new CompatClient({ provider: 'groq', minIntervalMs: 0, maxRetries: 0 }), gemini: new CompatClient({ provider: 'gemini', minIntervalMs: 0, maxRetries: 1 }) };
const CHAIN = [
  { client: quick.groq, model: 'openai/gpt-oss-120b' }, { client: quick.groq, model: 'openai/gpt-oss-20b' }, { client: quick.gemini, model: 'gemini-3.5-flash-lite' },
];
const chainRest = new Map<string, number>();
/** "Fast": the first model in CHAIN that is not resting answers; a refusal for rate or load rests it for a minute. */
const fastChain = {
  messages: {
    create: async (p: any) => {
      let last: unknown;
      for (const step of CHAIN) {
        if ((chainRest.get(step.model) ?? 0) > Date.now()) continue;
        if (step.client === quick.gemini && !process.env.GEMINI_API_KEY) continue;
        try { return await step.client.messages.create({ ...p, model: step.model }); }
        catch (e) {
          last = e;
          if (!/rate|quota|429|5\d\d|busy|demand|timeout|abort/i.test(String((e as Error).message))) throw e;
          // A day's allowance gone (Groq: "tokens per day") rests the model for half an hour, a minute's for a minute.
          chainRest.set(step.model, Date.now() + (/per day|TPD|RPD/i.test(String((e as Error).message)) ? 30 * 60_000 : 60_000));
        }
      }
      throw last ?? new Error('every model is busy: try again in a minute');
    },
  },
};
const clientFor = (model: string): any => { const p = ALL_MODELS.find(m => m.id === model)?.provider ?? 'ollama'; return p === 'chain' ? fastChain : clients[p]; };

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
  th: "A young Thai woman at the front desk of a Bangkok day spa, on the phone with a customer. She sounds like a real person in conversation, not a recording: relaxed, warm, a smile in her voice, everyday Thai with natural rhythm and the small pauses people make, soft ค่ะ and นะคะ. Not an announcer, not reading aloud, not too slow. Say exactly the transcript, nothing added.",
  en: "A young woman at the front desk of a Bangkok day spa, on the phone with a customer, speaking English with a light Thai accent. She sounds like a real person in conversation, not a recording: relaxed, warm, a smile in her voice, natural rhythm and small pauses. Not an announcer, not reading aloud, not too slow. Say exactly the transcript, nothing added.",
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
/**
 * The receptionist's voice for one line, streamed: Gemini sends the audio in pieces (the first after about a second,
 * against about three for the whole line, 18 Nov 2026), and the page plays each as it arrives. A line said before comes
 * from .data/tts at once. Returns false when no voice model will answer (the page then uses the Mac's voice).
 */
async function speech(res: http.ServerResponse, written: string, lang: 'th' | 'en', voice: string, headers: Record<string, string>): Promise<boolean> {
  const text = spoken(written, lang);
  const key = process.env.GEMINI_API_KEY;
  const v = VOICES.some(x => x.id === voice) ? voice : VOICES[0].id;
  const file = path.join(TTS_DIR, createHash('sha256').update(`${v}|${lang}|${text}`).digest('hex').slice(0, 32) + '.wav');
  if (existsSync(file)) { res.writeHead(200, { ...headers, 'content-type': 'audio/wav' }); res.end(readFileSync(file)); return true; }
  if (!key) return false;
  for (const model of TTS_MODELS) {
    if ((resting.get(model) ?? 0) > Date.now()) continue;
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST', signal: AbortSignal.timeout(25_000), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: `### DIRECTOR'S NOTES\n${NOTES[lang]}\n\n### TRANSCRIPT\n${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } } }),
      });
    } catch { resting.set(model, Date.now() + 30_000); continue; }
    if (!r.ok || !r.body) {
      const err = await r.text().catch(() => '');
      resting.set(model, r.status === 429 ? (err.includes('PerDay') ? pacificMidnight() : Date.now() + 60_000) : Date.now() + 30_000);
      continue;
    }
    // Server-sent events, one piece of 16-bit PCM (24 kHz, mono) in each; passed on as they come, kept for the cache.
    const pieces: Buffer[] = [];
    let buf = '', started = false, ok = true;
    const dec = new TextDecoder();
    try {
      for await (const part of r.body as any) {
        buf += dec.decode(part, { stream: true }).replace(/\r/g, '');
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = ev.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const data = JSON.parse(line.slice(6))?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
          if (!data) continue;
          const pcm = Buffer.from(data, 'base64');
          if (!started) { res.writeHead(200, { ...headers, 'content-type': 'audio/L16; rate=24000; channels=1' }); started = true; }
          pieces.push(pcm); res.write(pcm);
        }
      }
    } catch { ok = false; }
    if (!started) { resting.set(model, Date.now() + 30_000); continue; }
    res.end();
    if (ok) { mkdirSync(TTS_DIR, { recursive: true }); writeFileSync(file, wav(Buffer.concat(pieces))); }
    return true;
  }
  return false;
}

/**
 * The talk page's choices for the greeting: whether it says it is an AI (policy ai_disclosure; asked, it always says so)
 * and the receptionist's name (policy assistant_name).
 */
async function setGreeting(disclose: boolean, name: string, lang: 'th' | 'en') {
  const c = new pg.Client({ host: '127.0.0.1', port: 54421, user: 'rcpt', database: DB });
  await c.connect();
  try {
    await c.query(`update policies set body = body || jsonb_build_object('ai_disclosure', $2::boolean, 'assistant_name', jsonb_build_object($3::text, $4::text)) where tenant_id = $1`,
      [A, disclose, lang, name]);
  } finally { await c.end(); }
}

type Before = { since: number; tools: number; calls: number; events: number; held: number };
type Turn = { you: string; reply: string; source: 'model' | 'runtime' | 'error'; ms: number; calls: number;
  steps: Receptionist['toolLog']; events: string[]; held: string[] };
type Session = { n: number; call: Call; rec: Receptionist; lang: 'th' | 'en'; model: string; caller: string; ani: string | null;
  ended: boolean; busy: Before | null; log: Turn[]; startedAt: string; owner: string; lastActive: number };
/**
 * One line, one call at a time (18 Nov 2026: the page went public through a tunnel, to share with a colleague). The
 * visitor who starts a call owns it (a cookie); anyone else hears that the line is busy until it ends or has been quiet
 * for IDLE_MS, when it ends by itself.
 */
const IDLE_MS = 4 * 60_000;
const busyFor = (who: string) => !!session && !session.ended && session.owner !== who && Date.now() - session.lastActive < IDLE_MS;
const BUSY = 'The line is busy: someone else is on a call with the receptionist. Try again in a few minutes.';
const mine = (who: string) => { if (!session || session.owner !== who) throw new HttpError(403, 'This call belongs to someone else: start your own when the line is free.'); return session; };

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

async function start(o: { lang?: string; model?: string; caller?: string; fresh?: boolean; disclose?: boolean; name?: string }, who: string) {
  if (busyFor(who)) throw new HttpError(409, BUSY);
  const lang = o.lang === 'en' ? 'en' : 'th';
  const model = MODELS.some(m => m.id === o.model) ? o.model! : MODELS[0].id;
  const caller = ['new', 'returning', 'withheld'].includes(o.caller ?? '') ? o.caller! : 'new';
  const client = clientFor(model);
  const problems = client === fastChain ? [] : await client.preflight([model]);
  if (problems.length) throw new HttpError(503, problems.join(' '));
  if (session && !session.ended) await end(session.owner);
  if (ALL_MODELS.find(m => m.id === model)?.provider === 'ollama') void warm(model);
  if (o.fresh !== false) { await seed(DB); ownerSent.length = 0; }
  if (caller === 'returning' && o.fresh !== false) await prebook();
  const name = String(o.name ?? '').replace(/[^\p{L}\p{M} .'-]/gu, '').trim().slice(0, 24) || (lang === 'th' ? 'มิ้นท์' : 'Mint');
  await setGreeting(o.disclose === true, name, lang);
  const ani = caller === 'withheld' ? null : CALLERS[caller as 'new' | 'returning'];
  const { call, unrouted } = await Call.start({ dialed: NUM.A.dialed, ani, lang, now: () => new Date() });
  if (unrouted) throw new HttpError(500, 'The sample spa is missing from the talk database: start a fresh call.');
  session = { n: ++counter, call, rec: new Receptionist(client, call, model, BUSINESS), lang, model, caller, ani, ended: false, busy: null, log: [], startedAt: new Date().toISOString(), owner: who, lastActive: Date.now() };
  return sessionView(who);
}

async function say(text: string, who: string) {
  if (!session || session.ended) throw new HttpError(409, 'No call is open: start one first.');
  const s = mine(who);
  s.lastActive = Date.now();
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
    s.busy = null; s.lastActive = Date.now();
  }
  s.log.push(turn);
  await tick().catch(() => {});
  return turn;
}

async function end(who: string, endedBy: 'caller' | 'max_duration' = 'caller') {
  if (!session || session.ended) return sessionView(who);
  const s = mine(who);
  s.ended = true;
  await s.call.end(endedBy);
  await tick().catch(() => {});
  return sessionView(who);
}

async function owner(o: { text?: string; postback?: string; label?: string }, who: string) {
  // The owner's side of the latest call belongs to whoever made it (its questions arrive after it ends).
  mine(who);
  if (session) session.lastActive = Date.now();
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

function sessionView(who: string) {
  const s = session && session.owner === who ? session : null;
  return {
    models: MODELS, callers: CALLERS, tts: { gemini: !!process.env.GEMINI_API_KEY, voices: VOICES }, lineBusy: busyFor(who),
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

/** Requests per visitor (by address) in a window: enough for a call, not for a flood. */
const hits = new Map<string, number[]>();
function limit(ip: string, kind: string, n: number, windowMs: number) {
  const key = `${kind}|${ip}`, now = Date.now(), recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= n) throw new HttpError(429, 'Too many requests: wait a minute and try again.');
  recent.push(now); hits.set(key, recent);
}
/**
 * Host names this server answers: this Mac, and with TALK_PUBLIC=1 a Cloudflare quick tunnel (*.trycloudflare.com) or
 * the name in TALK_PUBLIC_HOST. Anything else is refused, so no page elsewhere can rebind its name to this server.
 */
function allowedHost(host: string) {
  if ([`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(host)) return true;
  if (process.env.TALK_PUBLIC !== '1') return false;
  return host.endsWith('.trycloudflare.com') || (!!process.env.TALK_PUBLIC_HOST && host === process.env.TALK_PUBLIC_HOST.toLowerCase());
}

const server = http.createServer(async (req, res) => {
  const cookies = Object.fromEntries((req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).filter(([k, v]) => k && v));
  const fresh = !/^[0-9a-f-]{36}$/.test(cookies.talk_id ?? '');
  const who: string = fresh ? randomUUID() : cookies.talk_id;
  const https = req.headers['x-forwarded-proto'] === 'https' || String(req.headers['cf-visitor'] ?? '').includes('https');
  const ip = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '');
  const base: Record<string, string> = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex',
    ...(fresh ? { 'set-cookie': `talk_id=${who}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${https ? '; Secure' : ''}` } : {}) };
  const send = (status: number, body: unknown, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { ...base, 'content-type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const host = (req.headers.host ?? '').toLowerCase();
  if (!allowedHost(host)) return send(421, { error: 'This server answers this Mac and its own tunnel only.' });
  try {
    if (req.url?.startsWith('/api/')) limit(ip, 'api', 240, 60_000);
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/') return send(200, readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/session') return send(200, sessionView(who));
    if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await state());
    if (req.method === 'POST') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: 'JSON only.' });
      const body = await readJson(req);
      if (url.pathname === '/api/start') { limit(ip, 'start', 8, 10 * 60_000); return send(200, await start(body, who)); }
      if (url.pathname === '/api/say') return send(200, await say(String(body.text ?? ''), who));
      if (url.pathname === '/api/end') return send(200, await end(who));
      if (url.pathname === '/api/owner') return send(200, await owner(body, who));
      if (url.pathname === '/api/tts') {
        // Only what the receptionist said in the visitor's own call: the voice is O2's quota.
        const text = String(body.text ?? '').trim().slice(0, 600), s = mine(who);
        const said = s.call.turns.filter(t => t.who === 'ai').map(t => t.text).join(' ');
        if (!text || !said.includes(text)) throw new HttpError(403, 'Only the receptionist\'s own words are voiced.');
        if (!await speech(res, text, body.lang === 'en' ? 'en' : 'th', String(body.voice ?? ''), base)) throw new HttpError(429, 'The Gemini voice is used up for now: the Mac voice is answering.');
        return;
      }
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
// A call left open and quiet ends by itself, so the line frees up.
setInterval(() => {
  if (session && !session.ended && !session.busy && Date.now() - session.lastActive > IDLE_MS) end(session.owner, 'max_duration').catch(() => {});
}, 30_000).unref();
server.listen(PORT, '127.0.0.1', () => console.log(`Talk to the receptionist: http://127.0.0.1:${PORT} (fictional spa, sandbox messages, ${MODELS[0].label} on this Mac)`));
