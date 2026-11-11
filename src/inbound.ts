/**
 * Inbound edge (Z1): verify, de-duplicate, route, then act. An unauthenticated message never touches a pending
 * question; it is logged as a security event.
 */
import { audit, idHash, sha256, withSystem, withTenant } from './db.ts';
import { applyOptKeyword, enqueue, firstReceipt, keyword, verifyLine, verifySms } from './messaging/channels.ts';
import { confirmTarget, handleOwnerEvent, ownerAction, readPostback } from './escalation/pq.ts';

export const LINE_CHANNEL_SECRET = process.env.RCPT_LINE_SECRET ?? 'sandbox-line-channel-secret';
export const SMS_WEBHOOK_SECRET = process.env.RCPT_SMS_SECRET ?? 'sandbox-sms-webhook-secret';

type LineEvent = { webhookEventId: string; type: 'message' | 'postback'; source: { type: string; userId: string };
  message?: { id: string; type: string; text?: string; quotedMessageId?: string }; postback?: { data: string } };

export async function lineWebhook(rawBody: string, signature: string | undefined, now: Date) {
  if (!verifyLine(rawBody, signature, LINE_CHANNEL_SECRET)) {
    await withSystem(tx => audit(tx, null, { machine: 'edge', entity: 'line', event: 'bad_signature', actor: 'unknown', at: now }));
    return { status: 401, results: [] as unknown[] };
  }
  const results: unknown[] = [];
  for (const ev of (JSON.parse(rawBody).events ?? []) as LineEvent[]) {
    if (ev.source?.type !== 'user') continue;
    const fresh = await withSystem(tx => firstReceipt(tx, 'line', ev.webhookEventId, null, true));
    if (!fresh) { results.push({ replay: true }); continue; }
    const tenants: string[] = await withSystem(async tx =>
      (await tx.query(`select tenant_id from owner_routes where channel = 'line' and value_hash = $1`, [idHash(ev.source.userId)])).rows.map(r => r.tenant_id));
    let pb: Record<string, string> | null = null;
    if (ev.type === 'postback') {
      pb = readPostback(ev.postback?.data ?? '');
      if (!pb || !tenants.includes(pb.t)) {
        await withSystem(tx => audit(tx, null, { machine: 'edge', entity: 'line', event: 'forged_or_foreign_postback', actor: 'line_user', at: now }));
        results.push({ rejected: 'postback' });
        continue;
      }
    }
    if (!tenants.length) {
      await withSystem(tx => audit(tx, null, { machine: 'edge', entity: 'line', event: 'unenrolled_sender', actor: 'line_user', at: now }));
      results.push({ rejected: 'unenrolled' });
      continue;
    }
    for (const tenantId of pb ? [pb.t] : tenants) {
      results.push(await withTenant(tenantId, async tx => {
        const who = (await tx.query(`select id from owner_identities where channel = 'line' and value_hash = $1`, [idHash(ev.source.userId)])).rows[0];
        if (!who) return { rejected: 'not_owner_here' };
        return handleOwnerEvent(tx, tenantId, { channel: 'line', identityId: who.id, providerMessageId: ev.message?.id ?? ev.webhookEventId,
          text: ev.message?.text, quotedMessageId: ev.message?.quotedMessageId, postback: pb ?? undefined }, now);
      }));
    }
  }
  return { status: 200, results };
}

