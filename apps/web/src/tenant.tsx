import { useEffect } from 'react';
import { POWERED_BY, type PublicTenant } from '@moneybee/shared';

export type { PublicTenant };

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexToRgba = (hex: string, a: number) => `rgba(${rgb(hex).join(', ')}, ${a})`;
/** blend two #RRGGBB colours; w = weight of b */
const mix = (a: string, b: string, w: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v * (1 - w) + y[i] * w).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * Maps a tenant's brand onto the CSS variables the whole UI already uses (styles.css).
 * The MoneyBee platform tenant keeps its gradient buttons; white-label tenants get solid buttons in their primary colour.
 */
export function applyTenantTheme(t: PublicTenant | null | undefined) {
  if (!t) return;
  const root = document.documentElement;
  const c = t.branding.colors;
  const vars: Record<string, string> = {
    '--gold': c.accent,
    '--warn': c.accent,
    '--honey': c.highlight,
    '--honey-soft': hexToRgba(c.highlight, 0.35),
    '--ink': c.ink,
    '--body': c.body,
    '--bg': c.surface,
    '--cream': c.surfaceAlt,
    '--brand-primary': c.primary,
    '--brand-on-primary': c.onPrimary,
    '--sans': t.branding.fonts.sans,
  };
  if (t.branding.fonts.mono) vars['--mono'] = t.branding.fonts.mono;
  // White-label tenants also replace the warm MoneyBee neutrals (paper, sand, warm cards, greys).
  // The platform tenant keeps the original stylesheet values, so its look is unchanged.
  const whiteLabelOnly: Record<string, string> = {
    '--btn-dark': `linear-gradient(${c.primary}, ${c.primary})`,
    '--paper': mix(c.surface, c.surfaceAlt, 0.5),
    '--sand': c.surfaceAlt,
    '--card-warm': `linear-gradient(150deg, ${c.surface} 15%, ${c.surfaceAlt} 100%)`,
    '--muted': hexToRgba(c.body, 0.62),
    '--ink2': hexToRgba(c.body, 0.8),
    '--ink-2': c.ink,
    '--chip-line': hexToRgba(c.accent, 0.35),
    '--warn-bg': hexToRgba(c.accent, 0.12),
  };
  for (const k of Object.keys(whiteLabelOnly)) root.style.removeProperty(k);
  if (t.kind === 'white_label') Object.assign(vars, whiteLabelOnly);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.tenant = t.id;
  document.title = `${t.branding.displayName} ${t.branding.productName}`;
}

export function useTenantTheme(t: PublicTenant | null | undefined) {
  useEffect(() => applyTenantTheme(t), [t]);
}

/** Logo and product name of the tenant. Falls back to the MoneyBee wordmark until the tenant is known. */
export function TenantMark({ tenant, size = 24 }: { tenant?: PublicTenant | null; size?: number }) {
  if (!tenant || tenant.kind === 'platform') {
    return (
      <span className="wordmark" style={{ fontSize: size }}>
        moneybee <small>{tenant?.branding.productName ?? 'Onboard'}</small>
      </span>
    );
  }
  return (
    <span className="wordmark tenant-mark" style={{ fontSize: size }}>
      <img src={tenant.branding.logoUrl} alt={`${tenant.branding.displayName} logo`} height={Math.round(size * 1.25)} />
      {tenant.branding.displayName} <small>{tenant.branding.productName}</small>
      {tenant.branding.isPlaceholder && <span className="pill placeholder-pill" title="Logo and colours are placeholders until the partner's brand assets are supplied">placeholder brand</span>}
    </span>
  );
}

/**
 * The fixed attribution line. It takes no props that could hide it and reads its text from the shared constant,
 * so no tenant setting can change it. Arabic pages show the translation alongside the English line.
 */
export function PoweredByMoneyBee({ locale = 'en' }: { locale?: 'en' | 'ar' }) {
  return (
    <div className="powered-by" data-testid="powered-by">
      <svg viewBox="0 0 64 64" width="14" height="14" aria-hidden="true"><path d="M32 4l24 14v28L32 60 8 46V18z" fill="#17140F" /><path d="M32 16l14 8v16l-14 8-14-8V24z" fill="#DEBA6E" /></svg>
      <span>{POWERED_BY}</span>
      {locale === 'ar' && <span lang="ar" dir="rtl">بدعم من MoneyBee</span>}
    </div>
  );
}
