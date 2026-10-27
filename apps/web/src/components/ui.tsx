import { useEffect, useState, type ReactNode } from 'react';
import { STATUS_TONE } from '../types';
import { useI18n } from '../i18n';

export function StatusPill({ s }: { s: string }) {
  const { status } = useI18n();
  return <span className={`pill ${STATUS_TONE[s] ?? ''}`}>{status(s)}</span>;
}
export function RiskChip({ r }: { r?: string | null }) {
  const { risk } = useI18n();
  if (!r) return <span className="muted small">-</span>;
  return <span className={`risk ${r}`}>{risk(r)}</span>;
}
export function Meter({ v, label }: { v: number | null | undefined; label?: string }) {
  if (v === null || v === undefined) return <span className="muted small">-</span>;
  const cls = v < 0.6 ? 'vlow' : v < 0.85 ? 'low' : '';
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }} title={label ?? `${Math.round(v * 100)}% confidence`}>
      <div className={`meter ${cls}`} style={{ flex: 1 }} role="meter" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="confidence"><i style={{ width: `${Math.round(v * 100)}%` }} /></div>
      <span className="num small">{Math.round(v * 100)}%</span>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty hexbg">
      <div className="hex" aria-hidden><span style={{ fontWeight: 700 }}>mb</span></div>
      <h3 className="h3" style={{ marginTop: 14 }}>{title}</h3>
      {children && <div className="muted" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}
export function MockBanner({ what }: { what: string }) {
  const { t } = useI18n();
  return <div className="banner mock" role="status">{t(`MOCK ${what.toUpperCase()} - no real external check was performed`)}</div>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3 className="h3" style={{ marginBottom: 14 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
let toastSet: ((s: string) => void) | null = null;
export const toast = (s: string) => toastSet?.(s);
export function Toaster() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    toastSet = (s) => {
      setMsg(s);
      setTimeout(() => setMsg(''), 4200);
    };
    return () => {
      toastSet = null;
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
