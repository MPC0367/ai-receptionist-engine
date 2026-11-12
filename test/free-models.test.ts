/**
 * The free-model adapter against a stand-in server on this Mac (no network, no model, no spend): request and
 * response translation for Ollama's /api/chat and OpenAI-compatible /chat/completions, a booking end to end through
 * each, the runtime's own checks on malformed tool calls and markup, retries and quota stops.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { A, NUM, Call, CALLER, closeDb, fresh, sha, withTenant } from './helpers.ts';
import { Receptionist } from '../sim/model/receptionist.ts';
import { checkArgs, TOOL_SPECS } from '../sim/model/tools.ts';
import { CompatClient, NO_THINK_CAP, PROVIDERS, QuotaError, fromOpenAI, toOpenAI, type CompatStats } from '../sim/model/free-models.ts';
import { cost } from '../sim/model/run.ts';

type Reply = { text?: string; tool?: { name: string; args: unknown }; cut?: boolean } | { status: number; retryAfter?: string };
type Brain = (msgs: any[]) => Reply;

let server: Server, port = 0, brain: Brain = () => ({ text: 'ค่ะ' });
const bodies: Array<{ path: string; body: any }> = [];
let n = 0;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (status: number, obj: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/tags') return send(200, { models: [{ name: 'stand-in:latest' }] });
      if (req.url === '/api/show') return send(200, { capabilities: body.model === 'thinker' ? ['completion', 'tools', 'thinking'] : ['completion', 'tools'] });
      bodies.push({ path: req.url!, body });
      const r = brain(body.messages);
      if ('status' in r) return send(r.status, { error: 'slow down' }, r.retryAfter ? { 'retry-after': r.retryAfter } : {});
      if (req.url === '/api/chat') {
        return send(200, { model: body.model, done: true, done_reason: r.cut ? 'length' : 'stop', prompt_eval_count: 1200, prompt_eval_cached_count: 1000, eval_count: 30,
          message: { role: 'assistant', content: r.text ?? '', thinking: 'private reasoning', ...(r.tool ? { tool_calls: [{ function: { name: r.tool.name, arguments: r.tool.args } }] } : {}) } });
      }
      return send(200, { id: `cmpl_${++n}`, choices: [{ index: 0, finish_reason: r.tool ? 'tool_calls' : 'stop',
        message: { role: 'assistant', content: r.text ?? null, ...(r.tool ? { tool_calls: [{ id: `call_${++n}`, type: 'function', function: { name: r.tool.name, arguments: typeof r.tool.args === 'string' ? r.tool.args : JSON.stringify(r.tool.args) } }] } : {}) } }],
        usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } } });
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});
after(async () => { server.close(); await closeDb(); });

const tool = (name: string, args: unknown): Reply => ({ tool: { name, args } });
const text = (t: string): Reply => ({ text: t });

/** Books when asked; the same brain serves both formats (tool results arrive as role 'tool' in each). */
const booker: Brain = msgs => {
  const last = msgs.at(-1);
  const tr = last.role === 'tool' ? JSON.parse(last.content) : null;
  const u = [...msgs].reverse().find((m: any) => m.role === 'user')?.content ?? '';
  if (tr?.data?.options) return tool('hold_slot', { slot_token: tr.data.options[0].slot_token, client_name: 'อันนา', for_booking_ref: null });
  if (tr?.data?.booking_ref) return text('<think>the booking went through</think>จองเรียบร้อยแล้วค่ะ');
  if (tr && !tr.ok) return text('ขออภัยค่ะ');
  if (u.startsWith('ใช่')) {
    const hold = msgs.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)).find((x: any) => x.data?.hold_ref)?.data.hold_ref;
    return tool('create_booking', { hold_ref: hold, client_name: 'อันนา', send_confirmation_text: false });
  }
  if (u.includes('จอง')) return tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: null });
  return text('<think>the caller thanked me</think>ค่ะ');
};

