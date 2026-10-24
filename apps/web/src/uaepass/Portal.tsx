import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { SHARE_DOC_LABELS, SHARE_DOC_TYPES, type ShareDocType, type ShareRequestView, type SigningView } from '@moneybee/shared';
import { m, invite } from './client';
import { LangProvider, LangToggle, fmtGst, useT } from './i18n';
import { ShareCard } from './ShareCard';
import type { MerchantSession } from './types';
import './uaepass.css';

function Qr({ value }: { value: string }) {
  const q = qrcode(0, 'M');
  q.addData(value);
  q.make();
  return <div className="up-qr" aria-hidden dangerouslySetInnerHTML={{ __html: q.createSvgTag({ scalable: true, margin: 0 }) }} />;
}

const MSG: Record<string, 'sopLow' | 'cancelled' | 'stateInvalid' | 'failed' | 'inviteInvalid'> = { sop_low: 'sopLow', cancelled: 'cancelled', state_invalid: 'stateInvalid', failed: 'failed', invite_invalid: 'inviteInvalid' };

export function MerchantPortal() {
  return (
    <LangProvider>
      <PortalInner />
    </LangProvider>
  );
}

function PortalInner() {
  const { t } = useT();
  const nav = useNavigate();
  const { invite: inviteParam } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const authMsg = sp.get('auth');

  // the invite token arrives once in the path, is kept in session storage, and the URL is cleaned straight away
  useEffect(() => {
    if (inviteParam) {
      invite.set(inviteParam);
      nav('/m', { replace: true });
    }
    setReady(true);
  }, [inviteParam, nav]);

  const session = useQuery({
    queryKey: ['merchant'],
    queryFn: () => m.get<MerchantSession>('/merchant/session'),
    enabled: ready && !!invite.get(),
    retry: false,
    refetchInterval: (q) => (q.state.data?.shareRequests.some((r) => r.status === 'pending') || q.state.data?.signing.some((s) => s.status === 'pending') ? 2500 : false),
  });
  const s = session.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['merchant'] });

  const start = async () => {
    setHandoff(true);
    try {
      const { url } = await m.post<{ url: string }>('/auth/uaepass/start');
      setTimeout(() => (window.location.href = url), 700);
    } catch {
      setHandoff(false);
      setSp({ auth: 'failed' });
    }
  };

  const step = !s?.signedIn ? 0 : s.signing.some((x) => x.status === 'signed') ? 3 : s.shareRequests.some((r) => r.status === 'shared') ? 2 : 1;

  return (
    <div>
      {s?.mode === 'mock' && <div className="up-sim-strip" role="status">{t.simulated}</div>}
      <header className="up-top">
        <div className="wordmark">moneybee <small>{t.brandSub}</small></div>
        <span className="grow" />
        {s?.signedIn && <button className="btn btn-ghost btn-sm" onClick={async () => { await m.post('/merchant/signout'); refresh(); }}>{t.signOut}</button>}
        <LangToggle />
      </header>
      <main className="up-wrap" style={{ maxWidth: 1080, padding: '8px 24px 80px' }}>
        {!invite.get() && ready && <div className="up-callout warn" style={{ marginTop: 30 }}>{t.noLink}</div>}
        {session.error && <div className="up-callout bad" style={{ marginTop: 30 }} role="alert">{t.inviteInvalid}</div>}
        {authMsg && authMsg !== 'ok' && MSG[authMsg] && <div className="up-callout bad" style={{ margin: '10px 0 18px' }} role="alert" data-testid="auth-error">{t[MSG[authMsg]]}</div>}
        {!s && !session.error && invite.get() && <div className="muted">{t.loading}</div>}

        {s && (
          <>
            <div className="up-steps" aria-label="Progress">
              {[t.stepSignIn, t.stepShare, ...(s.signingEnabled ? [t.stepSign] : [])].map((l, i) => (
                <span key={l} className={`up-step ${i === step ? 'on' : i < step ? 'done' : ''}`}><b>{i < step ? '✓' : i + 1}</b>{l}</span>
              ))}
            </div>
            {!s.signedIn ? <SignedOut s={s} handoff={handoff} onStart={start} onCancel={() => setHandoff(false)} /> : <SignedIn s={s} refresh={refresh} />}
          </>
        )}
        <div className="up-foot">{t.secured}<br /><b>{t.powered}</b></div>
      </main>
    </div>
  );
}

