/** Database access as the non-superuser app role, so row-level security always applies. */
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';

export type Tx = pg.PoolClient;

let pool: pg.Pool | undefined;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ host: '127.0.0.1', port: 54421, user: 'rcpt_app', database: process.env.RCPT_DB ?? 'rcpt', max: 20 });
  return pool;
}
export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

/** Run fn in one transaction scoped to a tenant (RLS reads app.tenant_id). */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** System context (no tenant): only system tables are visible. */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const uuid = () => randomUUID();
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();
/** Stable hash for phone numbers and LINE ids (lookups and deletion without storing plaintext twice). */
export const idHash = (v: string) => sha256('rcpt-id:' + v.replace(/[\s-]/g, ''));

export async function audit(tx: Tx, tenantId: string | null, a: {
  machine: string; entity: string; from?: string | null; to?: string | null; event: string; actor: string;
  correlation?: string; detail?: unknown; at: Date;
}) {
  await tx.query(
    `insert into audit_events (tenant_id, machine, entity_id, from_state, to_state, event, actor, correlation_id, detail, at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [tenantId, a.machine, a.entity, a.from ?? null, a.to ?? null, a.event, a.actor, a.correlation ?? null,
     a.detail === undefined ? null : JSON.stringify(a.detail), a.at],
  );
}

/** Simulation clock: every rule takes `now` from here so tests can move time (holds, expiries, reminders). */
export class Clock {
  t: number;
  constructor(iso: string) { this.t = Date.parse(iso); }
  now(): Date { return new Date(this.t); }
  advance(ms: number) { this.t += ms; }
}
