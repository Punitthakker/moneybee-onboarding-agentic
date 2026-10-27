import { useState } from 'react';
import { api } from '../api';
import { PoweredByMoneyBee, TenantMark, type PublicTenant } from '../tenant';
import { LangToggle, useI18n } from '../i18n';

export function Login({ onDone, tenant }: { onDone: () => void; tenant?: PublicTenant | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { t, err: errText, lang } = useI18n();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/login', { email, password });
      onDone();
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login hexbg">
      <form className="card" style={{ width: 'min(440px,100%)', padding: 32, boxShadow: 'var(--shadow-soft)' }} onSubmit={submit}>
        <div className="row between" style={{ marginBottom: 26, flexWrap: 'nowrap' }}><TenantMark tenant={tenant} /><LangToggle /></div>
        <p className="eyebrow">{t('Merchant onboarding, done by agents')}</p>
        <h1 className="h2">{t('Sign in.')}<span className="grey">{t('Review what the agents prepared.')}</span></h1>
        <div className="stack" style={{ marginTop: 24 }}>
          <div className="field"><label htmlFor="email">{t('Email')}</label><input id="email" className="input" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">{t('Password')}</label><input id="pw" className="input" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {err && <div className="banner bad" role="alert">{err}</div>}
          <button className="btn btn-dark" disabled={busy} type="submit">{busy ? t('Signing in') : t('Sign in')}</button>
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{t('Applying as a merchant?')} <a href={`/apply${tenant && tenant.kind !== 'platform' ? `?tenant=${encodeURIComponent(tenant.id)}` : ''}`}>{t('Open the merchant portal')}</a></p>
        </div>
      </form>
      <PoweredByMoneyBee locale={lang} />
    </div>
  );
}
