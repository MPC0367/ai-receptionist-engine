/**
 * Model-driven Gate A evaluation (D-04b): which turn model completes the scenarios, how often the runtime had to
 * discard an ungrounded reply, tokens, API time and estimated cost. Simulation only: fictional data, sandbox
 * messages, the `rcpt` database. Spends real money, so it refuses to run without --yes and stops at --budget-usd.
 *
 *   node sim/model/run.ts --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5 --repeats 2 --budget-usd 30 --yes
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Clock, closeDb } from '../../src/db.ts';
import { drain } from '../../src/handlers.ts';
import { seed, A, NUM } from '../seed.ts';
import { Call } from '../session.ts';
import { Receptionist, type ModelClient, type Usage } from './receptionist.ts';
import { scenarios, callerSystem } from './scenarios.ts';

process.env.RCPT_DB ??= 'rcpt';
export const PRICES: Record<string, { in: number; out: number; read: number; write: number }> = { // US$ per 1M tokens (Claude API reference, 3 Nov 2026)
  'claude-opus-5-5': { in: 4, out: 20, read: 0.20, write: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.10, write: 2.5 },
  'claude-haiku-5-5': { in: 0.10, out: 0.50, read: 0.01, write: 0.125 },
};
export const cost = (model: string, u: Usage) => {
  const p = PRICES[model];
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.read + u.cacheWrite * p.write) / 1e6;
};

export async function runOne(client: ModelClient, callerClient: ModelClient, sc: ReturnType<typeof scenarios>[number], model: string, callerModel: string) {
  await seed('rcpt');
  const clock = new Clock('2026-11-12T03:00:00Z');
  if (sc.id === 'M07-reschedule') {
    const pre = (await Call.start({ dialed: NUM.A.dialed, ani: sc.ani, now: () => clock.now() })).call;
    await pre.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'บี' });
    await pre.end();
  }
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: sc.ani, lang: sc.lang, now: () => clock.now() });
  const rec = new Receptionist(client, call, model, 'ร้านสปาตัวอย่าง (Sample Day Spa)');
  const callerUsage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, ms: 0 };
  const callerMsgs: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: call.turns[0].text }];
  for (let turn = 0; turn < 12; turn++) {
    const r = await callerClient.messages.create({ model: callerModel, max_tokens: 400, system: callerSystem(sc.persona, sc.lang), messages: callerMsgs, output_config: { effort: 'low' } });
    callerUsage.calls++; callerUsage.input += r.usage?.input_tokens ?? 0; callerUsage.output += r.usage?.output_tokens ?? 0;
    const said = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim();
    if (!said || said.includes('[HANGUP]')) break;
    callerMsgs.push({ role: 'assistant', content: said });
    clock.advance(20_000);
    const reply = await rec.respond(said);
    callerMsgs.push({ role: 'user', content: reply });
    if (call.outcomes.includes('unsafe_refused/emergency') && turn > 1) break;
  }
  clock.advance(10_000);
  await call.end();
  await drain(clock.now());
  const g = await sc.grade(call, rec.events);
  return { scenario: sc.id, model, pass: g.pass, why: g.why, events: rec.events, usage: rec.usage, callerUsage,
    cost: cost(model, rec.usage) + cost(callerModel, callerUsage), transcript: call.turns.map(t => `${t.who === 'ai' ? 'AI' : 'Caller'}: ${t.text}`) };
}

if (import.meta.main) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const models = arg('--models', 'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5').split(',');
  const callerModel = arg('--caller-model', 'claude-opus-5-5');
  const repeats = Number(arg('--repeats', '2')), budget = Number(arg('--budget-usd', '30'));
  const list = scenarios(A);
  const estimate = list.length * repeats * models.reduce((s, m) => s + ({ 'claude-opus-5-5': 0.35, 'claude-sonnet-5-5': 0.2, 'claude-haiku-5-5': 0.08 }[m] ?? 0.35), 0);
  console.log(`${list.length} scenarios × ${repeats} × ${models.length} models; estimated ≈ US$${estimate.toFixed(0)}; hard stop at US$${budget}.`);
  if (!process.argv.includes('--yes')) { console.log('Dry run only: add --yes to spend.'); process.exit(0); }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic() as unknown as ModelClient; // credentials from ANTHROPIC_API_KEY or an `ant auth login` profile
  const results: any[] = [];
  let spent = 0;
  outer: for (const m of models) for (let r = 0; r < repeats; r++) for (const sc of list) {
    if (spent >= budget) { console.log(`Budget reached (US$${spent.toFixed(2)}): stopping.`); break outer; }
    const res = await runOne(client, client, sc, m, callerModel);
    spent += res.cost; results.push(res);
    console.log(`${m} ${sc.id} #${r + 1}: ${res.pass ? 'PASS' : 'FAIL ' + res.why.join('; ')} · ${res.usage.calls} calls · ${(res.usage.ms / Math.max(1, res.usage.calls)).toFixed(0)} ms/call · US$${res.cost.toFixed(3)}`);
  }
  const dir = path.join(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(results, null, 2));
  const by = (m: string) => results.filter(x => x.model === m);
  const lines = models.map(m => {
    const rs = by(m); const pass = rs.filter(x => x.pass).length;
    const calls = rs.reduce((s, x) => s + x.usage.calls, 0), ms = rs.reduce((s, x) => s + x.usage.ms, 0);
    const rejected = rs.filter(x => x.events.includes('grounding_rejected')).length;
    return `| ${m} | ${pass}/${rs.length} | ${rejected} | ${(ms / Math.max(1, calls)).toFixed(0)} ms | US$${rs.reduce((s, x) => s + x.cost, 0).toFixed(2)} |`;
  });
  writeFileSync(path.join(dir, `${stamp}.md`), `# Model-driven Gate A run ${stamp}\n\n| Turn model | Passed | Runs with a grounding rejection | Mean API time per call | Cost (incl. caller model) |\n|---|---|---|---|---|\n${lines.join('\n')}\n\nCaller model: ${callerModel}. Fictional data only.\n`);
  console.log(`Total spent ≈ US$${spent.toFixed(2)}. Results in ${dir}.`);
  await closeDb();
}
