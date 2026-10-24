import { useState } from 'react';
import { api, can } from '../api';
import { useMe } from '../App';
import { toast } from '../components/ui';
import type { Case } from '../types';
import { LangProvider, fmtGst, useT } from './i18n';
import { ShareCard } from './ShareCard';
import './uaepass.css';

/** Ops view of the UAE PASS journey on a case: invite link, verified identity, share requests, signing, issuer-verified documents. */
export function UaePassPanel({ c, onChanged }: { c: Case; onChanged: () => void }) {
  return <LangProvider><Inner c={c} onChanged={onChanged} /></LangProvider>;
}

function Inner({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const me = useMe();
  const { t } = useT();
  const u = c.uaepass;
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const final = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ url: string; expiresAt: string }>(`/cases/${c.id}/uaepass/invite`);
      setLink(r);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const vault = c.documents.filter((d) => d.provenance === 'issuer_verified');
  return (
    <div className="stack up-ops" data-testid="uaepass-panel">
      <div className="card">
        <div className="row between">
          <div>
            <div className="h3">UAE PASS</div>
            <div className="muted small">Merchant sign-in, document sharing and signing. Documents shared here count as issuer-verified evidence and still go through the verifier.</div>
          </div>
          {can.write(me) && !final && <button className="btn btn-dark btn-sm" onClick={create} disabled={busy} data-testid="create-invite">{u?.inviteExpiresAt ? 'New merchant link' : 'Create merchant link'}</button>}
        </div>
        {link && (
          <div className="banner ok" style={{ marginTop: 14 }} data-testid="invite-link">
            <div><b>Merchant link (shown once, expires {fmtGst(link.expiresAt)})</b></div>
            <div style={{ marginTop: 6 }}><code>{link.url}</code></div>
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => { void navigator.clipboard?.writeText(link.url); toast('Link copied'); }}>Copy link</button>
          </div>
        )}
        {!link && u?.inviteExpiresAt && <div className="muted small" style={{ marginTop: 10 }}>A merchant link was issued and expires {fmtGst(u.inviteExpiresAt)}. Links are not stored in readable form, so create a new one to resend.</div>}
      </div>

      <div className="card">
        <div className="section-title">Verified identity</div>
        {u?.identity ? (
          <>
            <div className="row-k"><span>Name</span><b>{u.identity.name}</b></div>
            <div className="row-k"><span>Emirates ID</span><b className="num">{u.identity.emiratesIdMasked}</b></div>
            <div className="row-k"><span>Account level</span><b>{u.identity.sopLevel}</b></div>
            <div className="row-k"><span>Verified</span><span>{fmtGst(u.identity.verifiedAt)} <span className="up-prov">{u.identity.provider === 'mock' ? 'SIMULATED' : 'LIVE'}</span></span></div>
          </>
        ) : <div className="muted small">The merchant has not signed in with UAE PASS yet.</div>}
      </div>

      <div className="card">
        <div className="section-title">Share requests</div>
        {!u?.shareRequests.length ? <div className="muted small">No requests yet.</div> : (
          <div className="reqs">{u.shareRequests.map((r) => <ShareCard key={r.requestNo} r={r} />)}</div>
        )}
      </div>

      {!!u?.signing.length && (
        <div className="card">
          <div className="section-title">Signing</div>
          {u.signing.map((s) => (
            <div key={s.id} className="row-k"><span>{s.documentName}</span><span><b>{s.status}</b>{s.signedAt ? ` - ${fmtGst(s.signedAt)}` : ''}{s.signatureValid ? ' - signature valid' : ''} <span className="up-prov">{s.provider === 'mock' ? 'SIMULATED' : 'LIVE'}</span></span></div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="section-title">Issuer-verified documents</div>
        {!vault.length ? <div className="muted small">{t.noneYet}</div> : (
          <table className="up-table"><tbody>
            {vault.map((d) => (
              <tr key={d.id}><td><b>{d.docType.replace(/_/g, ' ')}</b><div className="small muted">{d.issuingAuthority}</div></td><td><span className="up-badge">{t.issuerVerified}</span></td><td className="num small">{d.uaepassRequestNo}</td><td><span className={`pill ${d.verifiedStatus === 'VERIFIED' ? 'ok' : d.verifiedStatus === 'FLAGGED' ? 'warn' : ''}`}>{d.verifiedStatus.toLowerCase()}</span></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </div>
  );
}
