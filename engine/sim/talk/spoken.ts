/**
 * What is said aloud: the words a person would say for the runtime's written sentences. "15:00 น. (บ่ายสามโมง)" is said
 * "บ่ายสามโมง", the year is left out, and so are brackets and symbols. The written sentence stays what the call records.
 */
export const THAI_HOURS: Record<number, string> = { 6: 'หกโมงเช้า', 7: 'เจ็ดโมงเช้า', 8: 'แปดโมงเช้า', 9: 'เก้าโมงเช้า', 10: 'สิบโมงเช้า', 11: 'สิบเอ็ดโมง', 12: 'เที่ยง',
  13: 'บ่ายโมง', 14: 'บ่ายสอง', 15: 'บ่ายสาม', 16: 'บ่ายสี่', 17: 'ห้าโมงเย็น', 18: 'หกโมงเย็น', 19: 'หนึ่งทุ่ม', 20: 'สองทุ่ม', 21: 'สามทุ่ม' };
/** A clock time as people say it in Thai ("15:30" → "บ่ายสามครึ่ง"); undefined outside 06:00–21:59. */
export function thaiTime(h: number, m: number) {
  const base = THAI_HOURS[h];
  if (!base || m > 59) return undefined;
  return m === 0 ? base : m === 30 ? `${base}ครึ่ง` : `${base} ${m} นาที`;
}
export function spoken(text: string, lang: 'th' | 'en') {
  let t = text;
  if (lang === 'th') t = t.replace(/(?:เวลา\s*)?\d{1,2}[:.]\d{2}\s*น\.?\s*\(([^)]+)\)/g, 'เวลา$1').replace(/\s(25|20)\d{2}(?=\s|$)/g, '')
    .replace(/(\d{1,2})[:.](\d{2})\s*น\.?/g, (all, h, m) => thaiTime(Number(h), Number(m)) ?? all);
  else t = t.replace(/\b(\d{1,2}):00\s*([AP]M)\b/gi, '$1 $2').replace(/\s20\d{2}\b/g, '');
  return t.replace(/\(([^)]*)\)/g, '$1').replace(/:\s/g, ' ').replace(/[?？]+/g, '').replace(/\s{2,}/g, ' ').trim();
}
