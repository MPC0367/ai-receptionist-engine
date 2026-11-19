/**
 * Free model routes for the model-driven harness (D-04b at $0): a `ModelClient` that takes the harness's
 * Anthropic-shaped requests and speaks either Ollama's native /api/chat (models on this Mac) or an OpenAI-compatible
 * /v1/chat/completions (Cerebras's free trial, Gemini's free tier, anything else that speaks that shape).
 *
 * What it does not pretend: no prompt caching, no server-side fallback, no strict schema enforcement. Those are
 * Claude features; here the runtime checks every tool call itself (`checkArgs`) and the run records the faults.
 * Results from these routes say how open models behave in this runtime — not how Claude would.
 *
 * Ollama's native endpoint is used instead of its OpenAI one because only the native one takes `num_ctx`: Ollama's
 * default context is small and it silently drops the start of a longer prompt — the system prompt and the rules.
 */
import type { ModelClient } from './receptionist.ts';

export type Provider = 'ollama' | 'cerebras' | 'gemini' | 'groq' | 'openai-compatible';
type Preset = { transport: 'ollama' | 'openai'; baseURL: string; keyEnv?: string; reasoning: boolean; stripAdditional: boolean; minIntervalMs: number; maxTokensTotal: number;
  /** Gemini 3 wants every tool call in the conversation signed; calls another model made carry Google's documented skip value. */
  signsToolCalls?: boolean };

export const PROVIDERS: Record<Provider, Preset> = {
  // Nothing leaves the Mac. Models must be pulled first (`ollama pull <model>`: a download, the owner's yes).
  ollama: { transport: 'ollama', baseURL: 'http://127.0.0.1:11434', reasoning: false, stripAdditional: false, minIntervalMs: 0, maxTokensTotal: Infinity },
  // Free trial: 5 requests a minute and 1M tokens a day per model (inference-docs.cerebras.ai, rate limits, Nov 2026).
  cerebras: { transport: 'openai', baseURL: 'https://api.cerebras.ai/v1', keyEnv: 'CEREBRAS_API_KEY', reasoning: true, stripAdditional: false, minIntervalMs: 12_500, maxTokensTotal: 900_000 },
  // Free tier: prompts are used to improve Google's products, so fictional data only (it is). Limits are shown only in
  // AI Studio; 10 a minute is a cautious guess. Whether it accepts additionalProperties is undocumented: it is
  // removed and enforced by `checkArgs` instead.
  gemini: { transport: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', reasoning: true, stripAdditional: true, minIntervalMs: 6_000, maxTokensTotal: Infinity, signsToolCalls: true },
  // Free tier with an account (the owner chose it, 18 Nov 2026, for steadily fast replies on the talk page): open models
  // on Groq's own chips, about 30 requests a minute. reasoning_effort is for the gpt-oss models.
  groq: { transport: 'openai', baseURL: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', reasoning: true, stripAdditional: false, minIntervalMs: 2_000, maxTokensTotal: Infinity },
  'openai-compatible': { transport: 'openai', baseURL: '', keyEnv: 'OPENAI_COMPATIBLE_API_KEY', reasoning: false, stripAdditional: false, minIntervalMs: 0, maxTokensTotal: Infinity },
};

export type CompatOptions = {
  provider: Provider; baseURL?: string; apiKey?: string;
  numCtx?: number;            // Ollama only (default 16384)
  think?: string;             // Ollama only: 'on' | 'off' | a level (gpt-oss: low/medium/high); unset = off where the model can think (gpt-oss: low)
  temperature?: number;       // unset = the model's own default (Gemma 4: 1.0)
  minIntervalMs?: number; timeoutMs?: number; maxRetries?: number;
  fetch?: typeof fetch;       // tests
  sleep?: (ms: number) => Promise<void>;
};

export type CompatStats = { requests: number; retries: number; unparseableArgs: number; toolCallsAsText: number; tokens: number; hiddenThinking?: number; toolUseFailed?: number };

/** Raised when the provider keeps refusing for rate or quota reasons: the runner stops and keeps what finished. */
export class QuotaError extends Error {}

export const NO_THINK_CAP = 200;
const THINK = /<think>[\s\S]*?(<\/think>|$)/g;
const TOOL_AS_TEXT = /<tool_call>|<\|tool_call|^\s*\{\s*"(name|function|tool)"\s*:/;

const blocksOf = (content: any): any[] => typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);
const textOf = (blocks: any[]) => blocks.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
const toolResultText = (c: any) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text ?? '').join(' ') : JSON.stringify(c);

function schemaFor(schema: any, strip: boolean): any {
  if (!strip || typeof schema !== 'object' || schema === null) return schema;
  const { additionalProperties, ...rest } = schema;
  if (rest.properties) rest.properties = Object.fromEntries(Object.entries(rest.properties).map(([k, v]) => [k, schemaFor(v, strip)]));
  return rest;
}

/** Anthropic-shaped request → OpenAI chat-completions body. */
export function toOpenAI(p: any, preset: Pick<Preset, 'reasoning' | 'stripAdditional' | 'signsToolCalls'>, temperature?: number) {
  const messages: any[] = [];
  if (p.system) messages.push({ role: 'system', content: typeof p.system === 'string' ? p.system : textOf(p.system) });
  for (const m of p.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === 'assistant') {
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        ...(preset.signsToolCalls ? { extra_content: b.extra_content ?? { google: { thought_signature: 'skip_thought_signature_validator' } } } : {}) }));
      messages.push(calls.length ? { role: 'assistant', content: textOf(blocks) || null, tool_calls: calls } : { role: 'assistant', content: textOf(blocks) });
    } else {
      for (const b of blocks.filter(x => x.type === 'tool_result')) messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: toolResultText(b.content) });
      const t = textOf(blocks);
      if (t) messages.push({ role: 'user', content: t });
    }
  }
  const body: any = { model: p.model, messages, max_tokens: p.max_tokens, stream: false };
  if (p.tools?.length) body.tools = p.tools.map((t: any) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaFor(t.input_schema, preset.stripAdditional) } }));
  if (p.tool_choice?.type === 'none' && body.tools) body.tool_choice = 'none';
  if (preset.reasoning && p.output_config?.effort) body.reasoning_effort = p.output_config.effort;
  if (temperature !== undefined) body.temperature = temperature;
  return body;
}

