/**
 * Model-driven Gate A evaluation (D-04b): which turn model completes the scenarios, how often the runtime had to
 * discard an ungrounded reply or a malformed tool call, tokens, API time and estimated cost. Simulation only:
 * fictional data, sandbox messages, the `rcpt` database. Refuses to run without --yes.
 *
 *   Claude (spends money, stops at --budget-usd):
 *     node sim/model/run.ts --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5 --repeats 2 --budget-usd 30 --yes
 *   Free routes (no money: local compute or a free quota, see free-models.ts):
 *     node sim/model/run.ts --provider ollama --models gemma4:12b --yes
 *     node sim/model/run.ts --provider cerebras --models gpt-oss-120b --yes
 *     node sim/model/run.ts --provider gemini --models gemini-3.8-flash --yes
 *   Keep one caller model for every receptionist model so differences come from the receptionist:
 *   --caller-provider / --caller-model (default: the first --models entry on the same provider).
 *   --only M01-book-thai,M04-emergency runs just those scenarios (a timing check before a full run).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Clock, closeDb } from '../../src/db.ts';
import { drain } from '../../src/handlers.ts';
import { seed, A, NUM } from '../seed.ts';
import { Call } from '../session.ts';
import { Receptionist, type ModelClient, type Usage } from './receptionist.ts';
import { CompatClient, PROVIDERS, QuotaError, type Provider } from './free-models.ts';
import { scenarios, callerSystem } from './scenarios.ts';

process.env.RCPT_DB ??= 'rcpt';
export const PRICES: Record<string, { in: number; out: number; read: number; write: number }> = { // US$ per 1M tokens (Claude API reference, 3 Nov 2026)
  'claude-opus-5-5': { in: 4, out: 20, read: 0.20, write: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.10, write: 2.5 },
  'claude-haiku-5-5': { in: 0.10, out: 0.50, read: 0.01, write: 0.125 },
};
/** US$ for Claude models; 0 for the free routes (their quota or local compute is not money). */
export const cost = (model: string, u: Usage) => {
  const p = PRICES[model];
  if (!p) {
    if (model.startsWith('claude-')) throw new Error(`No price for ${model}: add it to PRICES before spending.`);
    return 0;
  }
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
    callerUsage.calls++; callerUsage.input += r.usage?.input_tokens ?? 0; callerUsage.output += r.usage?.output_tokens ?? 0; callerUsage.cacheRead += r.usage?.cache_read_input_tokens ?? 0;
    const out = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
    // "ยืนยันจองเลยค่ะ ขอบคุณค่ะ [HANGUP]": what is said before the hang-up still reaches the receptionist (found 12 Nov
    // 2026: the whole turn, the "yes" included, used to be dropped).
    const hangup = out.includes('[HANGUP]'), said = out.replace(/\[HANGUP\]/g, '').trim();
    if (!said) break;
    callerMsgs.push({ role: 'assistant', content: said });
    clock.advance(20_000);
    const reply = await rec.respond(said);
    callerMsgs.push({ role: 'user', content: reply });
    if (hangup) break;
    if (call.outcomes.includes('unsafe_refused/emergency') && turn > 1) break;
  }
  clock.advance(10_000);
  await call.end();
  await drain(clock.now());
  const g = await sc.grade(call, rec.events);
  return { scenario: sc.id, model, pass: g.pass, why: g.why, events: rec.events, tools: rec.toolLog, discarded: rec.discarded, usage: rec.usage, callerUsage,
    cost: cost(model, rec.usage) + cost(callerModel, callerUsage), transcript: call.turns.map(t => `${t.who === 'ai' ? 'AI' : 'Caller'}: ${t.text}`) };
}

type Opts = { baseURL?: string; numCtx?: string; think?: string; minInterval?: string };

async function clientFor(provider: string, o: Opts): Promise<ModelClient> {
  if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic() as unknown as ModelClient; // credentials from ANTHROPIC_API_KEY or an `ant auth login` profile
  }
  if (!(provider in PROVIDERS)) throw new Error(`Unknown provider ${provider} (anthropic, ${Object.keys(PROVIDERS).join(', ')})`);
  return new CompatClient({ provider: provider as Provider, baseURL: o.baseURL, numCtx: o.numCtx ? Number(o.numCtx) : undefined,
    think: o.think, minIntervalMs: o.minInterval ? Number(o.minInterval) : undefined });
}

