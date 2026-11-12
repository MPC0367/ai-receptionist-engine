/**
 * Scripted stand-in for the voice runtime (Gate A has no telephony and no language model). It implements the
 * runtime's deterministic duties — greeting, turn log, state-gated tools, exact confirmation, grounding check,
 * the unknown-question branch (UQ0–UQ6) — and takes the "model" parts (intent, summaries) from the script.
 */
import { createHash } from 'node:crypto';
import { idHash, uuid, withSystem, withTenant } from '../src/db.ts';
import { callTool, type Meta, type ToolResult } from '../src/tools/gateway.ts';
import { mintCallToken, type CallClaims } from '../src/tools/token.ts';
import { callClock, WARN } from '../src/runtime/limits.ts';
import { grounded } from '../src/knowledge.ts';
import { safetyGate, cleanSummary, isEmergency } from '../src/escalation/safety.ts';
import { closeConversation } from '../src/metering.ts';
import { persistCallArtifacts } from '../src/privacy.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const T = {
  // §10.1: the recording clause is present only when the tenant records (D-09: off by default in Thailand).
  greeting: (name: string, lang: 'th' | 'en', recording: boolean) => lang === 'th'
    ? `สวัสดีค่ะ ${name} ค่ะ ดิฉันเป็นผู้ช่วย AI ของร้าน${recording ? ' การสนทนานี้อาจมีการบันทึกเสียงเพื่อการนัดหมายค่ะ' : 'ค่ะ'}`
    : `Hi, you've reached ${name}. I'm the business's AI assistant.${recording ? ' This call may be recorded to help with your booking.' : ''}`,
  unknown: (lang: 'th' | 'en') => lang === 'th' ? 'ดิฉันยังไม่มีคำตอบที่ยืนยันได้สำหรับเรื่องนี้ และไม่อยากเดาค่ะ' : "I don't have a confirmed answer to that, and I don't want to guess.",
  slotTaken: (lang: 'th' | 'en') => lang === 'th' ? 'ขออภัยค่ะ เวลานั้นเพิ่งมีคนจองไป' : 'That time was just taken.',
  textQuestion: (lang: 'th' | 'en') => lang === 'th' ? 'ต้องการรับข้อความยืนยันการจองทางเบอร์นี้ไหมคะ' : 'Would you like a text confirming the booking at this number?',
};

export class Call {
  token = ''; tenantId = ''; conversationId = ''; lang: 'th' | 'en' = 'th'; ani: string | null = null;
  turns: Array<{ seq: number; who: 'ai' | 'caller'; text: string }> = [];
  callerUtterances = 0; outcomes: string[] = []; corpus: string[] = [];
  now: () => Date;

  constructor(now: () => Date) { this.now = now; }

  static async start(o: { dialed: string; ani: string | null; lang?: 'th' | 'en'; now: () => Date; isTest?: boolean }) {
    const call = new Call(o.now);
    call.lang = o.lang ?? 'th';
    call.startedAt = o.now().getTime();
    call.ani = o.ani;
    const route = await withSystem(async tx => (await tx.query('select tenant_id, location_id from phone_numbers where e164 = $1', [o.dialed])).rows[0]);
    if (!route) return { call, unrouted: true };
    call.tenantId = route.tenant_id;
    call.conversationId = uuid();
    const name = await withTenant(call.tenantId, async tx => {
      const cfg = (await tx.query(`select number from configuration_versions where status = 'published'`)).rows[0];
      await tx.query(`insert into conversations (tenant_id, id, channel, provider_call_id, ani, ani_hash, status, config_version, started_at, lang, is_test)
        values ($1,$2,'voice',$3,$4,$5,'in_dialogue',$6,$7,$8,$9)`,
        [call.tenantId, call.conversationId, `sim-${call.conversationId}`, o.ani, o.ani ? idHash(o.ani) : null, cfg?.number ?? 1, o.now(), call.lang, !!o.isTest]);
      const country = (await tx.query('select country from tenants')).rows[0].country;
      call.recordingOn = !!(await tx.query('select body from policies order by version desc limit 1')).rows[0]?.body?.recording;
      await tx.query('update conversations set recording_on = $2 where id = $1', [call.conversationId, call.recordingOn]);
      call.claims = { tenant_id: call.tenantId, location_id: route.location_id, conversation_id: call.conversationId, config_version: cfg?.number ?? 1,
        ani: o.ani, lang: call.lang, jurisdiction: country };
      call.token = mintCallToken(call.claims, o.now());
      call.tokenAt = o.now().getTime();
      return (await tx.query('select name from locations limit 1')).rows[0].name as string;
    });
    call.say(T.greeting(name, call.lang, call.recordingOn));
    return { call, unrouted: false };
  }

