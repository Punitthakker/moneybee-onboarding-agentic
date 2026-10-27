import { useState } from 'react';
import { api, can } from '../api';
import { useMe } from '../App';
import { toast } from '../components/ui';
import type { Case } from '../types';
import { useI18n } from '../i18n';


/** Ops view of the self-serve portal on a case: who the merchant is, their answers, and a button to email them an upload link. */
export function MerchantPanel({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const me = useMe();
  const { t, date, doc, err } = useI18n();
  const when = (iso?: string) => (iso ? date(iso) : '-');
  const pt = c.portal;
  const [email, setEmail] = useState(pt?.contact.email ?? '');
  const [name, setName] = useState(pt?.contact.name ?? '');
  const [busy, setBusy] = useState(false);
  const final = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ sentTo: string; expiresAt: string }>(`/cases/${c.id}/portal-link`, { email: email || undefined, name: name || undefined });
      toast(t('Upload link emailed to {to}, valid until {until}', { to: r.sentTo, until: when(r.expiresAt) }));
      onChanged();
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  };
  const slotted = (pt?.uploads ?? []).filter((u) => u.slot).length;
  return (
    <div className="stack" data-testid="merchant-panel">
      <div className="card">
        <div className="h3">{t('Merchant portal')}</div>
        {pt ? (
          <table className="table" style={{ marginTop: 10 }}>
            <tbody>
              <tr><td className="muted">{t('Started from')}</td><td>{pt.source === 'merchant_portal' ? t('Merchant started it in the portal') : t('Link sent by your team')}</td></tr>
              <tr><td className="muted">{t('Contact')}</td><td>{pt.contact.name} <span dir="ltr">&lt;{pt.contact.email ?? pt.contact.emailMasked}&gt;{pt.contact.mobile ? `, ${pt.contact.mobile}` : ''}</span></td></tr>
              <tr><td className="muted">{t('Language')}</td><td>{pt.locale === 'ar' ? t('Arabic') : t('English')}</td></tr>
              <tr><td className="muted">{t('Sent for review')}</td><td>{when(pt.submittedAt)}</td></tr>
              <tr><td className="muted">{t('Last seen')}</td><td>{when(pt.lastSeenAt)}</td></tr>
              <tr><td className="muted">{t('Current link')}</td><td>{pt.link ? t('sent {a}, valid until {b}', { a: when(pt.link.sentAt), b: when(pt.link.expiresAt) }) : '-'}</td></tr>
              <tr><td className="muted">{t('Uploads')}</td><td>{t('{n} file(s), {m} placed against a checklist item', { n: pt.uploads.length, m: slotted })}</td></tr>
              {Object.entries(pt.answers).map(([k, v]) => <tr key={k}><td className="muted">{t(k) === k ? k.replace(/_/g, ' ') : t(k)}</td><td>{typeof v === 'boolean' ? t(v ? 'yes' : 'no') : v}</td></tr>)}
            </tbody>
          </table>
        ) : <p className="muted small" style={{ marginTop: 8 }}>{t('This case was created by your team. Email the merchant a secure link to upload documents themselves.')}</p>}
        {c.checklist.some((i) => i.reason) && (
          <div style={{ marginTop: 12 }}>
            <div className="small muted">{t("Required because of the merchant's answers")}</div>
            <ul className="small">{c.checklist.filter((i) => i.reason).map((i) => <li key={i.docType}>{doc(i.docType)}: {i.reason}</li>)}</ul>
          </div>
        )}
      </div>
      {can.write(me) && !final && (
        <div className="card">
          <div className="h3">{pt ? t('Send a new upload link') : t('Send an upload link')}</div>
          <p className="muted small">{t('The merchant gets a private link to the upload portal in your brand. A new link replaces the previous one.')}</p>
          <div className="field"><label htmlFor="m-name">{t('Merchant name')}</label><input id="m-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="m-email">{t('Merchant email')}</label><input id="m-email" className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn btn-dark btn-sm" disabled={busy || (!email && !pt)} onClick={send}>{t('Email upload link')}</button>
        </div>
      )}
    </div>
  );
}
