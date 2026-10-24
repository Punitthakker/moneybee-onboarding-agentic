import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScaffoldOptions {
  /** Module id, kebab-case. Becomes the scope prefix, URL prefix and tag. Example: "onboarding". */
  id: string;
  /** Singular resource name, snake_case. Example: "application". */
  resource: string;
  /** Plural resource name, snake_case. Used in paths and scopes. Example: "applications". */
  plural: string;
  /** Resource id prefix, 2 to 6 lowercase letters. Defaults to the first three letters of the resource. */
  prefix?: string;
  /** Repository root. Defaults to the current directory. */
  root?: string;
}

const RESERVED = new Set(['template', 'foundation', 'oauth', 'me', 'events', 'audit', 'webhook']);
const pascal = (s: string) => s.split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

function rename(text: string, o: Required<Omit<ScaffoldOptions, 'root'>>): string {
  const P = pascal;
  // Order matters: longest and most specific tokens first.
  const rules: [RegExp, string][] = [
    [/createTemplateModule/g, `create${P(o.id)}Module`],
    [/TEMPLATE_MODULES/g, 'TEMPLATE_MODULES'],
    [/newId\('ex'\)/g, `newId('${o.prefix}')`],
    [/\^ex_/g, `^${o.prefix}_`],
    [/Examples/g, P(o.plural)],
    [/Example/g, P(o.resource)],
    [/examples/g, o.plural],
    [/example/g, o.resource],
    [/Template/g, P(o.id)],
    [/template/g, o.id],
  ];
  return rules.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function scaffoldModule(opts: ScaffoldOptions): { created: string[]; edited: string[] } {
  const root = opts.root ?? process.cwd();
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(opts.id)) throw new Error(`id "${opts.id}" must be kebab-case, for example "risk-scoring"`);
  if (RESERVED.has(opts.id)) throw new Error(`id "${opts.id}" is reserved`);
  for (const [k, v] of [['resource', opts.resource], ['plural', opts.plural]] as const) {
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(v)) throw new Error(`${k} "${v}" must be snake_case`);
  }
  if (opts.resource === opts.plural) throw new Error('resource and plural must differ');
  const prefix = opts.prefix ?? opts.resource.replace(/_/g, '').slice(0, 3);
  if (!/^[a-z]{2,6}$/.test(prefix)) throw new Error(`prefix "${prefix}" must be 2 to 6 lowercase letters`);
  const o = { id: opts.id, resource: opts.resource, plural: opts.plural, prefix };

  const src = {
    spec: join(root, 'openapi/modules/_template.yaml'),
    impl: join(root, 'src/modules/template/index.ts'),
    test: join(root, 'test/modules/template.test.ts'),
    registry: join(root, 'src/modules/registry.ts'),
  };
  for (const f of Object.values(src)) if (!existsSync(f)) throw new Error(`template file missing: ${f}`);

  const out = {
    spec: join(root, `openapi/modules/${o.id}.yaml`),
    impl: join(root, `src/modules/${o.id}/index.ts`),
    test: join(root, `test/modules/${o.id}.test.ts`),
  };
  for (const f of Object.values(out)) if (existsSync(f)) throw new Error(`refusing to overwrite ${f}`);

  const registry = readFileSync(src.registry, 'utf8');
  if (!registry.includes('// @modules-import') || !registry.includes('// @modules-entry')) throw new Error('registry markers are missing');
  if (new RegExp(`['"]${o.id}['"]\\s*:`).test(registry)) throw new Error(`module "${o.id}" is already registered`);

  for (const f of Object.values(out)) mkdirSync(join(f, '..'), { recursive: true });
  // Drop the template's explanatory header comment block and put a short one in its place.
  const specBody = rename(readFileSync(src.spec, 'utf8'), o).replace(/^(#.*\n)+/, '');
  writeFileSync(out.spec, `# Module: ${o.id}. Scaffolded. Replace the placeholder fields, scopes and events.\n${specBody}`);
  writeFileSync(out.impl, rename(readFileSync(src.impl, 'utf8'), o));
  // The test keeps using the shared EXAMPLE payload from test/helpers.ts. Replace it with a valid body for the new resource.
  writeFileSync(out.test, rename(readFileSync(src.test, 'utf8'), o));

  const next = registry
    .replace('// @modules-import', `import { create${pascal(o.id)}Module } from './${o.id}/index.js';\n// @modules-import`)
    .replace('// @modules-entry', `${JSON.stringify(o.id)}: create${pascal(o.id)}Module,\n  // @modules-entry`);
  writeFileSync(src.registry, next);

  return { created: Object.values(out), edited: [src.registry] };
}
