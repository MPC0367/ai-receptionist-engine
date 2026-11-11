/**
 * Dry run of the model-driven harness with a scripted stand-in for the model (no network, no spend): proves the
 * plumbing — tool routing, the runtime speaking [CODE] sentences, turn evidence, grounding — before real runs.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { A, NUM, Call, CALLER, closeDb, fresh, withTenant } from './helpers.ts';
import { Receptionist, type ModelClient } from '../sim/model/receptionist.ts';
import { TOOL_SPECS } from '../sim/model/tools.ts';
import { cost } from '../sim/model/run.ts';

after(closeDb);
let n = 0;
const block = (b: any) => ({ id: `msg_${++n}`, stop_reason: b.type === 'tool_use' ? 'tool_use' : 'end_turn', content: [b], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } });
const toolUse = (name: string, input: unknown) => block({ type: 'tool_use', id: `tu_${++n}`, name, input });
const text = (t: string) => block({ type: 'text', text: t });
const lastToolResult = (p: any) => { const m = p.messages.at(-1); return Array.isArray(m.content) && m.content[0]?.type === 'tool_result' ? JSON.parse(m.content[0].content) : null; };
const lastUserText = (p: any) => { const m = [...p.messages].reverse().find((x: any) => x.role === 'user' && typeof x.content === 'string'); return m?.content ?? ''; };

/** A scripted "model": books when asked, answers with a made-up number when asked about parking. */
function scriptedModel(): ModelClient & { params: any[] } {
  const params: any[] = [];
  const create = async (p: any) => {
    params.push(p);
    const tr = lastToolResult(p), u = lastUserText(p);
    if (tr?.data?.options) return toolUse('hold_slot', { slot_token: tr.data.options[0].slot_token, client_name: 'อันนา' });
    if (tr?.data?.booking_ref) return text('จองเรียบร้อยแล้วค่ะ');
    if (tr && !tr.ok) return text('ขออภัยค่ะ');
    if (u.includes('จอง')) return toolUse('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม' });
    if (u.startsWith('ใช่')) return toolUse('create_booking', { hold_ref: p.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((c: any) => c.type === 'tool_result').map((c: any) => JSON.parse(c.content)).find((r: any) => r.data?.hold_ref)?.data.hold_ref, client_name: 'อันนา' });
    if (u.includes('ที่จอด')) return text('มีที่จอดรถ 20 คันค่ะ');
    return text('ค่ะ');
  };
  return { params, messages: { create }, beta: { messages: { create } } };
}

test('model-facing tools carry no envelope fields and are strict-ready', () => {
  for (const t of TOOL_SPECS) {
    const s: any = t.input_schema;
    assert.equal(s.additionalProperties, false, t.name);
    for (const k of ['tenant_id', 'conversation_id', 'idempotency_key', 'expected_version', 'confirmed_at']) assert.ok(!(k in s.properties), `${t.name} exposes ${k}`);
  }
});

test('harness: the scripted model books through the gateway; the runtime speaks the confirmation and adds the evidence', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const model = scriptedModel();
  const rec = new Receptionist(model, call, 'claude-opus-5-5', 'ร้านสปาตัวอย่าง');
  const r1 = await rec.respond('ขอจองนวดไทย 60 พรุ่งนี้บ่ายสามค่ะ ชื่ออันนา');
  assert.match(r1, /^ขอทวนนะคะ: นวดไทย 60 นาที/, 'the runtime, not the model, read the confirmation');
  const r2 = await rec.respond('ใช่ค่ะ');
  assert.equal(r2, 'จองเรียบร้อยแล้วค่ะ');
  assert.equal(await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments`)).rows[0].n), 1);
  assert.ok(model.params.every(p => p.system && p.cache_control?.type === 'ephemeral' && p.output_config?.effort === 'low'));
  assert.ok(model.params.every(p => p.tools.every((t: any) => t.strict === true)));
  assert.ok(!model.params[0].tools.some((t: any) => t.name === 'create_booking'), 'create_booking is not offered before a confirmation is spoken');
});

test('harness: an invented number from the model is discarded and replaced by the uncertainty line', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const rec = new Receptionist(scriptedModel(), call, 'claude-haiku-5-5', 'ร้านสปาตัวอย่าง');
  const r = await rec.respond('มีที่จอดรถไหมคะ');
  assert.match(r, /ไม่มีคำตอบที่ยืนยันได้/);
  assert.ok(rec.events.includes('grounding_rejected'));
  assert.ok(!call.turns.some(t => t.text.includes('20 คัน')));
});

test('harness: the emergency rules answer before the model is even asked', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const model = scriptedModel();
  const r = await new Receptionist(model, call, 'claude-sonnet-5-5', 'ร้านสปาตัวอย่าง').respond('แม่หมดสติหลังนวด ทำไงดี');
  assert.match(r, /1669/);
  assert.equal(model.params.length, 0);
});

test('cost estimate per model from usage', () => {
  const u = { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 0, calls: 1, ms: 0 };
  assert.equal(cost('claude-opus-5-5', u).toFixed(2), '6.40');
  assert.equal(cost('claude-haiku-5-5', u).toFixed(3), '0.170');
});
