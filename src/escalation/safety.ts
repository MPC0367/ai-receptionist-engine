/**
 * UQ1 safety gate (blueprint §5.8.1). Deterministic rules run first; an injected classifier decides the rest.
 * Fail closed: a classifier error or timeout makes the question tier S (sensitive), never tier N.
 */
export type Tier = 'E' | 'P' | 'S' | 'N';
export type GateResult = { tier: Tier; category: string; detectors: string[]; masked: string; source: 'rules' | 'classifier' | 'fail_closed' };
export type Classifier = (text: string) => Promise<{ tier: Tier; category: string }>;

const EMERGENCY = /collapsed|unconscious|not breathing|can'?t breathe|chest pain|bleeding (a lot|heavily)|seizure|overdose|suicid|kill (my|him|her)self|\bfire\b|ambulance|หมดสติ|ไม่หายใจ|หายใจไม่ออก|เจ็บหน้าอก|เลือดออกมาก|ชัก|ฆ่าตัวตาย|ไฟไหม้|รถพยาบาล|ฉุกเฉิน|เป็นลม/i;
const MEDICAL_ADVICE = /diagnos|prescri|what medicine|which medication|safe to take|cure my|treat my|ยาอะไร|วินิจฉัย|รักษาโรค|กินยาอะไร/i;
const LEGAL_FIN = /lawyer|\bsue\b|legal advice|\binvest|\bloan\b|ฟ้อง|ทนาย|กู้เงิน|ลงทุน/i;
const OTHER_PERSON = /who (else )?(is|was) (booked|coming)|other (client|customer)s?'?|someone else'?s (booking|appointment)|ใครจอง|ลูกค้าคนอื่น|เบอร์ของ(คุณ)?\S+คนอื่น/i;
const CREDENTIAL = /password|passcode|\botp\b|รหัสผ่าน|รหัส otp/i;
const CHILD = /(child|kid|son|daughter) (is |aged? )?([1-9]|1[0-2])( years?)?\b|เด็กอายุ\s?([1-9]|1[0-2])\s?(ขวบ|ปี)/i;
const SENSITIVE = /pregnan|injur|surgery|operation|condition|allerg|diabet|blood pressure|complain|refund|dispute|\brude\b|ตั้งครรภ์|ตั้งท้อง|คนท้อง|บาดเจ็บ|ผ่าตัด|แพ้|เบาหวาน|ความดัน|ร้องเรียน|คืนเงิน|ไม่พอใจ/i;

export function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return digits.length >= 13 && sum % 10 === 0;
}
export function thaiId(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(digits[i]) * (13 - i);
  return (11 - (s % 11)) % 10 === Number(digits[12]);
}

/** Find card numbers, Thai IDs and US SSNs; return masked text and detector names (never the values). */
export function detectSensitiveNumbers(text: string): { masked: string; found: string[] } {
  const found = new Set<string>();
  let masked = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => { found.add('us_ssn'); return '[masked]'; });
  masked = masked.replace(/(?:\d[ -]?){12,18}\d/g, run => {
    const d = run.replace(/\D/g, '');
    if (thaiId(d)) { found.add('thai_id'); return '[masked]'; }
    if (d.length >= 13 && d.length <= 19 && luhn(d)) { found.add('payment_card'); return '[masked]'; }
    return run;
  });
  return { masked, found: [...found] };
}

export const stubClassifier: Classifier = async () => ({ tier: 'N', category: 'business_question' });

export async function safetyGate(question: string, classifier: Classifier = stubClassifier, timeoutMs = 700): Promise<GateResult> {
  const { masked, found } = detectSensitiveNumbers(question);
  const det = [...found];
  const rule = (tier: Tier, category: string): GateResult => ({ tier, category, detectors: det, masked, source: 'rules' });
  if (EMERGENCY.test(question)) return rule('E', 'emergency');
  if (found.includes('payment_card')) return rule('P', 'payment');
  if (found.includes('thai_id') || found.includes('us_ssn')) return rule('P', 'government_id');
  if (CREDENTIAL.test(question)) return rule('P', 'credentials');
  if (MEDICAL_ADVICE.test(question)) return rule('P', 'medical');
  if (LEGAL_FIN.test(question)) return rule('P', 'legal_financial');
  if (OTHER_PERSON.test(question)) return rule('P', 'other_person');
  if (CHILD.test(question)) return rule('P', 'child');
  if (SENSITIVE.test(question)) return rule('S', 'personal_circumstance');
  try {
    const r = await Promise.race([
      classifier(masked),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('classifier timeout')), timeoutMs)),
    ]);
    return { ...r, detectors: det, masked, source: 'classifier' };
  } catch {
    return { tier: 'S', category: 'unclassified', detectors: det, masked, source: 'fail_closed' };
  }
}

/** UQ3: strip links, e-mail addresses and phone numbers from a question summary before it is frozen. */
export function cleanSummary(s: string): string {
  return s.replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
    .replace(/\S+@\S+\.\S+/g, '[email]')
    .replace(/\+?\d[\d -]{7,}\d/g, '[number]')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}