if (import.meta.main) {
  const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const provider = arg('--provider', 'anthropic')!;
  const free = provider !== 'anthropic';
  const modelsArg = arg('--models', free ? undefined : 'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5');
  if (!modelsArg) { console.log(`--provider ${provider} needs --models (for example --models gemma4:12b).`); process.exit(1); }
  const models = modelsArg.split(',');
  const callerProvider = arg('--caller-provider', provider)!;
  const callerModel = arg('--caller-model', callerProvider === 'anthropic' ? 'claude-opus-5-5' : models[0])!;
  const repeats = Number(arg('--repeats', '2')), budget = Number(arg('--budget-usd', '30'));
  const opts: Opts = { baseURL: arg('--base-url'), numCtx: arg('--num-ctx'), think: arg('--think'), minInterval: arg('--min-interval-ms') };
  const only = arg('--only')?.split(',');
  const list = scenarios(A).filter(s => !only || only.includes(s.id));
  if (!list.length) { console.log(`No scenario matches --only ${only}.`); process.exit(1); }
  const paid = provider === 'anthropic' || callerProvider === 'anthropic';
  const estimate = list.length * repeats * models.reduce((s, m) => s + ({ 'claude-opus-5-5': 0.35, 'claude-sonnet-5-5': 0.2, 'claude-haiku-5-5': 0.08 }[m] ?? (free ? 0 : 0.35)), 0);
  console.log(`${list.length} scenarios × ${repeats} × ${models.length} models on ${provider}; caller ${callerModel} on ${callerProvider}.`);
  console.log(paid ? `Estimated ≈ US$${estimate.toFixed(0)}${free ? ' plus the Claude caller' : ''}; hard stop at US$${budget}.`
    : 'No money: local compute or a free quota. The run stops cleanly at the quota and keeps what finished.');
  if (!process.argv.includes('--yes')) { console.log(`Dry run only: add --yes to run${paid ? ' (spends money)' : ''}.`); process.exit(0); }

  const recClient = await clientFor(provider, opts);
  const callerClient = callerProvider === provider ? recClient : await clientFor(callerProvider, opts);
  const compat = [...new Set([recClient, callerClient])].filter((c): c is CompatClient => c instanceof CompatClient);
  for (const c of compat) {
    const wanted = new Set<string>();
    if (c === recClient) models.forEach(m => wanted.add(m));
    if (c === callerClient) wanted.add(callerModel);
    const problems = await c.preflight([...wanted]);
    if (problems.length) { for (const p of problems) console.log(`- ${p}`); await closeDb(); process.exit(1); }
  }
  const tokenCap = Number(arg('--max-tokens', String(free ? PROVIDERS[provider as Provider].maxTokensTotal : Infinity)));
  const tokens = () => compat.reduce((s, c) => s + c.stats.tokens, 0);

  const results: any[] = [];
  let spent = 0, stopped = '';
  try {
    outer: for (const m of models) for (let r = 0; r < repeats; r++) for (const sc of list) {
      if (spent >= budget) { stopped = `budget reached (US$${spent.toFixed(2)})`; break outer; }
      if (tokens() >= tokenCap) { stopped = `token cap reached (${tokens()} of ${tokenCap})`; break outer; }
      const res = await runOne(recClient, callerClient, sc, m, callerModel);
      spent += res.cost; results.push(res);
      const bad = res.events.filter((e: string) => e === 'invalid_tool_call').length;
      console.log(`${m} ${sc.id} #${r + 1}: ${res.pass ? 'PASS' : 'FAIL ' + res.why.join('; ')} · ${res.usage.calls} calls · ${(res.usage.ms / Math.max(1, res.usage.calls)).toFixed(0)} ms/call${bad ? ` · ${bad} invalid tool calls` : ''}${paid ? ` · US$${res.cost.toFixed(3)}` : ''}`);
    }
  } catch (e) {
    stopped = e instanceof QuotaError ? `quota: ${e.message}` : `error: ${(e as Error).message}`;
  }
  if (stopped) console.log(`Stopped early: ${stopped}. Writing what finished.`);

  const dir = path.join(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stats = compat.map(c => c.stats);
  const sum = (k: keyof CompatClient['stats']) => stats.reduce((s, x) => s + x[k], 0);
  writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify({ provider, callerProvider, callerModel, opts, stopped, stats, results }, null, 2));
  const runsWith = (rs: any[], ...ev: string[]) => rs.filter(x => ev.some(e => x.events.includes(e))).length;
  const lines = models.map(m => {
    const rs = results.filter(x => x.model === m), pass = rs.filter(x => x.pass).length;
    const calls = rs.reduce((s, x) => s + x.usage.calls, 0), ms = rs.reduce((s, x) => s + x.usage.ms, 0);
    return `| ${m} | ${pass}/${rs.length} | ${runsWith(rs, 'grounding_rejected')} | ${runsWith(rs, 'invalid_tool_call')} | ${runsWith(rs, 'machine_text_rejected', 'empty_reply')} | ${(ms / Math.max(1, calls)).toFixed(0)} ms | ${paid ? `US$${rs.reduce((s, x) => s + x.cost, 0).toFixed(2)}` : 'free'} |`;
  });
  const freeNote = free ? [
    '',
    'Open-model results show how these models behave in this runtime; they do not say how Claude would. This route has no prompt caching, server-side fallback or strict tool use: the runtime checked every tool call itself.',
    stats.length ? `Provider requests ${sum('requests')}, retries ${sum('retries')}, unparseable arguments ${sum('unparseableArgs')}, tool calls written as text ${sum('toolCallsAsText')}, tokens ${sum('tokens')}.` : '',
  ] : [];
  writeFileSync(path.join(dir, `${stamp}.md`), [
    `# Model-driven Gate A run ${stamp}`, '',
    `Receptionist on **${provider}**${opts.baseURL ? ` (${opts.baseURL})` : ''}; caller model ${callerModel} on ${callerProvider}. Fictional data only.`,
    ...(stopped ? ['', `**Stopped early:** ${stopped}.`] : []), '',
    '| Turn model | Passed | Runs with a grounding rejection | Runs with an invalid tool call | Runs with markup or silence rejected | Mean API time per call | Cost (incl. caller model) |',
    '|---|---|---|---|---|---|---|',
    ...lines, ...freeNote, '',
  ].join('\n'));
  console.log(`${paid ? `Total spent ≈ US$${spent.toFixed(2)}. ` : ''}Results in ${dir}.`);
  await closeDb();
}
