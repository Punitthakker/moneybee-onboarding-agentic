import { randomBytes, randomInt } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ISSUER_NAMES, SHARE_DOC_LABELS, type ShareDocType, type ShareRequestView, type SopLevel } from '@moneybee/shared';
import type { Config } from '../../config';
import type { CreateShareInput, IdentityClaims, SharedDocument, UaePassProvider } from './types';

/**
 * MOCK UAE PASS PROVIDER (see docs/MOCKS.md).
 * Simulates the OAuth login and the document sharing and signing hand-offs so the whole flow can be demonstrated
 * without credentials. All people and numbers are invented. The state lives in memory: a restart forgets pending
 * simulator sessions (the case record keeps whatever was already ingested).
 */
export interface Persona {
  id: 'sop3' | 'mismatch' | 'sop1';
  label: string;
  note: string;
  claims: IdentityClaims;
}

export const PERSONAS: Persona[] = [
  { id: 'sop3', label: 'Layla Demo Hassan', note: 'SOP3 - verified, happy path', claims: { name: 'Layla Demo Hassan', emiratesId: '784-1988-7654321-3', sopLevel: 'SOP3', mobile: '971500000001', email: 'layla.demo@example.test', nationality: 'Testland', dob: '1988-03-14' } },
  { id: 'mismatch', label: 'Rashid Sample Mansoori', note: 'SOP3 - name differs from the trade licence owner', claims: { name: 'Rashid Sample Mansoori', emiratesId: '784-1985-1112223-4', sopLevel: 'SOP3', mobile: '971500000002', email: 'rashid.sample@example.test', nationality: 'Testland', dob: '1985-07-02' } },
  { id: 'sop1', label: 'Omar Sample Khan', note: 'SOP1 - Emirates ID not verified, blocked', claims: { name: 'Omar Sample Khan', emiratesId: '', sopLevel: 'SOP1' as SopLevel, mobile: '971500000003', email: 'omar.sample@example.test' } },
];

interface ReqState { view: ShareRequestView; decision?: 'approve' | 'decline'; decidedAt?: string; applicant?: IdentityClaims }
interface SignState { id: string; expiresAt: string; documentName: string; documentSha256: string; decision?: 'sign' | 'decline'; decidedAt?: string }

export class MockUaePassProvider implements UaePassProvider {
  readonly mode = 'mock' as const;
  private offsetMs = 0;
  private codes = new Map<string, Persona>();
  private tokens = new Map<string, Persona>();
  private requests = new Map<string, ReqState>();
  private signs = new Map<string, SignState>();
  constructor(private cfg: Config) {}

  now(real: Date): Date {
    return new Date(real.getTime() + this.offsetMs);
  }
  advanceClock(minutes: number) {
    this.offsetMs += minutes * 60_000;
  }
  resetClock() {
    this.offsetMs = 0;
  }
  get clockOffsetMinutes() {
    return Math.round(this.offsetMs / 60_000);
  }

  /* ---- login ---- */
  buildAuthorizeUrl(p: { state: string; redirectUri: string }): string {
    const u = new URL('/sim/uaepass/login', this.cfg.PUBLIC_WEB_URL);
    u.searchParams.set('state', p.state);
    u.searchParams.set('redirect_uri', p.redirectUri);
    return u.toString();
  }
  /** called by the simulator page: the "user" picked a persona and approved */
  authorize(personaId: string): string | null {
    const persona = PERSONAS.find((x) => x.id === personaId);
    if (!persona) return null;
    const code = `mockcode_${randomBytes(12).toString('base64url')}`;
    this.codes.set(code, persona);
    return code;
  }
  async exchangeCode(p: { code: string }): Promise<{ accessToken: string }> {
    const persona = this.codes.get(p.code);
    if (!persona) throw new Error('invalid or reused authorization code');
    this.codes.delete(p.code);
    const at = `mockat_${randomBytes(12).toString('base64url')}`;
    this.tokens.set(at, persona);
    return { accessToken: at };
  }
  async getUserInfo(accessToken: string): Promise<IdentityClaims> {
    const persona = this.tokens.get(accessToken);
    if (!persona) throw new Error('invalid access token');
    return { ...persona.claims };
  }

