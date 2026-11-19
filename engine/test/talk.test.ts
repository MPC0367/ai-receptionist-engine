/**
 * The talk page's voice (18 Nov 2026): what is said aloud for the runtime's written sentences, the receptionist's name
 * in the greeting, and the truthful answer with that name.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { A, NUM, Call, CALLER, closeDb, fresh } from './helpers.ts';
import { spoken, thaiTime } from '../sim/talk/spoken.ts';
import { Receptionist } from '../sim/model/receptionist.ts';

after(closeDb);

test('spoken: times as people say them, no year, no brackets or symbols', () => {
  assert.equal(spoken('ขอทวนนะคะ: นวดไทย 60 นาที กับคุณนก วันพฤหัสบดีที่ 19 พฤศจิกายน 2569 เวลา 15:00 น. (บ่ายสามโมง) ราคา 500 บาท ในชื่อคุณมด ยืนยันจองเลยไหมคะ', 'th'),
    'ขอทวนนะคะ นวดไทย 60 นาที กับคุณนก วันพฤหัสบดีที่ 19 พฤศจิกายน เวลาบ่ายสามโมง ราคา 500 บาท ในชื่อคุณมด ยืนยันจองเลยไหมคะ');
  assert.equal(spoken('ว่างตอน 15:00 น. และ 19:30 น. ค่ะ จองไหมคะ?', 'th'), 'ว่างตอน บ่ายสาม และ หนึ่งทุ่มครึ่ง ค่ะ จองไหมคะ');
  assert.equal(spoken('To confirm: Thai massage with Nok on Thursday 19 November 2026 at 3:00 PM. Shall I book it?', 'en'),
    'To confirm Thai massage with Nok on Thursday 19 November at 3 PM. Shall I book it');
  assert.equal(spoken('ร้านเปิดจันทร์ 10:00–20:00 ค่ะ ราคา 1,500.00 บาท วันที่ 13.11', 'th'), 'ร้านเปิดจันทร์ สิบโมงเช้าถึงสองทุ่ม ค่ะ ราคา 1,500.00 บาท วันที่ 13.11');
  assert.equal(thaiTime(10, 0), 'สิบโมงเช้า'); assert.equal(thaiTime(12, 30), 'เที่ยงครึ่ง'); assert.equal(thaiTime(16, 15), 'บ่ายสี่ 15 นาที');
  assert.equal(thaiTime(3, 0), undefined, 'outside opening hours the digits stay');
});

test('a named receptionist says its name in the greeting and in the truthful answer; without a name nothing changes', async () => {
  const clock = await fresh();
  const plain = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  assert.equal(plain.turns[0].text, 'สวัสดีค่ะ ร้านสปาตัวอย่าง ค่ะ ดิฉันเป็นผู้ช่วย AI ของร้านค่ะ', 'the seed has no name: the greeting is as before');
  const su = new pg.Client({ host: '127.0.0.1', port: 54421, user: 'rcpt', database: 'rcpt_test' });
  await su.connect();
  await su.query(`update policies set body = body || '{"ai_disclosure": false, "assistant_name": {"th": "มิ้นท์", "en": "Mint"}}'::jsonb where tenant_id = $1`, [A]);
  const th = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  assert.equal(th.turns[0].text, 'สวัสดีค่ะ ร้านสปาตัวอย่าง มิ้นท์รับสายค่ะ');
  const en = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, lang: 'en', now: () => clock.now() })).call;
  assert.equal(en.turns[0].text, "Hi, you've reached Sample Day Spa, this is Mint. How can I help you today?");
  await su.query(`update policies set body = body || '{"ai_disclosure": true}'::jsonb where tenant_id = $1`, [A]);
  await su.end();
  const told = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  assert.equal(told.turns[0].text, 'สวัสดีค่ะ ร้านสปาตัวอย่าง ค่ะ ดิฉันชื่อมิ้นท์ เป็นผู้ช่วย AI ของร้านค่ะ');
  // Asked, the runtime answers with the name, and the model is never asked.
  let asked = 0;
  const client = { messages: { create: async () => { asked++; return { content: [{ type: 'text', text: 'ค่ะ' }], stop_reason: 'end_turn', usage: {} }; } } };
  const rec = new Receptionist(client, th, 'stand-in', 'ร้านสปาตัวอย่าง');
  assert.equal(await rec.respond('คุยกับคนจริงอยู่หรือเปล่าคะ'), 'ดิฉันชื่อมิ้นท์ เป็นผู้ช่วย AI ของร้านค่ะ ถ้าต้องการคุยกับพนักงาน บอกได้เลยนะคะ มีอะไรให้ช่วยไหมคะ');
  assert.equal(asked, 0);
});
