import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watched, callClock, FILLER_MS, DEGRADE_MS } from '../src/runtime/limits.ts';

/** A controllable clock so the latency test takes no real time. */
function fakeTimers() {
  let now = 0; const q: Array<{ at: number; fn: () => void; id: number }> = []; let id = 0;
  return {
    setTimeout: ((fn: () => void, ms: number) => { q.push({ at: now + ms, fn, id: ++id }); return id; }) as any,
    clearTimeout: ((x: number) => { const i = q.findIndex(t => t.id === x); if (i >= 0) q.splice(i, 1); }) as any,
    async advance(ms: number) { now += ms; for (const t of q.filter(t => t.at <= now).sort((a, b) => a.at - b.at)) { q.splice(q.indexOf(t), 1); t.fn(); } await Promise.resolve(); },
  };
}

test('AT-37 latency: filler at 1.8 s, recovery line at 4 s, and a late result is ignored', async () => {
  const t = fakeTimers(); const spoken: string[] = [];
  let resolve!: (v: string) => void;
  const p = watched(new Promise<string>(r => (resolve = r)), l => spoken.push(l), t);
  await t.advance(FILLER_MS);
  assert.deepEqual(spoken, ['filler']);
  await t.advance(DEGRADE_MS - FILLER_MS);
  const r = await p;
  assert.equal(r.status, 'degraded');
  assert.deepEqual(spoken, ['filler', 'degraded']);
  resolve('too late');
});

test('a fast step speaks nothing extra; a step between 1.8 s and 4 s gets only the filler', async () => {
  const t = fakeTimers(); const spoken: string[] = [];
  assert.deepEqual(await watched(Promise.resolve('ok'), l => spoken.push(l), t), { status: 'ok', value: 'ok', filler: false });
  let resolve!: (v: string) => void;
  const p = watched(new Promise<string>(r => (resolve = r)), l => spoken.push(l), t);
  await t.advance(2_500); resolve('ok');
  assert.deepEqual(await p, { status: 'ok', value: 'ok', filler: true });
  assert.deepEqual(spoken, ['filler']);
});

test('call clock: warn once at 13 min, end at 15', () => {
  assert.equal(callClock(12 * 60_000, false), 'continue');
  assert.equal(callClock(13 * 60_000, false), 'warn');
  assert.equal(callClock(14 * 60_000, true), 'continue');
  assert.equal(callClock(15 * 60_000, true), 'end');
});