  /* ---- document sharing ---- */
  async createShareRequest(p: CreateShareInput, now: Date): Promise<ShareRequestView> {
    const requestNo = `MBIB26${randomLetters(2)}${String(randomInt(0, 1e10)).padStart(10, '0')}`;
    const t = this.now(now);
    const view: ShareRequestView = {
      requestNo, providerName: p.providerName, purpose: p.purpose, requestedAt: t.toISOString(), expiresAt: new Date(t.getTime() + p.ttlMinutes * 60_000).toISOString(),
      status: 'pending', provider: 'mock',
      mandatoryDocuments: p.documents.map((type) => ({ type, label: SHARE_DOC_LABELS[type], issuerName: ISSUER_NAMES[type], status: 'requested' as const })),
      personalDetails: { email: p.applicantEmail, phone: p.applicantPhone },
    };
    this.requests.set(requestNo, { view });
    return structuredClone(view);
  }
  private compute(st: ReqState, now: Date): ShareRequestView {
    const v = structuredClone(st.view);
    if (st.decision === 'approve') {
      v.status = 'shared';
      v.sharedAt = st.decidedAt;
      v.mandatoryDocuments.forEach((d) => (d.status = 'shared'));
    } else if (st.decision === 'decline') {
      v.status = 'declined';
      v.declinedAt = st.decidedAt;
      v.mandatoryDocuments.forEach((d) => (d.status = 'declined'));
    } else if (this.now(now) > new Date(v.expiresAt)) v.status = 'expired';
    return v;
  }
  async getShareRequest(req: ShareRequestView, now: Date): Promise<ShareRequestView> {
    const st = this.requests.get(req.requestNo);
    if (!st) {
      // simulator state lost (restart): fall back to the stored record, applying expiry
      const v = structuredClone(req);
      if (v.status === 'pending' && this.now(now) > new Date(v.expiresAt)) v.status = 'expired';
      return v;
    }
    return this.compute(st, now);
  }
  peekRequest(requestNo: string, now: Date): ShareRequestView | null {
    const st = this.requests.get(requestNo);
    return st ? this.compute(st, now) : null;
  }
  decideShare(requestNo: string, decision: 'approve' | 'decline', now: Date): { ok: true; view: ShareRequestView } | { ok: false; reason: 'not_found' | 'expired' | 'already_decided' } {
    const st = this.requests.get(requestNo);
    if (!st) return { ok: false, reason: 'not_found' };
    const cur = this.compute(st, now);
    if (cur.status === 'expired') return { ok: false, reason: 'expired' };
    if (st.decision) return { ok: false, reason: 'already_decided' };
    st.decision = decision;
    st.decidedAt = this.now(now).toISOString();
    return { ok: true, view: this.compute(st, now) };
  }
  async fetchSharedDocuments(req: ShareRequestView, identity: IdentityClaims | null): Promise<SharedDocument[]> {
    const who = identity ?? PERSONAS[0].claims;
    const out: SharedDocument[] = [];
    for (const d of req.mandatoryDocuments) out.push(await syntheticDocument(d.type, who));
    return out;
  }

