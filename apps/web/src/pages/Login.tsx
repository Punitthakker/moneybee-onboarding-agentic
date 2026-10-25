import { useState } from 'react';
import { api } from '../api';
import { PoweredByMoneyBee, TenantMark, type PublicTenant } from '../tenant';

export function Login({ onDone, tenant }: { onDone: () => void; tenant?: PublicTenant | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/login', { email, password });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login hexbg">
      <form className="card" style={{ width: 'min(440px,100%)', padding: 32, boxShadow: 'var(--shadow-soft)' }} onSubmit={submit}>
        <div style={{ marginBottom: 26 }}><TenantMark tenant={tenant} /></div>
        <p className="eyebrow">Merchant onboarding, done by agents</p>
        <h1 className="h2">Sign in.<span className="grey">Review what the agents prepared.</span></h1>
        <div className="stack" style={{ marginTop: 24 }}>
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {err && <div className="banner bad" role="alert">{err}</div>}
          <button className="btn btn-dark" disabled={busy} type="submit">{busy ? 'Signing in' : 'Sign in'}</button>
        </div>
      </form>
      <PoweredByMoneyBee />
    </div>
  );
}
