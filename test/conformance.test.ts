import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBundledSpec } from '../src/core/spec.js';
import { makeWorld } from './helpers.js';

const FOUNDATION_EVENTS = ['webhook.ping'];

describe('module conformance (manifest vs spec fragment vs code)', async () => {
  const w = await makeWorld();
  const doc = buildBundledSpec({ includeTemplate: true });
  const scopes: string[] = doc['x-scope-catalogue'].map((s: any) => s.scope);

  it('loads at least the template module', () => {
    expect(w.modules.map((m) => m.manifest.id)).toContain('template');
  });

  for (const m of w.modules) {
    const { manifest: mf, handlers } = m;
    describe(mf.id, () => {
      const ops = w.services.spec.ops.filter((o) => o.tags.includes(mf.tag));

      it('implements exactly the operations its tag carries in the spec', () => {
        expect(ops.map((o) => o.operationId).sort()).toEqual(Object.keys(handlers).sort());
      });

      it('owns exactly the scopes with its prefix, and operations only require those', () => {
        const owned = scopes.filter((s) => s.startsWith(`${mf.id}:`));
        expect([...mf.scopes].sort()).toEqual(owned.sort());
        for (const o of ops) for (const s of o.requiredScopes) expect(mf.scopes, `${o.operationId} requires ${s}`).toContain(s);
      });

      it('declares the events it emits, and they exist in the spec', () => {
        for (const e of mf.events) {
          expect(doc.webhooks[e], `${e} missing from the spec`).toBeDefined();
        }
        const withPrefix = Object.keys(doc.webhooks).filter((e) => e.startsWith(`${mf.id}.`));
        for (const e of withPrefix) expect(mf.events).toContain(e);
      });

      it('declares error codes that exist in the catalogue', () => {
        for (const c of mf.errorCodes) expect(doc['x-error-catalogue'][c], c).toBeDefined();
      });

      it('documents every sandbox behaviour', () => {
        for (const b of mf.sandboxBehaviours) {
          expect(b.id).toMatch(/^[a-z0-9-]+$/);
          expect(b.description.length).toBeGreaterThan(10);
        }
      });

      it('has a test file', () => {
        expect(existsSync(join(process.cwd(), `test/modules/${mf.id}.test.ts`)), `test/modules/${mf.id}.test.ts`).toBe(true);
      });

      it('marks every decision-recording operation as human-only', () => {
        for (const o of ops.filter((x) => x.mcpRisk === 'decision-recording')) {
          expect(o.requiredActor, o.operationId).toBe('user');
          expect(o.requiredRoles.length, o.operationId).toBeGreaterThan(0);
        }
      });
    });
  }

  it('leaves no event or operation unowned', () => {
    const events = new Set<string>([...FOUNDATION_EVENTS, ...w.modules.flatMap((m) => m.manifest.events)]);
    for (const e of Object.keys(doc.webhooks)) expect(events.has(e), `event ${e} is not owned by any module or the foundation`).toBe(true);
    const foundationTags = new Set(['Authentication', 'Tenancy', 'Audit', 'Webhooks', 'Events']);
    const tags = new Set(w.modules.map((m) => m.manifest.tag));
    for (const o of w.services.spec.ops) {
      const owned = o.tags.some((t) => tags.has(t) || foundationTags.has(t));
      expect(owned, `${o.operationId} has tags ${o.tags.join(',')} that no module owns`).toBe(true);
    }
  });

  it('keeps module fragments as the only files in openapi/modules', () => {
    for (const f of readdirSync(join(process.cwd(), 'openapi/modules'))) expect(f).toMatch(/\.yaml$/);
  });
});

describe('deprecation and sunset headers', () => {
  it('announces a deprecated operation with Deprecation and Sunset headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-dep-'));
    try {
      cpSync(join(process.cwd(), 'openapi'), dir, { recursive: true });
      const p = join(dir, 'openapi.yaml');
      const yaml = readFileSync(p, 'utf8');
      const marker = 'operationId: getCurrentContext';
      expect(yaml).toContain(marker);
      writeFileSync(p, yaml.replace(marker, `${marker}\n      deprecated: true\n      x-sunset: '2027-10-24T00:00:00Z'`));
      const w = await makeWorld({}, { openapiDir: dir });
      const res = await w.call('merchant_a1', 'GET', '/me');
      expect(res.status).toBe(200);
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.sunset).toBe('Sun, 24 Oct 2027 00:00:00 GMT');
      const other = await w.call('merchant_a1', 'GET', '/events');
      expect(other.headers.deprecation).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
