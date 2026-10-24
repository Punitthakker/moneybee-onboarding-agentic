/**
 * Breaking-change detector for the bundled OpenAPI document.
 *
 * Rule of thumb: a change is breaking if a client written against the baseline can stop working.
 * Because requests reject unknown fields, removing a request property is breaking. Because clients
 * switch on enums, adding a response enum value is breaking too (see DEPRECATION.md).
 */
type Json = Record<string, any>;

export interface Change {
  severity: 'breaking' | 'additive';
  where: string;
  message: string;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const RISK_ORDER = ['read', 'write', 'decision-recording', 'money-moving'];

function resolve(doc: Json, node: any, depth = 0): any {
  let n = node;
  let guard = 0;
  while (n && typeof n === 'object' && typeof n.$ref === 'string' && guard++ < 20) {
    const path = n.$ref.replace(/^#\//, '').split('/');
    let cur: any = doc;
    for (const p of path) cur = cur?.[p.replace(/~1/g, '/').replace(/~0/g, '~')];
    n = cur;
  }
  return n;
}

function typesOf(s: Json): string[] {
  const t = s?.type;
  return t === undefined ? [] : Array.isArray(t) ? [...t].sort() : [t];
}

/** Flattens allOf so required/properties are visible. Good enough for the schemas this API uses. */
function flatten(doc: Json, schema: any, depth = 0): Json {
  const s = resolve(doc, schema);
  if (!s || typeof s !== 'object' || depth > 12) return s ?? {};
  if (!Array.isArray(s.allOf)) return s;
  const out: Json = { ...s };
  delete out.allOf;
  out.properties = { ...(s.properties ?? {}) };
  out.required = [...(s.required ?? [])];
  for (const part of s.allOf) {
    const f = flatten(doc, part, depth + 1);
    Object.assign(out.properties, f.properties ?? {});
    out.required.push(...(f.required ?? []));
    for (const k of ['type', 'additionalProperties', 'unevaluatedProperties']) if (out[k] === undefined && f[k] !== undefined) out[k] = f[k];
  }
  return out;
}

function diffSchema(oldDoc: Json, newDoc: Json, o: any, n: any, dir: 'request' | 'response', where: string, out: Change[], depth = 0) {
  if (depth > 10) return;
  const a = flatten(oldDoc, o, 0);
  const b = flatten(newDoc, n, 0);
  const add = (severity: Change['severity'], message: string) => out.push({ severity, where, message });

  const ta = typesOf(a);
  const tb = typesOf(b);
  if (ta.length && tb.length && ta.join() !== tb.join()) {
    // Widening a response type or narrowing a request type is still a change clients can feel.
    add('breaking', `type changed from ${ta.join('|')} to ${tb.join('|')}`);
    return;
  }

  if (a.enum || b.enum) {
    const oa: unknown[] = a.enum ?? [];
    const nb: unknown[] = b.enum ?? [];
    if (a.enum && !b.enum && dir === 'request') add('additive', 'enum constraint removed');
    if (a.enum && b.enum) {
      const removed = oa.filter((x) => !nb.includes(x));
      const added = nb.filter((x) => !oa.includes(x));
      if (dir === 'request') {
        if (removed.length) add('breaking', `request enum value(s) removed: ${removed.join(', ')}`);
        if (added.length) add('additive', `request enum value(s) added: ${added.join(', ')}`);
      } else {
        if (added.length) add('breaking', `response enum value(s) added: ${added.join(', ')} (clients that switch on this field may fail)`);
        if (removed.length) add('additive', `response enum value(s) removed: ${removed.join(', ')}`);
      }
    }
    if (!a.enum && b.enum && dir === 'request') add('breaking', 'request enum constraint added');
  }

  if (dir === 'request') {
    const tighter: [string, 'min' | 'max'][] = [['minLength', 'min'], ['maxLength', 'max'], ['minimum', 'min'], ['maximum', 'max'], ['minItems', 'min'], ['maxItems', 'max']];
    for (const [k, kind] of tighter) {
      const x = a[k];
      const y = b[k];
      if (y !== undefined && (x === undefined || (kind === 'min' ? y > x : y < x))) add('breaking', `request constraint ${k} tightened (${x ?? 'none'} -> ${y})`);
    }
    if (b.pattern !== undefined && b.pattern !== a.pattern) add('breaking', `request pattern changed or added (${a.pattern ?? 'none'} -> ${b.pattern})`);
    if (b.format !== undefined && b.format !== a.format) add('breaking', `request format changed or added (${a.format ?? 'none'} -> ${b.format})`);
  } else {
    if (a.format !== undefined && b.format !== a.format) add('breaking', `response format changed (${a.format} -> ${b.format})`);
  }

  const pa: Json = a.properties ?? {};
  const pb: Json = b.properties ?? {};
  const ra = new Set<string>(a.required ?? []);
  const rb = new Set<string>(b.required ?? []);

  for (const k of Object.keys(pa)) {
    if (!(k in pb)) {
      add('breaking', dir === 'request' ? `request property "${k}" removed (unknown fields are rejected)` : `response property "${k}" removed`);
    } else {
      diffSchema(oldDoc, newDoc, pa[k], pb[k], dir, `${where}.${k}`, out, depth + 1);
    }
  }
  for (const k of Object.keys(pb)) {
    if (k in pa) continue;
    if (dir === 'request') add(rb.has(k) ? 'breaking' : 'additive', rb.has(k) ? `new required request property "${k}"` : `new optional request property "${k}"`);
    else add('additive', `new response property "${k}"`);
  }
  for (const k of rb) {
    if (ra.has(k) || !(k in pa) || dir !== 'request') continue;
    add('breaking', `request property "${k}" became required`);
  }
  if (dir === 'response') {
    for (const k of ra) if (!rb.has(k) && k in pb) add('breaking', `response property "${k}" is no longer always present`);
  }

  if (a.items || b.items) {
    if (a.items && b.items) diffSchema(oldDoc, newDoc, a.items, b.items, dir, `${where}[]`, out, depth + 1);
  }
  if (dir === 'request' && a.additionalProperties !== false && b.additionalProperties === false) add('breaking', 'request now rejects unknown fields');
}

function bodySchema(doc: Json, node: any): any {
  const c = resolve(doc, node)?.content?.['application/json']?.schema ?? Object.values<any>(resolve(doc, node)?.content ?? {})[0]?.schema;
  return c;
}

function paramMap(doc: Json, op: Json): Map<string, Json> {
  const m = new Map<string, Json>();
  for (const p of op.parameters ?? []) {
    const r = resolve(doc, p);
    if (r) m.set(`${r.in}:${r.name}`, r);
  }
  return m;
}

export function diffSpecs(oldDoc: Json, newDoc: Json): Change[] {
  const out: Change[] = [];
  const push = (severity: Change['severity'], where: string, message: string) => out.push({ severity, where, message });

  for (const [path, item] of Object.entries<Json>(oldDoc.paths ?? {})) {
    const nItem = newDoc.paths?.[path];
    for (const m of METHODS) {
      const oOp = item[m];
      if (!oOp) continue;
      const where = `${m.toUpperCase()} ${path}`;
      const nOp = nItem?.[m];
      if (!nOp) {
        push('breaking', where, 'operation removed');
        continue;
      }
      if (oOp.operationId !== nOp.operationId) push('breaking', where, `operationId changed (${oOp.operationId} -> ${nOp.operationId}); SDK and MCP tool names depend on it`);

      // Authorisation
      const so: string[] = oOp['x-required-scopes'] ?? [];
      const sn: string[] = nOp['x-required-scopes'] ?? [];
      for (const s of sn) if (!so.includes(s)) push('breaking', where, `new required scope "${s}"`);
      if (!oOp['x-required-actor'] && nOp['x-required-actor']) push('breaking', where, `now requires actor type "${nOp['x-required-actor']}"`);
      const ro: string[] = oOp['x-required-roles'] ?? [];
      for (const r of nOp['x-required-roles'] ?? []) if (!ro.includes(r)) push('breaking', where, `new required role "${r}"`);
      const io = RISK_ORDER.indexOf(oOp['x-mcp-risk']);
      const inn = RISK_ORDER.indexOf(nOp['x-mcp-risk']);
      if (io >= 0 && inn > io) push('breaking', where, `x-mcp-risk escalated ${oOp['x-mcp-risk']} -> ${nOp['x-mcp-risk']}; agent permissions must be re-reviewed`);
      if (!(oOp.security?.length === 0) && nOp.security?.length === 0) push('additive', where, 'operation no longer requires authentication');
      if (oOp.security?.length === 0 && !(nOp.security?.length === 0)) push('breaking', where, 'operation now requires authentication');

      // Parameters
      const po = paramMap(oldDoc, oOp);
      const pn = paramMap(newDoc, nOp);
      for (const [k, p] of po) {
        const q = pn.get(k);
        if (!q) {
          push('breaking', where, `parameter ${k} removed (unknown parameters are rejected)`);
          continue;
        }
        diffSchema(oldDoc, newDoc, p.schema, q.schema, 'request', `${where} ${k}`, out);
        if (!p.required && q.required) push('breaking', where, `parameter ${k} became required`);
      }
      for (const [k, q] of pn) if (!po.has(k)) push(q.required ? 'breaking' : 'additive', where, `${q.required ? 'new required' : 'new optional'} parameter ${k}`);

      // Request body
      const bo = oOp.requestBody;
      const bn = nOp.requestBody;
      if (bo && !bn) push('breaking', where, 'request body removed');
      else if (!bo && bn) push(resolve(newDoc, bn).required ? 'breaking' : 'additive', where, 'request body added');
      else if (bo && bn) {
        if (!resolve(oldDoc, bo).required && resolve(newDoc, bn).required) push('breaking', where, 'request body became required');
        diffSchema(oldDoc, newDoc, bodySchema(oldDoc, bo), bodySchema(newDoc, bn), 'request', `${where} body`, out);
      }

      // Responses
      for (const [code, r] of Object.entries<Json>(oOp.responses ?? {})) {
        const nr = nOp.responses?.[code];
        if (!nr) {
          push(code.startsWith('2') ? 'breaking' : 'additive', where, `response ${code} removed`);
          continue;
        }
        const so_ = bodySchema(oldDoc, r);
        const sn_ = bodySchema(newDoc, nr);
        if (so_ && sn_) diffSchema(oldDoc, newDoc, so_, sn_, 'response', `${where} ${code}`, out);
      }
      for (const code of Object.keys(nOp.responses ?? {})) if (!oOp.responses?.[code]) push('additive', where, `response ${code} added`);
    }
    if (nItem) for (const m of METHODS) if (nItem[m] && !item[m]) push('additive', `${m.toUpperCase()} ${path}`, 'operation added');
  }
  for (const path of Object.keys(newDoc.paths ?? {})) if (!oldDoc.paths?.[path]) push('additive', path, 'path added');

  // Webhook events: direction is server to client, so they follow response rules.
  for (const [name, w] of Object.entries<Json>(oldDoc.webhooks ?? {})) {
    const nw = newDoc.webhooks?.[name];
    if (!nw) {
      push('breaking', `event ${name}`, 'event removed');
      continue;
    }
    const vo = w.post?.['x-event-version'];
    const vn = nw.post?.['x-event-version'];
    if (vo !== vn) push('breaking', `event ${name}`, `x-event-version changed (${vo} -> ${vn}); introduce a new event version instead of changing this one`);
    diffSchema(oldDoc, newDoc, bodySchema(oldDoc, w.post?.requestBody), bodySchema(newDoc, nw.post?.requestBody), 'response', `event ${name}`, out);
  }
  for (const name of Object.keys(newDoc.webhooks ?? {})) if (!oldDoc.webhooks?.[name]) push('additive', `event ${name}`, 'event added');

  // Scopes and error codes
  const byScope = (d: Json): Json => Object.fromEntries((d['x-scope-catalogue'] ?? []).map((s: Json) => [s.scope, s]));
  const scopesOld = byScope(oldDoc);
  const scopesNew = byScope(newDoc);
  for (const [s, def] of Object.entries<Json>(scopesOld)) {
    if (!scopesNew[s]) push('breaking', `scope ${s}`, 'scope removed');
    else {
      const lost = (def.levels ?? []).filter((l: string) => !(scopesNew[s].levels ?? []).includes(l));
      if (lost.length) push('breaking', `scope ${s}`, `no longer available to level(s): ${lost.join(', ')}`);
    }
  }
  for (const s of Object.keys(scopesNew)) if (!scopesOld[s]) push('additive', `scope ${s}`, 'scope added');
  const errOld: Json = oldDoc['x-error-catalogue'] ?? {};
  const errNew: Json = newDoc['x-error-catalogue'] ?? {};
  for (const [c, def] of Object.entries<Json>(errOld)) {
    if (!errNew[c]) push('breaking', `error ${c}`, 'error code removed');
    else if (errNew[c].status !== def.status) push('breaking', `error ${c}`, `status changed ${def.status} -> ${errNew[c].status}`);
  }
  for (const c of Object.keys(errNew)) if (!errOld[c]) push('additive', `error ${c}`, 'error code added');

  return out;
}