async function bookThrough(client: CompatClient) {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  brain = booker; bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  const r1 = await rec.respond('ขอจองนวดไทย 60 พรุ่งนี้บ่ายสามค่ะ ชื่ออันนา');
  const r2 = await rec.respond('ใช่ค่ะ');
  const r3 = await rec.respond('ขอบคุณครับ');
  const booked = await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments`)).rows[0].n);
  return { r1, r2, r3, booked, rec };
}

test('OpenAI-compatible route: books end to end; tool calls and results keep their ids; Claude-only fields are not sent', async () => {
  const client = new CompatClient({ provider: 'openai-compatible', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key' });
  const { r1, r2, r3, booked, rec } = await bookThrough(client);
  assert.match(r1, /^ขอทวนนะคะ: นวดไทย 60 นาที/, 'the runtime read the confirmation');
  assert.equal(r2, 'จองเรียบร้อยแล้วค่ะ ต้องการรับข้อความยืนยันการจองทางเบอร์ที่โทรมาไหมคะ', 'the runtime offers the text');
  assert.equal(r3, 'ค่ะ', 'a thank-you is not a yes ("ครับ" holds "รับ"), and reasoning in <think> is never spoken');
  assert.equal(booked, 1);
  assert.deepEqual(rec.events, []);
  const last = bodies.at(-1)!.body;
  assert.ok(bodies.every(b => b.path === '/v1/chat/completions'));
  assert.equal(last.messages[0].role, 'system');
  assert.ok(!('cache_control' in last) && !('output_config' in last) && !('reasoning_effort' in last));
  assert.ok(last.tools.every((t: any) => t.type === 'function' && t.function.parameters.additionalProperties === false));
  const ids = last.messages.flatMap((m: any) => m.tool_calls ?? []).map((c: any) => c.id);
  const answered = last.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id);
  assert.deepEqual(answered, ids, 'every tool result answers its own call');
  assert.ok(last.messages.flatMap((m: any) => m.tool_calls ?? []).every((c: any) => typeof c.function.arguments === 'string'));
  const seen = JSON.stringify(bodies.map(b => b.body.messages));
  assert.ok(!/eyJ|[0-9a-f]{8}-[0-9a-f]{4}-/.test(seen), 'no signed slot token or UUID ever reaches the model');
  assert.match(seen, /\\"slot_token\\":\\"S1\\"/);
  assert.match(seen, /\\"hold_ref\\":\\"H1\\"/);
  assert.match(seen, /\\"booking_ref\\":\\"B1\\"/);
  assert.equal(rec.usage.cacheRead, 1000 * rec.usage.calls, 'cached prompt tokens are counted as cache reads');
  assert.equal(rec.usage.input, 200 * rec.usage.calls);
});

test('Ollama route: books end to end with arguments as objects and a context window set per request', async () => {
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  assert.deepEqual(await client.preflight(['stand-in']), []);
  assert.match((await client.preflight(['gemma4:12b']))[0], /ollama pull gemma4:12b/);
  const { r1, r2, booked } = await bookThrough(client);
  assert.match(r1, /^ขอทวนนะคะ/);
  assert.match(r2, /ต้องการรับข้อความยืนยัน/);
  assert.equal(booked, 1);
  const last = bodies.at(-1)!.body;
  assert.ok(bodies.every(b => b.path === '/api/chat'));
  assert.equal(last.stream, false);
  assert.equal(last.options.num_ctx, 16_384, 'Ollama would otherwise cut the start of the prompt');
  assert.ok(!('think' in last), 'no think field unless asked');
  const calls = last.messages.flatMap((m: any) => m.tool_calls ?? []);
  assert.ok(calls.length >= 2 && calls.every((c: any) => typeof c.function.arguments === 'object'));
  assert.ok(last.messages.filter((m: any) => m.role === 'tool').every((m: any) => !('tool_call_id' in m)));
});

test('a malformed tool call never reaches the gateway: the model is told what was wrong', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'openai-compatible', baseURL: `http://127.0.0.1:${port}/v1` });
  let step = 0;
  brain = msgs => {
    step++;
    if (step === 1) return tool('search_availability', { variant_ref: 'นวดไทย 60', when: 'พรุ่งนี้' });
    if (step === 2) return tool('hold_slot', '{"slot_token": "abc", ');
    return text(`ขอทราบวันและเวลาที่สะดวกค่ะ`);
  };
  bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  const r = await rec.respond('อยากจองนวดค่ะ');
  assert.equal(r, 'ขอทราบวันและเวลาที่สะดวกค่ะ');
  assert.deepEqual(rec.events, ['invalid_tool_call', 'invalid_tool_call']);
  const errs = bodies.at(-1)!.body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
  assert.equal(errs[0].error.code, 'INVALID_ARGUMENTS');
  assert.ok(errs[0].error.problems.includes('arguments.date_phrase is required'));
  assert.ok(errs[0].error.problems.includes('arguments.when is not a known field'));
  assert.ok(errs[1].error.problems.some((p: string) => p.includes('__unparseable_arguments')));
  assert.equal(client.stats.unparseableArgs, 1);
  const holds = await withTenant(A, async tx => (await tx.query(`select count(*)::int n from holds`)).rows[0].n);
  assert.equal(holds, 0);
});

test('a label the tools never gave (or a mangled real token) is refused before the gateway', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = () => ++step === 1 ? tool('hold_slot', { slot_token: 'S9', client_name: 'มด' }) : step === 2 ? tool('cancel_booking', { booking_ref: 'eyJ0IjoiMTEx.forged', confirmed: true }) : text('ขอเช็กอีกครั้งนะคะ');
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('จองเวลาเมื่อกี้เลยค่ะ'), 'ขออภัยค่ะ รายการนี้ยังไม่สำเร็จ ยังไม่มีการเปลี่ยนแปลงใดๆ นะคะ', 'after a refused cancellation the runtime, not the model, speaks');
  assert.deepEqual(rec.events, ['unknown_reference', 'invalid_tool_call', 'unknown_reference', 'invalid_tool_call', 'unconfirmed_write']);
  assert.match(rec.toolLog[0].problems![0], /slot_token "S9" was not given by a tool/);
  assert.equal(await withTenant(A, async tx => (await tx.query(`select count(*)::int n from holds`)).rows[0].n), 0);
});

test('markup or silence is never read to a caller', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  brain = () => text('<tool_call>{"name": "get_business_facts", "arguments": {"question": "parking"}}</tool_call>');
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('มีที่จอดรถไหมคะ'), 'ขออภัยค่ะ ระบบขัดข้องเล็กน้อย');
  brain = () => text('');
  assert.equal(await rec.respond('ฮัลโหลค่ะ'), 'ขออภัยค่ะ ระบบขัดข้องเล็กน้อย');
  assert.deepEqual(rec.events, ['machine_text_rejected', 'retried', 'machine_text_rejected', 'retried_words_only', 'machine_text_rejected',
    'empty_reply', 'retried', 'empty_reply', 'retried_words_only', 'empty_reply'], 'a retry with tools, one for words only, then the runtime line');
  assert.equal(client.stats.toolCallsAsText, 3);
  assert.ok(!call.turns.some(t => t.text.includes('tool_call')));
});

