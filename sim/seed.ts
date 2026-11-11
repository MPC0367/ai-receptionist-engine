/**
 * Synthetic seed (Gate A). Every business, person and number here is fictional and labelled so (INV-12).
 * Tenant A: a Thai day spa (D-16). Tenant B: a second Thai tenant with canary facts for isolation tests.
 * Tenant C: a U.S. tenant used only for daylight-saving tests.
 */
import pg from 'pg';
import { createHash } from 'node:crypto';
import { migrate } from '../scripts/migrate.ts';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
const u = (tenant: string, n: number) => tenant.slice(0, 24) + String(n).padStart(12, '0');
const idHash = (v: string) => createHash('sha256').update('rcpt-id:' + v.replace(/[\s-]/g, '')).digest();
const sha = (s: string) => createHash('sha256').update(s).digest();

export const IDS = {
  A: { loc: u(A, 1), nok: u(A, 2), fon: u(A, 3), thai60: u(A, 10), thai90: u(A, 11), foot45: u(A, 12), ownerLine: u(A, 20), ownerSms: u(A, 21) },
  B: { loc: u(B, 1), staff: u(B, 2), thai60: u(B, 10), ownerLine: u(B, 20) },
  C: { loc: u(C, 1), sam: u(C, 2), cut: u(C, 10), ownerSms: u(C, 20) },
};
export const NUM = {
  A: { dialed: '+6620000101', ownerLine: 'U_owner_A_fictional', ownerSms: '+66900000001', sender: 'SAMPLESPA', publicPhone: '020000001' },
  B: { dialed: '+6620000202', ownerLine: 'U_owner_B_fictional', sender: 'OTHERSPA', publicPhone: '020000002' },
  C: { dialed: '+12025550199', ownerSms: '+12025550111', sender: '+12025550100', publicPhone: '+12025550199' },
};

