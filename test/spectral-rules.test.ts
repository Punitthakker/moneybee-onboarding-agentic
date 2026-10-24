import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBundledSpec } from '../src/core/spec.js';

function lint(file: string): { code: string; path: string[] }[] {
  const r = spawnSync('npx', ['spectral', 'lint', file, '--ruleset', '.spectral.yaml', '--format', 'json'], { encoding: 'utf8' });
  // With no findings Spectral prints a plain sentence instead of an empty JSON array.
  // Some versions also print a summary line after the JSON array, so cut at the last closing bracket.
  const out = r.stdout.trim();
  if (!out.startsWith('[')) return [];
  return JSON.parse(out.slice(0, out.lastIndexOf(']') + 1));
}

describe('Spectral house rules actually fire', () => {
  const clean = buildBundledSpec({ includeTemplate: true });
  const dir = mkdtempSync(join(tmpdir(), 'mb-spectral-'));

  it('the real bundle (with the template) is clean', () => {
    const f = join(dir, 'clean.json');
    writeFileSync(f, JSON.stringify(clean));
    const hits = lint(f).filter((x) => x.code.startsWith('mb-') || x.code.startsWith('oas'));
    expect(hits.map((h) => `${h.code} @ ${h.path.join('.')}`)).toEqual([]);
  });

  it('each deliberate defect trips its rule', () => {
    const d = structuredClone(clean) as any;
    // 1 idempotency key removed
    d.paths['/webhook-endpoints'].post.parameters = [];
    // 2 mcp risk missing
    delete d.paths['/events'].get['x-mcp-risk'];
    // 3 decision-recording without human-only
    delete d.paths['/template/examples/{example_id}/decision'].post['x-required-actor'];
    // 4 free text not marked untrusted
    d.components.schemas.ExampleCreate.properties.memo = { type: 'string' };
    // 5 list without cursor
    d.paths['/audit-events'].get.parameters = d.paths['/audit-events'].get.parameters.filter((p: any) => p.$ref !== '#/components/parameters/Cursor');
    // 6 operationId not camelCase
    d.paths['/events'].get.operationId = 'List_Events';
    // 7 error response with the wrong schema
    d.paths['/me'].get.responses['400'] = { description: 'bad', content: { 'application/json': { schema: { type: 'object', properties: { foo: { type: 'string' } } } } } };
    // 8 short description
    d.paths['/me'].get.description = 'Too short.';
    // 9 operation overrides global security
    d.paths['/audit-events/verification'].get.security = [{ oauth2: [] }];
    // 10 webhook without version
    delete d.webhooks['webhook.ping'].post['x-event-version'];
    // 11 write operation classed as read
    d.paths['/webhook-endpoints'].post['x-mcp-risk'] = 'read';

    const f = join(dir, 'broken.json');
    writeFileSync(f, JSON.stringify(d));
    const fired = new Set(lint(f).map((x) => x.code));
    for (const rule of [
      'mb-idempotency-key-required',
      'mb-mcp-risk-declared',
      'mb-decision-recording-is-human-only',
      'mb-untrusted-free-text-marked',
      'mb-list-has-pagination',
      'mb-operation-id-camel-case',
      'mb-error-responses-use-envelope',
      'mb-description-informative',
      'mb-secured-or-explicitly-open',
      'mb-webhook-has-event-version',
      'mb-read-risk-matches-method',
    ]) {
      expect(fired, `rule ${rule} did not fire`).toContain(rule);
    }
  }, 60000);
});
