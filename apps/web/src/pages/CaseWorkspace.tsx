import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, can } from '../api';
import { useMe } from '../App';
import { DocViewer } from '../components/DocViewer';
import { OwnershipGraph } from '../components/OwnershipGraph';
import { UaePassPanel } from '../uaepass/OpsPanel';
import { MerchantPanel } from './MerchantPanel';
import { Empty, Meter, MockBanner, Modal, RiskChip, StatusPill, toast } from '../components/ui';
import { SECTIONS, fmt, type Case, type CaseField, type CaseResponse, type Person, type Trace } from '../types';
import { useI18n } from '../i18n';

type Tab = 'fields' | 'ownership' | 'risk' | 'output' | 'gaps' | 'merchant' | 'uaepass';

export function CaseWorkspace() {
  const { id = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const { t, doc: docName, entity, step, msg, err, status: statusName } = useI18n();
  const q = useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseResponse>(`/cases/${id}`), refetchInterval: (qq) => (qq.state.data?.case.run?.state === 'running' || qq.state.data?.case.run?.state === 'queued' ? 2500 : false) });
  const [live, setLive] = useState<Trace[]>([]);
  const [tab, setTab] = useState<Tab>('fields');
  const [sel, setSel] = useState<{ docId?: string; page?: number; snippet?: string }>({});

  // SSE: live agent timeline
  useEffect(() => {
    const es = new EventSource(`/api/v1/cases/${id}/events`, { withCredentials: true });
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'trace') setLive((cur) => [...cur.filter((t) => t.id !== e.trace.id), e.trace]);
      if (e.type === 'status' || (e.type === 'trace' && e.trace.status !== 'running') || e.type === 'run') qc.invalidateQueries({ queryKey: ['case', id] });
    };
    return () => es.close();
  }, [id, qc]);

  const data = q.data;
  const traces = useMemo(() => {
    const m = new Map<string, Trace>();
    (data?.traces ?? []).forEach((t) => m.set(t.id, t));
    live.forEach((t) => m.set(t.id, t));
    return [...m.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [data?.traces, live]);

  if (q.isLoading) return <div className="muted">{t('Loading case')}</div>;
  if (q.error || !data) return <div className="banner bad">{q.error ? err(q.error) : t('Case not found')}</div>;
  const c = data.case;
  const refresh = () => qc.invalidateQueries({ queryKey: ['case', id] });
  const doc = c.documents.find((d) => d.id === sel.docId) ?? c.documents[0];
  const file = c.files.find((f) => f.id === (doc?.fileId ?? sel.docId)) ?? c.files[0];
  const running = c.run?.state === 'running' || c.run?.state === 'queued';
  const openSource = (f?: CaseField) => {
    if (!f?.source?.docId) return;
    setSel({ docId: f.source.docId, page: f.source.page, snippet: f.source.snippet });
  };

  const run = async (from: 'classify' | 'verify' = 'classify') => {
    try {
      await api.post(`/cases/${id}/run`, { from });
      setLive([]);
      refresh();
    } catch (e) {
      toast(err(e));
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="eyebrow mono">{c.ref} · {c.acquirerCode}</p>
          <h1 className="h2">{c.legalName ?? c.name}<span className="grey">{c.entityType || (c.entityTypeRequested && c.entityTypeRequested !== 'auto') ? entity(c.entityType ?? c.entityTypeRequested) : t('Entity type pending')}</span></h1>
        </div>
        <div className="row">
          <StatusPill s={c.status} />
          <RiskChip r={c.risk?.rating} />
          {running && <span className="pill honey">{t('agents running')}</span>}
          {can.write(me) && !['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status) && (
            <>
              <UploadMore caseId={id} onDone={refresh} />
              <button className="btn btn-dark btn-sm" disabled={running || !c.files.length} onClick={() => run('classify')}>{c.run?.seq ? t('Re-run agents') : t('Run agents')}</button>
            </>
          )}
        </div>
      </div>

      {c.run?.state === 'failed' && <div className="banner bad">{t('Pipeline failed: {e}. Fix the cause (for example the token budget) and re-run.', { e: c.run.error ?? '' })}</div>}
      {c.injectionSuspected && <div className="banner warn"><b>{t('Prompt injection suspected.')}</b> {t('A document contains instruction-like text. It was treated as data, did not change any check, and is recorded as a risk signal.')}</div>}
      {data.llmIsMock && <MockBanner what="AI extraction (fixture parser)" />}

      <div className="ws">
        {/* left: documents */}
        <div className="col sticky">
          <div className="card" style={{ padding: 16 }}>
            <div className="row between"><h3 className="h3">{t('Documents')}</h3><span className="mono small muted">{t('{a} / {b} files', { a: c.documents.length, b: c.files.length })}</span></div>
            <div className="doclist" style={{ marginTop: 10 }}>
              {c.documents.length === 0 && c.files.map((f) => (
                <button key={f.id} className="docitem" onClick={() => setSel({ docId: f.id })}><span className="t">{f.name}</span></button>
              ))}
              {c.documents.map((d) => {
                const f = c.files.find((x) => x.id === d.fileId);
                return (
                  <button key={d.id} className={`docitem ${doc?.id === d.id ? 'active' : ''}`} onClick={() => setSel({ docId: d.id, page: d.pageStart })}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t">{docName(d.docType)}{d.provenance === 'issuer_verified' && <span className="up-badge" style={{ marginInlineStart: 8, height: 18, fontSize: 10.5 }}>UAE PASS</span>}</div>
                      <div className="s" dir="ltr" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>{f?.name} · p{d.pageStart}{d.pageEnd !== d.pageStart ? `-${d.pageEnd}` : ''} · {d.language}</div>
                    </div>
                    <span className={`pill ${d.verifiedStatus === 'VERIFIED' ? 'ok' : d.verifiedStatus === 'EXPIRED' ? 'bad' : d.verifiedStatus === 'FLAGGED' ? 'warn' : ''}`}>{statusName(d.verifiedStatus).toLowerCase()}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <DocViewer caseId={id} file={file} page={sel.page ?? doc?.pageStart ?? 1} snippet={sel.docId === doc?.id ? sel.snippet : undefined} />
          <Checklist c={c} />
        </div>

        {/* centre */}
        <div className="col">
          <div className="tabs" role="tablist">
            {([['fields', t('Fields')], ['ownership', t('Ownership')], ['risk', t('Risk and decision')], ['output', t('Output')], ['gaps', `${t('Gaps')}${c.gaps?.items.length ? ` (${c.gaps.items.length})` : ''}`], ['merchant', t('Merchant portal')], ['uaepass', t('UAE PASS')]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'fields' && <Fields c={c} threshold={data.policy.confidenceThreshold} onSource={openSource} onChanged={refresh} />}
          {tab === 'ownership' && <Ownership c={c} />}
          {tab === 'risk' && <RiskPanel c={c} onChanged={refresh} />}
          {tab === 'output' && <OutputPanel c={c} webhooks={data.webhooks} onChanged={refresh} />}
          {tab === 'gaps' && <Gaps c={c} />}
          {tab === 'merchant' && <MerchantPanel c={c} onChanged={refresh} />}
          {tab === 'uaepass' && <UaePassPanel c={c} onChanged={refresh} />}
        </div>

        {/* right: timeline */}
        <div className="col col-right sticky">
          <div className="card" style={{ padding: 16 }}>
            <div className="row between"><h3 className="h3">{t('Agent timeline')}</h3><span className="mono small muted">{c.usage.tokens.toLocaleString('en-US')} / {c.usage.budget.toLocaleString('en-US')} {t('tok')}</span></div>
            <div className="meter" style={{ marginTop: 8 }}><i style={{ width: `${Math.min(100, (c.usage.tokens / c.usage.budget) * 100)}%`, background: 'var(--honey)' }} /></div>
            <div className="timeline" style={{ marginTop: 14 }}>
              {traces.length === 0 && <div className="muted small">{t('No runs yet. Upload documents and run the agents.')}</div>}
              {traces.map((tr) => (
                <div key={tr.id} className={`tl ${tr.status}`}>
                  <details>
                    <summary>
                      <div className="row between" style={{ flexWrap: 'nowrap' }}>
                        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{step(tr.step)}</span>
                        <span className="mono tiny muted">{tr.status === 'running' ? '...' : `${(tr.durationMs / 1000).toFixed(1)}s`}</span>
                      </div>
                      <div className="small muted">{tr.summary ? msg(tr.summary) : tr.error ?? tr.agent}</div>
                      {(tr.tokensIn ?? 0) + (tr.tokensOut ?? 0) > 0 && <div className="mono tiny muted">{((tr.tokensIn ?? 0) + (tr.tokensOut ?? 0)).toLocaleString('en-US')} {t('tok')} · {tr.model}</div>}
                    </summary>
                    <div className="small" style={{ marginTop: 6 }}>
                      <div className="mono tiny muted">{t('agent')} {tr.agent} · {t('run')} {tr.runSeq}{tr.promptVersion ? ` · ${tr.promptVersion}` : ''}{tr.model ? ` · ${tr.model}` : ''}</div>
                      {tr.toolCalls?.length ? <div style={{ marginTop: 6 }}>{tr.toolCalls.map((tc, i) => <div key={i} className="mono tiny">→ {tc.name}{tc.resultSummary ? `: ${tc.resultSummary}` : ''}</div>)}</div> : null}
                      {tr.output !== undefined && <pre>{JSON.stringify(tr.output, null, 2)}</pre>}
                      {tr.error && <div className="banner bad" style={{ marginTop: 6 }}>{tr.error}</div>}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
          <Findings c={c} onDoc={(docId) => setSel({ docId })} />
        </div>
      </div>
    </div>
  );
}

function UploadMore({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const { t, err } = useI18n();
  return (
    <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
      {t('Add documents')}
      <input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.zip,.eml" onChange={async (e) => {
        const fd = new FormData();
        Array.from(e.target.files ?? []).forEach((f) => fd.append('files', f, f.name));
        try {
          const r = await api.form<{ added: unknown[]; rejected: { name: string; reason: string }[] }>(`/cases/${caseId}/documents`, fd);
          toast(`${t('{n} added', { n: r.added.length })}${r.rejected.length ? t(', {n} rejected', { n: r.rejected.length }) : ''}. ${t('Re-run the agents to process them.')}`);
          onDone();
        } catch (x) {
          toast(err(x));
        }
      }} />
    </label>
  );
}

function Checklist({ c }: { c: Case }) {
  const { t, doc } = useI18n();
  if (!c.checklist.length) return null;
  const req = c.checklist.filter((x) => x.required);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row between"><h3 className="h3">{t('Checklist')}</h3><span className="mono small">{req.filter((x) => x.received && !x.expired).length}/{req.length}</span></div>
      <div style={{ marginTop: 8 }}>
        {c.checklist.map((x) => (
          <div key={x.docType} className="check">
            <span className={`dot ${x.expired ? 'x' : x.received ? 'y' : 'n'}`} aria-hidden>{x.expired ? '!' : x.received ? '✓' : '×'}</span>
            <span style={{ flex: 1 }}>{doc(x.docType)}</span>
            <span className="small muted">{t(x.required ? (x.expired ? 'expired' : x.received ? 'received' : 'missing') : 'optional')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fields({ c, threshold, onSource, onChanged }: { c: Case; threshold: number; onSource: (f?: CaseField) => void; onChanged: () => void }) {
  const me = useMe();
  const { t, field, section } = useI18n();
  const [edit, setEdit] = useState<{ path: string; value: string; confirm?: boolean } | null>(null);
  const editable = can.review(me) && ['AWAITING_REVIEW', 'NEEDS_INFO'].includes(c.status);
  if (!Object.keys(c.fields).length) return <Empty title={t('No fields extracted yet')}>{t('Run the agents to classify and extract the documents.')}</Empty>;
  const row = (path: string, f: CaseField) => (
    <div key={path} className={`frow ${f.needsReview ? 'flag' : ''}`}>
      <div className="k">{field(path)}{f.needsReview && <div className="tiny" style={{ color: 'var(--gold)', fontWeight: 600 }}>{t('needs review (below {n}%)', { n: Math.round(threshold * 100) })}</div>}</div>
      <div className={`v ${f.edited ? 'edited' : ''}`}>
        <span className={/iban|trn|number|mcc|volume|ticket|date|ratio/i.test(path) ? 'mono' : ''} dir="auto">{fmt(f.value)}</span>
        <div className="row" style={{ gap: 10, marginTop: 2 }}>
          {f.source?.docId && <button className="linkbtn" onClick={() => onSource(f)}>{t('source')}{f.source.page ? ` p${f.source.page}` : ''}</button>}
          {editable && <button className="linkbtn" onClick={() => setEdit({ path, value: fmt(f.value) === '-' ? '' : fmt(f.value) })}>{t('edit')}</button>}
          {editable && f.needsReview && <button className="linkbtn" onClick={() => setEdit({ path, value: fmt(f.value), confirm: true })}>{t('confirm')}</button>}
          {f.edited && <span className="tiny muted" title={f.edited.reason}>{t('by {who}: {why}', { who: f.edited.by, why: f.edited.reason })}</span>}
        </div>
      </div>
      <Meter v={f.confidence} />
    </div>
  );
  const people = (title: string, list: Person[], showPct = false) => list.length ? (
    <div className="card" style={{ padding: 14 }}>
      <div className="section-title">{title}</div>
      {list.map((p, i) => (
        <div key={i} className="frow">
          <div className="k">{p.type === 'corporate' ? t('Corporate') : t(p.role ?? 'Natural person')}</div>
          <div className="v">{p.name}{p.nationality && <span className="muted small"> · {p.nationality}</span>}</div>
          <div className="num small">{showPct && p.percentage !== undefined ? `${p.percentage}%` : ''}</div>
        </div>
      ))}
    </div>
  ) : null;
  const ubos = c.ubo?.ubos ?? [];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {SECTIONS.map((s) => {
        const keys = Object.keys(c.fields).filter((k) => k.startsWith(s.prefix));
        if (!keys.length) return null;
        return (
          <div key={s.title} className="card" style={{ padding: 14 }}>
            <div className="section-title">{section(s.title)}</div>
            {keys.map((k) => row(k, c.fields[k]))}
          </div>
        );
      })}
      {people(t('Directors'), c.directors)}
      {people(t('Authorised signatories'), c.signatories)}
      {people(t('Shareholders'), c.shareholders, true)}
      {ubos.length > 0 && (
        <div className="card card-warm" style={{ padding: 14 }}>
          <div className="section-title">{t('Ultimate beneficial owners')}</div>
          {ubos.map((u) => (
            <div key={u.name} className="frow"><div className="k">{t(u.basis.replace(/_/g, ' '))}</div><div className="v" style={{ fontWeight: 600 }}>{u.name}</div><div className="num small">{u.basis === 'ownership' ? `${u.effectivePct.toFixed(2)}%` : ''}</div></div>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.confirm ? t('Confirm {f}', { f: field(edit.path) }) : t('Edit {f}', { f: field(edit.path) })} onClose={() => setEdit(null)}>
          <EditForm c={c} edit={edit} onDone={() => { setEdit(null); onChanged(); }} />
        </Modal>
      )}
    </div>
  );
}

function EditForm({ c, edit, onDone }: { c: Case; edit: { path: string; value: string; confirm?: boolean }; onDone: () => void }) {
  const { t, err } = useI18n();
  const [value, setValue] = useState(edit.value);
  const [reason, setReason] = useState('');
  const save = async () => {
    try {
      const numeric = /volume|ticket|ratio/i.test(edit.path) && value.trim() !== '' && !Number.isNaN(Number(value.replace(/,/g, '')));
      await api.patch(`/cases/${c.id}/fields`, edit.confirm ? { path: edit.path, confirm: true, reason } : { path: edit.path, value: numeric ? Number(value.replace(/,/g, '')) : value, reason });
      toast(t('Saved and audited'));
      onDone();
    } catch (e) {
      toast(err(e));
    }
  };
  return (
    <div className="stack">
      {!edit.confirm ? <div className="field"><label>{t('Value')}</label><input className="input" dir="auto" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></div> : <div className="banner ok">{t('Current value:')} <b dir="auto">{edit.value}</b></div>}
      <div className="field"><label>{t('Reason (required, stored in the audit log)')}</label><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('For example: verified against the original licence')} /></div>
      <div className="row"><button className="btn btn-dark" disabled={reason.trim().length < 3} onClick={save}>{edit.confirm ? t('Confirm value') : t('Save change')}</button></div>
    </div>
  );
}

function Ownership({ c }: { c: Case }) {
  const { t, ubo } = useI18n();
  if (!c.ubo) return <Empty title={t('Ownership not resolved yet')}>{t('The UBO resolver runs after verification.')}</Empty>;
  return (
    <div className="stack">
      <div className="row"><span className="chip">{t('threshold {n}%', { n: c.ubo.thresholdPct })}</span><span className="chip">{t('{n} layer(s)', { n: c.ubo.layers })}</span><span className="chip">{t('{n} UBO(s)', { n: c.ubo.ubos.length })}</span>{c.ubo.unresolved.length > 0 && <span className="pill warn">{t('untraced: {s}', { s: c.ubo.unresolved.join(', ') })}</span>}</div>
      <div dir="ltr"><OwnershipGraph ubo={c.ubo} /></div>
      <div className="card card-warm"><p className="eyebrow">{t('In plain language')}</p><p style={{ margin: 0, fontSize: 15.5 }}>{ubo(c.ubo.explanation)}</p></div>
    </div>
  );
}

function RiskPanel({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const me = useMe();
  const { t, msg, memo, reco, role, status: statusName, err, date } = useI18n();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  if (!c.risk) return <Empty title={t('No risk assessment yet')}>{t('The underwriter agent scores the case after screening.')}</Empty>;
  const r = c.risk;
  const approvals = c.reviews.filter((x) => x.decision === 'approve');
  const needSecond = r.requiresSecondReviewer && approvals.length === 1 && c.status === 'AWAITING_REVIEW';
  const decide = async (decision: 'approve' | 'reject' | 'request_info') => {
    setBusy(true);
    try {
      const out = await api.post<{ status: string; awaitingSecondReviewer: boolean }>(`/cases/${c.id}/review`, { decision, notes });
      toast(out.awaitingSecondReviewer ? t('First approval recorded. A second reviewer must approve.') : t('Case is now {s}', { s: statusName(out.status).toLowerCase() }));
      setNotes('');
      onChanged();
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="card card-dark">
        <div className="row between">
          <div><p className="eyebrow">{t('Risk score')}</p><div className="row" style={{ alignItems: 'baseline' }}><span className="mono" style={{ fontSize: 46, letterSpacing: '-0.03em' }}>{r.score}</span><span className="muted">/ 100</span><RiskChip r={r.rating} /></div></div>
          {r.requiresSecondReviewer && <span className="pill honey">{t('second reviewer required')}</span>}
        </div>
        <div className="row" style={{ marginTop: 12, gap: 6 }}>{r.reasonCodes.map((x) => <span key={x} className="chip" style={{ color: 'var(--cream)', borderColor: 'rgba(246,241,230,.3)' }}>{x}</span>)}</div>
        <div style={{ marginTop: 14 }}>
          {r.breakdown.map((b) => <div key={b.code} className="row between small" style={{ padding: '4px 0', borderBottom: '1px solid rgba(246,241,230,.1)', flexWrap: 'nowrap' }}><span>{msg(b.note)}</span><span className="mono">+{b.points}</span></div>)}
        </div>
      </div>

      <div className="card">
        <div className="row between"><h3 className="h3">{t('Screening')}</h3><span className="mono small muted">{c.screening?.provider}</span></div>
        {c.screening?.isMock && <div style={{ marginTop: 10 }}><MockBanner what="screening" /></div>}
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>{t('Party')}</th><th>{t('Role')}</th><th>{t('Result')}</th></tr></thead>
          <tbody>{c.screening?.results.map((s, i) => <tr key={i}><td>{s.subject}</td><td className="small muted">{t(s.role)}</td><td>{s.status === 'CLEAR' ? <span className="pill ok">{t('clear')}</span> : <span className="pill bad">{s.category?.toLowerCase()} {s.status.toLowerCase()}</span>}<div className="tiny muted">{s.detail ? t(s.detail) : null}</div></td></tr>)}</tbody>
        </table>
      </div>

      <div className="card card-paper">
        <p className="eyebrow">{t('Underwriter memo')} {r.memoModel ? <span className="mono tiny muted">· {r.memoModel}</span> : null}</p>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>{memo(r.memo)}</div>
        <div className="banner warn" style={{ marginTop: 12 }}><b>{t('Recommendation:')}</b>&nbsp;{reco(r.recommendedAction)}</div>
        <p className="script" style={{ margin: '10px 0 0' }}>{t('The agent recommends. You decide.')}</p>
      </div>

      <div className="card">
        <h3 className="h3">{t('Decision')}</h3>
        {c.reviews.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {c.reviews.map((x, i) => <div key={i} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}><b>{t(x.decision.replace('_', ' '))}</b> · <span dir="ltr">{x.reviewerEmail}</span> <span className="muted">({role(x.role)}, {date(x.at)})</span><div className="muted" dir="auto">{x.notes}</div></div>)}
          </div>
        )}
        {needSecond && <div className="banner warn" style={{ marginTop: 10 }}>{t('First approval recorded. A different reviewer with the SECOND REVIEWER role must approve.')}</div>}
        {c.needsReviewFields.length > 0 && c.status === 'AWAITING_REVIEW' && <div className="banner warn" style={{ marginTop: 10 }}>{t('Confirm or correct {n} low-confidence field(s) on the Fields tab before approving.', { n: c.needsReviewFields.length })}</div>}
        {can.review(me) && c.status === 'AWAITING_REVIEW' ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="field"><label htmlFor="notes">{t('Notes (mandatory)')}</label><textarea id="notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('What you checked and why')} /></div>
            <div className="row">
              <button className="btn btn-honey" disabled={busy || notes.trim().length < 5 || c.needsReviewFields.length > 0} onClick={() => decide('approve')}>{t('Approve')}</button>
              <button className="btn" disabled={busy || notes.trim().length < 5} onClick={() => decide('request_info')}>{t('Request info')}</button>
              <button className="btn btn-bad" disabled={busy || notes.trim().length < 5} onClick={() => decide('reject')}>{t('Reject')}</button>
            </div>
          </div>
        ) : (
          <p className="muted small" style={{ marginTop: 10 }}>{c.status === 'AWAITING_REVIEW' ? t('Your role cannot decide cases.') : t('Case is {s}.', { s: statusName(c.status).toLowerCase() })}</p>
        )}
      </div>
    </div>
  );
}

function OutputPanel({ c, webhooks, onChanged }: { c: Case; webhooks: CaseResponse['webhooks']; onChanged: () => void }) {
  const me = useMe();
  const { t, err, date } = useI18n();
  const [minted, setMinted] = useState<{ token: string; claimUrl: string; tokenExpiresAt: string; tokenId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ token: string; claimUrl: string; tokenExpiresAt: string; tokenId: string }>(`/cases/${c.id}/complete`);
      setMinted(r);
      onChanged();
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(t('Copied'));
    } catch {
      toast(t('Copy failed: select the text manually'));
    }
  };
  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><h3 className="h3">{t('Acquirer pack')}</h3><span className="mono small">{c.pack?.acquirerCode ?? c.acquirerCode}</span></div>
        {!c.pack ? <p className="muted">{t('Built automatically at the end of the pipeline.')}</p> : (
          <>
            <div style={{ marginTop: 10 }}>
              {c.pack.files.map((f) => (
                <div key={f.name} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)', flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}><div className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div><div className="tiny muted mono">sha256 {f.sha256.slice(0, 16)}…</div></div>
                  <a className="btn btn-sm" href={`/api/v1/cases/${c.id}/pack/${encodeURIComponent(f.name)}`}>{f.kind === 'archive' ? t('Download zip') : t('Download')}</a>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              {can.write(me) && <button className="btn btn-sm" onClick={async () => { const r = await api.post<{ warning: string }>(`/cases/${c.id}/submit-pack`); toast(r.warning); onChanged(); }}>{t('Submit via API (mock)')}</button>}
              {c.pack.submission && <span className="pill warn">{c.pack.submission.mode} {c.pack.submission.reference ?? ''}{c.pack.submission.isMock ? ' (MOCK)' : ''}</span>}
            </div>
          </>
        )}
      </div>

      <div className="card card-dark">
        <p className="eyebrow">{t('Completion')}</p>
        {c.status === 'COMPLETED' && c.completion ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row"><span className="pill ok">{t('System of record written')}</span><span className="mono small">{date(c.completion.sqlWrittenAt)}</span></div>
            <div className="small">{t('Merchant')} <span className="mono">{c.completion.merchantId}</span></div>
            <div className="small">{t('Record')} <span className="mono">{c.completion.sqlCaseId}</span></div>
            <div className="small">{t('Token id')} <span className="mono">{c.completion.tokenId}</span> · {t('expires')} <span className="mono">{date(c.completion.tokenExpiresAt)}</span></div>
            {minted ? (
              <>
                <div className="banner warn">{t('This is the only time the token is shown. It is stored only as a hash.')}</div>
                <div className="tokenbox" dir="ltr">{minted.token}</div>
                <div className="row"><button className="btn btn-honey btn-sm" onClick={() => copy(minted.claimUrl)}>{t('Copy claim URL')}</button><button className="btn btn-sm" onClick={() => copy(minted.token)}>{t('Copy token')}</button></div>
              </>
            ) : <div className="muted small">{t('The token was shown once at completion and cannot be displayed again.')}</div>}
            {can.write(me) && <div><button className="btn btn-bad btn-sm" onClick={async () => { try { await api.post(`/tokens/${c.completion!.tokenId}/revoke`); toast(t('Token revoked')); } catch (e) { toast(err(e)); } }}>{t('Revoke token')}</button></div>}
          </div>
        ) : c.status === 'APPROVED' ? (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>{t('Approved by a human reviewer. Completing writes the merchant, parties, documents, decision and a hashed token to the system of record in one atomic write, then fires the signed webhook.')}</p>
            {can.write(me) && <div><button className="btn btn-honey" disabled={busy} onClick={complete}>{busy ? t('Completing') : t('Complete and mint token')}</button></div>}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>{t('Available once the case is approved.')}</p>}
      </div>

      <div className="card">
        <h3 className="h3">{t('Webhook deliveries')}</h3>
        {webhooks.length === 0 ? <p className="muted small">{t('No deliveries yet. Configure the webhook URL in Settings.')}</p> : (
          <table className="table"><thead><tr><th>{t('Status')}</th><th>{t('Attempts')}</th><th className="hide-sm">{t('Last result')}</th><th></th></tr></thead>
            <tbody>{webhooks.map((w) => (
              <tr key={w.id}>
                <td><span className={`pill ${w.status === 'DELIVERED' ? 'ok' : w.status === 'DEAD' ? 'bad' : 'warn'}`}>{w.status.toLowerCase()}</span></td>
                <td className="mono">{w.attempts}</td>
                <td className="hide-sm small muted">{w.lastStatusCode ? `HTTP ${w.lastStatusCode}` : w.lastError ?? '-'}</td>
                <td>{w.status === 'DEAD' && can.write(me) && <button className="btn btn-sm" onClick={async () => { await api.post(`/webhooks/${w.id}/retry`); toast(t('Retry queued')); onChanged(); }}>{t('Retry')}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Gaps({ c }: { c: Case }) {
  const { t, msg } = useI18n();
  const items = c.gaps?.items ?? [];
  if (!items.length) return <Empty title={t('Nothing outstanding')}>{t('All required documents and fields are present.')}</Empty>;
  return (
    <div className="stack">
      <div className="card">
        <h3 className="h3">{t('Outstanding items')}</h3>
        <ul style={{ margin: '10px 0 0', paddingInlineStart: 18 }}>{Array.from(new Set(items.map((i) => i.message))).map((m) => <li key={m} style={{ padding: '3px 0' }}>{msg(m)}</li>)}</ul>
      </div>
      <div className="card card-paper">
        <div className="row between"><p className="eyebrow" style={{ margin: 0 }}>{t('Draft request to the merchant')}</p><span className="pill warn">{t('not sent')}</span></div>
        <textarea className="textarea" dir="auto" style={{ marginTop: 10, minHeight: 200, background: '#fff' }} defaultValue={c.gaps?.draftMessage} aria-label={t('Draft message')} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-dark btn-sm" onClick={async () => { await navigator.clipboard.writeText(c.gaps?.draftMessage ?? ''); toast(t('Copied. Paste it into your email and send it yourself.')); }}>{t('Copy draft')}</button>
          <span className="small muted">{t('MoneyBee never sends this automatically. A human sends it.')}</span>
        </div>
      </div>
    </div>
  );
}

function Findings({ c, onDoc }: { c: Case; onDoc: (id: string) => void }) {
  const { t, msg } = useI18n();
  if (!c.findings.length) return null;
  const order = { fail: 0, warn: 1, info: 2 } as const;
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 className="h3">{t('Policy checks')}</h3>
      <p className="tiny muted" style={{ margin: '4px 0 8px' }}>{t('Deterministic checks. Regulatory interpretation stays with compliance.')}</p>
      {[...c.findings].sort((a, b) => order[a.severity] - order[b.severity]).map((f, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
          <div className="row" style={{ gap: 8 }}><span className={`pill ${f.severity === 'fail' ? 'bad' : f.severity === 'warn' ? 'warn' : ''}`}>{f.code}</span></div>
          <div className="small" style={{ marginTop: 4 }}>{msg(f.message)}</div>
          {f.explanation && <div className="small muted" style={{ marginTop: 2 }}>{msg(f.explanation)}</div>}
          {f.docIds?.[0] && <button className="linkbtn" onClick={() => onDoc(f.docIds![0])}>{t('open document')}</button>}
        </div>
      ))}
    </div>
  );
}