export async function seed(database = process.env.RCPT_DB ?? 'rcpt', reset = true) {
  if (reset) await migrate(database, true);
  const c = new pg.Client({ host: '127.0.0.1', port: 54421, user: 'rcpt', database });
  await c.connect();
  const q = (sql: string, params: unknown[] = []) => c.query(sql, params);
  const now = new Date('2026-11-01T00:00:00Z');
  try {
    await q('begin');
    const en = async (t: string, table: string, id: string, name: string) => q(`update ${table} set name_en = $3 where tenant_id = $1 and id = $2`, [t, id, name]);
    // ---- Tenant A: Thai day spa -------------------------------------------------------------------
    await q(`insert into tenants (id, name, country, vertical, status) values ($1,'ร้านสปาตัวอย่าง (Sample Day Spa — fictional)','TH','massage_day_spa','live')`, [A]);
    await q(`insert into locations (tenant_id, id, name, time_zone, public_phone, public_contact) values ($1,$2,'ร้านสปาตัวอย่าง','Asia/Bangkok',$3,$4)`,
      [A, IDS.A.loc, NUM.A.publicPhone, JSON.stringify({ address: { th: 'ถนนตัวอย่าง (ที่อยู่สมมติ)', en: 'Sample Road (fictional address)' }, domains: ['samplespa.example'] })]);
    await q(`insert into services (tenant_id, id, name) values ($1,$2,'นวดไทย'), ($1,$3,'นวดเท้า')`, [A, u(A, 30), u(A, 31)]);
    await q(`insert into service_variants (tenant_id, id, service_id, name, aliases, duration_min, buffer_after_min, price_minor, currency, price_is_authoritative) values
      ($1,$2,$5,'นวดไทย 60 นาที', array['thai massage 60','นวดไทย 60','thai massage'], 60, 15, 50000, 'THB', true),
      ($1,$3,$5,'นวดไทย 90 นาที', array['thai massage 90','นวดไทย 90'], 90, 15, 70000, 'THB', true),
      ($1,$4,$6,'นวดเท้า 45 นาที', array['foot massage','นวดเท้า'], 45, 15, 35000, 'THB', false)`,
      [A, IDS.A.thai60, IDS.A.thai90, IDS.A.foot45, u(A, 30), u(A, 31)]);
    await q(`insert into resources (tenant_id, id, location_id, kind, display_name) values ($1,$2,$4,'staff','นก'), ($1,$3,$4,'staff','ฝน')`, [A, IDS.A.nok, IDS.A.fon, IDS.A.loc]);
    await q(`insert into resource_services values ($1,$2,$4),($1,$2,$5),($1,$2,$6),($1,$3,$4),($1,$3,$6)`, [A, IDS.A.nok, IDS.A.fon, IDS.A.thai60, IDS.A.thai90, IDS.A.foot45]);
    await en(A, 'service_variants', IDS.A.thai60, 'Thai massage, 60 minutes'); await en(A, 'service_variants', IDS.A.thai90, 'Thai massage, 90 minutes');
    await en(A, 'service_variants', IDS.A.foot45, 'foot massage, 45 minutes'); await en(A, 'resources', IDS.A.nok, 'Nok'); await en(A, 'resources', IDS.A.fon, 'Fon');
    for (let wd = 1; wd <= 7; wd++) {
      await q(`insert into business_hours (tenant_id, id, location_id, weekday, opens, closes) values ($1,$2,$3,$4,'10:00','20:00')`, [A, u(A, 100 + wd), IDS.A.loc, wd]);
      if (wd <= 6) await q(`insert into business_hours (tenant_id, id, location_id, resource_id, weekday, opens, closes) values ($1,$2,$3,$4,$5,'10:00','20:00')`, [A, u(A, 110 + wd), IDS.A.loc, IDS.A.nok, wd]);
      if (wd >= 2) await q(`insert into business_hours (tenant_id, id, location_id, resource_id, weekday, opens, closes) values ($1,$2,$3,$4,$5,'12:00','20:00')`, [A, u(A, 120 + wd), IDS.A.loc, IDS.A.fon, wd]);
    }
    const policy = { lead_min: 60, horizon_days: 62, slot_step_min: 30, change_window_h: 24, max_bookings_per_number_24h: 2,
      cancel_text: { th: 'ยกเลิกน้อยกว่า 24 ชั่วโมงก่อนนัด ทางร้านขอสงวนสิทธิ์เก็บมัดจำค่ะ', en: 'Cancelling less than 24 hours before the appointment keeps the deposit.' } };
    await q(`insert into policies (tenant_id, id, version, body) values ($1,$2,1,$3)`, [A, u(A, 40), JSON.stringify(policy)]);
    await q(`insert into configuration_versions (tenant_id, id, number, status, snapshot, snapshot_sha256, published_at) values ($1,$2,1,'published',$3,$4,$5)`,
      [A, u(A, 41), JSON.stringify({ policy }), sha(JSON.stringify({ policy })), now]);
    const art = (n: number, topic: string, kw: string[], qg: string, ans: string, tenant = A) => q(
      `insert into knowledge_articles (tenant_id, id, version, topic, keywords, question_general, answer_text, audience, provenance, status, approved_by, approved_at, effective_from, review_by)
       values ($1,$2,1,$3,$4,$5,$6,array['speakable','messageable'],'owner_entry','published','owner (fictional)',$7,$7,$8)`,
      [tenant, u(tenant, 200 + n), topic, kw, qg, ans, now, new Date('2027-02-01T00:00:00Z')]);
    await art(1, 'payment_methods', ['จ่าย', 'ชำระ', 'บัตร', 'โอน', 'pay', 'card', 'cash', 'promptpay'], 'ชำระเงินแบบไหนได้บ้าง', 'รับเงินสด บัตรเครดิต และพร้อมเพย์ค่ะ');
    await art(2, 'what_to_wear', ['แต่งตัว', 'ชุด', 'wear', 'clothes'], 'ต้องเตรียมชุดไหม', 'ทางร้านมีชุดให้เปลี่ยนค่ะ');
    await art(3, 'canary', ['canary'], 'canary', 'canary-A-7781');
    await q(`insert into owner_identities (tenant_id, id, label, channel, value, value_hash, priority, verified_at) values
      ($1,$2,'เจ้าของร้าน (LINE)','line',$4,$5,1,$8), ($1,$3,'เจ้าของร้าน (SMS)','sms',$6,$7,2,$8)`,
      [A, IDS.A.ownerLine, IDS.A.ownerSms, NUM.A.ownerLine, idHash(NUM.A.ownerLine), NUM.A.ownerSms, idHash(NUM.A.ownerSms), now]);
    await q(`insert into owner_routes values ('line',$1,$3), ('sms',$2,$3)`, [idHash(NUM.A.ownerLine), idHash(NUM.A.ownerSms), A]);
    await q(`insert into senders values ('sms',$1,$2,false)`, [NUM.A.sender, A]);
    await q(`insert into phone_numbers values ($1,$2,$3)`, [NUM.A.dialed, A, IDS.A.loc]);

    // ---- Tenant B: second Thai tenant (isolation canaries) ---------------------------------------------
    await q(`insert into tenants (id, name, country, vertical, status) values ($1,'ร้านอื่นตัวอย่าง (Other Spa — fictional)','TH','massage_day_spa','live')`, [B]);
    await q(`insert into locations (tenant_id, id, name, time_zone, public_phone, public_contact) values ($1,$2,'ร้านอื่นตัวอย่าง','Asia/Bangkok',$3,'{}')`, [B, IDS.B.loc, NUM.B.publicPhone]);
    await q(`insert into services (tenant_id, id, name) values ($1,$2,'นวดไทย')`, [B, u(B, 30)]);
    await q(`insert into service_variants (tenant_id, id, service_id, name, aliases, duration_min) values ($1,$2,$3,'นวดไทย 60 นาที',array['thai massage 60','นวดไทย 60'],60)`, [B, IDS.B.thai60, u(B, 30)]);
    await q(`insert into resources (tenant_id, id, location_id, kind, display_name) values ($1,$2,$3,'staff','แพร')`, [B, IDS.B.staff, IDS.B.loc]);
    await q(`insert into resource_services values ($1,$2,$3)`, [B, IDS.B.staff, IDS.B.thai60]);
    for (let wd = 1; wd <= 7; wd++) await q(`insert into business_hours (tenant_id, id, location_id, weekday, opens, closes) values ($1,$2,$3,$4,'09:00','21:00')`, [B, u(B, 100 + wd), IDS.B.loc, wd]);
    await q(`insert into policies (tenant_id, id, version, body) values ($1,$2,1,$3)`, [B, u(B, 40), JSON.stringify({ ...policy, cancel_text: null })]);
    await art(1, 'payment_methods', ['จ่าย', 'ชำระ', 'บัตร', 'pay', 'card'], 'ชำระเงินแบบไหนได้บ้าง', 'รับเฉพาะเงินสด (canary-B-9932)', B);
    await art(3, 'canary', ['canary'], 'canary', 'canary-B-9932', B);
    await q(`insert into owner_identities (tenant_id, id, label, channel, value, value_hash, priority, verified_at) values ($1,$2,'owner B','line',$3,$4,1,$5)`,
      [B, IDS.B.ownerLine, NUM.B.ownerLine, idHash(NUM.B.ownerLine), now]);
    await q(`insert into owner_routes values ('line',$1,$2)`, [idHash(NUM.B.ownerLine), B]);
    await q(`insert into senders values ('sms',$1,$2,false)`, [NUM.B.sender, B]);
    await q(`insert into phone_numbers values ($1,$2,$3)`, [NUM.B.dialed, B, IDS.B.loc]);

    // ---- Tenant C: US (daylight-saving fixture: open 00:00–04:00 on Sundays) ------------------------------
    await q(`insert into tenants (id, name, country, vertical, status) values ($1,'Sample Barber (fictional)','US','barber','live')`, [C]);
    await q(`insert into locations (tenant_id, id, name, time_zone, public_phone, public_contact) values ($1,$2,'Sample Barber','America/New_York',$3,'{}')`, [C, IDS.C.loc, NUM.C.publicPhone]);
    await q(`insert into services (tenant_id, id, name) values ($1,$2,'Haircut')`, [C, u(C, 30)]);
    await q(`insert into service_variants (tenant_id, id, service_id, name, aliases, duration_min) values ($1,$2,$3,'Haircut 30',array['haircut'],30)`, [C, IDS.C.cut, u(C, 30)]);
    await q(`insert into resources (tenant_id, id, location_id, kind, display_name) values ($1,$2,$3,'staff','Sam')`, [C, IDS.C.sam, IDS.C.loc]);
    await q(`insert into resource_services values ($1,$2,$3)`, [C, IDS.C.sam, IDS.C.cut]);
    await en(C, 'service_variants', IDS.C.cut, 'haircut, 30 minutes'); await en(C, 'resources', IDS.C.sam, 'Sam');
    await q(`insert into business_hours (tenant_id, id, location_id, weekday, opens, closes) values ($1,$2,$3,7,'00:00','04:00')`, [C, u(C, 107), IDS.C.loc]);
    await q(`insert into policies (tenant_id, id, version, body) values ($1,$2,1,$3)`, [C, u(C, 40), JSON.stringify({ ...policy, lead_min: 0 })]);
    await q(`insert into owner_identities (tenant_id, id, label, channel, value, value_hash, priority, verified_at) values ($1,$2,'owner C','sms',$3,$4,1,$5)`,
      [C, IDS.C.ownerSms, NUM.C.ownerSms, idHash(NUM.C.ownerSms), now]);
    await q(`insert into owner_routes values ('sms',$1,$2)`, [idHash(NUM.C.ownerSms), C]);
    await q(`insert into senders values ('sms',$1,$2,true)`, [NUM.C.sender, C]);
    await q(`insert into phone_numbers values ($1,$2,$3)`, [NUM.C.dialed, C, IDS.C.loc]);

    // ---- Jurisdiction contacts: a person must verify these before Gate B (§5.8.1 UQ-E) ---------------------
    await q(`insert into jurisdiction_contacts (country, kind, number, label_th, label_en, verified_by) values
      ('TH','medical','1669','สายด่วนการแพทย์ฉุกเฉิน 1669','emergency medical services, 1669','PENDING human verification'),
      ('TH','police','191','แจ้งเหตุด่วนเหตุร้าย 191','police, 191','PENDING human verification'),
      ('US','emergency','911','—','911','PENDING human verification')`);
    await q('commit');
  } catch (e) {
    await q('rollback');
    throw e;
  } finally {
    await c.end();
  }
}

if (import.meta.main) {
  await seed(process.argv[2] ?? 'rcpt');
  console.log('seeded (fictional data only)');
}