/** Anthropic-shaped request → Ollama /api/chat body (arguments as objects, no call ids: results follow call order). */
export function toOllama(p: any, o: Pick<CompatOptions, 'numCtx' | 'think' | 'temperature'>) {
  const messages: any[] = [];
  if (p.system) messages.push({ role: 'system', content: typeof p.system === 'string' ? p.system : textOf(p.system) });
  for (const m of p.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === 'assistant') {
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ function: { name: b.name, arguments: b.input ?? {} } }));
      messages.push({ role: 'assistant', content: textOf(blocks), ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const b of blocks.filter(x => x.type === 'tool_result')) messages.push({ role: 'tool', content: toolResultText(b.content) });
      const t = textOf(blocks);
      if (t) messages.push({ role: 'user', content: t });
    }
  }
  const thinking = !!o.think && o.think !== 'off';
  // Thinking tokens count against num_predict: with thinking on, the answer gets its own room on top (Gemma 4 12B spent
  // the caller's whole 400 on thinking and said nothing, 12 Nov 2026).
  // Without thinking a reply is a sentence or a tool call: Gemma 4 12B's ran 16–62 tokens, so 200 bounds a runaway
  // (one that never finishes a tool call) at a few seconds instead of a minute.
  const body: any = { model: p.model, messages, stream: false, options: { num_ctx: o.numCtx ?? 16_384, num_predict: thinking ? p.max_tokens + 8_192 : Math.min(p.max_tokens, NO_THINK_CAP) } };
  // Ollama has no tool_choice: "none" is honoured by not offering the tools at all.
  if (p.tools?.length && p.tool_choice?.type !== 'none') body.tools = p.tools.map((t: any) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  if (o.think) body.think = o.think === 'on' ? true : o.think === 'off' ? false : o.think;
  if (o.temperature !== undefined) body.options.temperature = o.temperature;
  return body;
}

function parseArgs(raw: unknown, stats: CompatStats): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (raw === undefined || raw === null || raw === '') return {};
  try {
    const v = JSON.parse(String(raw));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* fall through */ }
  stats.unparseableArgs++;
  return { __unparseable_arguments: String(raw).slice(0, 500) }; // fails checkArgs, so the model is told and the tool never runs
}

function cleanText(s: unknown, stats: CompatStats) {
  const raw = String(s ?? ''), t = raw.replace(THINK, '').trim();
  // Words that were all reasoning: Gemma 4 12B did this with thinking off, running to the token cap (12 Nov 2026).
  if (!t && THINK.test(raw)) stats.hiddenThinking = (stats.hiddenThinking ?? 0) + 1;
  THINK.lastIndex = 0;
  if (TOOL_AS_TEXT.test(t)) stats.toolCallsAsText++;
  return t;
}

