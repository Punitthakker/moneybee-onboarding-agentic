import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ActorType, Level, McpRisk, Operation } from './types.js';

const OPENAPI_DIR = fileURLToPath(new URL('../../openapi/', import.meta.url));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const FRAGMENT_KEYS = new Set(['x-module', 'tags', 'x-scope-catalogue', 'x-error-catalogue', 'paths', 'webhooks', 'components']);
const COMPONENT_SECTIONS = ['schemas', 'parameters', 'responses', 'headers'] as const;
const MCP_RISKS: McpRisk[] = ['read', 'write', 'money-moving', 'decision-recording'];

type Json = Record<string, any>;

export interface BundleOptions {
  /** Include fragments whose file name starts with an underscore (the module template). */
  includeTemplate?: boolean;
  openapiDir?: string;
}

function readYaml(path: string): Json {
  return parse(readFileSync(path, 'utf8')) as Json;
}

function dup(kind: string, key: string, file: string): never {
  throw new Error(`Spec merge: duplicate ${kind} "${key}" in ${file}`);
}

function mergeFragment(root: Json, frag: Json, file: string) {
  for (const k of Object.keys(frag)) {
    if (!FRAGMENT_KEYS.has(k)) throw new Error(`Spec merge: ${file} has unsupported top-level key "${k}"`);
  }
  for (const section of ['paths', 'webhooks'] as const) {
    root[section] ??= {};
    for (const [k, v] of Object.entries(frag[section] ?? {})) {
      if (k in root[section]) dup(section, k, file);
      root[section][k] = v;
    }
  }
  root.components ??= {};
  for (const section of COMPONENT_SECTIONS) {
    root.components[section] ??= {};
    for (const [k, v] of Object.entries(frag.components?.[section] ?? {})) {
      if (k in root.components[section]) dup(`components.${section}`, k, file);
      root.components[section][k] = v;
    }
  }
  root.tags ??= [];
  for (const t of frag.tags ?? []) {
    if (root.tags.some((x: Json) => x.name === t.name)) dup('tag', t.name, file);
    root.tags.push(t);
  }
  root['x-scope-catalogue'] ??= [];
  for (const s of frag['x-scope-catalogue'] ?? []) {
    if (root['x-scope-catalogue'].some((x: Json) => x.scope === s.scope)) dup('scope', s.scope, file);
    root['x-scope-catalogue'].push(s);
  }
  root['x-error-catalogue'] ??= {};
  for (const [k, v] of Object.entries(frag['x-error-catalogue'] ?? {})) {
    if (k in root['x-error-catalogue']) dup('error code', k, file);
    root['x-error-catalogue'][k] = v;
  }
  if (frag['x-module']) {
    root['x-modules'] ??= [];
    root['x-modules'].push(frag['x-module']);
  }
}

const STD_HEADERS: Record<string, string> = {
  'X-Request-Id': 'RequestId',
  'MoneyBee-Version': 'ApiVersion',
  'RateLimit-Limit': 'RateLimitLimit',
  'RateLimit-Remaining': 'RateLimitRemaining',
  'RateLimit-Reset': 'RateLimitReset',
};

function addHeaders(response: Json, extra: Record<string, string> = {}) {
  if (response.$ref) return;
  response.headers ??= {};
  for (const [name, comp] of Object.entries({ ...STD_HEADERS, ...extra })) {
    response.headers[name] ??= { $ref: `#/components/headers/${comp}` };
  }
}

