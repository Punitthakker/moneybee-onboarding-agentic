import { z } from 'zod';
import { EntityTypeSchema } from './enums';

/**
 * Fixed attribution line. It is added by the platform to every merchant-facing surface
 * (portal, WhatsApp, email, PDF, acquirer pack) and is deliberately NOT part of tenant config,
 * so no tenant setting can remove or change it.
 */
export const POWERED_BY = 'Powered by MoneyBee' as const;

/** Tenant every record belongs to when nothing else is set (the MoneyBee platform tenant). */
export const DEFAULT_TENANT_ID = 'moneybee';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must be #RRGGBB');
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'phone must be in E.164 format, for example +971500000000');
const domain = z.string().regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i, 'must be a domain such as onboard.example.com');

export const TenantColorsSchema = z
  .object({
    /** buttons and primary actions */
    primary: hex,
    /** text on primary buttons */
    onPrimary: hex,
    /** eyebrows, links, focus ring */
    accent: hex,
    /** soft highlight (badges, glows) */
    highlight: hex,
    /** headings */
    ink: hex,
    /** body text */
    body: hex,
    /** page background */
    surface: hex,
    /** cards and panels */
    surfaceAlt: hex,
  })
  .strict();

export const TenantBrandingSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    /** product name shown next to the logo, for example "Business Onboarding" */
    productName: z.string().min(1).max(80),
    /** path under the web app (for example /tenants/botim/logo.svg) or an https URL */
    logoUrl: z.string().min(1).max(500).refine((v) => v.startsWith('/') || v.startsWith('https://'), 'logoUrl must be a site path or an https URL'),
    /** true while the logo and colours are stand-ins waiting for the partner's approved brand assets */
    isPlaceholder: z.boolean().default(false),
    colors: TenantColorsSchema,
    fonts: z.object({ sans: z.string().min(1).max(200), mono: z.string().min(1).max(200).optional() }).strict(),
  })
  .strict();

export const TenantCopySchema = z
  .object({
    welcomeTitle: z.string().min(1).max(160),
    welcomeBody: z.string().min(1).max(600),
    supportLine: z.string().min(1).max(200),
    legalFooter: z.string().max(400).default(''),
    privacyUrl: z.string().url().optional(),
    termsUrl: z.string().url().optional(),
  })
  .strict();

export const TenantContactSchema = z
  .object({
    supportEmail: z.string().email(),
    supportPhone: e164.optional(),
    /** WhatsApp Business number merchants message (channel built in phase 4) */
    whatsappNumber: e164.optional(),
    /** domain for per-application inbound addresses and outbound mail (phase 4) */
    emailDomain: domain.optional(),
  })
  .strict();

export const TenantNudgeSchema = z
  .object({
    /** hours after the last merchant activity at which a reminder is sent */
    cadenceHours: z.array(z.number().positive().max(24 * 30)).min(1).max(10),
    maxAttempts: z.number().int().min(0).max(10),
    quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).strict(),
    timezone: z.string().min(1).max(60),
  })
  .strict();

export const TenantRiskSchema = z
  .object({
    /** licence activities this tenant will not onboard (matched case-insensitively), used by the risk engine in phase 6 */
    prohibitedActivities: z.array(z.string().min(2).max(120)).max(200).default([]),
  })
  .strict();

export const TENANT_KINDS = ['platform', 'white_label'] as const;
export const LOCALES = ['en', 'ar'] as const;

export const TenantSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'tenant id: lowercase letters, digits and hyphens'),
    name: z.string().min(1).max(120),
    /** platform = MoneyBee itself (may manage global settings); white_label = partner such as Botim */
    kind: z.enum(TENANT_KINDS),
    status: z.enum(['active', 'suspended']).default('active'),
    /** prefix for case references, for example MB or BT */
    casePrefix: z.string().regex(/^[A-Z]{2,4}$/),
    /** host names that resolve to this tenant on public pages (for example botim.localhost) */
    hostnames: z.array(z.string().min(1).max(253)).max(20).default([]),
    locales: z.array(z.enum(LOCALES)).min(1).default(['en', 'ar']),
    enabledEntityTypes: z.array(EntityTypeSchema).min(1),
    defaultAcquirerCode: z.string().min(1).optional(),
    branding: TenantBrandingSchema,
    copy: TenantCopySchema,
    contact: TenantContactSchema,
    nudges: TenantNudgeSchema,
    risk: TenantRiskSchema.default({ prohibitedActivities: [] }),
  })
  .strict();
export type Tenant = z.infer<typeof TenantSchema>;

/** Fields a tenant admin may edit. Identity, kind and status are platform decisions. Unknown keys (for example poweredBy) are rejected. */
export const TenantUpdateSchema = TenantSchema.pick({ name: true, locales: true, enabledEntityTypes: true, defaultAcquirerCode: true, branding: true, copy: true, contact: true, nudges: true, risk: true })
  .partial()
  .strict();
export type TenantUpdate = z.infer<typeof TenantUpdateSchema>;

/** What any visitor may see about a tenant: enough to theme a page. POWERED_BY is always appended by the platform. */
export interface PublicTenant {
  id: string;
  name: string;
  kind: Tenant['kind'];
  locales: Tenant['locales'];
  enabledEntityTypes: Tenant['enabledEntityTypes'];
  branding: Tenant['branding'];
  copy: Tenant['copy'];
  contact: Pick<Tenant['contact'], 'supportEmail' | 'supportPhone' | 'whatsappNumber'>;
  poweredBy: typeof POWERED_BY;
}

export function publicTenantView(t: Tenant): PublicTenant {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    locales: t.locales,
    enabledEntityTypes: t.enabledEntityTypes,
    branding: t.branding,
    copy: t.copy,
    contact: { supportEmail: t.contact.supportEmail, supportPhone: t.contact.supportPhone, whatsappNumber: t.contact.whatsappNumber },
    // set last and from a constant: tenant data can never override it
    poweredBy: POWERED_BY,
  };
}
