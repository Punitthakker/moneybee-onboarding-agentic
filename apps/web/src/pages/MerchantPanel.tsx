import { useState } from 'react';
import { api, can } from '../api';
import { useMe } from '../App';
import { toast } from '../components/ui';
import { DOC_LABELS, type Case } from '../types';

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

/** Ops view of the self-serve portal on a case: who the merchant is, their answers, and a button to email them an upload link. */
export function MerchantPanel({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const me = useMe();
  const pt = c.portal;
  const [email, setEmail] = useState(pt?.contact.email ?? '');
  const [name, setName] = useState(pt?.contact.name ?? '');
  const [busy, setBusy] = useState(false);
  const final = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ sentTo: string; expiresAt: string }>(`/cases/${c.id}/portal-link`, { email: email || undefined, name: name || undefined });
      toast(`Upload link emailed to ${r.sentTo}, valid until ${when(r.expiresAt)}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const slotted = (pt?.uploads ?? []).filter((u) => u.slot).length;
  return (
    <div className="stack" data-testid="merchant-panel">
      <div className="card">
        <div className="h3">Merchant portal</div>
        {pt ? (
          <table className="table" style={{ marginTop: 10 }}>
            <tbody>
              <tr><td className="muted">Started from</td><td>{pt.source === 'merchant_portal' ? 'Merchant started it in the portal' : 'Link sent by your team'}</td></tr>
              <tr><td className="muted">Contact</td><td>{pt.contact.name} &lt;{pt.contact.email ?? pt.contact.emailMasked}&gt;{pt.contact.mobile ? `, ${pt.contact.mobile}` : ''}</td></tr>
              <tr><td className="muted">Language</td><td>{pt.locale === 'ar' ? 'Arabic' : 'English'}</td></tr>
              <tr><td className="muted">Sent for review</td><td>{when(pt.submittedAt)}</td></tr>
              <tr><td className="muted">Last seen</td><td>{when(pt.lastSeenAt)}</td></tr>
              <tr><td className="muted">Current link</td><td>{pt.link ? `sent ${when(pt.link.sentAt)}, valid until ${when(pt.link.expiresAt)}` : '-'}</td></tr>
              <tr><td className="muted">Uploads</td><td>{pt.uploads.length} file(s), {slotted} placed against a checklist item</td></tr>
              {Object.entries(pt.answers).map(([k, v]) => <tr key={k}><td className="muted">{k.replace(/_/g, ' ')}</td><td>{typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}</td></tr>)}
            </tbody>
          </table>
        ) : <p className="muted small" style={{ marginTop: 8 }}>This case was created by your team. Email the merchant a secure link to upload documents themselves.</p>}
        {c.checklist.some((i) => i.reason) && (
          <div style={{ marginTop: 12 }}>
            <div className="small muted">Required because of the merchant's answers</div>
            <ul className="small">{c.checklist.filter((i) => i.reason).map((i) => <li key={i.docType}>{DOC_LABELS[i.docType] ?? i.docType}: {i.reason}</li>)}</ul>
          </div>
        )}
      </div>
      {can.write(me) && !final && (
        <div className="card">
          <div className="h3">{pt ? 'Send a new upload link' : 'Send an upload link'}</div>
          <p className="muted small">The merchant gets a private link to the upload portal in your brand. A new link replaces the previous one.</p>
          <div className="field"><label htmlFor="m-name">Merchant name</label><input id="m-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="m-email">Merchant email</label><input id="m-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn btn-dark btn-sm" disabled={busy || (!email && !pt)} onClick={send}>Email upload link</button>
        </div>
      )}
    </div>
  );
}
