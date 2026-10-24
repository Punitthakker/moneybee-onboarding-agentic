import type { Services } from '../core/context.js';
import { createTemplateModule } from './template/index.js';
// @modules-import
import type { ModuleDef, ModuleFactory } from './types.js';

/**
 * Register new modules here. Adding a module is: scaffold it (npm run new:module), implement its handlers,
 * add its factory to this list. The template is only active when MB_INCLUDE_TEMPLATE=true.
 */
export const PRODUCT_MODULES: Record<string, ModuleFactory> = {
  // onboarding: createOnboardingModule,   (Module A)
  // compliance: createComplianceModule,   (Module B)
  // qss: createQssModule,                 (Module C)
  // @modules-entry
};

export const TEMPLATE_MODULES: Record<string, ModuleFactory> = {
  template: createTemplateModule,
};

export function loadModules(services: Services): ModuleDef[] {
  const factories = { ...PRODUCT_MODULES, ...(services.cfg.includeTemplate ? TEMPLATE_MODULES : {}) };
  return Object.values(factories).map((f) => f(services));
}
