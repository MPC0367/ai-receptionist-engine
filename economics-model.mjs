// Part 1: per-stack cost model (read with blueprint §14)
// Unit-economics model for the clean-room AI receptionist. All prices USD, official pages read 11 Nov 2026.
const THB = 33; // ASSUMPTION: 33 THB per USD
const f = (x, d = 4) => x.toFixed(d);
const pct = x => (x * 100).toFixed(0) + '%';

// LLM per minute: 4 model calls/min; per call 4,000 cached prefix tokens, 1,500 uncached, 160 output (incl. thinking)
function llmPerMin({ inp, cacheRead, out }, tokenMult = 1) {
  const perCall = (4000 * cacheRead + 1500 * inp * tokenMult + 160 * out * tokenMult) / 1e6;
  return perCall * 4;
}
const haiku = { inp: 0.10, cacheRead: 0.01, out: 0.50 };
const sonnet = { inp: 2.00, cacheRead: 0.10, out: 10.00 };
const opus = { inp: 4.00, cacheRead: 0.20, out: 20.00 };

const ttsChars = 405; // AI speaks ~45% of the call at ~150 wpm (EN); TH assumed 400 chars/min

const stacks = {
  'US recommended (Telnyx + LiveKit Cloud + Deepgram Nova-3 + Claude Haiku 5.5 + Cartesia)': {
    perMin: { carrier: 0.0032, sipLeg: 0.004, orchestration: 0.010, stt: 0.0077, llm: llmPerMin(haiku), tts: 0.039 * ttsChars / 1000 },
    fixedPerConv: { numberAndRegistration: (1 + 10) / 300, messages: 1.6 * 0.007, hosting: 400 / 15000, supportRework: 0.02 },
    feesPct: 0.036, refundsPct: 0.02,
  },
  'US managed alternative (Vapi + same providers)': {
    perMin: { carrier: 0.0032, orchestration: 0.05, stt: 0.0077, llm: llmPerMin(haiku), tts: 0.039 * ttsChars / 1000 },
    fixedPerConv: { numberAndRegistration: (1 + 10) / 300, messages: 1.6 * 0.007, hosting: 250 / 15000, supportRework: 0.02 },
    feesPct: 0.036, refundsPct: 0.02,
  },
  'TH recommended (Twilio TH mobile no. + self-hosted LiveKit in AWS Bangkok + Azure th-TH STT/TTS + Claude Haiku 5.5)': {
    perMin: { carrier: 0.0100, orchestrationCompute: 0.003, stt: 0.0167, llm: llmPerMin(haiku, 2), tts: 0.015 * 400 / 1000 },
    fixedPerConv: { number: 25.30 / 300, messages: (0.4 + 0.1) * (0.20 * 2.5 / THB) + 1.6 * (1780 / 35000 / THB), hosting: 600 / 15000, supportRework: 0.02 },
    feesPct: 0.044, refundsPct: 0.02,
  },
};

const bands = [ ['0–1 min', 0.75, 0.20], ['1–2 min', 1.5, 0.30], ['2–4 min', 3, 0.30], ['4–8 min', 6, 0.15], ['8–15 min', 11, 0.05] ];
const meanMin = bands.reduce((s, b) => s + b[1] * b[2], 0);
const bookRate = 0.40, completeRate = 0.70;

for (const [name, s] of Object.entries(stacks)) {
  const pm = Object.values(s.perMin).reduce((a, b) => a + b, 0);
  const fx = Object.values(s.fixedPerConv).reduce((a, b) => a + b, 0);
  console.log(`\n### ${name}`);
  console.log('per-minute lines:', Object.entries(s.perMin).map(([k, v]) => `${k} ${f(v)}`).join(', '), '=> per min', f(pm));
  console.log('per-conversation lines:', Object.entries(s.fixedPerConv).map(([k, v]) => `${k} ${f(v)}`).join(', '), '=> fixed', f(fx));
  const costAt = d => fx + pm * d;
  const avg = costAt(meanMin);
  console.log(`mean duration ${f(meanMin,2)} min; cost/answered conv ${f(avg,3)}; per completed task (${pct(completeRate)}) ${f(avg/completeRate,3)}; per confirmed booking (${pct(bookRate)}) ${f(avg/bookRate,3)}`);
  for (const price of [0.49, 0.39, 0.59]) {
    const net = price * (1 - s.feesPct - s.refundsPct);
    const be = (net - fx) / pm;
    const rows = bands.map(([b, d]) => `${b}: cost ${f(costAt(d),3)}, margin ${pct((net - costAt(d)) / price)}`).join(' | ');
    console.log(`price ${price}: net ${f(net,3)}, break-even ${f(be,1)} min | ${rows}`);
  }
}
console.log('\nLLM per minute: Haiku 5.5', f(llmPerMin(haiku)), 'Sonnet 5.5', f(llmPerMin(sonnet)), 'Opus 5.5', f(llmPerMin(opus)), '| Thai (x2 tokens) Haiku', f(llmPerMin(haiku,2)), 'Sonnet', f(llmPerMin(sonnet,2)), 'Opus', f(llmPerMin(opus,2)));

// Part 2: pricing options
// THB defined above
const bands2 = [['0–1', 0.75], ['1–2', 1.5], ['2–4', 3], ['4–8', 6], ['8–15', 11]];
const usPm = 0.0418, usFx = 0.0945, usDed = 0.056;
const line = (label, priceOf) => {
  console.log(label);
  for (const [b, d] of bands2) {
    const price = priceOf(d), net = price * (1 - usDed), cost = usFx + usPm * d;
    console.log(' ' + b + ' min: price ' + price.toFixed(2) + ', cost ' + cost.toFixed(3) + ', margin ' + ((net - cost) / price * 100).toFixed(0) + '%');
  }
};
line('US hybrid 0.39 incl 4 min + 0.10/min:', d => 0.39 + Math.max(0, d - 4) * 0.10);
line('US per-minute 0.15/min, 1-min minimum:', d => Math.max(1, d) * 0.15);
const thVarPerCall = 0.0377 * 2.95 + 0.010 + 0.02;
for (const [label, fee, incl, over, numberCost] of [
  ['TH-S1 1,990 THB/mo incl 150, 12 THB over (Twilio TH number)', 1990, 150, 12, 25.30],
  ['TH-S2 2,490 THB/mo incl 200, 10 THB over (Twilio TH number)', 2490, 200, 10, 25.30],
  ['TH-S1 with a 300 THB/mo Thai SIP DID (UNKNOWN price, illustrative)', 1990, 150, 12, 300 / THB],
]) {
  const rows = [100, 150, 300, 600].map(calls => {
    const rev = (fee + Math.max(0, calls - incl) * over) / THB;
    const net = rev * (1 - 0.044 - 0.02) - 10 / THB;
    const cost = numberCost + 12 + calls * thVarPerCall;
    return calls + ' calls: rev ' + rev.toFixed(0) + ', cost ' + cost.toFixed(0) + ', margin ' + ((net - cost) / rev * 100).toFixed(0) + '%';
  }).join(' | ');
  console.log(label + ': ' + rows);
}
