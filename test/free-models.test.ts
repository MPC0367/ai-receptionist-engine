/**
 * The free-model adapter against a stand-in server on this Mac (no network, no model, no spend): request and
 * response translation for Ollama's /api/chat and OpenAI-compatible /chat/completions, a booking end to end through
 * each, the runtime's own checks on malformed tool calls and markup, retries and quota stops.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { A, NUM, Call, CALLER, closeDb, fresh, withTenant } from './helpers.ts';
import { Receptionist } from '../sim/model/receptionist.ts';
import { checkArgs, TOOL_SPECS } from '../sim/model/tools.ts';
import { CompatClient, PROVIDERS, QuotaError, fromOpenAI, toOpenAI, type CompatStats } from '../sim/model/free-models.ts';
import { cost } from '../sim/model/run.ts';

type Reply = { text?: string; tool?: { name: string; args: unknown } } | { status: number; retryAfter?: string };
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
        return send(200, { model: body.model, done: true, done_reason: 'stop', prompt_eval_count: 1200, prompt_eval_cached_count: 1000, eval_count: 30,
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
  return text('ค่ะ');
};

async function bookThrough(client: CompatClient) {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  brain = booker; bodies.length = 0;
  const rec = new Receptionist(client, call, 'stand-in', 'ร้านสปาตัวอย่าง');
  const r1 = await rec.respond('ขอจองนวดไทย 60 พรุ่งนี้บ่ายสามค่ะ ชื่ออันนา');
  const r2 = await rec.respond('ใช่ค่ะ');
  const booked = await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments`)).rows[0].n);
  return { r1, r2, booked, rec };
}

test('OpenAI-compatible route: books end to end; tool calls and results keep their ids; Claude-only fields are not sent', async () => {
  const client = new CompatClient({ provider: 'openai-compatible', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key' });
  const { r1, r2, booked, rec } = await bookThrough(client);
  assert.match(r1, /^ขอทวนนะคะ: นวดไทย 60 นาที/, 'the runtime read the confirmation');
  assert.equal(r2, 'จองเรียบร้อยแล้วค่ะ', 'reasoning in <think> is never spoken');
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
  assert.equal(r2, 'จองเรียบร้อยแล้วค่ะ');
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
  assert.equal(await rec.respond('จองเวลาเมื่อกี้เลยค่ะ'), 'ขอเช็กอีกครั้งนะคะ');
  assert.deepEqual(rec.events, ['unknown_reference', 'invalid_tool_call', 'unknown_reference', 'invalid_tool_call']);
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
  assert.deepEqual(rec.events, ['machine_text_rejected', 'empty_reply']);
  assert.equal(client.stats.toolCallsAsText, 1);
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
  assert.equal(bodies[0].body.options.num_predict, 400);
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
