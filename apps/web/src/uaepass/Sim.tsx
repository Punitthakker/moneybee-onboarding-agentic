import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ShareRequestView } from '@moneybee/shared';
import { m } from './client';
import { LangProvider, LangToggle, useT } from './i18n';
import { ShareCard } from './ShareCard';
import './uaepass.css';

/** The UAE PASS app, SIMULATED. Every screen carries a strip saying so. */
function Phone({ children, actions, back }: { children: React.ReactNode; actions?: React.ReactNode; back?: boolean }) {
  const { t } = useT();
  return (
    <div className="sim-phone" data-testid="sim-phone">
      <div className="up-sim-strip">{t.simulated}</div>
      <div className="sim-bar"><span>7:32</span><span>5G ▮▮▮</span></div>
      <div className="sim-nav">{back !== false && <span className="back" aria-hidden>‹</span>}</div>
      <div className="sim-body">{children}</div>
      {actions && <div className="sim-actions">{actions}</div>}
    </div>
  );
}

function Clock({ onChange }: { onChange: () => void }) {
  const [off, setOff] = useState<number | null>(null);
  const load = () => m.sim.get<{ offsetMinutes: number }>('/mock/uaepass/clock').then((r) => setOff(r.offsetMinutes)).catch(() => undefined);
  useEffect(() => void load(), []);
  const adv = async (mins: number) => {
    await m.sim.post('/mock/uaepass/clock', mins ? { advanceMinutes: mins } : { reset: true });
    await load();
    onChange();
  };
  return (
    <div className="card sim-side">
      <div className="section-title">Demo controls</div>
      <div className="small muted">Simulated clock offset: <b className="num">+{off ?? 0} min</b>. Move it past a request expiry to show the expired screen.</div>
      <button className="btn btn-sm" onClick={() => adv(31)} data-testid="advance-clock">Advance 31 minutes</button>
      <button className="btn btn-sm btn-ghost" onClick={() => adv(0)}>Reset clock</button>
    </div>
  );
}

export function SimLogin() {
  return <LangProvider><SimLoginInner /></LangProvider>;
}
function SimLoginInner() {
  const [sp] = useSearchParams();
  const state = sp.get('state') ?? '';
  const [personas, setPersonas] = useState<{ id: string; label: string; note: string }[]>([]);
  const [pick, setPick] = useState('sop3');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { m.sim.get<{ personas: typeof personas }>('/mock/uaepass/personas').then((r) => setPersonas(r.personas)).catch((e) => setErr((e as Error).message)); }, []);
  const go = async (cancel = false) => {
    setBusy(true);
    try {
      const out = await m.sim.post<{ redirectUrl: string }>('/mock/uaepass/authorize', { state, persona: pick, cancel });
      window.location.href = out.redirectUrl;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="sim-page"><div className="sim-stage">
      <Phone back={false} actions={<><button className="sim-btn p" disabled={busy || !state} onClick={() => go(false)} data-testid="sim-signin">Sign in</button><button className="sim-btn s" disabled={busy} onClick={() => go(true)}>Cancel</button></>}>
        <div style={{ padding: '6px 18px' }}>
          <h2 style={{ fontSize: 26, fontWeight: 500, margin: '4px 0 6px' }}>Sign in to MoneyBee</h2>
          <p className="small muted" style={{ marginTop: 0 }}>MoneyBee wants to verify who you are. Pick a demo user.</p>
          <div className="stack" style={{ gap: 10 }}>
            {personas.map((p) => (
              <label key={p.id} className={`sim-persona ${pick === p.id ? 'on' : ''}`}>
                <input type="radio" name="persona" checked={pick === p.id} onChange={() => setPick(p.id)} />
                <span><b>{p.label}</b><small>{p.note}</small></span>
              </label>
            ))}
          </div>
          {err && <div className="up-callout bad" style={{ marginTop: 12 }} role="alert">{err}</div>}
        </div>
      </Phone>
    </div></div>
  );
}

