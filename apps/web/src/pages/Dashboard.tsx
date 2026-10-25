import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, can } from '../api';
import { useMe } from '../App';
import { Empty, Meter, RiskChip, StatusPill } from '../components/ui';
import { ENTITY_LABELS, ago } from '../types';

interface Row { id: string; ref: string; name: string; status: string; entityType: string; acquirerCode: string; risk: string | null; confidence: number | null; needsReview: number; owner: string; createdAt: string; run: string; docs: number }
interface Stats { casesToday: number; autoCompletedFieldsPct: number; avgTimeToPackSeconds: number; awaitingReview: number; total: number }

const STATUS_FILTERS = ['', 'AWAITING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'COMPLETED', 'REJECTED', 'RECEIVED', 'DRAFT'];

export function Dashboard() {
  const me = useMe();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [entity, setEntity] = useState('');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (entity) params.set('entityType', entity);
  const cases = useQuery({ queryKey: ['cases', q, status, entity], queryFn: () => api.get<{ cases: Row[] }>(`/cases?${params}`), refetchInterval: 5000 });
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats'), refetchInterval: 8000 });
  const s = stats.data;
  const t = s?.avgTimeToPackSeconds ?? 0;
  return (
    <div className="stack" style={{ gap: 26 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="eyebrow">Beyond the onboarding form</p>
          <h1 className="h1">Merchant cases.<span className="grey">Prepared by agents, decided by you.</span></h1>
        </div>
        {can.write(me) && <Link to="/new" className="btn btn-dark">New case</Link>}
      </div>

      <div className="kpis">
        <div className="kpi"><small>Cases today</small><b>{s?.casesToday ?? '-'}</b></div>
        <div className="kpi"><small>Fields auto-completed</small><b>{s ? `${s.autoCompletedFieldsPct}%` : '-'}</b></div>
        <div className="kpi"><small>Avg time to pack</small><b>{s ? (t < 90 ? `${t}s` : `${Math.round(t / 60)}m`) : '-'}</b></div>
        <div className="kpi dark"><small>Awaiting review</small><b>{s?.awaitingReview ?? '-'}</b></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="input" style={{ maxWidth: 320 }} placeholder="Search merchant or case ref" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ maxWidth: 230 }} aria-label="Entity type" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All entity types</option>
            {Object.entries(ENTITY_LABELS).filter(([k]) => k !== 'auto').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="row" style={{ gap: 6 }}>
            {STATUS_FILTERS.map((f) => <button key={f} className={`chip ${status === f ? 'on' : ''}`} onClick={() => setStatus(f)}>{f ? f.replace(/_/g, ' ').toLowerCase() : 'all'}</button>)}
          </div>
        </div>
        {cases.data && cases.data.cases.length === 0 ? (
          <Empty title="No cases yet">Drop a merchant folder or zip into a new case and the agents take it from there.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Merchant</th><th>Status</th><th className="hide-sm">Entity</th><th className="hide-sm">Acquirer</th><th>Risk</th><th className="hide-sm">Confidence</th><th className="hide-sm">Age</th><th className="hide-sm">Owner</th></tr>
              </thead>
              <tbody>
                {cases.data?.cases.map((c) => (
                  <tr key={c.id} className="click" tabIndex={0} onClick={() => nav(`/cases/${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/cases/${c.id}`)}>
                    <td><div style={{ fontWeight: 500 }}>{c.name}</div><div className="mono small muted">{c.ref}{c.run === 'running' || c.run === 'queued' ? ' · agents running' : ''}</div></td>
                    <td><StatusPill s={c.status} />{c.needsReview > 0 && <div className="small" style={{ color: 'var(--gold)', marginTop: 4 }}>{c.needsReview} field(s) to check</div>}</td>
                    <td className="hide-sm small">{ENTITY_LABELS[c.entityType] ?? c.entityType}</td>
                    <td className="hide-sm mono small">{c.acquirerCode}</td>
                    <td><RiskChip r={c.risk} /></td>
                    <td className="hide-sm" style={{ minWidth: 130 }}><Meter v={c.confidence} /></td>
                    <td className="hide-sm mono small">{ago(c.createdAt)}</td>
                    <td className="hide-sm small muted">{c.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