  /** Every caller turn passes the emergency rules first (UQ1 tier E applies anywhere in the call, SM-2). */
  async listen(text: string): Promise<{ emergency: true; spokenNumber: string } | null> {
    this.hear(text);
    if (!isEmergency(text)) return null;
    const country = await withTenant(this.tenantId, async tx => (await tx.query('select country from tenants')).rows[0].country);
    const n = await withSystem(async s => (await s.query(`select number, label_th, label_en from jurisdiction_contacts where country = $1 order by kind limit 1`, [country])).rows[0]);
    this.say(this.lang === 'th' ? `หากเป็นเหตุฉุกเฉิน กรุณาโทร ${n.label_th} ทันทีค่ะ` : `If this is an emergency, please call ${n.label_en} now.`);
    this.outcomes.push('unsafe_refused/emergency');
    return { emergency: true, spokenNumber: n.number };
  }

  say(text: string) { const seq = this.turns.length; this.turns.push({ seq, who: 'ai', text }); return seq; }
  hear(text: string) { const seq = this.turns.length; this.turns.push({ seq, who: 'caller', text }); this.callerUtterances++; this.corpus.push(text); return seq; }

  claims: Omit<CallClaims, 'exp' | 'jti'> | null = null;
  tokenAt = 0;
  warned = false;

  /** The telephony gateway renews the 15-minute call token while the call is live (blueprint §6.3). */
  private renew() {
    if (this.claims && this.now().getTime() - this.tokenAt > 10 * 60_000) { this.token = mintCallToken(this.claims, this.now()); this.tokenAt = this.now().getTime(); }
  }

  /** Call-length policy, checked before every caller turn: warn at 13 min, wrap up and end at 15 (AT-48). */
  async checkClock(): Promise<'continue' | 'warn' | 'ended'> {
    const c = callClock(this.now().getTime() - this.startedAt, this.warned);
    if (c === 'warn') { this.warned = true; this.say(WARN[this.lang]); return 'warn'; }
    if (c === 'end') {
      const done = this.outcomes.includes('booked') ? (this.lang === 'th' ? 'การจองของคุณบันทึกไว้แล้วค่ะ ' : 'Your booking is saved. ') : '';
      this.say(`${done}${this.lang === 'th' ? 'ขอบคุณที่โทรมาค่ะ สวัสดีค่ะ' : 'Thank you for calling. Goodbye.'}`);
      await this.end('max_duration');
      return 'ended';
    }
    return 'continue';
  }

  async tool(name: string, args: unknown, meta: Meta = {}): Promise<ToolResult> {
    this.renew();
    const r = await callTool(this.token, name, args, meta, this.now());
    if (r.ok) this.corpus.push(JSON.stringify(r.data));
    return r;
  }

