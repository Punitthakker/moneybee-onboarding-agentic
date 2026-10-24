import type { ShareRequestView } from '@moneybee/shared';
import type { Config } from '../../config';
import { NotConfiguredError, type CreateShareInput, type IdentityClaims, type SharedDocument, type UaePassProvider } from './types';

/**
 * LIVE UAE PASS PROVIDER (skeleton).
 * Login follows the public OAuth 2.0 / OpenID Connect flow. Endpoint paths, scope, acr values and claim names below are
 * the commonly used ones and are UNVERIFIED: confirm them against the toolkit you receive when onboarding.
 * Document sharing and signing are not publicly documented, so they throw NotConfigured until access and the spec arrive.
 */
export class LiveUaePassProvider implements UaePassProvider {
  readonly mode = 'live' as const;
  constructor(private cfg: Config) {}

  private need(): { id: string; secret: string } {
    if (!this.cfg.UAEPASS_CLIENT_ID || !this.cfg.UAEPASS_CLIENT_SECRET) throw new NotConfiguredError('UAEPASS_CLIENT_ID / UAEPASS_CLIENT_SECRET');
    return { id: this.cfg.UAEPASS_CLIENT_ID, secret: this.cfg.UAEPASS_CLIENT_SECRET };
  }

  buildAuthorizeUrl(p: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    const { id } = this.need();
    const u = new URL('/idshub/authorize', this.cfg.UAEPASS_BASE_URL);
    u.search = new URLSearchParams({
      response_type: 'code', client_id: id, redirect_uri: p.redirectUri, scope: this.cfg.UAEPASS_SCOPE, state: p.state,
      acr_values: this.cfg.UAEPASS_ACR_VALUES, code_challenge: p.codeChallenge, code_challenge_method: 'S256',
    }).toString();
    return u.toString();
  }

  async exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ accessToken: string }> {
    const { id, secret } = this.need();
    const res = await fetch(new URL('/idshub/token', this.cfg.UAEPASS_BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.codeVerifier }),
    });
    if (!res.ok) throw new Error(`UAE PASS token exchange failed (${res.status})`);
    const j = (await res.json()) as { access_token?: string };
    if (!j.access_token) throw new Error('UAE PASS token response had no access_token');
    return { accessToken: j.access_token };
  }

  async getUserInfo(accessToken: string): Promise<IdentityClaims> {
    const res = await fetch(new URL('/idshub/userinfo', this.cfg.UAEPASS_BASE_URL), { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`UAE PASS userinfo failed (${res.status})`);
    const j = (await res.json()) as Record<string, string | undefined>;
    // claim names UNVERIFIED: fullnameEN, idn, mobile, email, userType (SOP1|SOP2|SOP3)
    const lvl = (j.userType ?? 'SOP1').toUpperCase();
    return {
      name: j.fullnameEN ?? j.fullnameAR ?? '', emiratesId: j.idn ?? '', sopLevel: lvl === 'SOP3' ? 'SOP3' : lvl === 'SOP2' ? 'SOP2' : 'SOP1',
      mobile: j.mobile, email: j.email, nationality: j.nationalityEN,
    };
  }

  createShareRequest(_p: CreateShareInput, _now: Date): Promise<ShareRequestView> {
    throw new NotConfiguredError('the document sharing API (specification pending from the UAE PASS team)');
  }
  getShareRequest(_r: ShareRequestView, _now: Date): Promise<ShareRequestView> {
    throw new NotConfiguredError('the document sharing API');
  }
  fetchSharedDocuments(_r: ShareRequestView, _i: IdentityClaims | null): Promise<SharedDocument[]> {
    throw new NotConfiguredError('the document sharing API');
  }
  startSigning(): Promise<{ signUrl: string; expiresAt: string }> {
    throw new NotConfiguredError('the signing API (service provider onboarding for signature)');
  }
  getSigningResult(): Promise<{ status: 'pending' | 'signed' | 'declined' | 'expired' }> {
    throw new NotConfiguredError('the signing API');
  }
}