  /* ---- signing ---- */
  async startSigning(p: { transactionId: string; documentName: string; documentSha256: string; ttlMinutes: number }, now: Date) {
    const t = this.now(now);
    const expiresAt = new Date(t.getTime() + p.ttlMinutes * 60_000).toISOString();
    this.signs.set(p.transactionId, { id: p.transactionId, expiresAt, documentName: p.documentName, documentSha256: p.documentSha256 });
    return { signUrl: new URL(`/sim/uaepass/sign?tx=${encodeURIComponent(p.transactionId)}`, this.cfg.PUBLIC_WEB_URL).toString(), expiresAt };
  }
  private signStatus(st: SignState, now: Date): 'pending' | 'signed' | 'declined' | 'expired' {
    if (st.decision === 'sign') return 'signed';
    if (st.decision === 'decline') return 'declined';
    return this.now(now) > new Date(st.expiresAt) ? 'expired' : 'pending';
  }
  async getSigningResult(p: { transactionId: string }, now: Date) {
    const st = this.signs.get(p.transactionId);
    if (!st) return { status: 'pending' as const };
    const status = this.signStatus(st, now);
    return { status, signedAt: status === 'signed' ? st.decidedAt : undefined, signatureValid: status === 'signed' ? true : undefined };
  }
  peekSigning(tx: string, now: Date) {
    const st = this.signs.get(tx);
    return st ? { id: st.id, documentName: st.documentName, documentSha256: st.documentSha256, expiresAt: st.expiresAt, status: this.signStatus(st, now), signedAt: st.decidedAt } : null;
  }
  decideSigning(tx: string, decision: 'sign' | 'decline', now: Date): { ok: true } | { ok: false; reason: 'not_found' | 'expired' | 'already_decided' } {
    const st = this.signs.get(tx);
    if (!st) return { ok: false, reason: 'not_found' };
    const s = this.signStatus(st, now);
    if (s === 'expired') return { ok: false, reason: 'expired' };
    if (st.decision) return { ok: false, reason: 'already_decided' };
    st.decision = decision;
    st.decidedAt = this.now(now).toISOString();
    return { ok: true };
  }
}

const randomLetters = (n: number) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz'[randomInt(0, 23)]).join('');

/** Synthetic Emirates ID or Residence Visa in the same "Label: value" layout as /fixtures so the whole pipeline can read it. */
async function syntheticDocument(type: ShareDocType, who: IdentityClaims): Promise<SharedDocument> {
  const expiry = type === 'emirates_id' ? '2028-09-30' : '2028-06-30';
  const lines =
    type === 'emirates_id'
      ? ['UNITED ARAB EMIRATES - EMIRATES ID', `Full Name: ${who.name}`, `ID Number: ${who.emiratesId}`, `Nationality: ${who.nationality ?? 'Testland'}`, `DOB: ${who.dob ?? '1988-03-14'}`, `Expiry Date: ${expiry}`, 'Sex: F']
      : ['UAE RESIDENCE VISA', `Full Name: ${who.name}`, `Visa Number: 201/2024/${(who.emiratesId || '0000000').replace(/\D/g, '').slice(-7)}`, `Expiry Date: ${expiry}`, 'Sponsor: Self'];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  let y = 790;
  lines.forEach((l, i) => {
    page.drawText(l, { x: 50, y, size: i === 0 ? 16 : 10.5, font: i === 0 ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= i === 0 ? 30 : 18;
  });
  page.drawText('SIMULATED UAE PASS DOCUMENT - SYNTHETIC TEST DATA - NOT A REAL DOCUMENT', { x: 50, y: 30, size: 8, font, color: rgb(0.6, 0.1, 0.1) });
  const fields: Record<string, string> =
    type === 'emirates_id'
      ? { fullName: who.name, idNumber: who.emiratesId, nationality: who.nationality ?? 'Testland', dob: who.dob ?? '1988-03-14', expiryDate: expiry, sex: 'F' }
      : { fullName: who.name, visaNumber: `201/2024/${(who.emiratesId || '0000000').replace(/\D/g, '').slice(-7)}`, expiryDate: expiry, sponsor: 'Self' };
  return { type, issuerName: ISSUER_NAMES[type], fileName: `${type}-uaepass.pdf`, data: Buffer.from(await pdf.save()), fields, expiresOn: expiry };
}