  /** Search → offer → hold → exact confirmation → (caller) → create. `affirm` false simulates "hmm" / no. */
  async book(o: { service: string; when: string; pick?: number; name: string; affirm?: boolean; textConfirmation?: boolean; staff?: string; earlyYes?: boolean }) {
    this.hear(`${o.service} ${o.when}`);
    const s = await this.tool('search_availability', { variant_ref: o.service, date_phrase: o.when, ...(o.staff ? { staff_ref: o.staff } : {}) });
    if (!s.ok || !s.data.options?.length) return { stage: 'search', result: s };
    const opt = s.data.options[o.pick ?? 0];
    this.say(s.data.options.map((x: any) => this.lang === 'th' ? x.start_local_th : x.start_local_en).join(' / '));
    this.hear('เอาเวลานี้');
    const h = await this.tool('hold_slot', { slot_token: opt.slot_token, client_name: o.name });
    if (!h.ok) { if (h.error.code === 'CONFLICT') this.say(T.slotTaken(this.lang)); return { stage: 'hold', result: h, search: s }; }
    const rendered = h.data.rendered_confirmation;
    const yesEarly = o.earlyYes ? this.hear('ใช่ จองเลย') : undefined;
    const spokenTurn = this.say(this.lang === 'th' ? rendered.th : rendered.en);
    const confirmTurn = o.earlyYes ? yesEarly! : this.hear(o.affirm === false ? 'อืม' : 'ใช่ค่ะ');
    if (o.affirm === false) { await this.tool('release_hold', { hold_ref: h.data.hold_ref }); return { stage: 'declined', hold: h }; }
    let textYes: number | undefined;
    if (o.textConfirmation) { this.say(T.textQuestion(this.lang)); textYes = this.hear('ได้ค่ะ'); }
    const b = await this.tool('create_booking', { hold_ref: h.data.hold_ref, client_name: o.name, send_confirmation_text: !!o.textConfirmation },
      { spoken_confirmation_sha256: sha(rendered.th + '\n' + rendered.en), spoken_turn: spokenTurn, confirm_turn: confirmTurn, text_consent_turn: textYes });
    if (b.ok) { this.say(this.lang === 'th' ? b.data.rendered_summary.th : b.data.rendered_summary.en); this.outcomes.push('booked'); }
    return { stage: 'create', result: b, hold: h, search: s, option: opt };
  }

  /** SM-7: answer from a fact only if the scripted model draft passes the grounding check; otherwise SM-8. */
  async ask(question: string, modelDraft?: string) {
    this.hear(question);
    const f = await this.tool('get_business_facts', { question });
    if (f.ok && f.data.status === 'answer') {
      const draft = modelDraft ?? f.data.facts[0].text;
      if (grounded(draft, this.corpus)) { this.say(draft); this.outcomes.push('faq_answered'); return { answered: true, facts: f.data };}
    }
    this.say(T.unknown(this.lang));
    return { answered: false, facts: f.ok ? f.data : null };
  }