test('rate limits: waits as told and retries; a quota that never lifts stops the run with QuotaError', async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => { waits.push(ms); };
  let left = 2;
  brain = () => left-- > 0 ? { status: 429, retryAfter: '1' } : text('ค่ะ');
  const client = new CompatClient({ provider: 'openai-compatible', baseURL: `http://127.0.0.1:${port}/v1`, sleep });
  const r = await client.messages.create({ model: 'stand-in', max_tokens: 50, messages: [{ role: 'user', content: 'สวัสดีค่ะ' }] });
  assert.equal(r.content[0].text, 'ค่ะ');
  assert.equal(client.stats.retries, 2);
  assert.deepEqual(waits.filter(w => w > 0), [1000, 1000]);
  brain = () => ({ status: 429 });
  const stuck = new CompatClient({ provider: 'openai-compatible', baseURL: `http://127.0.0.1:${port}/v1`, sleep, maxRetries: 2 });
  await assert.rejects(stuck.messages.create({ model: 'stand-in', max_tokens: 50, messages: [{ role: 'user', content: 'x' }] }), QuotaError);
  waits.length = 0;
  brain = () => ({ status: 429, retryAfter: '3600' });
  await assert.rejects(stuck.messages.create({ model: 'stand-in', max_tokens: 50, messages: [{ role: 'user', content: 'x' }] }), QuotaError);
  assert.deepEqual(waits.filter(w => w > 0), [], 'a day-long wait is not slept through');
  brain = () => ({ status: 400 });
  await assert.rejects(stuck.messages.create({ model: 'stand-in', max_tokens: 50, messages: [{ role: 'user', content: 'x' }] }), /400/);
});

test('Gemini preset: no additionalProperties anywhere (the runtime enforces it); effort becomes reasoning_effort', () => {
  const body = toOpenAI({ model: 'gemini-3.8-flash', max_tokens: 400, system: 's', output_config: { effort: 'low' },
    tools: TOOL_SPECS.map(t => ({ ...t, strict: true })), messages: [{ role: 'user', content: 'hi' }] }, PROVIDERS.gemini);
  assert.equal(body.reasoning_effort, 'low');
  assert.ok(!JSON.stringify(body.tools).includes('additionalProperties'));
  assert.ok(!JSON.stringify(body.tools).includes('strict'));
  const roa = body.tools.find((t: any) => t.function.name === 'request_owner_answer');
  assert.deepEqual(roa.function.parameters.properties.reply_target.required, ['kind']);
});

test('response mapping: finish reasons and usage', () => {
  const stats: CompatStats = { requests: 0, retries: 0, unparseableArgs: 0, toolCallsAsText: 0, tokens: 0 };
  const r = fromOpenAI({ choices: [{ finish_reason: 'length', message: { content: 'ค่ะ' } }], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } } }, stats);
  assert.equal(r.stop_reason, 'max_tokens');
  assert.deepEqual(r.usage, { input_tokens: 600, output_tokens: 50, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 });
  assert.equal(fromOpenAI({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }, stats).stop_reason, 'refusal');
  const t = fromOpenAI({ choices: [{ finish_reason: 'stop', message: { content: null, tool_calls: [{ function: { name: 'get_client_context', arguments: '' } }] } }] }, stats);
  assert.equal(t.stop_reason, 'tool_use', 'a tool call is a tool call whatever the finish reason');
  assert.deepEqual(t.content[0].input, {});
  assert.ok(t.content[0].id, 'a missing call id is made up');
});

test('checkArgs: required, unknown, type and enum faults; valid calls pass', () => {
  assert.deepEqual(checkArgs('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้' }), []);
  assert.deepEqual(checkArgs('get_client_context', {}), []);
  assert.deepEqual(checkArgs('make_coffee', {}), ['unknown tool make_coffee']);
  assert.deepEqual(checkArgs('cancel_booking', { booking_ref: 'b1', confirmed: 'true' }), ['arguments.confirmed must be true or false']);
  assert.deepEqual(checkArgs('record_consent', { purpose: 'marketing', target: 'ani', question_text: 'q' }), ['arguments.purpose must be one of service_followup']);
  assert.deepEqual(checkArgs('request_owner_answer', { question_text: 'q', summary_source: 'model', reply_target: { kind: 'ani', extra: 1 } }), ['arguments.reply_target.extra is not a known field']);
  assert.deepEqual(checkArgs('hold_slot', 'abc'), ['arguments must be an object']);
});

test('cost: free models cost nothing; an unpriced Claude model refuses to run', () => {
  const u = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, calls: 1, ms: 0 };
  assert.equal(cost('gemma4:12b', u), 0);
  assert.throws(() => cost('claude-unknown-9', u), /No price/);
});

test('preflight: a free cloud route without its key says how to save one; nothing is fetched', async () => {
  const saved = process.env.CEREBRAS_API_KEY;
  delete process.env.CEREBRAS_API_KEY;
  try {
    const c = new CompatClient({ provider: 'cerebras', fetch: () => { throw new Error('no network in this test'); } });
    assert.deepEqual(await c.preflight(['gpt-oss-120b']), ['cerebras needs CEREBRAS_API_KEY in engine/.env.local (sh scripts/save-key.sh cerebras).']);
  } finally { if (saved !== undefined) process.env.CEREBRAS_API_KEY = saved; }
});

