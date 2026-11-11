/**
 * Project-local PostgreSQL 18 for Gate A (simulation only).
 * Binaries from @embedded-postgres/darwin-arm64; data in .data/pg (git-ignored); 127.0.0.1:54421 only, no unix
 * sockets, trust auth on loopback. Databases: `rcpt` (simulation) and `rcpt_test` (tests). Deleting .data/ removes it.
 *
 *   node scripts/db.ts start | stop | status
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, '.data', 'pg');
const LOG = path.join(ROOT, '.data', 'pg.log');
export const PORT = 54421;
export const SUPERUSER = 'rcpt';
const DATABASES = ['rcpt', 'rcpt_test'];

function bin(name: string): string {
  const dir = path.join(ROOT, 'node_modules', '@embedded-postgres', `${process.platform}-${process.arch}`, 'native', 'bin');
  if (!existsSync(dir)) throw new Error(`No bundled PostgreSQL for ${process.platform}-${process.arch}; set DATABASE_URL to your own PostgreSQL 16+.`);
  return path.join(dir, name);
}

function run(name: string, args: string[], allowFail = false) {
  const r = spawnSync(bin(name), args, { encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    process.stderr.write((r.stdout ?? '') + (r.stderr ?? ''));
    throw new Error(`${name} exited with ${r.status}`);
  }
  return r;
}

const running = () => existsSync(path.join(DATA, 'PG_VERSION')) && run('pg_ctl', ['-D', DATA, 'status'], true).status === 0;

async function start() {
  if (!existsSync(path.join(DATA, 'PG_VERSION'))) {
    mkdirSync(DATA, { recursive: true });
    run('initdb', ['-D', DATA, '-U', SUPERUSER, '--auth=trust', '--encoding=UTF8', '--locale=C']);
    writeFileSync(path.join(DATA, 'pg_hba.conf'), 'host all all 127.0.0.1/32 trust\n');
  }
  if (!running()) {
    run('pg_ctl', ['-D', DATA, '-l', LOG, '-w', '-o', `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=`, 'start']);
  }
  const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: SUPERUSER, database: 'postgres' });
  await c.connect();
  try {
    for (const db of DATABASES) {
      const r = await c.query('select 1 from pg_database where datname = $1', [db]);
      if (!r.rowCount) await c.query(`create database ${db}`);
    }
    const role = await c.query(`select 1 from pg_roles where rolname = 'rcpt_app'`);
    if (!role.rowCount) await c.query(`create role rcpt_app login nosuperuser nobypassrls`);
  } finally {
    await c.end();
  }
  console.log(`PostgreSQL ready on 127.0.0.1:${PORT} (databases ${DATABASES.join(', ')}; app role rcpt_app)`);
}

const cmd = process.argv[2];
if (cmd === 'start') await start();
else if (cmd === 'stop') { if (running()) run('pg_ctl', ['-D', DATA, '-w', 'stop']); console.log('stopped'); }
else if (cmd === 'status') console.log(running() ? `running on ${PORT}` : 'stopped');
else { console.error('usage: node scripts/db.ts start|stop|status'); process.exit(2); }
