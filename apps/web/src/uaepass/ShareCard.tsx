import { useEffect, useState } from 'react';
import type { ShareRequestView } from '@moneybee/shared';
import { fmtGst, useT } from './i18n';

/** Share request in the structure of the UAE PASS sharing screens: header card, mandatory documents, personal details. */
export function useCountdown(expiresAt: string, offsetMinutes = 0, active = true): string {
  const [now, setNow] = useState(() => Date.now() + offsetMinutes * 60_000);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() + offsetMinutes * 60_000), 1000);
    return () => clearInterval(id);
  }, [offsetMinutes, active]);
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function titleFor(status: ShareRequestView['status'], t: ReturnType<typeof useT>['t']) {
  return status === 'shared' ? t.sharedTitle : status === 'expired' ? t.expiredTitle : status === 'declined' ? t.declinedTitle : t.waiting;
}

export function ShareCard({ r, offsetMinutes = 0, variant = 'portal', showTitle = true }: { r: ShareRequestView; offsetMinutes?: number; variant?: 'portal' | 'app'; showTitle?: boolean }) {
  const { t } = useT();
  const left = useCountdown(r.expiresAt, offsetMinutes, r.status === 'pending');
  const tagFor = (s: 'requested' | 'shared' | 'declined') => (s === 'shared' ? t.shared : s === 'declined' ? t.declined : t.requested);
  return (
    <section className={`up-share ${variant} ${r.status}`} data-testid="share-card" data-status={r.status}>
      {showTitle && <h3 className="up-share-title" data-testid="share-title">{titleFor(r.status, t)}</h3>}
      <div className="up-head">
        <div className="up-head-top">
          <div>
            <div className="up-sub">{t.requestedBy}</div>
            <div className="up-provider">{r.providerName}</div>
          </div>
          <div className="up-mark" aria-hidden><span>mb</span></div>
        </div>
        <dl className="up-meta">
          <div><dt><i className="up-ico i" />{t.purpose}:</dt><dd>{r.purpose}</dd></div>
          <div><dt><i className="up-ico c" />{t.requestedOn}:</dt><dd>{fmtGst(r.requestedAt)}</dd></div>
          {r.status === 'shared' && <div><dt><i className="up-ico s" />{t.sharedOn}:</dt><dd>{fmtGst(r.sharedAt)}</dd></div>}
          {r.status === 'pending' && <div><dt><i className="up-ico h" />{t.expiresIn}:</dt><dd className="num" data-testid="countdown">{left}</dd></div>}
          {r.status === 'expired' && <div><dt><i className="up-ico h" />{t.expiredOn}:</dt><dd>{fmtGst(r.expiresAt)}</dd></div>}
          {r.status === 'declined' && <div><dt><i className="up-ico x" />{t.declinedOn}:</dt><dd>{fmtGst(r.declinedAt)}</dd></div>}
        </dl>
        <div className="up-reqno"><span>{t.requestNo}</span> <b className="num">{r.requestNo}</b></div>
      </div>

      <h4 className="up-h4">{t.mandatory}</h4>
      <div className="up-list">
        {r.mandatoryDocuments.map((d) => (
          <div key={d.type} className="up-item">
            {d.status !== 'requested' || r.status === 'pending' ? <span className={`up-tag ${d.status}`}>{r.status === 'pending' && d.status === 'requested' ? t.requested : tagFor(d.status)}</span> : null}
            <div className="up-item-t">{d.label}</div>
            <div className="up-item-s">{d.issuerName}</div>
          </div>
        ))}
      </div>

      <h4 className="up-h4">{t.personal}</h4>
      <div className="up-list">
        <div className="up-row"><span>{t.email}</span><b>{r.personalDetails.email ?? '-'}</b></div>
        <div className="up-row"><span>{t.phone}</span><b className="num">{r.personalDetails.phone ?? '-'}</b></div>
      </div>
    </section>
  );
}
