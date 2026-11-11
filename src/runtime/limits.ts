/**
 * Runtime time limits (blueprint §10.9, SM-2). Shared by the Gate A stand-in and the future LiveKit runtime.
 * The caller never waits in silence: a filler line at 1.8 s, the bounded recovery path at 4 s.
 */
export const FILLER_MS = 1_800;
export const DEGRADE_MS = 4_000;
export const WARN_AT_MS = 13 * 60_000;
export const MAX_CALL_MS = 15 * 60_000;

export const FILLER = { th: 'สักครู่นะคะ', en: 'One moment.' };
export const DEGRADED = { th: 'ขออภัยค่ะ ระบบของดิฉันขัดข้องเล็กน้อย', en: "I'm having trouble on my side." };
export const WARN = { th: 'ขออภัยค่ะ เราใกล้หมดเวลาสายแล้ว มีอะไรที่ต้องการให้ช่วยเป็นเรื่องสุดท้ายไหมคะ', en: "We're nearly out of time on this call. Is there one last thing I can help with?" };

export type Watched<T> = { status: 'ok'; value: T; filler: boolean } | { status: 'degraded'; filler: true };

/**
 * Race a step (model turn, tool call, TTS) against the latency budget. `speak` is called with the filler at
 * FILLER_MS and with the recovery line at DEGRADE_MS; after DEGRADE_MS the step's late result is ignored.
 */
export async function watched<T>(step: Promise<T>, speak: (line: 'filler' | 'degraded') => void,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }): Promise<Watched<T>> {
  let filler = false;
  const f = timers.setTimeout(() => { filler = true; speak('filler'); }, FILLER_MS);
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(res => { giveUp = timers.setTimeout(() => res('timeout'), DEGRADE_MS); });
  try {
    const r = await Promise.race([step.then(v => ({ v })), timeout]);
    if (r === 'timeout') { speak('degraded'); return { status: 'degraded', filler: true }; }
    return { status: 'ok', value: r.v, filler };
  } finally {
    timers.clearTimeout(f);
    if (giveUp) timers.clearTimeout(giveUp);
  }
}

/** Call-length policy: warn once at 13 min, end at 15 min. */
export function callClock(elapsedMs: number, warned: boolean): 'continue' | 'warn' | 'end' {
  if (elapsedMs >= MAX_CALL_MS) return 'end';
  if (elapsedMs >= WARN_AT_MS && !warned) return 'warn';
  return 'continue';
}
