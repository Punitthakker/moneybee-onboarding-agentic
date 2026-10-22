import path from 'node:path';

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).normalize('NFKC');
  const cleaned = base.replace(/[^\p{L}\p{N}._ \-()]/gu, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 120);
}

export type Sniffed = { mime: string; kind: 'pdf' | 'png' | 'jpeg' | 'zip' | 'eml' | 'unknown' };

export function sniff(buf: Buffer, name: string): Sniffed {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', kind: 'pdf' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', kind: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', kind: 'jpeg' };
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) return { mime: 'application/zip', kind: 'zip' };
  if (name.toLowerCase().endsWith('.eml') && /^(received|from|to|subject|date|mime-version|message-id|return-path):/im.test(buf.subarray(0, 2000).toString('utf8'))) return { mime: 'message/rfc822', kind: 'eml' };
  return { mime: 'application/octet-stream', kind: 'unknown' };
}

/**
 * Heuristic scan for instruction-like text inside documents. Documents are untrusted data; a hit
 * is a RISK SIGNAL only. It never changes the decision logic, it raises the risk score and flags the document.
 */
const INJECTION_PATTERNS: [string, RegExp][] = [
  ['ignore_previous', /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i],
  ['disregard', /disregard\s+(all\s+)?(the\s+)?(previous|prior|above|system)\b/i],
  ['approve_directive', /\b(approve|accept)\s+(this|the)\s+(case|merchant|application|onboarding)\b/i],
  ['and_approve', /ignore[^.\n]{0,60}\band\s+approve\b/i],
  ['role_override', /\b(you\s+are\s+now|act\s+as|new\s+instructions?|system\s+prompt|developer\s+message)\b/i],
  ['set_risk', /\b(set|mark)\s+(the\s+)?risk\s+(rating\s+)?(to|as)\s+(low|none)\b/i],
  ['skip_checks', /\b(skip|bypass|do\s+not\s+(run|perform))\s+(the\s+)?(screening|verification|checks?|kyc)\b/i],
  ['tool_call', /<\s*(tool_use|function_call|system)\b/i],
];

export function scanForInjection(text: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of INJECTION_PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}