/** Generic two-way SMS stand-in. Real adapters (Twilio, Telnyx, a Thai gateway) verify their own signature schemes. */
export async function smsWebhook(rawBody: string, ts: number, signature: string | undefined, now: Date) {
  if (!verifySms(rawBody, ts, signature, SMS_WEBHOOK_SECRET, now)) {
    await withSystem(tx => audit(tx, null, { machine: 'edge', entity: 'sms', event: 'bad_signature', actor: 'unknown', at: now }));
    return { status: 401 };
  }
  const m = JSON.parse(rawBody) as { message_id: string; from: string; to: string; body: string };
  if (!(await withSystem(tx => firstReceipt(tx, 'sms', m.message_id, null, true)))) return { status: 200, replay: true };
  const route = await withSystem(async tx => (await tx.query(`select tenant_id, two_way from senders where channel = 'sms' and sender = $1`, [m.to])).rows[0]);
  if (!route) return { status: 404 };
  return withTenant(route.tenant_id, async tx => {
    const owner = (await tx.query(`select id from owner_identities where channel = 'sms' and value_hash = $1`, [idHash(m.from)])).rows[0];
    if (owner) return { status: 200, ...(await handleOwnerEvent(tx, route.tenant_id, { channel: 'sms', identityId: owner.id, providerMessageId: m.message_id, text: m.body }, now)) };
    const kw = keyword(m.body);
    if (kw === 'stop' || kw === 'start') {
      await applyOptKeyword(tx, route.tenant_id, { sender: m.to, target: m.from, channel: 'sms', kw, sourceMessageId: m.message_id, now, twoWay: route.two_way, lang: /[฀-๿]/.test(m.body) ? 'th' : 'en' });
      return { status: 200, keyword: kw };
    }
    if (kw === 'help') {
      const loc = (await tx.query('select name, public_phone from locations limit 1')).rows[0];
      const th = /[\u0E00-\u0E7F]/.test(m.body);
      const body = th ? `${loc.name}: ติดต่อ ${loc.public_phone}${route.two_way ? ' ส่ง STOP เพื่อยกเลิกรับข้อความ' : ''}`
        : `${loc.name}: call ${loc.public_phone} for help.${route.two_way ? ' Reply STOP to opt out.' : ''}`;
      await enqueue(tx, route.tenant_id, { kind: 'sms', key: `help:${m.message_id}`, to: m.from, sender: m.to, body, exempt: true, now });
      return { status: 200, keyword: 'help' };
    }
    if (/^\s*yes\s*$/i.test(m.body)) {
      const pqs = (await tx.query(`select id from pending_questions where target_hash = $1 and target_confirmed_at is null and terminal_outcome is null`, [idHash(m.from)])).rows;
      for (const p of pqs) await confirmTarget(tx, route.tenant_id, p.id, now);
      return { status: 200, confirmed: pqs.length };
    }
    await audit(tx, route.tenant_id, { machine: 'edge', entity: 'sms', event: kw === 'plain_opt_out' ? 'plain_opt_out_for_review' : 'caller_text_forwarded', actor: 'caller', at: now });
    return { status: 200, forwarded: true, review: kw === 'plain_opt_out' };
  });
}

/** One-time links (Thai one-way SMS): confirm a reply number, opt out, or open the owner reply page. */
export async function linkHit(token: string, now: Date, ownerText?: string, pressSend = false) {
  const row = await withSystem(async tx => (await tx.query(`select * from link_tokens where token_hash = $1 for update`, [sha256(token)])).rows[0]);
  if (!row || row.expires_at < now) return { status: 410 };
  if (row.kind === 'confirm_target') {
    return withTenant(row.tenant_id, tx => confirmTarget(tx, row.tenant_id, row.ref, now));
  }
  if (row.kind === 'opt_out') {
    if (row.used_at) return { status: 200, already: true };
    await withSystem(tx => tx.query(`update link_tokens set used_at = $2 where token_hash = $1`, [sha256(token), now]));
    return withTenant(row.tenant_id, async tx => {
      const s = (await tx.query(`select sender, two_way from senders where tenant_id = $1 and channel = 'sms'`, [row.tenant_id])).rows[0];
      await applyOptKeyword(tx, row.tenant_id, { sender: s.sender, target: row.ref, channel: 'sms', kw: 'stop', sourceMessageId: `link:${sha256(token).toString('hex').slice(0, 16)}`, now, twoWay: s.two_way, lang: 'th' });
      return { status: 200, opted_out: true };
    });
  }
  // owner_reply: Gate A accepts the token alone; production also requires an owner session (passkey/OTP) — §5.8.5.
  if (!ownerText) return { status: 200, page: 'owner_reply', pending_question: row.ref };
  return withTenant(row.tenant_id, async tx => {
    const owner = (await tx.query(`select id from owner_identities order by priority limit 1`)).rows[0];
    const r: any = await handleOwnerEvent(tx, row.tenant_id, { channel: 'web', identityId: owner.id, providerMessageId: `web:${now.getTime()}`, text: ownerText,
      quotedMessageId: undefined, pqId: row.ref }, now);
    // The web page is itself the preview: its Send button is the owner's explicit confirmation.
    if (pressSend && r.status === 'owner_confirming') {
      const pq = (await tx.query('select pending_reply_id from pending_questions where id = $1', [row.ref])).rows[0];
      return ownerAction(tx, row.tenant_id, row.ref, 'send', now, { r: pq.pending_reply_id });
    }
    return r;
  });
}
