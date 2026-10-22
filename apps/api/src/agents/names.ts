/** Transliteration-aware fuzzy name matching for Arabic-origin names written in Latin script. */

const ARABIC_MAP: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd',
  ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', ى: 'a', ة: 'a', ء: '', ؤ: 'w', ئ: 'y',
};

const CANON: Record<string, string> = {
  mohammed: 'muhammad', mohamed: 'muhammad', mohammad: 'muhammad', muhammed: 'muhammad', muhamed: 'muhammad', mohd: 'muhammad', md: 'muhammad',
  ahmed: 'ahmad', ahmet: 'ahmad',
  abdulla: 'abdullah', abdallah: 'abdullah', abdulah: 'abdullah',
  hussain: 'husayn', hussein: 'husayn', husain: 'husayn', husein: 'husayn', hosein: 'husayn',
  yusuf: 'yusuf', youssef: 'yusuf', yousef: 'yusuf', yousuf: 'yusuf', yosef: 'yusuf',
  omar: 'umar', umer: 'umar',
  khaled: 'khalid', khalad: 'khalid',
  rashed: 'rashid', rasheed: 'rashid',
  mansoori: 'mansuri', mansouri: 'mansuri', mansori: 'mansuri', mansuri: 'mansuri',
  saeed: 'said', sayed: 'said', sayyid: 'said', syed: 'said', saied: 'said',
  fatima: 'fatimah', fatma: 'fatimah',
  aisha: 'aishah', ayesha: 'aishah', aysha: 'aishah',
  ibraheem: 'ibrahim', ebrahim: 'ibrahim',
  suleiman: 'sulayman', sulaiman: 'sulayman', sulayman: 'sulayman', soliman: 'sulayman',
  osama: 'usama', usamah: 'usama',
  zaid: 'zayd', zayed: 'zayd', zayd: 'zayd',
  nasser: 'nasir', naser: 'nasir', nasir: 'nasir',
  hassan: 'hasan', hasan: 'hasan',
};

const PARTICLES = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'ben', 'of', 'the', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sheikh', 'shaikh', 'sheikha', 'eng', 'engr', 'prof', 'haji', 'hajj']);

function transliterate(s: string): string {
  return Array.from(s).map((ch) => ARABIC_MAP[ch] ?? ch).join('');
}

export function normalizeNameTokens(name: string): string[] {
  let s = transliterate(name.normalize('NFKD')).replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/\b(al|el)[\-\s']?(?=[a-z])/g, ' ').replace(/[^a-z\s]/g, ' ');
  return s
    .split(/\s+/)
    .filter((t) => t && !PARTICLES.has(t))
    .map((t) => {
      let x = t.replace(/(.)\1+/g, '$1').replace(/ou|oo/g, 'u').replace(/ee/g, 'i').replace(/ph/g, 'f').replace(/aa/g, 'a');
      x = CANON[t] ?? CANON[x] ?? x;
      return x;
    });
}

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const ratio = (a: string, b: string) => (a || b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);

/** 0..1 similarity; order-insensitive; tolerant of dropped middle names and spelling variants. */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeNameTokens(a);
  const tb = normalizeNameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bi = -1;
    long.forEach((u, i) => {
      if (used.has(i)) return;
      const r = ratio(t, u);
      if (r > best) {
        best = r;
        bi = i;
      }
    });
    if (bi >= 0 && best >= 0.75) used.add(bi);
    total += best >= 0.75 ? best : best * 0.4;
  }
  const coverage = total / short.length;
  const lengthPenalty = short.length === long.length ? 1 : short.length >= 2 ? 0.95 : 0.7;
  const sorted = ratio(ta.slice().sort().join(' '), tb.slice().sort().join(' '));
  // consonant skeleton catches Arabic script vs Latin spellings (vowels are usually not written in Arabic)
  const skel = (t: string[]) => t.map((x) => x.replace(/[aeiouy]/g, '')).sort().join(' ');
  const sk = ta.length === tb.length ? ratio(skel(ta), skel(tb)) * 0.9 : 0;
  return Math.max(Math.min(1, coverage * lengthPenalty), sorted, sk);
}

const COMPANY_SUFFIX = /\b(l\.?l\.?c\.?|llc|fz-?llc|fzco|fze|fz|fzc|free\s*zone|establishment|est|co|company|ltd|limited|inc|incorporated|pjsc|dmcc|sole\s+proprietorship|trading|general\s+trading)\b\.?/gi;

export function normalizeCompany(name: string): string {
  return transliterate(name.normalize('NFKD')).replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(?:[a-z]\.){2,}[a-z]?\.?/g, (m) => m.replace(/\./g, '')).replace(COMPANY_SUFFIX, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function companySimilarity(a: string, b: string): number {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return 0;
  return Math.max(ratio(x, y), ratio(x.split(' ').sort().join(' '), y.split(' ').sort().join(' ')));
}

export function addressSimilarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !['po', 'box', 'p', 'o', 'dubai', 'uae', 'united', 'arab', 'emirates', 'the', 'of'].includes(t)));
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / Math.min(A.size, B.size);
}