let seq = 0;
const newId = () => `call_${Date.now().toString(36)}_${(++seq).toString(36)}`;

/** A tool call the host refused (Groq's failed_generation) as an Anthropic-shaped message; nothing usable → an empty one. */
export function salvage(raw: string) {
  const empty = { content: [] as any[], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  try {
    const gen = JSON.parse(raw)?.error?.failed_generation;
    const parsed = typeof gen === 'string' ? JSON.parse(gen) : gen;
    const calls = (Array.isArray(parsed) ? parsed : [parsed]).filter((c: any) => c && typeof c.name === 'string');
    if (!calls.length) return empty;
    return { ...empty, stop_reason: 'tool_use', content: calls.map((c: any) => ({ type: 'tool_use', id: newId(), name: c.name, input: c.arguments ?? c.parameters ?? {} })) };
  } catch { return empty; }
}

/** OpenAI chat-completions response → Anthropic-shaped message. */
export function fromOpenAI(r: any, stats: CompatStats) {
  const ch = r.choices?.[0] ?? {}, msg = ch.message ?? {};
  const content: any[] = [];
  const text = cleanText(msg.content, stats);
  if (text) content.push({ type: 'text', text });
  // Gemini 3 signs each tool call (extra_content.google.thought_signature) and refuses the next turn unless the call
  // comes back with it (found 18 Nov 2026): keep it on the block, and toOpenAI sends it back.
  for (const c of msg.tool_calls ?? []) content.push({ type: 'tool_use', id: c.id || newId(), name: c.function?.name, input: parseArgs(c.function?.arguments, stats),
    ...(c.extra_content ? { extra_content: c.extra_content } : {}) });
  const u = r.usage ?? {}, cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const stop = content.some(b => b.type === 'tool_use') ? 'tool_use' : ch.finish_reason === 'length' ? 'max_tokens' : ch.finish_reason === 'content_filter' ? 'refusal' : 'end_turn';
  return { content, stop_reason: stop, usage: { input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cached), output_tokens: u.completion_tokens ?? 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } };
}

/** Ollama /api/chat response → Anthropic-shaped message. */
export function fromOllama(r: any, stats: CompatStats) {
  const msg = r.message ?? {};
  const content: any[] = [];
  const text = cleanText(msg.content, stats);
  if (text) content.push({ type: 'text', text });
  for (const c of msg.tool_calls ?? []) content.push({ type: 'tool_use', id: newId(), name: c.function?.name, input: parseArgs(c.function?.arguments, stats) });
  // Empty words but thinking text: the model reasoned although thinking was off (seen as 1,024-token empty replies).
  if (!text && !msg.tool_calls?.length && msg.thinking) stats.hiddenThinking = (stats.hiddenThinking ?? 0) + 1;
  const cached = r.prompt_eval_cached_count ?? 0;
  const stop = content.some(b => b.type === 'tool_use') ? 'tool_use' : r.done_reason === 'length' ? 'max_tokens' : 'end_turn';
  // load_ms: time Ollama spent loading the model into memory for this request (it swaps models that do not fit together).
  return { content, stop_reason: stop, usage: { input_tokens: Math.max(0, (r.prompt_eval_count ?? 0) - cached), output_tokens: r.eval_count ?? 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, load_ms: (r.load_duration ?? 0) / 1e6 } };
}

export class CompatClient implements ModelClient {
  readonly stats: CompatStats = { requests: 0, retries: 0, unparseableArgs: 0, toolCallsAsText: 0, tokens: 0 };
  readonly preset: Preset;
  private o: CompatOptions; private base: string; private key?: string; private last = 0;
  messages = { create: (p: any) => this.create(p) };

  constructor(o: CompatOptions) {
    this.o = o; this.preset = PROVIDERS[o.provider];
    this.base = (o.baseURL ?? this.preset.baseURL).replace(/\/$/, '');
    if (!this.base) throw new Error(`${o.provider} needs --base-url`);
    this.key = o.apiKey ?? (this.preset.keyEnv ? process.env[this.preset.keyEnv] : undefined);
  }

