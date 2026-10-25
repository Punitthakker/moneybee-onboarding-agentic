import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, can, type Role } from '../api';
import { useMe, useTenant } from '../App';
import { MockBanner, toast } from '../components/ui';

interface SettingsRes { tokenTtlHours: number; webhookUrl: string; webhookSecretSet: boolean; llmMode: string; screeningProvider: string; screeningIsMock: boolean; model: string }
interface PolicyRes { version: number; base: Record<string, unknown>; acquirers: Record<string, unknown>[]; by: string; at: string; note: string }
interface UserRow { id: string; email: string; name: string; role: Role; active: boolean }

export function Settings() {
  const me = useMe();
  const admin = can.admin(me);
  // global token, webhook and policy settings belong to the platform tenant; partner admins see them read-only
  const platform = useTenant()?.kind === 'platform';
  const [tab, setTab] = useState<'policy' | 'acquirers' | 'tokens' | 'users'>('policy');
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <p className="eyebrow">Settings</p>
        <h1 className="h1">Policy and controls.<span className="grey">Every change is versioned.</span></h1>
      </div>
      {!admin && <div className="banner warn">Read only. Only an ADMIN can change settings.</div>}
      <div className="tabs">
        {([['policy', 'Base policy'], ['acquirers', 'Acquirer overrides'], ['tokens', 'Tokens and webhook'], ['users', 'Users and roles']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {admin && !platform && <div className="banner warn">Policies, acquirers, tokens and webhook are managed by MoneyBee for all partners. You can manage your own users.</div>}
      {(tab === 'policy' || tab === 'acquirers') && <PolicyEditor which={tab} admin={admin && platform} />}
      {tab === 'tokens' && <TokenSettings admin={admin && platform} />}
      {tab === 'users' && (admin ? <Users /> : <p className="muted">Admins manage users.</p>)}
    </div>
  );
}

function PolicyEditor({ which, admin }: { which: 'policy' | 'acquirers'; admin: boolean }) {
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['policy'], queryFn: () => api.get<PolicyRes>('/settings/policy') });
  const v = useQuery({ queryKey: ['policy-versions'], queryFn: () => api.get<{ versions: { version: number; by: string; at: string; note: string }[] }>('/settings/policy/versions') });
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (p.data) setText(JSON.stringify(which === 'policy' ? p.data.base : p.data.acquirers, null, 2));
  }, [p.data, which]);
  if (!p.data) return <div className="muted">Loading</div>;
  const base = p.data.base as { uboThresholdPct: number; confidenceThreshold: number; docExpiryWarnDays: number };
  const save = async () => {
    try {
      const parsed = JSON.parse(text);
      const body = which === 'policy' ? { base: parsed, acquirers: p.data!.acquirers, note } : { base: p.data!.base, acquirers: parsed, note };
      const r = await api.put<{ version: number }>('/settings/policy', body);
      toast(`Saved as policy version ${r.version}`);
      setNote('');
      qc.invalidateQueries({ queryKey: ['policy'] });
      qc.invalidateQueries({ queryKey: ['policy-versions'] });
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Invalid JSON' : (e as Error).message);
    }
  };
  return (
    <div className="ws" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(260px,340px)' }}>
      <div className="col">
        {which === 'policy' && (
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
            <div className="kpi"><small>UBO threshold</small><b>{base.uboThresholdPct}%</b></div>
            <div className="kpi"><small>Confidence threshold</small><b>{Math.round(base.confidenceThreshold * 100)}%</b></div>
            <div className="kpi dark"><small>Expiry warning</small><b>{base.docExpiryWarnDays}d</b></div>
          </div>
        )}
        <div className="card">
          <div className="row between"><h3 className="h3">{which === 'policy' ? 'Base policy' : 'Acquirer overrides (examples)'}</h3><span className="mono small">v{p.data.version}</span></div>
          <p className="muted small">Checklists per entity type, thresholds and MCC risk tiers. Validated with zod on save. Values are examples to be set by compliance.</p>
          <textarea className="textarea mono" style={{ minHeight: 420, fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} readOnly={!admin} aria-label="Policy JSON" />
          {admin && (
            <div className="row" style={{ marginTop: 10 }}>
              <input className="input" style={{ maxWidth: 420 }} placeholder="Change note (required)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-dark" disabled={note.trim().length < 3} onClick={save}>Save new version</button>
            </div>
          )}
        </div>
      </div>
      <div className="col">
        <div className="card card-paper">
          <h3 className="h3">Version history</h3>
          {v.data?.versions.map((x) => <div key={x.version} className="small" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}><span className="mono">v{x.version}</span> · {x.by}<div className="muted">{x.note}</div><div className="tiny muted">{new Date(x.at).toLocaleString()}</div></div>)}
        </div>
      </div>
    </div>
  );
}

