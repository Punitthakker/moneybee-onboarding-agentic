import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM with a key ring so keys can be rotated. Envelope: keyId.iv.tag.ciphertext (base64url). */
export class PiiCipher {
  private keys = new Map<string, Buffer>();
  constructor(private currentKeyId: string, keys: Record<string, string>) {
    for (const [id, k] of Object.entries(keys)) this.keys.set(id, normaliseKey(k));
    if (!this.keys.has(currentKeyId)) throw new Error(`PII key ${currentKeyId} not configured`);
  }
  get keyId() {
    return this.currentKeyId;
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.keys.get(this.currentKeyId)!, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [this.currentKeyId, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }
  decrypt(envelope: string): string {
    const [id, iv, tag, ct] = envelope.split('.');
    const key = this.keys.get(id);
    if (!key) throw new Error(`Unknown PII key id ${id}`);
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
  encryptBytes(data: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.keys.get(this.currentKeyId)!, iv);
    const ct = Buffer.concat([c.update(data), c.final()]);
    const id = Buffer.from(this.currentKeyId);
    return Buffer.concat([Buffer.from([id.length]), id, iv, c.getAuthTag(), ct]);
  }
  decryptBytes(blob: Buffer): Buffer {
    const idLen = blob[0];
    const id = blob.subarray(1, 1 + idLen).toString();
    const iv = blob.subarray(1 + idLen, 13 + idLen);
    const tag = blob.subarray(13 + idLen, 29 + idLen);
    const ct = blob.subarray(29 + idLen);
    const key = this.keys.get(id);
    if (!key) throw new Error(`Unknown file key id ${id}`);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
}

/** Accepts a 32-byte key as base64 or hex. Any other string is stretched with SHA-256 (dev only). */
function normaliseKey(k: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, 'hex');
  const b = Buffer.from(k, 'base64');
  if (b.length === 32) return b;
  return createHash('sha256').update(k).digest();
}

export function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = String(id);
  return s.length <= 4 ? '****' : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}
