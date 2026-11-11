/**
 * Owner-reply validation (blueprint §5.8.5). Deterministic; nothing in free text is ever executed. Commands come
 * only from a fixed grammar or from signed LINE postbacks.
 */
import { detectSensitiveNumbers } from './safety.ts';

export type ReplyCtx = { allowedDomains: string[]; businessPhones: string[]; linkedPriceMinor?: number | null; otherClientNames?: string[] };
export type ReplyCheck = { ok: boolean; fails: string[]; confirm: string[] };

const SHORTENERS = /(^|\.)(bit\.ly|tinyurl\.com|goo\.gl|t\.co|s\.id|cutt\.ly|rb\.gy|shorturl\.at|ow\.ly|is\.gd|lin\.ee)$/i;
const isThai = (s: string) => /[฀-๿]/.test(s);
const digits = (s: string) => s.replace(/\D/g, '').replace(/^66/, '0');

export function validateOwnerReply(text: string, ctx: ReplyCtx): ReplyCheck {
  const fails: string[] = [], confirm: string[] = [];
  const t = text.trim();
  if (!t) fails.push('empty');
  if (t.length > (isThai(t) ? 200 : 480)) fails.push('too_long');
  const { found } = detectSensitiveNumbers(t);
  for (const f of found) fails.push(f === 'payment_card' ? 'card_number' : 'government_id');
  if (/password|passcode|\botp\b|รหัสผ่าน/i.test(t)) fails.push('credential');
  // Every link-shaped token: any scheme, "www.", or a dotted name ending in letters of any script (Thai domains too).
  // URL() puts internationalised names into punycode, so only allow-listed Latin domains can pass (review finding 10).
  for (const m of t.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"“”<>]+|www\.[^\s"“”<>]+|[^\s"“”<>@:\/]+\.\p{L}{2,}(?:\/[^\s"“”<>]*)?/giu)) {
    let host = '';
    try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(m[0]) ? m[0] : 'http://' + m[0]).hostname.toLowerCase(); } catch { fails.push('link_not_allowed'); continue; }
    if (/^\[.*\]$|^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { fails.push('link_not_allowed'); continue; }
    if (SHORTENERS.test(host)) { fails.push('short_link'); continue; }
    if (!ctx.allowedDomains.some(d => host === d || host.endsWith('.' + d))) fails.push('link_not_allowed');
  }
  const business = new Set(ctx.businessPhones.map(digits));
  for (const m of t.matchAll(/\+?\d[\d -]{7,13}\d/g)) {
    const d = digits(m[0]);
    if (d.length >= 9 && d.length <= 11 && !business.has(d)) fails.push('phone_not_business');
  }
  for (const n of ctx.otherClientNames ?? []) if (n.length >= 2 && t.includes(n)) fails.push('other_client');
  if (ctx.linkedPriceMinor != null) {
    for (const m of t.matchAll(/(?:฿\s*([\d,]+)|([\d,]+)\s*(?:บาท|baht|thb|฿))/gi)) {
      const amount = Number((m[1] ?? m[2]).replace(/,/g, '')) * 100;
      if (amount !== ctx.linkedPriceMinor) { confirm.push('price_conflict'); break; }
    }
  }
  return { ok: fails.length === 0, fails: [...new Set(fails)], confirm };
}

/** SMS command grammar: SEND Q-7K3F · DECLINE Q-7K3F · CALL Q-7K3F (Thai: ส่ง / ตอบไม่ได้ / ติดต่อเอง). */
export function ownerCommand(text: string): { cmd: 'send' | 'decline' | 'will_contact'; handle?: string } | null {
  const m = text.trim().match(/^(send|decline|call|ส่ง|ตอบไม่ได้|ติดต่อเอง)\s*(q-[a-z0-9]{4})?\s*$/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const cmd = word === 'send' || word === 'ส่ง' ? 'send' : word === 'decline' || word === 'ตอบไม่ได้' ? 'decline' : 'will_contact';
  return { cmd, handle: m[2]?.toUpperCase() };
}

export const FAIL_TEXT: Record<string, { th: string; en: string }> = {
  empty: { th: 'ข้อความว่าง', en: 'The answer is empty.' },
  too_long: { th: 'คำตอบยาวเกินไป (ไทยไม่เกิน 200 ตัวอักษร)', en: 'The answer is too long (480 characters max).' },
  card_number: { th: 'คำตอบส่งเลขบัตรไม่ได้', en: "Answers can't include card numbers." },
  government_id: { th: 'คำตอบส่งเลขบัตรประชาชนไม่ได้', en: "Answers can't include ID numbers." },
  credential: { th: 'คำตอบส่งรหัสผ่านหรือ OTP ไม่ได้', en: "Answers can't include passwords or codes." },
  short_link: { th: 'ใช้ลิงก์ย่อไม่ได้ (กฎ SMS ไทย) กรุณาใช้ลิงก์เต็มของร้าน', en: "Shortened links can't be sent; use the full link." },
  link_not_allowed: { th: 'ส่งได้เฉพาะลิงก์ของร้าน', en: 'Only links to your own website can be sent.' },
  phone_not_business: { th: 'ส่งได้เฉพาะเบอร์ของร้าน', en: "Only the business's own phone number can be sent." },
  other_client: { th: 'คำตอบมีชื่อลูกค้าคนอื่น', en: "The answer names another client." },
};
