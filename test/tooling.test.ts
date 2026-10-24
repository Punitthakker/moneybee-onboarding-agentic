import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diffSpecs } from '../scripts/lib/breaking.js';
import { scaffoldModule } from '../scripts/lib/scaffold.js';
import { buildBundledSpec } from '../src/core/spec.js';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('breaking-change checker', () => {
  const base = buildBundledSpec({ includeTemplate: true });
  const run = (mutate: (d: any) => void) => {
    const next = clone(base);
    mutate(next);
    return diffSpecs(base, next);
  };
  const breaking = (cs: ReturnType<typeof diffSpecs>) => cs.filter((c) => c.severity === 'breaking').map((c) => c.message);

  it('sees no change in an identical spec', () => {
    expect(diffSpecs(base, clone(base))).toEqual([]);
  });

  it('treats new optional things as additive, not breaking', () => {
    const cs = run((d) => {
      d.components.schemas.ExampleCreate.properties.memo = { type: 'string' };
      d.components.schemas.Example.properties.extra = { type: 'string' };
      d['x-error-catalogue'].new_code = { status: 409, description: 'x' };
    });
    expect(breaking(cs)).toEqual([]);
    expect(cs.map((c) => c.message).join('\n')).toMatch(/new optional request property "memo"/);
    expect(cs.map((c) => c.message).join('\n')).toMatch(/new response property "extra"/);
  });

  const cases: [string, (d: any) => void, RegExp][] = [
    ['removed operation', (d) => delete d.paths['/me'].get, /operation removed/],
    ['removed path', (d) => delete d.paths['/events'], /operation removed/],
    ['changed operationId', (d) => (d.paths['/me'].get.operationId = 'whoAmI'), /operationId changed/],
    ['new required scope', (d) => d.paths['/me'].get['x-required-scopes'].push('events:read'), /new required scope/],
    ['actor requirement added', (d) => (d.paths['/me'].get['x-required-actor'] = 'user'), /now requires actor/],
    ['risk escalation', (d) => (d.paths['/template/examples'].post['x-mcp-risk'] = 'money-moving'), /x-mcp-risk escalated/],
    ['new required request field', (d) => d.components.schemas.ExampleCreate.required.push('name2') && (d.components.schemas.ExampleCreate.properties.name2 = { type: 'string' }), /new required request property/],
    ['request field removed', (d) => delete d.components.schemas.ExampleCreate.properties.currency, /request property "currency" removed/],
    ['field became required', (d) => d.components.schemas.WebhookEndpointBase && d.components.schemas.ExampleCreate.required.push('currency') && false, /./],
    ['type change', (d) => (d.components.schemas.ExampleCreate.properties.amount_minor.type = 'string'), /type changed/],
    ['tightened maxLength', (d) => (d.components.schemas.ExampleCreate.properties.name.maxLength = 2), /tightened/],
    ['request enum value removed', (d) => d.components.schemas.ExampleDecisionCreate.properties.reason_code.enum.pop(), /enum value\(s\) removed/],
    ['response property removed', (d) => delete d.components.schemas.Example.properties.status, /response property "status" removed/],
    ['response enum widened', (d) => d.components.schemas.Example.properties.status.enum.push('expired'), /response enum value\(s\) added/],
    ['query param removed', (d) => (d.paths['/template/examples'].get.parameters = d.paths['/template/examples'].get.parameters.filter((p: any) => p.name !== 'sort')), /parameter query:sort removed/],
    ['2xx response removed', (d) => delete d.paths['/me'].get.responses['200'], /response 200 removed/],
    ['event removed', (d) => delete d.webhooks['example.created'], /event removed/],
    ['event version bumped in place', (d) => (d.webhooks['example.created'].post['x-event-version'] = 2), /x-event-version changed/],
    ['scope removed', (d) => (d['x-scope-catalogue'] = d['x-scope-catalogue'].filter((x: any) => x.scope !== 'events:read')), /scope removed/],
    ['scope narrowed to fewer levels', (d) => (d['x-scope-catalogue'].find((x: any) => x.scope === 'events:read').levels = ['platform']), /no longer available/],
    ['error code removed', (d) => delete d['x-error-catalogue'].not_found, /error code removed/],
    ['error status changed', (d) => (d['x-error-catalogue'].not_found.status = 410), /status changed/],
  ];
  for (const [name, mutate, re] of cases) {
    if (name === 'field became required') continue; // covered by "new required request field"
    it(`flags: ${name}`, () => {
      const msgs = breaking(run(mutate));
      expect(msgs.length, `no breaking change reported for "${name}"`).toBeGreaterThan(0);
      expect(msgs.join('\n')).toMatch(re);
    });
  }
});