test('thinking is off by default where a model can think; asked for, it gets room on top of the answer', async () => {
  brain = () => text('ค่ะ');
  bodies.length = 0;
  const off = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  await off.messages.create({ model: 'thinker', max_tokens: 400, messages: [{ role: 'user', content: 'x' }] });
  await off.messages.create({ model: 'stand-in', max_tokens: 400, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(bodies[0].body.think, false);
  assert.equal(bodies[0].body.options.num_predict, NO_THINK_CAP);
  assert.ok(!('think' in bodies[1].body), 'a model that cannot think is sent nothing');
  const on = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}`, think: 'on' });
  await on.messages.create({ model: 'thinker', max_tokens: 400, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(bodies[2].body.think, true);
  assert.equal(bodies[2].body.options.num_predict, 400 + 8_192);
});

test('a placeholder for the caller\'s name is refused: the model must ask', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = msgs => {
    step++;
    const last = msgs.at(-1), tr = last.role === 'tool' ? JSON.parse(last.content) : null;
    if (step === 1) return tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม' });
    if (step === 2) return tool('hold_slot', { slot_token: tr.data.options[0].slot_token, client_name: 'คุณลูกค้า' });
    return text('ขอทราบชื่อผู้จองด้วยค่ะ');
  };
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('ขอจองนวดไทย 60 พรุ่งนี้บ่ายสามค่ะ'), 'ขอทราบชื่อผู้จองด้วยค่ะ');
  assert.match(rec.toolLog[1].problems![0], /is not a name the caller gave/);
  assert.equal(await withTenant(A, async tx => (await tx.query(`select count(*)::int n from holds`)).rows[0].n), 0);
});

test('a name the caller gives with คุณ is not read back as "คุณคุณ"', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม' });
  const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, client_name: 'คุณมด' });
  assert.match(h.data.rendered_confirmation.th, /ในชื่อคุณมด ยืนยัน/);
});

test('a reschedule: the hold names both times, only reschedule_booking is offered, and a failed write is never called done', async () => {
  const clock = await fresh();
  const pre = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  await pre.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'บี' });
  await pre.end();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = msgs => {
    step++;
    const last = msgs.at(-1), tr = last.role === 'tool' ? JSON.parse(last.content) : null;
    if (step === 1) return tool('get_bookings_for_caller', {});
    if (step === 2) return tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '21 พ.ย. 69 บ่ายสาม', for_booking_ref: tr.data.bookings[0].booking_ref });
    if (step === 3) return tool('hold_slot', { slot_token: tr.data.options[0].slot_token, client_name: 'บี', for_booking_ref: 'B1' });
    if (step === 4) return tool('create_booking', { hold_ref: 'H1', client_name: 'บี' });
    return text('เลื่อนนัดเรียบร้อยแล้วค่ะ');
  };
  bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  const confirm = await rec.respond('ขอเลื่อนนัดวันที่ 20 เป็นวันที่ 21 พ.ย. บ่ายสามค่ะ');
  assert.match(confirm, /^ขอทวนนะคะ: เลื่อนนัดนวดไทย 60 นาที จากวันศุกร์ที่ 20 พฤศจิกายน 2569 เวลา 15:00 น\. \(บ่ายสามโมง\) เป็นวันเสาร์ที่ 21 พฤศจิกายน 2569/);
  assert.match(confirm, /ยืนยันเลื่อนนัดเลยไหมคะ$/);
  const reply = await rec.respond('ใช่ค่ะ');
  const offered = bodies.at(-1)!.body.tools.map((t: any) => t.function.name);
  assert.ok(offered.includes('reschedule_booking') && !offered.includes('create_booking'));
  assert.match(rec.toolLog.at(-1)!.problems![0], /call reschedule_booking/);
  assert.equal(reply, 'ขออภัยค่ะ รายการนี้ยังไม่สำเร็จ ยังไม่มีการเปลี่ยนแปลงใดๆ นะคะ', 'never "done" after a refused write');
  assert.ok(rec.events.includes('unconfirmed_write'));
});

test('a reply cut off at the token limit is never read out', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const stats: CompatStats = { requests: 0, retries: 0, unparseableArgs: 0, toolCallsAsText: 0, tokens: 0 };
  const cut = { messages: { create: async () => fromOpenAI({ choices: [{ finish_reason: 'length', message: { content: 'ค่ะ ค่ะ ค่ะ ค่ะ' } }] }, stats) } };
  const rec = new Receptionist(cut, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('สวัสดีค่ะ'), 'ขออภัยค่ะ ระบบขัดข้องเล็กน้อย');
  assert.deepEqual(rec.events, ['reply_cut_off', 'retried', 'reply_cut_off', 'retried_words_only', 'reply_cut_off']);
});

test('an emergency stays an emergency: "still not conscious" triggers the rule, and a discarded reply repeats 1669', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  brain = () => text('ให้ยกขาสูง 30 เซนติเมตรค่ะ'); // an invented number: the grounding check throws it away
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  const first = await rec.respond('แม่หมดสติหลังนวดค่ะ');
  assert.match(first, /1669/);
  assert.match(await rec.respond('แม่ยังไม่รู้สึกตัวเลยค่ะ'), /1669/, 'ไม่รู้สึกตัว is on the emergency list');
  assert.equal(await rec.respond('ต้องทำอะไรก่อนดีคะ'), first, 'a discarded reply repeats the emergency line, not "no confirmed answer"');
  assert.deepEqual(rec.events, ['emergency_rule', 'emergency_rule', 'grounding_rejected']);
});

test('an internal label is never said to the caller', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  brain = () => text('ตรวจสอบข้อมูลการจองลำดับที่ B1 ให้แล้วค่ะ');
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('ขอเลื่อนนัดค่ะ'), 'ขออภัยค่ะ ระบบขัดข้องเล็กน้อย');
  assert.deepEqual(rec.events, ['label_spoken_rejected']);
  assert.ok(!call.turns.some(t => t.text.includes('B1')));
});

test('a runaway reply is asked again once, for words only: no tools offered, no claims a tool would back', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = () => ++step <= 2 ? { text: '', cut: true } : text('ขออภัยค่ะ ไม่ทราบว่าต้องการเลื่อนเป็นวันไหนคะ');
  bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('ขอเลื่อนนัดค่ะ'), 'ขออภัยค่ะ ไม่ทราบว่าต้องการเลื่อนเป็นวันไหนคะ');
  assert.deepEqual(rec.events, ['reply_cut_off', 'retried', 'reply_cut_off', 'retried_words_only']);
  assert.ok(bodies[0].body.tools?.length && bodies[1].body.tools?.length, 'the first ask and the first retry have tools');
  assert.ok(!('tools' in bodies[2].body), 'the second retry has none');
  assert.match(bodies[2].body.messages[0].content, /you cannot use tools/);
  assert.ok(!bodies[2].body.messages.some((m: any) => m.role === 'assistant' && m.content === ''), 'the broken reply is not left in the history');
  assert.ok(!rec.messages.some((m: any) => Array.isArray(m.content) && m.content.length === 0));
  const next = toOpenAI({ model: 'm', max_tokens: 10, tools: TOOL_SPECS, tool_choice: { type: 'none' }, messages: [{ role: 'user', content: 'x' }] }, PROVIDERS.cerebras);
  assert.equal(next.tool_choice, 'none', 'OpenAI-compatible hosts get tool_choice none');
});

test('a words-only reply that claims something was done is never read out', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = () => ++step <= 2 ? { text: '', cut: true } : text('ดิฉันบันทึกคำถามเรื่องที่จอดรถไว้ให้ทีมงานตรวจสอบแล้วค่ะ');
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('ฝากถามเรื่องที่จอดรถด้วยค่ะ'), 'ขออภัยค่ะ ระบบขัดข้องเล็กน้อย');
  assert.equal(rec.events.at(-1), 'claim_without_tool');
  assert.ok(!call.turns.some(t => t.text.includes('บันทึกคำถาม')));
});

test('promisesTransfer: promises (from real Gemma replies) caught; offers and refusals kept', async () => {
  const { promisesTransfer } = await import('../sim/model/receptionist.ts');
  for (const t of ['ได้ค่ะ รอสักครู่นะคะ เดี๋ยวจะต่อสายให้เจ้าหน้าที่ตรวจสอบข้อมูลการจองให้ค่ะ', 'รับทราบค่ะ คุณบี เดี๋ยวรอสักครู่นะคะกำลังดำเนินการต่อสายให้ค่ะ',
    'ขออภัยด้วยนะคะ เดี๋ยวขออนุญาตโอนสายไปยังเจ้าหน้าที่ให้สักครู่นะคะ', "I'll put you through to the team now.", 'Let me transfer you.', 'Connecting you now.'])
    assert.ok(promisesTransfer(t), `promise: ${t}`);
  for (const t of ['ต้องการให้ดิฉันต่อสายให้เจ้าหน้าที่ไหมคะ', 'ให้ดิฉันโอนสายให้หรือเปล่าคะ', 'ขออภัยค่ะ ไม่สามารถโอนสายให้ได้ในขณะนี้ค่ะ', 'ตอนนี้ยังต่อสายให้ไม่ได้ค่ะ',
    'ขออภัยค่ะ ขณะนี้เจ้าหน้าที่ไม่ว่างรับสาย มีอะไรให้ดิฉันช่วยไหมคะ', 'หรือต้องการให้รีบต่อสายหาพนักงานเพื่อความช่วยเหลือด่วนไหมคะ?', 'Would you like me to transfer you?', "I can't transfer you right now.", 'Which day suits you?'])
    assert.ok(!promisesTransfer(t), `not a promise: ${t}`);
});

test('a promised transfer that was not made: asked again with a note, then the runtime tells the truth', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  // Corrected on the re-ask: it calls the tool (nobody is available at Gate A) and answers honestly.
  let step = 0;
  brain = msgs => {
    step++;
    const last = msgs.at(-1);
    if (step === 1) return text('เดี๋ยวจะต่อสายให้เจ้าหน้าที่นะคะ');
    if (step === 2) return tool('request_human_transfer', { reason: 'caller_asked', topic: 'เลื่อนนัด' });
    return text(last.role === 'tool' && JSON.parse(last.content).ok === false ? 'ขออภัยค่ะ ขณะนี้เจ้าหน้าที่ไม่ว่างรับสาย ให้ดิฉันช่วยเลื่อนนัดให้ไหมคะ' : 'ค่ะ');
  };
  bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('ขอสายพนักงานหน่อยค่ะ'), 'ขออภัยค่ะ ขณะนี้เจ้าหน้าที่ไม่ว่างรับสาย ให้ดิฉันช่วยเลื่อนนัดให้ไหมคะ');
  assert.deepEqual(rec.events, ['transfer_promise_without_tool']);
  assert.match(bodies[1].body.messages[0].content, /no transfer was made/);
  assert.ok(bodies[1].body.tools?.length, 'the re-ask keeps the tools so the transfer can really be asked for');
  // Not corrected: the runtime says it.
  brain = () => text('กำลังดำเนินการต่อสายให้ค่ะ');
  assert.match(await rec.respond('ขอคุยกับคนค่ะ'), /^ขออภัยค่ะ ตอนนี้ดิฉันยังต่อสายให้เจ้าหน้าที่ไม่ได้ค่ะ/);
  assert.ok(!call.turns.some(t => t.who === 'ai' && /เดี๋ยวจะต่อสาย|กำลังดำเนินการต่อสาย/.test(t.text)));
});

test('after a bridged transfer, saying so is the truth', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = () => ++step === 1 ? tool('request_human_transfer', { reason: 'caller_asked', topic: 'คุยกับพนักงาน' }) : text('ต่อสายให้เจ้าหน้าที่แล้วค่ะ');
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  rec.transferSim = { eligible: true, answered: true, dtmf: '1' };
  assert.equal(await rec.respond('ขอสายพนักงานค่ะ'), 'ต่อสายให้เจ้าหน้าที่แล้วค่ะ');
  assert.deepEqual(rec.events, []);
});

test('promisesRelay: "I\'ll send your question to the team" caught; offers and refusals kept', async () => {
  const { promisesRelay } = await import('../sim/model/receptionist.ts');
  for (const t of ['ยืนยันว่าคำถามคือเรื่องที่จอดรถนะคะ จะส่งคำถามให้ทางทีมงานแจ้งกลับผ่านเบอร์โทรศัพท์ที่ท่านกำลังใช้งานอยู่ค่ะ', 'ยินดีค่ะ เดี๋ยวจะรีบประสานงานให้ทราบทางข้อความนะคะ',
    'ดิฉันส่งคำถามให้ทีมงานเรียบร้อยแล้วค่ะ', "I'll pass your question to the team.", 'The team will text you back soon.'])
    assert.ok(promisesRelay(t), `promise: ${t}`);
  for (const t of ['ให้ดิฉันส่งคำถามนี้ให้ทีมงานแจ้งกลับทางข้อความให้ไหมคะ?', 'ต้องการให้ดิฉันฝากคำถามไว้ให้ทีมงานไหมคะ', 'ตอนนี้ยังไม่ได้ส่งคำถามให้ทีมงานนะคะ',
    'Would you like me to pass this to the team?', "I can't send messages right now.", 'ขอทราบวันที่สะดวกค่ะ'])
    assert.ok(!promisesRelay(t), `not a promise: ${t}`);
});

test('a promised relay that was not made: asked again, the model sends the question and the runtime reads the expectation', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const client = new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` });
  let step = 0;
  brain = () => {
    step++;
    if (step === 1) return text('จะส่งคำถามให้ทางทีมงานแจ้งกลับทางข้อความค่ะ');
    if (step === 2) return tool('record_consent', { purpose: 'service_followup', target: 'ani', question_text: 'ร้านมีที่จอดรถไหม' });
    if (step === 3) return tool('request_owner_answer', { question_text: 'ร้านมีที่จอดรถไหม', summary_source: 'model', reply_target: { kind: 'ani' } });
    return text('ค่ะ');
  };
  bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  const said = await rec.respond('ใช่ค่ะ ใช้เบอร์นี้ ส่งข้อความได้ค่ะ');
  assert.deepEqual(rec.events, ['relay_promise_without_tool']);
  assert.match(bodies[1].body.messages[0].content, /nothing was sent/);
  assert.ok(call.outcomes.includes('pq_created'), 'the question really went to the team');
  assert.ok(said.length > 0 && !said.includes('จะส่งคำถามให้ทางทีมงาน'));
});