/** Adds the scope list to the security scheme, the standard headers and the standard error responses. */
function normalise(doc: Json) {
  const scopes: Record<string, string> = {};
  for (const s of doc['x-scope-catalogue']) scopes[s.scope] = s.description;
  doc.components.securitySchemes.oauth2.flows.clientCredentials.scopes = scopes;

  for (const r of Object.values<Json>(doc.components.responses)) addHeaders(r);

  for (const item of Object.values<Json>(doc.paths)) {
    for (const m of METHODS) {
      const op: Json | undefined = item[m];
      if (!op) continue;
      const oauthFormat = op['x-error-format'] === 'oauth';
      const requiresAuth = !(Array.isArray(op.security) && op.security.length === 0);
      const hasBody = !!op.requestBody;
      const hasInputs = hasBody || (op.parameters ?? []).some((p: Json) => (p.$ref ? true : p.in !== 'header'));
      op.responses ??= {};
      const addStd = (code: string, ref: string) => {
        op.responses[code] ??= { $ref: `#/components/responses/${ref}` };
      };
      if (!oauthFormat) {
        addStd('400', 'BadRequest');
        if (requiresAuth) addStd('401', 'Unauthenticated');
        if ((op['x-required-scopes'] ?? []).length > 0 || op['x-required-actor']) addStd('403', 'Forbidden');
        if (hasInputs) addStd('422', 'ValidationFailed');
        if (hasBody) addStd('415', 'UnsupportedMediaType');
        // Every call that takes an Idempotency-Key can answer 409 (key conflict or request in progress).
        const takesIdemKey = (op.parameters ?? []).some((x: Json) => typeof x.$ref === 'string' && x.$ref.endsWith('/IdempotencyKey'));
        if (takesIdemKey) addStd('409', 'Conflict');
      }
      addStd('429', 'RateLimited');
      addStd('500', 'InternalError');
      for (const [code, resp] of Object.entries<Json>(op.responses)) {
        if (resp.$ref) continue;
        const extra: Record<string, string> = {};
        if (code.startsWith('2') && m !== 'get' && !op['x-idempotency-exempt']) extra['Idempotent-Replayed'] = 'IdempotentReplayed';
        addHeaders(resp, extra);
      }
    }
  }
}

/** Builds the full bundled and normalised spec from the root file and the module fragments. */
export function buildBundledSpec(opts: BundleOptions = {}): Json {
  const dir = opts.openapiDir ?? OPENAPI_DIR;
  const doc = readYaml(join(dir, 'openapi.yaml'));
  doc.components.responses ??= {};
  doc['x-modules'] = [];
  let files: string[] = [];
  try {
    files = readdirSync(join(dir, 'modules')).filter((f) => f.endsWith('.yaml')).sort();
  } catch {
    /* no modules directory */
  }
  for (const f of files) {
    if (f.startsWith('_') && !opts.includeTemplate) continue;
    mergeFragment(doc, readYaml(join(dir, 'modules', f)), f);
  }
  normalise(doc);
  return doc;
}

/** Resolves internal $refs. Circular references are rejected: schemas in this API are trees. */
export function deref(node: any, root: Json, stack: string[] = []): any {
  if (Array.isArray(node)) return node.map((n) => deref(n, root, stack));
  if (node === null || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    const ref: string = node.$ref;
    if (!ref.startsWith('#/')) throw new Error(`Only internal refs are supported: ${ref}`);
    if (stack.includes(ref)) throw new Error(`Circular $ref: ${[...stack, ref].join(' -> ')}`);
    let target: any = root;
    for (const part of ref.slice(2).split('/')) target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (target === undefined) throw new Error(`Unresolved $ref: ${ref}`);
    return deref(target, root, [...stack, ref]);
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, root, stack);
  return out;
}

export interface ParamSpec {
  name: string;
  in: 'query' | 'path' | 'header';
  required: boolean;
  schema: Json;
}

export interface OpValidators {
  params: ParamSpec[];
  query: ValidateFunction;
  path: ValidateFunction;
  bodies: Map<string, ValidateFunction>;
  bodyRequired: boolean;
  contentTypes: string[];
  response(status: number): ValidateFunction | null | undefined;
}

export interface EventDef {
  type: string;
  version: number;
}

export class LoadedSpec {
  readonly doc: Json;
  readonly ops: Operation[];
  readonly byId = new Map<string, Operation>();
  readonly scopes = new Map<string, { description: string; levels: Level[] }>();
  readonly errors: Record<string, { status: number; description: string }>;
  readonly events = new Map<string, EventDef>();
  readonly modules: Json[];
  readonly basePath: string;
  private readonly queryAjv: Ajv2020;
  private readonly strictAjv: Ajv2020;
  private readonly cache = new Map<string, OpValidators>();

