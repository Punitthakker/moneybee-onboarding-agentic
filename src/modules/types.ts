import type { HandlerMap, Services } from '../core/context.js';

/**
 * What every module declares. The conformance test compares this to the module's spec fragment,
 * so the two cannot drift apart.
 */
export interface ModuleManifest {
  /** Matches the file name openapi/modules/<id>.yaml and the x-module id. */
  id: string;
  /** The OpenAPI tag all of the module's operations carry. */
  tag: string;
  /** Scopes the module owns (all appear in its fragment's x-scope-catalogue). */
  scopes: string[];
  /** Event types the module emits (all appear in its fragment's webhooks). */
  events: string[];
  /** Error codes the module adds to the catalogue. */
  errorCodes: string[];
  /** Magic inputs that make the sandbox behave in a documented way. */
  sandboxBehaviours: { id: string; description: string }[];
}

export interface ModuleDef {
  manifest: ModuleManifest;
  handlers: HandlerMap;
}

export type ModuleFactory = (services: Services) => ModuleDef;
