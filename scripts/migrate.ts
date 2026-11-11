/**
 * Apply migrations to a database as the superuser. `--reset` drops and recreates the public schema first
 * (only allowed on the local Gate A databases).  node scripts/migrate.ts [--db rcpt_test] [--reset]
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');

export async function migrate(database: string, reset: boolean) {
  if (!['rcpt', 'rcpt_test'].includes(database)) throw new Error(`refusing to migrate unknown database ${database}`);
  const c = new pg.Client({ host: '127.0.0.1', port: 54421, user: 'rcpt', database });
  await c.connect();
  try {
    if (reset) {
      await c.query('drop schema public cascade; create schema public; grant usage on schema public to rcpt_app');
    }
    await c.query('create table if not exists schema_migrations (name text primary key, at timestamptz default now())');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map(r => r.name));
    for (const file of readdirSync(path.join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await c.query('begin');
      await c.query(readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
      await c.query('insert into schema_migrations (name) values ($1)', [file]);
      await c.query('commit');
      console.log(`applied ${file} to ${database}`);
    }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

if (import.meta.main) {
  const i = process.argv.indexOf('--db');
  await migrate(i > 0 ? process.argv[i + 1] : 'rcpt', process.argv.includes('--reset'));
}