function TokenSettings({ admin }: { admin: boolean }) {
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsRes>('/settings'), enabled: admin });
  const dead = useQuery({ queryKey: ['dead'], queryFn: () => api.get<{ deliveries: { id: string; caseId: string; attempts: number; lastError?: string; lastStatusCode?: number; url: string }[] }>('/webhooks/dead') });
  const [ttl, setTtl] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  useEffect(() => {
    if (s.data) {
      setTtl(String(s.data.tokenTtlHours));
      setUrl(s.data.webhookUrl);
    }
  }, [s.data]);
  const save = async () => {
    try {
      await api.put('/settings', { tokenTtlHours: Number(ttl), webhookUrl: url, ...(secret ? { webhookSecret: secret } : {}) });
      setSecret('');
      toast('Settings saved');
      s.refetch();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="stack">
      {admin && s.data && (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="chip">LLM: {s.data.llmMode} · {s.data.model}</span>
            <span className="chip">screening: {s.data.screeningProvider}</span>
          </div>
          {s.data.screeningIsMock && <MockBanner what="screening provider configured" />}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', marginTop: 14 }}>
            <div className="field"><label>Token TTL (hours)</label><input className="input mono" value={ttl} onChange={(e) => setTtl(e.target.value)} inputMode="numeric" /></div>
            <div className="field"><label>Webhook URL</label><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-payment-service/hooks/onboarding" /></div>
            <div className="field"><label>Webhook secret {s.data.webhookSecretSet ? '(set)' : '(not set)'}</label><input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Leave empty to keep" /></div>
          </div>
          <button className="btn btn-dark" style={{ marginTop: 12 }} onClick={save}>Save</button>
          <p className="small muted">Deliveries are signed with HMAC-SHA256 over "timestamp.body" in X-MoneyBee-Signature, with X-MoneyBee-Timestamp. Receivers should reject timestamps older than 5 minutes.</p>
        </div>
      )}
      <div className="card">
        <h3 className="h3">Dead-letter webhooks</h3>
        {!dead.data?.deliveries.length ? <p className="muted small">None.</p> : dead.data.deliveries.map((d) => (
          <div key={d.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
            <div className="small"><span className="mono">{d.id.slice(0, 8)}</span> · case <span className="mono">{d.caseId.slice(0, 8)}</span> · {d.attempts} attempts · {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : d.lastError}</div>
            <button className="btn btn-sm" onClick={async () => { await api.post(`/webhooks/${d.id}/retry`); toast('Retry queued'); dead.refetch(); }}>Retry</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Users() {
  const u = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: UserRow[] }>('/users') });
  const [f, setF] = useState({ email: '', name: '', role: 'UNDERWRITER' as Role, password: '' });
  const create = async () => {
    try {
      await api.post('/users', f);
      toast('User created');
      setF({ email: '', name: '', role: 'UNDERWRITER', password: '' });
      u.refetch();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="stack">
      <div className="card">
        <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead>
          <tbody>{u.data?.users.map((x) => (
            <tr key={x.id}>
              <td>{x.name}</td><td className="mono small">{x.email}</td>
              <td><select className="select" style={{ height: 34, maxWidth: 200 }} value={x.role} onChange={async (e) => { await api.patch(`/users/${x.id}`, { role: e.target.value }); u.refetch(); }}>{['ADMIN', 'UNDERWRITER', 'SECOND_REVIEWER', 'VIEWER'].map((r) => <option key={r}>{r}</option>)}</select></td>
              <td><input type="checkbox" checked={x.active} aria-label="active" onChange={async (e) => { await api.patch(`/users/${x.id}`, { active: e.target.checked }); u.refetch(); }} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card card-paper">
        <h3 className="h3">Add user</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', marginTop: 10 }}>
          <input className="input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{['ADMIN', 'UNDERWRITER', 'SECOND_REVIEWER', 'VIEWER'].map((r) => <option key={r}>{r}</option>)}</select>
          <input className="input" type="password" placeholder="Password (12+ chars)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <button className="btn btn-dark" style={{ marginTop: 10 }} onClick={create}>Create user</button>
      </div>
    </div>
  );
}