function SignedOut({ s, handoff, onStart, onCancel }: { s: MerchantSession; handoff: boolean; onStart: () => void; onCancel: () => void }) {
  const { t } = useT();
  return (
    <div className="up-grid">
      <section className="up-hero">
        <p className="eyebrow">{s.case.name} &middot; {s.case.ref}</p>
        <h1 className="h1" style={{ fontSize: 'clamp(34px,5vw,52px)' }}>{t.signInTitle}<span className="grey">{t.signInGrey}</span></h1>
        <p className="lede">{t.signInLede}</p>
        <div style={{ marginTop: 26 }}>
          {handoff ? (
            <div className="row" style={{ gap: 16 }} role="status" data-testid="handoff">
              <div className="up-spin" />
              <div><b>{t.opening}</b><div className="up-note">{t.openingSub}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t.cancel}</button>
            </div>
          ) : (
            <button className="up-btn-uae" onClick={onStart} data-testid="continue-uaepass"><span className="glyph">UAE<br />PASS</span>{t.continueUaePass}</button>
          )}
        </div>
      </section>
      <div className="stack">
        <div className="card">
          <div className="section-title">{t.weReceive}</div>
          <ul className="up-list2">{t.weReceiveList.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="card">
          <div className="section-title">{t.weNever}</div>
          <ul className="up-list2">{t.weNeverList.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

function SignedIn({ s, refresh }: { s: MerchantSession; refresh: () => void }) {
  const { t } = useT();
  const idn = s.identity!;
  const open = s.shareRequests.find((r) => r.status === 'pending');
  const latest = s.shareRequests[0];
  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="up-verified" data-testid="verified-panel">
        <div className="row between">
          <div className="up-badge" style={{ background: 'rgba(222,186,110,.2)', color: 'var(--honey)' }}>{t.verifiedTitle}</div>
          <span className="up-sop">{idn.sopLevel === 'SOP3' ? t.levelSop3 : t.levelSop2}</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginTop: 18 }}>
          <div><div className="k">Name</div><div className="v">{idn.name}</div></div>
          <div><div className="k">{t.emiratesId}</div><div className="v num" data-testid="masked-eid">{idn.emiratesIdMasked}</div></div>
          <div><div className="k">{t.phone}</div><div className="v num">{idn.mobile ?? '-'}</div></div>
          <div><div className="k">{t.email}</div><div className="v">{idn.email ?? '-'}</div></div>
        </div>
      </section>

      <div className="up-grid">
        <section>
          <h2 className="h2" style={{ marginBottom: 6 }}>{t.shareTitle}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{t.shareLede}</p>
          {open ? <PendingShare r={open} offset={s.clockOffsetMinutes} mode={s.mode} /> : latest ? <ResolvedShare r={latest} s={s} onNew={refresh} /> : <RequestForm onSent={refresh} />}
        </section>
        <section className="stack">
          <Vault s={s} />
          {s.signingEnabled && <Signing s={s} refresh={refresh} />}
        </section>
      </div>
    </div>
  );
}

function RequestForm({ onSent }: { onSent: () => void }) {
  const { t } = useT();
  const [sel, setSel] = useState<ShareDocType[]>(['emirates_id']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (d: ShareDocType) => setSel((c) => (c.includes(d) ? c.filter((x) => x !== d) : [...c, d]));
  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      await m.post('/merchant/share-requests', { documents: sel });
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="section-title">{t.docsToShare}</div>
      <div className="up-checks">
        {SHARE_DOC_TYPES.map((d) => (
          <label key={d} className="up-check">
            <input type="checkbox" checked={sel.includes(d)} onChange={() => toggle(d)} disabled={d === 'emirates_id'} />
            <span>{SHARE_DOC_LABELS[d]}{d !== 'emirates_id' && <small>{t.optional}</small>}</span>
          </label>
        ))}
      </div>
      {err && <div className="up-callout bad" role="alert">{err}</div>}
      <button className="btn btn-dark" disabled={busy || !sel.length} onClick={send} data-testid="send-request">{t.sendRequest}</button>
    </div>
  );
}