  constructor(doc: Json) {
    this.doc = doc;
    this.errors = doc['x-error-catalogue'];
    this.modules = doc['x-modules'] ?? [];
    this.basePath = new URL(doc.servers[0].url).pathname.replace(/\/$/, '');
    for (const s of doc['x-scope-catalogue']) this.scopes.set(s.scope, { description: s.description, levels: s.levels });
    for (const [type, item] of Object.entries<Json>(doc.webhooks ?? {})) {
      this.events.set(type, { type, version: Number(item.post?.['x-event-version'] ?? 1) });
    }
    this.ops = this.extractOps();
    for (const op of this.ops) this.byId.set(op.operationId, op);

    // Query and path params arrive as strings, so they are coerced and defaults are applied.
    this.queryAjv = new Ajv2020({ allErrors: true, strict: false, coerceTypes: true, useDefaults: true });
    addFormats.default(this.queryAjv);
    // Bodies are validated as sent: no coercion, no defaults.
    this.strictAjv = new Ajv2020({ allErrors: true, strict: false });
    addFormats.default(this.strictAjv);
  }

  private extractOps(): Operation[] {
    const ops: Operation[] = [];
    for (const [path, item] of Object.entries<Json>(this.doc.paths)) {
      for (const method of METHODS) {
        const raw = item[method];
        if (!raw) continue;
        const requiresAuth = !(Array.isArray(raw.security) && raw.security.length === 0);
        const risk = raw['x-mcp-risk'] as McpRisk;
        if (!MCP_RISKS.includes(risk)) throw new Error(`${raw.operationId}: missing or invalid x-mcp-risk`);
        ops.push({
          operationId: raw.operationId,
          method,
          path,
          tags: raw.tags ?? [],
          summary: raw.summary,
          mcpRisk: risk,
          requiredScopes: raw['x-required-scopes'] ?? [],
          requiredActor: (raw['x-required-actor'] as ActorType | undefined) ?? null,
          requiredRoles: raw['x-required-roles'] ?? [],
          requiresAuth,
          idempotent: method !== 'get' && !raw['x-idempotency-exempt'],
          deprecated: !!raw.deprecated,
          sunset: raw['x-sunset'] ?? null,
          raw,
        });
      }
    }
    return ops;
  }

  private eventValidators = new Map<string, ValidateFunction | null>();

  /** Validator for the full webhook payload of an event type, taken from the spec's webhooks section. */
  eventValidator(type: string): ValidateFunction | null {
    if (this.eventValidators.has(type)) return this.eventValidators.get(type)!;
    const schema = this.doc.webhooks?.[type]?.post?.requestBody?.content?.['application/json']?.schema;
    const fn = schema ? this.strictAjv.compile(deref(schema, this.doc)) : null;
    this.eventValidators.set(type, fn);
    return fn;
  }

  validatorsFor(op: Operation): OpValidators {
    const hit = this.cache.get(op.operationId);
    if (hit) return hit;
    const params: ParamSpec[] = (op.raw.parameters ?? []).map((p: Json) => {
      const r = deref(p, this.doc);
      return { name: r.name, in: r.in, required: !!r.required, schema: r.schema } as ParamSpec;
    });
    const objSchema = (where: 'query' | 'path') => {
      const ps = params.filter((p) => p.in === where);
      return {
        type: 'object',
        properties: Object.fromEntries(ps.map((p) => [p.name, p.schema])),
        required: ps.filter((p) => p.required).map((p) => p.name),
        additionalProperties: false,
      };
    };
    const bodies = new Map<string, ValidateFunction>();
    const content: Json = deref(op.raw.requestBody?.content ?? {}, this.doc);
    for (const [ct, def] of Object.entries<Json>(content)) {
      bodies.set(ct, (ct.includes('form-urlencoded') ? this.queryAjv : this.strictAjv).compile(def.schema ?? {}));
    }
    const responseValidators = new Map<string, ValidateFunction | null>();
    const v: OpValidators = {
      params,
      query: this.queryAjv.compile(objSchema('query')),
      path: this.queryAjv.compile(objSchema('path')),
      bodies,
      bodyRequired: !!op.raw.requestBody?.required,
      contentTypes: [...bodies.keys()],
      response: (status: number) => {
        const key = String(status);
        if (responseValidators.has(key)) return responseValidators.get(key);
        const resp = op.raw.responses?.[key];
        if (!resp) {
          responseValidators.set(key, undefined as any);
          return undefined;
        }
        const r = deref(resp, this.doc);
        const schema = r.content?.['application/json']?.schema;
        const fn = schema ? this.strictAjv.compile(schema) : null;
        responseValidators.set(key, fn);
        return fn;
      },
    };
    this.cache.set(op.operationId, v);
    return v;
  }
}

export function loadSpec(opts: BundleOptions = {}): LoadedSpec {
  return new LoadedSpec(buildBundledSpec(opts));
}