test('an unknown service name says it is the service, with the menu — not "no free times"', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const r = await call.tool('search_availability', { variant_ref: 'นวดเท้า 60', date_phrase: 'พรุ่งนี้บ่ายสาม' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_FOUND');
  assert.equal(r.error.detail.not_found, 'service');
  assert.ok(r.error.detail.menu.includes('นวดเท้า 45 นาที'));
  assert.match(r.error.detail.note, /not about free times/);
});

test('texting words: the question, the answer and the promise', async () => {
  const { asksAboutText, yesNo, promisesText } = await import('../sim/model/receptionist.ts');
  assert.ok(asksAboutText('ต้องการรับข้อความยืนยันการจองทางเบอร์นี้ไหมคะ'));
  assert.ok(asksAboutText('Would you like a text confirming the booking?'));
  assert.ok(!asksAboutText('ให้ดิฉันส่งคำถามนี้ให้ทีมงานแจ้งกลับทางข้อความไหมคะ'), 'texting about a question is not a booking confirmation');
  assert.ok(!asksAboutText('จองเรียบร้อยแล้วค่ะ'));
  assert.equal(yesNo('ได้ค่ะ'), 'yes'); assert.equal(yesNo('ค่ะ ส่งมาเลย'), 'yes'); assert.equal(yesNo('Yes, please.'), 'yes');
  assert.equal(yesNo('ไม่ต้องค่ะ'), 'no'); assert.equal(yesNo('ใช่ค่ะ จองเลย ไม่ต้องส่งข้อความนะคะ'), 'no'); assert.equal(yesNo("No thanks."), 'no');
  assert.equal(yesNo('วันพรุ่งนี้บ่ายสาม'), null);
  assert.equal(yesNo('ขอบคุณครับ'), null, '"ครับ" contains "รับ" but is not a yes'); assert.equal(yesNo('ค่ะ'), 'yes'); assert.equal(yesNo('ได้เลยครับ ขอบคุณครับ'), 'yes');
  for (const t of ['จะส่งข้อความยืนยันไปที่เบอร์นี้นะคะ', 'ส่งข้อความยืนยันให้เรียบร้อยแล้วค่ะ', "I'll send you a text confirmation.", 'A confirmation text has been sent.'])
    assert.ok(promisesText(t), `promise: ${t}`);
  for (const t of ['ต้องการให้ส่งข้อความยืนยันไหมคะ', 'ครั้งนี้ยังไม่ได้ส่งข้อความยืนยันนะคะ', 'Would you like me to send a text confirmation?', "I won't send a text."])
    assert.ok(!promisesText(t), `not a promise: ${t}`);
});

test('gateway: send_confirmation_text without the runtime\'s consent evidence books but sends no text', async () => {
  const clock = await fresh();
  const texts = () => withTenant(A, async tx => (await tx.query(`select count(*)::int n from outbox_events where payload->>'to' = $1`, [CALLER])).rows[0].n);
  for (const evidence of [false, true]) {
    const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
    const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: evidence ? 'พรุ่งนี้บ่ายสี่โมง' : 'พรุ่งนี้บ่ายสาม' });
    const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, client_name: 'อันนา' });
    const spoken = call.say(h.data.rendered_confirmation.th), yes = call.hear('ใช่ค่ะ');
    const before = await texts();
    const b = await call.tool('create_booking', { hold_ref: h.data.hold_ref, client_name: 'อันนา', send_confirmation_text: true },
      { spoken_confirmation_sha256: sha(h.data.rendered_confirmation.th + '\n' + h.data.rendered_confirmation.en), spoken_turn: spoken, confirm_turn: yes, ...(evidence ? { text_consent_turn: yes } : {}) });
    assert.ok(b.ok);
    assert.equal(await texts() - before, evidence ? 1 : 0, evidence ? 'with evidence: one text' : 'the flag alone sends nothing');
    await call.end();
  }
});