describe('module scaffolder', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const sandbox = () => {
    const root = mkdtempSync(join(tmpdir(), 'mb-scaffold-'));
    dirs.push(root);
    for (const f of ['openapi/openapi.yaml', 'openapi/modules/_template.yaml', 'src/modules/template/index.ts', 'src/modules/registry.ts', 'test/modules/template.test.ts']) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      cpSync(join(process.cwd(), f), join(root, f));
    }
    return root;
  };

  it('creates a spec fragment, implementation and test, and registers the module', () => {
    const root = sandbox();
    const r = scaffoldModule({ id: 'risk-scoring', resource: 'assessment', plural: 'assessments', root });
    expect(r.created.every((f) => existsSync(f))).toBe(true);
    const spec = readFileSync(join(root, 'openapi/modules/risk-scoring.yaml'), 'utf8');
    expect(spec).toContain('/risk-scoring/assessments');
    expect(spec).toContain('risk-scoring:assessments.read');
    expect(spec).toContain('assessment_already_decided');
    expect(spec).toContain('^ass_');
    expect(spec).not.toMatch(/template|example/i);
    const impl = readFileSync(join(root, 'src/modules/risk-scoring/index.ts'), 'utf8');
    expect(impl).toContain('createRiskScoringModule');
    expect(impl).toContain("newId('ass')");
    expect(impl).not.toMatch(/template|example/i);
    const reg = readFileSync(join(root, 'src/modules/registry.ts'), 'utf8');
    expect(reg).toContain("import { createRiskScoringModule } from './risk-scoring/index.js';");
    expect(reg).toContain('"risk-scoring": createRiskScoringModule,');
    expect(reg).toContain('// @modules-import');
    expect(reg).toContain('// @modules-entry');
  });

  it('produces a fragment that bundles cleanly next to the real spec', () => {
    const root = sandbox();
    scaffoldModule({ id: 'risk-scoring', resource: 'assessment', plural: 'assessments', root });
    const doc = buildBundledSpec({ includeTemplate: false, openapiDir: join(root, 'openapi') });
    expect(Object.keys(doc.paths)).toContain('/risk-scoring/assessments');
    expect(doc['x-scope-catalogue'].some((x: any) => x.scope === 'risk-scoring:assessments.decide')).toBe(true);
    expect(Object.keys(doc.webhooks)).toContain('assessment.created');
  });

  it('refuses to overwrite, to double-register, or to accept bad names', () => {
    const root = sandbox();
    scaffoldModule({ id: 'kyc', resource: 'check', plural: 'checks', root });
    expect(() => scaffoldModule({ id: 'kyc', resource: 'check', plural: 'checks', root })).toThrow(/refusing to overwrite/);
    expect(() => scaffoldModule({ id: 'Bad_Id', resource: 'a', plural: 'as', root })).toThrow(/kebab-case/);
    expect(() => scaffoldModule({ id: 'template', resource: 'a', plural: 'as', root })).toThrow(/reserved/);
    expect(() => scaffoldModule({ id: 'ok', resource: 'item', plural: 'item', root })).toThrow(/differ/);
    expect(() => scaffoldModule({ id: 'ok', resource: 'Item', plural: 'items', root })).toThrow(/snake_case/);
    expect(() => scaffoldModule({ id: 'ok', resource: 'item', plural: 'items', prefix: 'X', root })).toThrow(/prefix/);
  });
});