  /** UQ1–UQ6 with the caller's scripted choices. Returns the terminal outcome reached inside the call. */
  async unknownQuestion(o: {
    question: string; summary: string; choice: 'text' | 'live' | 'decline'; target?: { kind: 'ani' } | { kind: 'other_number'; number: string };
    consent?: boolean; callerName?: string; transferSim?: Meta['transfer_sim']; contextLine?: string; variantRef?: string;
  }) {
    const gate = await safetyGate(o.question);
    if (gate.tier === 'E') {
      const n = await withTenant(this.tenantId, async tx => {
        const country = (await tx.query('select country from tenants')).rows[0].country;
        return (await withSystem(async s => (await s.query(`select number, label_th, label_en from jurisdiction_contacts where country = $1 order by kind limit 1`, [country])).rows[0]));
      });
      this.say(this.lang === 'th' ? `หากเป็นเหตุฉุกเฉิน กรุณาโทร ${n.label_th} ทันทีค่ะ` : `If this is an emergency, please call ${n.label_en} now.`);
      this.outcomes.push('unsafe_refused/emergency');
      return { outcome: 'unsafe_refused', tier: 'E', spokenNumber: n.number };
    }
    if (gate.tier === 'P') {
      this.say(this.lang === 'th' ? 'เรื่องนี้ดิฉันช่วยทางโทรศัพท์ไม่ได้ และจะไม่บันทึกรายละเอียดนั้นไว้ค่ะ' : "I can't help with that by phone, and I won't record those details.");
      this.outcomes.push(`unsafe_refused/prohibited:${gate.category}`);
      return { outcome: 'unsafe_refused', tier: 'P', category: gate.category, masked: gate.masked };
    }
    if (o.choice === 'live') {
      const t = await this.tool('request_human_transfer', { reason: 'unknown_question', topic: o.summary.slice(0, 80) }, { transfer_sim: o.transferSim });
      if (t.ok && t.data.outcome === 'bridged') { this.outcomes.push('transfer_connected'); return { outcome: 'transfer_connected', tier: gate.tier }; }
      this.say(this.lang === 'th' ? 'ไม่มีใครรับสายได้ในตอนนี้ค่ะ' : 'No one was able to pick up.');
    }
    if (o.choice === 'decline') { this.outcomes.push('caller_declined_followup'); return { outcome: 'caller_declined_followup', tier: gate.tier }; }
    const summary = cleanSummary(o.summary);
    this.say(this.lang === 'th' ? `ขอทวนคำถามนะคะ: ${summary} ถูกต้องไหมคะ` : `Just to check, your question is: ${summary}. Is that right?`);
    this.hear('ใช่');
    const target = o.target ?? { kind: 'ani' as const };
    const consentTurn = this.hear(o.consent === false ? 'ไม่ต้อง' : 'ได้ค่ะ');
    if (o.consent === false) { this.outcomes.push('caller_declined_followup'); return { outcome: 'caller_declined_followup', tier: gate.tier }; }
    const c = await this.tool('record_consent', { purpose: 'service_followup', target: target.kind, ...(target.kind === 'other_number' ? { number: target.number } : {}), question_text: summary },
      { utterance_turn_ref: String(consentTurn) });
    if (!c.ok) { this.outcomes.push('caller_declined_followup'); return { outcome: 'caller_declined_followup', tier: gate.tier, error: c.error }; }
    const pq = await this.tool('request_owner_answer', { question_text: summary, summary_source: 'model', reply_target: target,
      ...(o.callerName ? { caller_preferred_name: o.callerName } : {}), ...(o.contextLine ? { context_line: o.contextLine } : {}), ...(o.variantRef ? { variant_ref: o.variantRef } : {}) });
    if (!pq.ok) {
      this.say(this.lang === 'th' ? 'ขออภัยค่ะ ส่งคำถามไม่สำเร็จ กรุณาติดต่อร้านโดยตรงนะคะ' : "I wasn't able to send your question just now. Please contact us directly.");
      this.outcomes.push('pq_creation_failed');
      return { outcome: 'pq_creation_failed', tier: gate.tier, error: pq.error };
    }
    this.say(pq.data.speakable_expectation);
    this.outcomes.push('pq_created');
    return { outcome: 'pq_created', tier: gate.tier, pq: pq.data };
  }

  recordingOn = false;
  startedAt = 0;

  /** AT-33: the caller objects — recording stops at this offset; the call continues. */
  async objectToRecording() {
    this.hear(this.lang === 'th' ? 'ไม่ต้องอัดเสียงนะคะ' : "Please don't record this.");
    this.recordingOn = false;
    const offset = this.now().getTime() - this.startedAt;
    await withTenant(this.tenantId, tx => tx.query(`update conversations set recording_on = false, recording_stopped_offset_ms = $2 where id = $1`, [this.conversationId, offset]));
    this.say(this.lang === 'th' ? 'ได้ค่ะ ปิดการบันทึกเสียงแล้วค่ะ' : "Okay, I've turned recording off.");
  }

  async end(endedBy: 'caller' | 'ai' | 'max_duration' | 'system_fault' = 'caller', spam = false) {
    return withTenant(this.tenantId, async tx => {
      const closed = await closeConversation(tx, this.tenantId, { conversationId: this.conversationId, now: this.now(), endedBy, callerUtterances: this.callerUtterances, spam, outcomes: this.outcomes });
      if (!('already' in closed)) {
        // A recording exists only if recording was never refused; in production the stopped call keeps audio up to the offset.
        await persistCallArtifacts(tx, this.tenantId, { conversationId: this.conversationId, turns: this.turns, recordingOn: this.recordingOn,
          durationMs: this.now().getTime() - this.startedAt, now: this.now() });
      }
      return closed;
    });
  }
}