/** Books through the stand-in; whether and how the model asks about a text is up to the test. */
function textBrain(ask: boolean) {
  return (msgs: any[]): Reply => {
    const last = msgs.at(-1), tr = last.role === 'tool' ? JSON.parse(last.content) : null;
    const u = [...msgs].reverse().find((m: any) => m.role === 'user')?.content ?? '';
    if (tr?.data?.options) return tool('hold_slot', { slot_token: tr.data.options[0].slot_token, client_name: 'อันนา' });
    if (tr?.data?.booking_ref) return text(tr.data.confirmation_text?.startsWith('not_sent') ? 'จองเรียบร้อยแล้วค่ะ' : 'จองเรียบร้อยแล้วค่ะ จะส่งข้อความยืนยันไปที่เบอร์นี้นะคะ');
    if (tr && !tr.ok) return text('ขออภัยค่ะ');
    const hold = () => msgs.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)).find((x: any) => x.data?.hold_ref)?.data.hold_ref;
    if (u.startsWith('ใช่')) return ask ? text('ต้องการรับข้อความยืนยันการจองทางเบอร์นี้ไหมคะ') : tool('create_booking', { hold_ref: hold(), client_name: 'อันนา', send_confirmation_text: true });
    if (/ได้ค่ะ|ไม่ต้อง/.test(u)) return tool('create_booking', { hold_ref: hold(), client_name: 'อันนา', send_confirmation_text: true });
    if (u.includes('จอง')) return tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม' });
    return text('ค่ะ');
  };
}

