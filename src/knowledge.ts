/**
 * T-01 retrieval (Gate A: keyword scoring; embeddings later). Tenant scoping is structural: RLS and the
 * transaction's tenant are set before any lookup. Only published, in-date, speakable articles are returned.
 */
import type { Tx } from './db.ts';

const STOP = new Set(['ไหม', 'มั้ย', 'ค่ะ', 'คะ', 'ครับ', 'นะ', 'มี', 'ให้', 'ที่', 'ของ', 'และ', 'หรือ', 'ได้', 'ร้าน', 'ลูกค้า', 'คุณ', 'เรา', 'จะ', 'ไป', 'มา',
  'ก็', 'เป็น', 'อยู่', 'ว่า', 'แล้ว', 'บ้าง', 'อะไร', 'is', 'the', 'a', 'an', 'for', 'do', 'does', 'you', 'have', 'there', 'any', 'to', 'of', 'and', 'or',
  'can', 'i', 'what', 'how', 'your', 'spa', 'clients', 'client']);
const SEG = new Intl.Segmenter('th', { granularity: 'word' });
/** Content words of a question (Thai has no spaces: segment, then drop stop words). */
export function keywordsOf(text: string): string[] {
  return [...new Set([...SEG.segment(text.toLowerCase())].filter(x => x.isWordLike).map(x => x.segment).filter(w => w.length >= 2 && !STOP.has(w)))];
}

export type Fact = { text: string; ref: string; version: string; audience: string };
export type FactsResult = { status: 'answer' | 'no_answer' | 'conflict'; facts: Fact[] };

const HOURS_Q = /\bhours\b|\bopen\b|\bclose|เปิดกี่โมง|ปิดกี่โมง|เวลาเปิด|เปิดวัน|ร้านเปิด|ร้านปิด/i;
const ADDRESS_Q = /\bwhere\b|address|location|ที่อยู่|อยู่ที่ไหน|ร้านอยู่|ไปยังไง/i;
const DAYS_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

export async function businessFacts(tx: Tx, question: string, now: Date, lang: 'th' | 'en'): Promise<FactsResult> {
  const q = question.toLowerCase();
  const loc = (await tx.query('select * from locations limit 1')).rows[0];
  if (HOURS_Q.test(q)) {
    const h = (await tx.query(`select weekday, opens::text, closes::text from business_hours where resource_id is null order by weekday`)).rows;
    const text = h.map(r => `${lang === 'th' ? DAYS_TH[r.weekday - 1] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][r.weekday - 1]} ${r.opens.slice(0, 5)}–${r.closes.slice(0, 5)}`).join(', ');
    return { status: 'answer', facts: [{ text, ref: 'config:business_hours', version: 'live', audience: 'speakable' }] };
  }
  if (ADDRESS_Q.test(q) && loc.public_contact?.address) {
    return { status: 'answer', facts: [{ text: loc.public_contact.address[lang] ?? loc.public_contact.address.th, ref: 'config:address', version: 'live', audience: 'speakable' }] };
  }
  const arts = (await tx.query(
    `select id, version, topic, keywords, answer_text, provenance from knowledge_articles
     where status = 'published' and 'speakable' = any(audience) and effective_from <= $1 and (effective_to is null or effective_to > $1)`, [now])).rows;
  // Curated owner entries match on one keyword; answers learned from owner replies need half their content words (≥ 2).
  const scored = arts.map(a => {
    const kw = a.keywords as string[], hits = kw.filter(k => q.includes(k.toLowerCase())).length;
    const need = String(a.provenance).startsWith('owner_reply:') ? Math.max(2, Math.ceil(kw.length / 2)) : 1;
    return { a, score: hits >= need ? hits : 0 };
  }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);
  if (!scored.length) return { status: 'no_answer', facts: [] };
  const top = scored.filter(x => x.score === scored[0].score);
  const answers = new Set(top.filter(x => x.a.topic === top[0].a.topic).map(x => x.a.answer_text));
  if (answers.size > 1) return { status: 'conflict', facts: [] };
  return { status: 'answer', facts: top.slice(0, 3).map(x => ({ text: x.a.answer_text, ref: `article:${x.a.id}`, version: String(x.a.version), audience: 'speakable' })) };
}

/**
 * Runtime grounding check (§10.0): every number in a draft reply must appear in this conversation's tool results
 * or in the caller's own words; otherwise the draft is discarded.
 */
export function grounded(draft: string, corpus: string[]): boolean {
  const norm = (s: string) => s.replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)));
  const nums = norm(draft).match(/\d+(?:[.:,]\d+)?/g) ?? [];
  const hay = norm(corpus.join(' \n '));
  return nums.every(n => hay.includes(n));
}
