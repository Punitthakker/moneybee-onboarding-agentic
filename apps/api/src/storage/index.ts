import fs from 'node:fs/promises';
import path from 'node:path';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config';
import type { PiiCipher } from '../crypto/pii';

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  init(): Promise<void>;
}

class LocalStore implements BlobStore {
  constructor(private dir: string) {}
  private p(key: string) {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }
  async put(key: string, data: Buffer) {
    const f = this.p(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }
  async get(key: string) {
    return fs.readFile(this.p(key));
  }
  async delete(key: string) {
    await fs.rm(this.p(key), { force: true });
  }
}

class S3Store implements BlobStore {
  private c: S3Client;
  constructor(private cfg: Config) {
    this.c = new S3Client({
      region: cfg.S3_REGION,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: cfg.S3_ACCESS_KEY && cfg.S3_SECRET_KEY ? { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY } : undefined,
    });
  }
  async init() {
    for (let i = 0; i < 20; i++) {
      try {
        await this.c.send(new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
        return;
      } catch {
        try {
          await this.c.send(new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    throw new Error('S3 bucket unavailable');
  }
  async put(key: string, data: Buffer) {
    await this.c.send(new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: data }));
  }
  async get(key: string) {
    const r = await this.c.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.c.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
  }
}

/** Wraps any BlobStore so every object is AES-256-GCM encrypted before it leaves the process. */
class EncryptedStore implements BlobStore {
  constructor(private inner: BlobStore, private cipher: PiiCipher) {}
  init() {
    return this.inner.init();
  }
  put(key: string, data: Buffer) {
    return this.inner.put(key, this.cipher.encryptBytes(data));
  }
  async get(key: string) {
    return this.cipher.decryptBytes(await this.inner.get(key));
  }
  delete(key: string) {
    return this.inner.delete(key);
  }
}

export function createBlobStore(cfg: Config, cipher: PiiCipher): BlobStore {
  const inner = cfg.STORAGE === 's3' ? new S3Store(cfg) : new LocalStore(path.resolve(cfg.LOCAL_STORAGE_DIR));
  return new EncryptedStore(inner, cipher);
}

/** In-memory blob store for tests. */
export function createMemoryBlobStore(): BlobStore {
  const m = new Map<string, Buffer>();
  return {
    async init() {},
    async put(k, d) {
      m.set(k, Buffer.from(d));
    },
    async get(k) {
      const v = m.get(k);
      if (!v) throw new Error('not found');
      return Buffer.from(v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
}
