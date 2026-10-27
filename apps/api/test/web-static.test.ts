import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers';

describe('API serving the web app (servers without Docker)', () => {
  it('serves files, falls back to index.html for app routes, and leaves the API alone', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mbweb-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>MoneyBee</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'pdf.worker-x.mjs'), 'export {}');
    const t = await makeTestApp({ WEB_DIST: dist });
    const a = request(t.app);
    const home = await a.get('/apply?tenant=botim').expect(200);
    expect(home.text).toContain('<title>MoneyBee</title>');
    expect(home.headers['x-frame-options']).toBe('DENY');
    expect(home.headers['cache-control']).toBe('no-cache');
    const w = await a.get('/assets/pdf.worker-x.mjs').expect(200);
    expect(w.headers['content-type']).toMatch(/application\/javascript/);
    expect(w.headers['cache-control']).toMatch(/immutable/);
    expect(w.headers['content-encoding']).toBe('gzip');
    expect(w.text).toBe('export {}');
    // without gzip support the plain file is sent
    const plain = await a.get('/assets/pdf.worker-x.mjs').set('Accept-Encoding', 'identity').expect(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    await a.get('/assets/..%2Findex.html').set('Accept-Encoding', 'gzip').expect((r) => expect(r.headers['content-encoding']).toBeUndefined());
    await a.get('/assets/missing.js').expect(404);
    expect((await a.get('/api/v1/public/tenant?tenant=botim').expect(200)).body.tenant.id).toBe('botim');
    await a.get('/api/v1/nope').expect(404);
    await a.get('/health').expect(200);
  });
});