test('a text only after the caller says yes to the question; never on the model\'s flag alone', async () => {
  const texts = () => withTenant(A, async tx => (await tx.query(`select count(*)::int n from outbox_events where payload->>'to' = $1`, [CALLER])).rows[0].n);
  const run = async (ask: boolean, answer?: string) => {
    const clock = await fresh();
    const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
    brain = textBrain(ask);
    const rec = new Receptionist(new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` }), call, 'stand-in', 'ร้านสปาตัวอย่าง');
    await rec.respond('ขอจองนวดไทย 60 พรุ่งนี้บ่ายสามค่ะ ชื่ออันนา');
    let last = await rec.respond('ใช่ค่ะ');
    if (answer) last = await rec.respond(answer);
    const booked = await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments where status = 'booked'`)).rows[0].n);
    return { rec, last, booked, texts: await texts() };
  };
  const unasked = await run(false);
  assert.equal(unasked.booked, 1);
  assert.equal(unasked.texts, 0, 'the flag alone sends nothing');
  assert.ok(unasked.rec.events.includes('text_without_consent'));
  assert.equal(unasked.last, 'จองเรียบร้อยแล้วค่ะ ต้องการรับข้อความยืนยันการจองทางเบอร์ที่โทรมาไหมคะ', 'so the runtime offers it');
  const offeredYes = await run(false, 'ได้ค่ะ');
  assert.equal(offeredYes.texts, 1, 'offered by the runtime, yes: one text');
  assert.equal(offeredYes.last, 'ส่งข้อความยืนยันไปที่เบอร์นี้แล้วค่ะ มีอะไรให้ช่วยเพิ่มเติมไหมคะ');
  const offeredNo = await run(false, 'ไม่ต้องค่ะ');
  assert.equal(offeredNo.texts, 0, 'offered by the runtime, no: no text');
  assert.equal(offeredNo.last, 'ได้ค่ะ ไม่ส่งข้อความนะคะ มีอะไรให้ช่วยเพิ่มเติมไหมคะ');
  const yes = await run(true, 'ได้ค่ะ');
  assert.equal(yes.texts, 1, 'the model asked and the caller said yes: one text, and no second offer');
  assert.ok(!yes.rec.events.includes('text_without_consent'));
  const no = await run(true, 'ไม่ต้องค่ะ');
  assert.equal(no.booked, 1);
  assert.equal(no.texts, 0, 'the model asked and the caller said no: no text');
  assert.ok(!no.last.includes('ต้องการรับข้อความยืนยัน'), 'a caller who said no is not asked again');
});

