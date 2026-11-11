/**
 * `npm run sim` — seed the simulation database with fictional data and play three scripted calls, printing what
 * the caller hears, what the owner receives on LINE, and what would have been texted. Nothing leaves this machine.
 */
import { Clock, closeDb, withSystem, withTenant } from '../src/db.ts';
import { drain } from '../src/handlers.ts';
import { lineWebhook, LINE_CHANNEL_SECRET } from '../src/inbound.ts';
import { lineSignature } from '../src/messaging/channels.ts';
import { seed, A, NUM } from './seed.ts';
import { Call } from './session.ts';

process.env.RCPT_DB ??= 'rcpt';
await seed('rcpt');
const clock = new Clock('2026-11-12T03:00:00Z'); // Thu 12 Nov 2026, 10:00 Bangkok
const line = (s = '') => console.log(s);
const show = (call: Call) => { for (const t of call.turns) line(`  ${t.who === 'ai' ? 'AI     ' : 'Caller '} ${t.text}`); };
let shown = 0;
const outbox = async () => {
  const rows = await withSystem(async tx => (await tx.query(`select channel, recipient, body from sandbox_messages where tenant_id = $1 order by id`, [A])).rows);
  for (const r of rows.slice(shown)) line(`  ➜ ${r.channel === 'line' ? 'LINE to owner' : `SMS to ${r.recipient}`}:\n     ${r.body.replace(/\n/g, '\n     ')}`);
  shown = rows.length;
};
let ev = 0;
const ownerSays = async (e: { text?: string; quoted?: string; postback?: string }) => {
  const body = JSON.stringify({ events: [{ webhookEventId: `sim-${++ev}`, type: e.postback ? 'postback' : 'message', source: { type: 'user', userId: NUM.A.ownerLine },
    ...(e.postback ? { postback: { data: e.postback } } : { message: { id: `sim-m-${ev}`, type: 'text', text: e.text, quotedMessageId: e.quoted } }) }] });
  await lineWebhook(body, lineSignature(body, LINE_CHANNEL_SECRET), clock.now());
  await drain(clock.now());
};
const lastQuick = async (prefix: string) => {
  const rows = await withSystem(async tx => (await tx.query(`select quick_replies from sandbox_messages where tenant_id = $1 and quick_replies is not null order by id desc`, [A])).rows);
  for (const r of rows) { const q = r.quick_replies.find((x: any) => x.label.startsWith(prefix)); if (q) return q.data; }
  throw new Error(prefix);
};

line('SIMULATION — fictional business, fictional people, sandbox messages only\n');
line('Call 1 · booking + an unknown question (Thai)');
const c1 = (await Call.start({ dialed: NUM.A.dialed, ani: '+66812345678', now: () => clock.now() })).call;
await c1.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
await c1.ask('มีที่จอดรถไหมคะ');
const u = await c1.unknownQuestion({ question: 'มีที่จอดรถไหมคะ', summary: 'ร้านมีที่จอดรถให้ลูกค้าไหม', choice: 'text', callerName: 'อันนา' });
clock.advance(150_000);
await c1.end();
show(c1);
await drain(clock.now());
await outbox();

line('\n35 minutes later · the owner answers on LINE by quoting the question, checks the preview, taps Send');
clock.advance(35 * 60_000);
const notify = await withSystem(async tx => (await tx.query(`select provider_message_id from sandbox_messages where body like $1 and channel = 'line'`, [`%${u.pq!.pq_handle}%`])).rows[0]);
await ownerSays({ text: 'จอดได้ฟรีที่ลานหลังร้านหลังหกโมงเย็นค่ะ', quoted: notify.provider_message_id });
await outbox();
await ownerSays({ postback: await lastQuick('ส่ง') });
await outbox();
line('\nThe owner taps "save for future callers"');
await ownerSays({ postback: await lastQuick('บันทึก (โทร+ข้อความ)') });

line('\nCall 2 · a different caller asks the same question the next day (Thai) — the approved answer is used');
clock.advance(20 * 3600_000);
const c2 = (await Call.start({ dialed: NUM.A.dialed, ani: '+66898765432', now: () => clock.now() })).call;
await c2.ask('ร้านมีที่จอดรถไหม');
show(c2);

line('\nCall 3 · an emergency is never turned into an owner question (Thai)');
const c3 = (await Call.start({ dialed: NUM.A.dialed, ani: '+66811111111', now: () => clock.now() })).call;
c3.hear('เพื่อนหมดสติหลังนวด ทำยังไงดี');
await c3.unknownQuestion({ question: 'เพื่อนหมดสติหลังนวด ทำยังไงดี', summary: '-', choice: 'text' });
show(c3);

const outcomes = await withTenant(A, async tx => (await tx.query(`select handle, terminal_outcome from pending_questions`)).rows);
line(`\nPending questions: ${outcomes.map(o => `${o.handle} → ${o.terminal_outcome ?? 'open'}`).join(', ')}`);
await closeDb();