export function SimShare() {
  return <LangProvider><SimShareInner /></LangProvider>;
}
function SimShareInner() {
  const { no = '' } = useParams();
  const { t, lang } = useT();
  const [r, setR] = useState<ShareRequestView | null>(null);
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState('');
  const load = () => m.sim.get<{ request: ShareRequestView }>(`/mock/uaepass/share/${no}`).then((x) => { setR(x.request); setErr(''); }).catch((e) => setErr((e as Error).message));
  const loadClock = () => m.sim.get<{ offsetMinutes: number }>('/mock/uaepass/clock').then((x) => setOffset(x.offsetMinutes)).catch(() => undefined);
  useEffect(() => { load(); loadClock(); const id = setInterval(load, 3000); return () => clearInterval(id); }, [no]);
  const decide = async (decision: 'approve' | 'decline') => {
    try {
      const out = await m.sim.post<{ request: ShareRequestView }>(`/mock/uaepass/share/${no}/decision`, { decision });
      setR(out.request);
    } catch (e) {
      setErr((e as Error).message);
      load();
    }
  };
  const pending = r?.status === 'pending';
  return (
    <div className="sim-page"><div className="sim-stage">
      <Phone actions={pending ? <><button className="sim-btn p" onClick={() => decide('approve')} data-testid="sim-approve">{lang === 'ar' ? 'موافقة ومشاركة' : 'Approve and share'}</button><button className="sim-btn s" onClick={() => decide('decline')} data-testid="sim-decline">{lang === 'ar' ? 'رفض' : 'Decline'}</button></> : undefined}>
        {r ? <ShareCard r={r} offsetMinutes={offset} variant="app" /> : <div style={{ padding: 24 }}>{err || t.loading}</div>}
        {err && r && <div className="up-callout bad" style={{ margin: '0 18px' }}>{err}</div>}
      </Phone>
      <div className="stack sim-side"><LangToggle /><Clock onChange={() => { load(); loadClock(); }} /></div>
    </div></div>
  );
}

export function SimSign() {
  return <LangProvider><SimSignInner /></LangProvider>;
}
function SimSignInner() {
  const [sp] = useSearchParams();
  const tx = sp.get('tx') ?? '';
  const { t } = useT();
  const [s, setS] = useState<{ id: string; documentName: string; documentSha256: string; status: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState('');
  const load = () => m.sim.get<{ signing: NonNullable<typeof s> }>(`/mock/uaepass/sign/${encodeURIComponent(tx)}`).then((x) => { setS(x.signing); setErr(''); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [tx]);
  const decide = async (decision: 'sign' | 'decline') => {
    try {
      await m.sim.post(`/mock/uaepass/sign/${encodeURIComponent(tx)}/decision`, { decision });
    } catch (e) {
      setErr((e as Error).message);
    }
    load();
  };
  const done = s && s.status !== 'pending';
  const ok = s?.status === 'signed';
  return (
    <div className="sim-page"><div className="sim-stage">
      <Phone actions={done ? <a className="sim-btn p" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} href="/m" data-testid="sim-back">Back to MoneyBee</a> : s ? <><button className="sim-btn p" onClick={() => decide('sign')} data-testid="sim-sign">Sign document</button><button className="sim-btn s" onClick={() => decide('decline')}>Decline</button></> : undefined}>
        {!s ? <div style={{ padding: 24 }}>{err || t.loading}</div> : done ? (
          <div className={`sim-done ${ok ? '' : 'bad'}`} data-testid="sim-sign-result" data-status={s.status}>
            <div className="tick">{ok ? '✓' : '✕'}</div>
            <h2>{ok ? 'Document signed' : s.status === 'expired' ? 'Signature request expired' : 'Signature declined'}</h2>
            <p className="small muted">{s.documentName}</p>
          </div>
        ) : (
          <div style={{ padding: '6px 0' }}>
            <h2 style={{ fontSize: 26, fontWeight: 500, margin: '4px 18px 6px' }}>Signature request</h2>
            <p className="small muted" style={{ margin: '0 18px 12px' }}>MoneyBee asks you to sign this document with your UAE PASS signature.</p>
            <div className="sim-doc"><b>{s.documentName}</b><div className="small muted" style={{ marginTop: 6 }}>SHA-256</div><div className="h">{s.documentSha256}</div></div>
          </div>
        )}
        {err && <div className="up-callout bad" style={{ margin: '12px 18px' }}>{err}</div>}
      </Phone>
      <div className="stack sim-side"><Clock onChange={load} /></div>
    </div></div>
  );
}