test('"a text is on its way" with no text queued is caught', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  brain = () => text('จะส่งข้อความยืนยันไปที่เบอร์นี้นะคะ');
  const rec = new Receptionist(new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` }), call, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('ขอบคุณค่ะ'), 'ขออภัยค่ะ ครั้งนี้ยังไม่ได้ส่งข้อความยืนยันนะคะ');
  assert.deepEqual(rec.events, ['text_promise_without_consent', 'text_promise_without_consent']);
});

test('send_booking_text: needs the runtime\'s evidence, only for the caller\'s own booking, once', async () => {
  const clock = await fresh();
  const texts = (to: string) => withTenant(A, async tx => (await tx.query(`select count(*)::int n from outbox_events where payload->>'to' = $1`, [to])).rows[0].n);
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const b = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' });
  const ref = b.result.data.booking_ref;
  assert.equal(b.result.data.text_queued, false);
  assert.equal(b.result.data.can_text, true);
  const before = await texts(CALLER);
  const none = await call.tool('send_booking_text', { booking_ref: ref });
  assert.equal(!none.ok && none.error.code, 'CONSENT_REQUIRED', 'no evidence, no text');
  const yes = call.hear('ได้ค่ะ');
  assert.ok((await call.tool('send_booking_text', { booking_ref: ref }, { text_consent_turn: yes })).ok);
  assert.ok((await call.tool('send_booking_text', { booking_ref: ref }, { text_consent_turn: yes })).ok, 'a repeat is answered, not sent again');
  assert.equal(await texts(CALLER) - before, 1);
  const body = await withTenant(A, async tx => (await tx.query(`select payload->>'body' b from outbox_events where payload->>'to' = $1 order by created_at desc limit 1`, [CALLER])).rows[0].b);
  assert.match(body, /นัดของคุณ: นวดไทย 60 นาที กับคุณนก วันศุกร์ที่ 13 พฤศจิกายน 2569 เวลา 15:00 น\./);
  assert.ok(!body.includes('อันนา'), 'no client name in the text');
  const other = (await Call.start({ dialed: NUM.A.dialed, ani: '+66899999999', now: () => clock.now() })).call;
  const t = other.hear('ได้ค่ะ');
  const stranger = await other.tool('send_booking_text', { booking_ref: ref }, { text_consent_turn: t });
  assert.equal(!stranger.ok && stranger.error.code, 'NOT_FOUND', 'another caller cannot have someone else\'s booking texted');
});

test('a move\'s summary keeps both times and drops the question', async () => {
  const clock = await fresh();
  const pre = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  await pre.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'บี' }); await pre.end();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const mine = await call.tool('get_bookings_for_caller', {});
  const b = mine.data.bookings[0];
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '21 พ.ย. 69 บ่ายสาม', for_booking_ref: b.booking_ref });
  const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, client_name: 'บี', for_booking_ref: b.booking_ref });
  const spoken = call.say(h.data.rendered_confirmation.th), yes = call.hear('ใช่ค่ะ');
  const r = await call.tool('reschedule_booking', { booking_ref: b.booking_ref, hold_ref: h.data.hold_ref },
    { expected_version: b.version, spoken_confirmation_sha256: sha(h.data.rendered_confirmation.th + '\n' + h.data.rendered_confirmation.en), spoken_turn: spoken, confirm_turn: yes });
  assert.ok(r.ok);
  assert.equal(r.data.rendered_summary.th, 'เลื่อนนัดเรียบร้อยแล้วค่ะ: นวดไทย 60 นาที จากวันศุกร์ที่ 20 พฤศจิกายน 2569 เวลา 15:00 น. (บ่ายสามโมง) เป็นวันเสาร์ที่ 21 พฤศจิกายน 2569 เวลา 15:00 น. (บ่ายสามโมง) กับคุณนก');
  assert.equal(r.data.rendered_summary.en, "Moved: your Thai massage, 60 minutes from Friday 20 November 2026 at 3:00 pm to Saturday 21 November 2026 at 3:00 pm with Nok.");
});

test('a caller who asks for a text gets one without being asked', async () => {
  const { volunteersText } = await import('../sim/model/receptionist.ts');
  for (const t of ['ยืนยันค่ะ รับข้อความยืนยันได้เลยค่ะ', 'ส่งข้อความมาด้วยนะคะ', 'Yes, and please text me the details.']) assert.ok(volunteersText(t), t);
  for (const t of ['ไม่ต้องส่งข้อความนะคะ', 'ยืนยันค่ะ ขอบคุณค่ะ', "Don't text me, thanks."]) assert.ok(!volunteersText(t), t);
  const texts = () => withTenant(A, async tx => (await tx.query(`select count(*)::int n from outbox_events where payload->>'to' = $1`, [CALLER])).rows[0].n);
  for (const modelSetsFlag of [false, true]) {
    const clock = await fresh();
    const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
    brain = msgs => {
      const r = textBrain(false)(msgs);
      if ('tool' in r && r.tool?.name === 'create_booking') r.tool.args = { ...(r.tool.args as object), send_confirmation_text: modelSetsFlag };
      return r;
    };
    const rec = new Receptionist(new CompatClient({ provider: 'ollama', baseURL: `http://127.0.0.1:${port}` }), call, 'stand-in', 'ร้านสปาตัวอย่าง');
    await rec.respond('ขอจองนวดไทย 60 พรุ่งนี้บ่ายสามค่ะ ชื่ออันนา');
    const last = await rec.respond('ใช่ค่ะ รับข้อความยืนยันได้เลยค่ะ');
    assert.equal(await texts(), 1, `one text (the model ${modelSetsFlag ? 'set' : 'did not set'} the flag)`);
    if (!modelSetsFlag) assert.equal(last, 'จองเรียบร้อยแล้วค่ะ ส่งข้อความยืนยันไปที่เบอร์ที่โทรมาแล้วนะคะ', 'the runtime sends it and says so');
    else assert.equal(last, 'จองเรียบร้อยแล้วค่ะ จะส่งข้อความยืนยันไปที่เบอร์นี้นะคะ', 'the booking sent it, so the model may say so');
  }
});