function PendingShare({ r, offset, mode }: { r: ShareRequestView; offset: number; mode: 'mock' | 'live' }) {
  const { t } = useT();
  const link = mode === 'mock' ? `${window.location.origin}/sim/uaepass/share/${r.requestNo}` : '';
  return (
    <div className="stack">
      <ShareCard r={r} offsetMinutes={offset} />
      <div className="card row between" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 14, alignItems: 'center' }}>
          <div className="up-spin" />
          <div><b>{t.waiting}</b></div>
        </div>
        {link && (
          <div className="row" style={{ gap: 16, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}><Qr value={link} /><div className="up-note" style={{ marginTop: 6, maxWidth: 140 }}>{t.scanQr}</div></div>
            <a className="btn btn-honey" href={link} target="_blank" rel="noreferrer" data-testid="open-app">{t.openApp}</a>
          </div>
        )}
      </div>
    </div>
  );
}

function ResolvedShare({ r, s, onNew }: { r: ShareRequestView; s: MerchantSession; onNew: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const again = async () => {
    setBusy(true);
    try {
      await m.post('/merchant/share-requests', { documents: r.mandatoryDocuments.map((d) => d.type) });
      onNew();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <ShareCard r={r} offsetMinutes={s.clockOffsetMinutes} />
      {r.status !== 'shared' && <button className="btn btn-dark" onClick={again} disabled={busy} data-testid="new-request">{t.sendAnother}</button>}
    </div>
  );
}

function Vault({ s }: { s: MerchantSession }) {
  const { t } = useT();
  return (
    <div className="card" data-testid="vault">
      <div className="h3">{t.vaultTitle}</div>
      <p className="muted small" style={{ marginTop: 6 }}>{t.vaultLede}</p>
      {s.vault.length === 0 ? <div className="muted small">{t.noneYet}</div> : (
        <table className="up-table">
          <thead><tr><th>{t.mandatory}</th><th>{t.validUntil}</th></tr></thead>
          <tbody>
            {s.vault.map((d) => (
              <tr key={d.id}>
                <td><b>{d.label}</b><div className="small muted">{d.issuer}</div><div style={{ marginTop: 6 }}><span className="up-badge">{t.issuerVerified}</span> <span className="small muted num">{d.requestNo}</span></div></td>
                <td className="num">{d.expiresOn ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Signing({ s, refresh }: { s: MerchantSession; refresh: () => void }) {
  const { t } = useT();
  const latest: SigningView | undefined = s.signing[0];
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);
  const go = async () => {
    setBusy(true);
    try {
      const out = await m.post<{ signUrl: string }>('/merchant/signing');
      startedRef.current = true;
      window.location.href = out.signUrl;
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const label = !latest ? null : latest.status === 'signed' ? t.signedTitle : latest.status === 'pending' ? t.signWaiting : latest.status === 'expired' ? t.signExpired : t.signDeclined;
  return (
    <div className="card" data-testid="signing">
      <div className="h3">{t.signTitle}</div>
      <p className="muted small" style={{ marginTop: 6 }}>{t.signLede}</p>
      <div className="up-item" style={{ background: 'var(--paper)', borderRadius: 14, margin: '10px 0' }}>
        <div className="up-item-t">{t.reviewAgreement}</div>
        <div className="up-item-s">{latest?.documentName ?? 'Merchant services agreement.pdf'}</div>
      </div>
      {latest && (
        <div className={`up-callout ${latest.status === 'signed' ? 'ok' : latest.status === 'pending' ? 'warn' : 'bad'}`} data-testid="signing-state" data-status={latest.status}>
          <b>{label}</b>
          {latest.status === 'signed' && <div className="small">{t.signedSub} &middot; {fmtGst(latest.signedAt)}</div>}
        </div>
      )}
      {(!latest || latest.status === 'expired' || latest.status === 'declined') && <button className="up-btn-uae" style={{ height: 46, marginTop: 12 }} onClick={go} disabled={busy} data-testid="sign-uaepass"><span className="glyph">UAE<br />PASS</span>{latest ? t.startAgain : t.signWith}</button>}
    </div>
  );
}
