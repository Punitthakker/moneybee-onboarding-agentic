import type { IdentityView, ShareRequestView, SigningView } from '@moneybee/shared';

export interface VaultDoc { id: string; type: string; label: string; issuer: string; requestNo: string; expiresOn: string | null; verifiedStatus: string }
export interface MerchantSession {
  case: { ref: string; name: string };
  mode: 'mock' | 'live';
  signingEnabled: boolean;
  providerName: string;
  shareTtlMinutes: number;
  signedIn: boolean;
  identity: IdentityView | null;
  shareRequests: ShareRequestView[];
  signing: SigningView[];
  vault: VaultDoc[];
  clockOffsetMinutes: number;
}
export type { IdentityView, ShareRequestView, SigningView };
