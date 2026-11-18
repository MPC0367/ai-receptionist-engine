/** SM-14 billable-conversation rule v1 (draft, D-02). One usage event per conversation per rule version, ever. */
import type { Tx } from './db.ts';
import { audit, uuid } from './db.ts';

export const RULE_VERSION = 'billable-v1-draft';
const band = (s: number) => (s < 60 ? '0-1' : s < 120 ? '1-2' : s < 240 ? '2-4' : s < 480 ? '4-8' : '8-15');

export async function closeConversation(tx: Tx, tenantId: string, a: {
  conversationId: string; now: Date; endedBy: 'caller' | 'ai' | 'max_duration' | 'system_fault'; callerUtterances: number; spam?: boolean; outcomes: string[];
}) {
  const conv = (await tx.query(`select * from conversations where id = $1 for update`, [a.conversationId])).rows[0];
  if (conv.status === 'closed') return { already: true };
  const seconds = Math.round((a.now.getTime() - (conv.started_at as Date).getTime()) / 1000);
  await tx.query(`update conversations set status = 'closed', ended_at = $2, ended_by = $3, outcome_codes = $4 where id = $1`, [a.conversationId, a.now, a.endedBy, a.outcomes]);
  await tx.query(`update holds set status = 'released' where conversation_id = $1 and status = 'active'`, [a.conversationId]);
  await tx.query(`update slot_claims set status = 'released' where status = 'active' and kind = 'hold'
                  and hold_ref in (select hold_ref from holds where conversation_id = $1)`, [a.conversationId]);
  let reason = 'billable';
  if (conv.is_test) reason = 'test_call';
  else if (a.spam) reason = 'spam';
  else if (a.callerUtterances < 1) reason = 'no_caller_speech';
  else if (seconds < 15) reason = 'too_short';
  else if (a.endedBy === 'system_fault' && seconds < 60) reason = 'system_fault';
  else if (a.outcomes.length === 1 && a.outcomes[0] === 'pq_creation_failed') reason = 'system_fault';
  await tx.query(
    `insert into usage_events (tenant_id, id, conversation_id, rule_version, billable, reason, duration_s, duration_band)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id, conversation_id, rule_version) do nothing`,
    [tenantId, uuid(), a.conversationId, RULE_VERSION, reason === 'billable', reason, seconds, band(seconds)]);
  await audit(tx, tenantId, { machine: 'SM-2', entity: a.conversationId, to: 'closed', event: 'ended', actor: a.endedBy, detail: { seconds, reason, outcomes: a.outcomes }, at: a.now });
  return { billable: reason === 'billable', reason, seconds };
}