  private get sleep() { return this.o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms))); }

  /** Before a run: is the provider reachable and the model there? Never downloads anything. */
  async preflight(models: string[]): Promise<string[]> {
    const f = this.o.fetch ?? fetch, out: string[] = [];
    if (this.preset.transport === 'ollama') {
      let names: string[];
      try { names = ((await (await f(`${this.base}/api/tags`, { signal: AbortSignal.timeout(5_000) })).json()).models ?? []).map((m: any) => m.name); }
      catch { return [`Ollama is not answering at ${this.base} (it starts at login: brew services start ollama).`]; }
      for (const m of models) {
        const want = m.includes(':') ? m : `${m}:latest`;
        if (!names.includes(want) && !names.includes(m)) { out.push(`Ollama has no ${m}. It is a download (the owner's yes first): ollama pull ${m}`); continue; }
        try {
          const show = await (await f(`${this.base}/api/show`, { method: 'POST', body: JSON.stringify({ model: m }) })).json();
          if (Array.isArray(show.capabilities) && !show.capabilities.includes('tools')) out.push(`${m} does not list tool calling among its capabilities.`);
        } catch { /* show is advisory */ }
      }
    } else if (this.preset.keyEnv && !this.key) {
      out.push(`${this.o.provider} needs ${this.preset.keyEnv} in engine/.env.local (sh scripts/save-key.sh ${this.o.provider}).`);
    }
    return out;
  }

  private caps = new Map<string, Promise<string[]>>();
  /** What an Ollama model says it can do (cached per model); [] if it will not say. */
  private capabilities(model: string) {
    if (!this.caps.has(model)) this.caps.set(model, (async () => {
      try { return (await (await (this.o.fetch ?? fetch)(`${this.base}/api/show`, { method: 'POST', body: JSON.stringify({ model }) })).json()).capabilities ?? []; }
      catch { return []; }
    })());
    return this.caps.get(model)!;
  }

  /**
   * Thinking on Ollama: off unless asked (--think), as on the Claude route, where neither the receptionist nor the caller
   * asks for extended thinking — and a phone line cannot wait for it. gpt-oss cannot switch it off, so it reasons "low".
   */
  private async thinkFor(model: string) {
    if (this.o.think) return this.o.think;
    if (!(await this.capabilities(model)).includes('thinking')) return undefined;
    return /^gpt-oss/.test(model) ? 'low' : 'off';
  }

  async create(p: any) {
    const ollama = this.preset.transport === 'ollama';
    const url = ollama ? `${this.base}/api/chat` : `${this.base}/chat/completions`;
    const body = JSON.stringify(ollama ? toOllama(p, { numCtx: this.o.numCtx, think: await this.thinkFor(p.model), temperature: this.o.temperature }) : toOpenAI(p, this.preset, this.o.temperature));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.key) headers.authorization = `Bearer ${this.key}`;
    const f = this.o.fetch ?? fetch, max = this.o.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      const gap = (this.o.minIntervalMs ?? this.preset.minIntervalMs) - (Date.now() - this.last);
      if (gap > 0) await this.sleep(gap);
      this.last = Date.now();
      this.stats.requests++;
      let res: Response;
      try { res = await f(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.o.timeoutMs ?? 300_000) }); }
      catch (e) {
        if (attempt >= max) throw new Error(`${this.o.provider}: no answer after ${attempt + 1} tries (${(e as Error).message})`);
        this.stats.retries++; await this.sleep(2_000 * 2 ** attempt); continue;
      }
      if (res.ok) {
        const out = ollama ? fromOllama(await res.json(), this.stats) : fromOpenAI(await res.json(), this.stats);
        this.stats.tokens += out.usage.input_tokens + out.usage.cache_read_input_tokens + out.usage.output_tokens;
        return out;
      }
      const raw = await res.text().catch(() => '');
      const detail = raw.slice(0, 300);
      // Groq checks tool arguments on its side and refuses the whole reply over a null in an optional field
      // (tool_use_failed, 20 Nov 2026); the call it refused comes back as failed_generation. Hand that to the runtime,
      // which checks arguments itself, or an empty reply it will ask again for.
      if (res.status === 400 && /tool_use_failed/.test(raw)) {
        this.stats.toolUseFailed = (this.stats.toolUseFailed ?? 0) + 1;
        return salvage(raw);
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw new Error(`${this.o.provider} ${res.status}: ${detail}`);
      if (attempt >= max) throw res.status === 429 ? new QuotaError(`${this.o.provider}: still rate-limited after ${attempt + 1} tries (${detail})`) : new Error(`${this.o.provider} ${res.status} after ${attempt + 1} tries: ${detail}`);
      const after = Number(res.headers.get('retry-after'));
      // A long wait means the day's (or hour's) quota is gone: stop and keep what finished rather than sleep for hours.
      if (res.status === 429 && after > 120) throw new QuotaError(`${this.o.provider}: quota used up, retry after ${Math.round(after / 60)} min (${detail})`);
      this.stats.retries++;
      await this.sleep(Number.isFinite(after) && after > 0 ? after * 1_000 : 5_000 * 2 ** attempt);
    }
  }
}
