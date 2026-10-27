import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';
import { PoweredByMoneyBee, TenantMark, useTenantTheme, type PublicTenant } from '../tenant';
import { PortalLang, PortalLangToggle, usePT } from './i18n';
import { p, tenantQuery, type AppFile, type AppView, type ChecklistItem, type EntityOption, type EntityType, type Question, type Requirements } from './api';
import './portal.css';

/** Merchant self-serve portal: /apply (start), /apply/sent, /apply/resume, /apply/link#token, /apply/app */
export function ApplyRoutes() {
  return (
    <PortalLang>
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/sent" element={<SentPage />} />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/link" element={<LinkPage />} />
        <Route path="/app" element={<AppPage />} />
        <Route path="*" element={<StartPage />} />
      </Routes>
    </PortalLang>
  );
}

const withQ = (path: string) => `${path}${tenantQuery()}`;
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function usePublicTenant() {
  return useQuery({ queryKey: ['portal-req', tenantQuery()], queryFn: () => p.get<Requirements>(`/public/requirements${tenantQuery()}`), staleTime: 60_000 });
}

function Shell({ tenant, children, right }: { tenant?: PublicTenant | null; children: ReactNode; right?: ReactNode }) {
  const { lang, t } = usePT();
  useTenantTheme(tenant);
  return (
    <div className="pt-shell">
      <header className="pt-top">
        <Link to={withQ('/apply')} className="pt-brand" aria-label="Home"><TenantMark tenant={tenant} size={20} /></Link>
        <span className="pt-grow" />
        {right}
        <PortalLangToggle />
      </header>
      <main className="pt-main">{children}</main>
      <footer className="pt-foot">
        {tenant && (
          <p>
            {tenant.copy.supportLine || t.help}{' '}
            <a href={`mailto:${tenant.contact.supportEmail}`}>{tenant.contact.supportEmail}</a>
            {tenant.contact.whatsappNumber && <> &nbsp; WhatsApp <a href={`https://wa.me/${tenant.contact.whatsappNumber.replace(/\D/g, '')}`}>{tenant.contact.whatsappNumber}</a></>}
          </p>
        )}
        {tenant?.copy.legalFooter && <p className="pt-legal">{tenant.copy.legalFooter}</p>}
        <PoweredByMoneyBee locale={lang} />
      </footer>
    </div>
  );
}

/* ---------------- start ---------------- */

function StartPage() {
  const { t, L, lang } = usePT();
  const nav = useNavigate();
  const req = usePublicTenant();
  const existing = useQuery({ queryKey: ['portal-app'], queryFn: () => p.get<AppView>('/portal/application'), retry: false });
  const [type, setType] = useState<EntityType | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [form, setForm] = useState({ businessName: '', name: '', email: '', mobile: '', consent: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tenant = req.data?.tenant;
  const opt = req.data?.entityTypes.find((e) => e.id === type);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!type) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await p.post<{ ref: string; emailMasked: string; emailSent: boolean }>(`/public/applications${tenantQuery()}`, {
        entityType: type, answers, businessName: form.businessName, contact: { name: form.name, email: form.email, mobile: form.mobile }, locale: lang, consent: form.consent,
      });
      nav(withQ('/apply/sent'), { state: r });
    } catch (x) {
      setErr(errMsg(x, t.errorGeneric));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell tenant={tenant}>
      {existing.data && (
        <div className="pt-resume-banner" role="status">
          <span>{existing.data.application.businessName} ({existing.data.application.ref})</span>
          <Link className="pt-btn pt-btn-sm" to={withQ('/apply/app')}>{t.continueHere}</Link>
        </div>
      )}
      <section className="pt-hero">
        <h1>{tenant?.copy.welcomeTitle}</h1>
        <p className="pt-lede">{tenant?.copy.welcomeBody}</p>
        <Link to={withQ('/apply/resume')} className="pt-textlink">{t.resumeLink}</Link>
      </section>

      {req.isError && <p className="pt-alert" role="alert">{t.errorGeneric}</p>}
      <form className="pt-steps" onSubmit={submit}>
        <fieldset className="pt-step">
          <legend><span className="pt-n">1</span>{t.stepType}</legend>
          <p className="pt-help">{t.typeHelp}</p>
          <div className="pt-choices" role="radiogroup">
            {req.data?.entityTypes.map((e) => (
              <label key={e.id} className={`pt-choice ${type === e.id ? 'on' : ''}`}>
                <input type="radio" name="entityType" value={e.id} checked={type === e.id} onChange={() => { setType(e.id); setAnswers({}); }} />
                <span className="pt-choice-t">{L(e.label, e.labelAr)}</span>
                <span className="pt-choice-d">{L(e.description, e.descriptionAr)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {opt && (
          <>
            {opt.questions.length > 0 && (
              <fieldset className="pt-step">
                <legend><span className="pt-n">2</span>{t.stepQuestions}</legend>
                <p className="pt-help">{t.questionsHelp}</p>
                <Questions questions={opt.questions} answers={answers} onChange={setAnswers} />
              </fieldset>
            )}
            <WillNeed opt={opt} />
            <fieldset className="pt-step">
              <legend><span className="pt-n">{opt.questions.length ? 3 : 2}</span>{t.stepContact}</legend>
              <div className="pt-fields">
                <Field label={t.businessName}><input required minLength={2} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} autoComplete="organization" /></Field>
                <Field label={t.yourName}><input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></Field>
                <Field label={t.email}><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" dir="ltr" /></Field>
                <Field label={t.mobile}><input type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} autoComplete="tel" dir="ltr" placeholder="+971 50 000 0000" /></Field>
              </div>
              <label className="pt-consent"><input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} /> {t.consent}</label>
              <p className="pt-help">{t.emailNote}</p>
              {err && <p className="pt-alert" role="alert">{err}</p>}
              <button className="pt-btn" disabled={busy}>{busy ? t.starting : t.begin}</button>
            </fieldset>
          </>
        )}
      </form>
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="pt-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Questions({ questions, answers, onChange, disabled }: { questions: Question[]; answers: Record<string, string | boolean>; onChange: (a: Record<string, string | boolean>) => void; disabled?: boolean }) {
  const { t, L } = usePT();
  return (
    <div className="pt-questions">
      {questions.map((q) => (
        <div key={q.id} className="pt-q" role="group" aria-labelledby={`q-${q.id}`}>
          <span id={`q-${q.id}`} className="pt-q-l">{L(q.label, q.labelAr)}</span>
          {q.type === 'boolean' ? (
            <div className="pt-seg">
              {[true, false].map((v) => (
                <button type="button" key={String(v)} disabled={disabled} aria-pressed={answers[q.id] === v} onClick={() => onChange({ ...answers, [q.id]: v })}>{v ? t.yes : t.no}</button>
              ))}
            </div>
          ) : (
            <select disabled={disabled} value={String(answers[q.id] ?? '')} onChange={(e) => onChange({ ...answers, [q.id]: e.target.value })} aria-labelledby={`q-${q.id}`}>
              <option value="" disabled>-</option>
              {q.options?.map((o) => <option key={o.value} value={o.value}>{L(o.label, o.labelAr)}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

/** Preview of the documents for the chosen type. The exact list (with answers applied) is on the application page. */
function WillNeed({ opt }: { opt: EntityOption }) {
  const { t, docLabel } = usePT();
  return (
    <section className="pt-willneed" aria-label={t.youWillNeed}>
      <h2>{t.youWillNeed}</h2>
      <ul>
        {opt.documents.filter((d) => d.required).map((d) => <li key={d.docType}>{docLabel(d.docType, d.label)}</li>)}
        {opt.documents.filter((d) => d.ifApplicable).map((d) => (
          <li key={d.docType} className="pt-maybe">{docLabel(d.docType, d.label)} <em>{t.ifApplicable}</em></li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- sent / resume / link ---------------- */

function SentPage() {
  const { t } = usePT();
  const loc = useLocation();
  const req = usePublicTenant();
  const st = loc.state as { ref: string; emailMasked: string; emailSent?: boolean } | null;
  return (
    <Shell tenant={req.data?.tenant}>
      <section className="pt-card pt-narrow">
        <h1>{st?.emailSent === false ? t.continueHere : t.sentTitle}</h1>
        <p className="pt-lede">{st?.emailSent === false ? t.sentFailed : t.sentBody(st?.emailMasked ?? '')}</p>
        {st?.ref && <p className="pt-help">{t.ref}: <b dir="ltr">{st.ref}</b></p>}
        <Link className="pt-btn" to={withQ('/apply/app')}>{t.continueHere}</Link>
      </section>
    </Shell>
  );
}

function ResumePage() {
  const { t } = usePT();
  const req = usePublicTenant();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await p.post<{ emailMasked: string }>(`/public/applications/resume${tenantQuery()}`, { email });
      setSent(r.emailMasked);
    } catch (x) {
      setErr(errMsg(x, t.errorGeneric));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell tenant={req.data?.tenant}>
      <section className="pt-card pt-narrow">
        <h1>{t.resumeTitle}</h1>
        {sent ? <p className="pt-lede" role="status">{t.resumeSent(sent)}</p> : (
          <form onSubmit={send} className="pt-stack">
            <p className="pt-lede">{t.resumeBody}</p>
            <Field label={t.email}><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" /></Field>
            {err && <p className="pt-alert" role="alert">{err}</p>}
            <button className="pt-btn" disabled={busy}>{t.sendLink}</button>
          </form>
        )}
      </section>
    </Shell>
  );
}

function LinkPage() {
  const { t } = usePT();
  const nav = useNavigate();
  const [bad, setBad] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = window.location.hash.slice(1);
    // drop the token from the address bar and history straight away
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!token) return setBad(true);
    p.post<{ tenant: string }>('/portal/session', { token })
      .then((r) => nav(`/apply/app?tenant=${encodeURIComponent(r.tenant)}`, { replace: true }))
      .catch(() => setBad(true));
  }, [nav]);
  return (
    <Shell>
      <section className="pt-card pt-narrow">
        {bad ? (
          <>
            <h1>{t.linkBad}</h1>
            <Link className="pt-btn" to={withQ('/apply/resume')}>{t.getNewLink}</Link>
          </>
        ) : <p className="pt-lede" role="status">{t.openingLink}</p>}
      </section>
    </Shell>
  );
}

/* ---------------- the application ---------------- */

function AppPage() {
  const { t, lang, setLang, docLabel } = usePT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['portal-app'],
    queryFn: () => p.get<AppView>('/portal/application'),
    retry: false,
    refetchInterval: (x) => (x.state.data && (x.state.data.application.phase === 'submitted' || x.state.data.files.some((f) => f.state === 'checking')) ? 2500 : false),
  });
  const v = q.data;
  const synced = useRef(false);
  useEffect(() => {
    // first visit on a device follows the language chosen at the start
    if (v && !synced.current) {
      synced.current = true;
      try { if (!localStorage.getItem('mb_lang') && v.application.locale !== lang) setLang(v.application.locale); } catch { /* storage unavailable */ }
    }
  }, [v, lang, setLang]);
  const set = (next: AppView) => qc.setQueryData(['portal-app'], next);
  const signOut = async () => {
    await p.post('/portal/signout');
    qc.removeQueries({ queryKey: ['portal-app'] });
    nav(withQ('/apply'));
  };

  if (q.isLoading) return <Shell><p className="pt-help pt-center">{t.openingLink}</p></Shell>;
  if (!v) {
    return (
      <Shell>
        <section className="pt-card pt-narrow">
          <h1>{t.noSession}</h1>
          <Link className="pt-btn" to={withQ('/apply/resume')}>{t.getNewLink}</Link>
        </section>
      </Shell>
    );
  }
  const [title, sub] = t.phase[v.application.phase];
  return (
    <Shell tenant={v.tenant} right={<button type="button" className="pt-btn pt-btn-ghost pt-btn-sm" onClick={signOut}>{t.signOut}</button>}>
      <div className="pt-app">
        <section className="pt-status" aria-live="polite">
          <p className="pt-ref" dir="ltr">{v.application.ref}</p>
          <h1>{title}</h1>
          <p className="pt-lede">{sub}</p>
          <CountBar v={v} />
        </section>

        <div className="pt-cols">
          <div className="pt-colmain">
            {v.requests.length > 0 && (
              <ul className="pt-requests">{v.requests.map((r, i) => <li key={i}>{lang === 'ar' && r.docType ? `مطلوب: ${docLabel(r.docType, r.docType)}` : r.message}</li>)}</ul>
            )}
            <Checklist v={v} onView={set} />
            {v.application.canUpload && <DropAll onView={set} />}
            <Files v={v} onView={set} />
          </div>
          <aside className="pt-side">
            <SubmitBox v={v} onView={set} />
            <MobileBar v={v} />
            <Details v={v} onView={set} />
            <Timeline v={v} />
            <section className="pt-panel">
              <h2>{t.whatNext}</h2>
              <ol className="pt-next">{t.whatNextList.map((x) => <li key={x}>{x}</li>)}</ol>
            </section>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

/** One segment per required document: the clearest picture of "how much is left". */
function CountBar({ v }: { v: AppView }) {
  const { t } = usePT();
  const req = v.checklist.items.filter((i) => i.required);
  if (!req.length) return null;
  return (
    <div className="pt-count">
      <div className="pt-count-bar" role="img" aria-label={t.docsIn(v.checklist.requiredDone, v.checklist.requiredTotal)}>
        {req.map((i) => <span key={i.docType} className={`seg ${i.status}`} title={i.label} />)}
      </div>
      <p className="pt-count-l">{v.checklist.complete ? t.allIn : t.docsIn(v.checklist.requiredDone, v.checklist.requiredTotal)}</p>
    </div>
  );
}

async function uploadFiles(files: FileList | File[], slot: string | null): Promise<{ view: AppView; added: { name: string; detected: string[]; matchesSlot: boolean | null }[]; duplicates: string[]; reused?: string[]; rejected: { name: string; reason: string }[] }> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append('files', f);
  if (slot) fd.append('slot', slot);
  return p.form('/portal/application/documents', fd);
}

function useUpload(onView: (v: AppView) => void) {
  const { t, docLabel } = usePT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const run = async (files: FileList | File[] | null, slot: string | null, slotLabel?: string) => {
    if (!files || !files.length) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await uploadFiles(files, slot);
      onView(r.view);
      const labelOf = (d: string) => docLabel(d, r.view.checklist.items.find((i) => i.docType === d)?.label ?? r.view.files.flatMap((f) => f.detected).find((x) => x.docType === d)?.label ?? d);
      const mism = r.added.find((a) => slot && a.matchesSlot === false && a.detected.length && !a.detected.includes('unknown'));
      if (mism && slot) setNote({ tone: 'warn', text: t.notSlot(labelOf(mism.detected[0]), slotLabel ?? labelOf(slot)) });
      else if (r.rejected.length) setNote({ tone: 'bad', text: r.rejected.map((x) => `${x.name}: ${x.reason}`).join('. ') });
      else if (r.reused?.length && slot) setNote({ tone: 'ok', text: t.reused(slotLabel ?? labelOf(slot)) });
      else if (r.duplicates.length && !r.added.length) setNote({ tone: 'warn', text: t.duplicate(r.duplicates.join(', ')) });
    } catch (x) {
      setNote({ tone: 'bad', text: errMsg(x, t.errorGeneric) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, note, run };
}

function Checklist({ v, onView }: { v: AppView; onView: (v: AppView) => void }) {
  const { t } = usePT();
  const required = v.checklist.items.filter((i) => i.required);
  const optional = v.checklist.items.filter((i) => !i.required);
  return (
    <section className="pt-check" aria-label="Checklist">
      <ul className="pt-list">{required.map((i) => <Row key={i.docType} item={i} v={v} onView={onView} />)}</ul>
      {optional.length > 0 && (
        <details className="pt-opt">
          <summary>{t.optional} ({optional.length})</summary>
          <ul className="pt-list">{optional.map((i) => <Row key={i.docType} item={i} v={v} onView={onView} />)}</ul>
        </details>
      )}
    </section>
  );
}

function Row({ item, v, onView }: { item: ChecklistItem; v: AppView; onView: (v: AppView) => void }) {
  const { t, L, docLabel } = usePT();
  const input = useRef<HTMLInputElement>(null);
  const up = useUpload(onView);
  const [over, setOver] = useState(false);
  const label = docLabel(item.docType, item.label);
  const statusText = { received: t.received, missing: item.required ? t.missing : item.ifApplicable ? t.ifApplicable : t.optional, expired: t.expired, too_old: t.tooOld }[item.status];
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (v.application.canUpload) up.run(e.dataTransfer.files, item.docType, label);
  };
  return (
    <li className={`pt-row ${item.status} ${over ? 'over' : ''}`} onDragOver={(e) => { if (v.application.canUpload) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <span className="pt-mark" aria-hidden />
      <div className="pt-row-body">
        <div className="pt-row-head">
          <span className="pt-row-t">{label}</span>
          <span className="pt-row-s">{statusText}</span>
        </div>
        {item.conditional && item.reason && <p className="pt-row-why">{t.needed}: {L(item.reason, item.reasonAr)}</p>}
        {(item.hint || item.perPerson) && <p className="pt-row-hint">{L(item.hint, item.hintAr) || t.people[item.perPerson ?? '']}</p>}
        {item.files.length > 0 && <p className="pt-row-files" dir="ltr">{item.files.join(', ')}</p>}
        {up.note && <p className={`pt-note ${up.note.tone}`} role="status">{up.note.text}</p>}
      </div>
      {v.application.canUpload && (
        <>
          <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.heic,image/*,application/pdf" onChange={(e) => { up.run(e.target.files, item.docType, label); e.target.value = ''; }} />
          <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm" disabled={up.busy} onClick={() => input.current?.click()} aria-label={`${item.status === 'received' ? t.replace : t.addFile}: ${label}`}>
            {up.busy ? t.uploading : item.status === 'received' ? t.replace : t.addFile}
          </button>
        </>
      )}
    </li>
  );
}

function DropAll({ onView }: { onView: (v: AppView) => void }) {
  const { t } = usePT();
  const input = useRef<HTMLInputElement>(null);
  const up = useUpload(onView);
  const [over, setOver] = useState(false);
  return (
    <section
      className={`pt-drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); up.run(e.dataTransfer.files, null); }}
    >
      <h2>{t.dropAll}</h2>
      <p>{t.dropAllSub}</p>
      <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.heic,image/*,application/pdf" onChange={(e) => { up.run(e.target.files, null); e.target.value = ''; }} />
      <button type="button" className="pt-btn" disabled={up.busy} onClick={() => input.current?.click()}>{up.busy ? t.uploading : t.choose}</button>
      {up.note && <p className={`pt-note ${up.note.tone}`} role="status">{up.note.text}</p>}
    </section>
  );
}

function Files({ v, onView }: { v: AppView; onView: (v: AppView) => void }) {
  const { t, docLabel } = usePT();
  const [err, setErr] = useState<string | null>(null);
  if (!v.files.length) return null;
  const remove = async (f: AppFile) => {
    setErr(null);
    try {
      onView(await p.del<AppView>(`/portal/application/files/${f.id}`));
    } catch (x) {
      setErr(errMsg(x, t.errorGeneric));
    }
  };
  // a file we could not read: the merchant says what it is, a reviewer confirms it later
  const tag = async (f: AppFile, docType: string) => {
    if (!docType) return;
    setErr(null);
    try {
      onView(await p.patch<AppView>(`/portal/application/files/${f.id}`, { docType }));
    } catch (x) {
      setErr(errMsg(x, t.errorGeneric));
    }
  };
  return (
    <section className="pt-panel">
      <h2>{t.yourFiles}</h2>
      {err && <p className="pt-alert" role="alert">{err}</p>}
      <ul className="pt-files">
        {v.files.map((f) => (
          <li key={f.id}>
            <span className="pt-file-n" dir="ltr">{f.name}</span>
            <span className={`pt-file-s ${f.state}`}>
              {f.state === 'checking' ? t.checking : f.state === 'unrecognised' ? t.unrecognised : f.detected.map((d) => docLabel(d.docType, d.label)).join(', ')}
            </span>
            {f.state === 'unrecognised' && v.application.canUpload && (
              <select className="pt-what" aria-label={`${t.whatIsThis} ${f.name}`} value="" onChange={(e) => tag(f, e.target.value)}>
                <option value="">{t.whatIsThis}</option>
                {v.checklist.items.map((i) => <option key={i.docType} value={i.docType}>{docLabel(i.docType, i.label)}</option>)}
              </select>
            )}
            {v.application.canEdit && <button type="button" className="pt-linkbtn" onClick={() => remove(f)} aria-label={`${t.remove} ${f.name}`}>{t.remove}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubmitBox({ v, onView }: { v: AppView; onView: (v: AppView) => void }) {
  const { t } = usePT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v.application.canUpload) return null;
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      onView(await p.post<AppView>('/portal/application/submit'));
    } catch (x) {
      setErr(errMsg(x, t.errorGeneric));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="pt-panel pt-submit">
      <button type="button" className="pt-btn pt-btn-wide" disabled={!v.application.canSubmit || busy} onClick={send}>{busy ? t.submitting : t.submit}</button>
      <p className="pt-help">{!v.application.canSubmit ? t.submitBlocked : (v.application.missingRequired ?? 0) > 0 ? t.submitMissing(v.application.missingRequired!) : t.submitHelp}</p>
      {err && <p className="pt-alert" role="alert">{err}</p>}
    </section>
  );
}

/** Small screens: keep the progress and the send button in reach while scrolling the checklist. */
function MobileBar({ v }: { v: AppView }) {
  const { t } = usePT();
  if (!v.application.canUpload) return null;
  return (
    <div className="pt-mbar" aria-hidden={false}>
      <span>{v.checklist.complete ? t.allIn : t.docsIn(v.checklist.requiredDone, v.checklist.requiredTotal)}</span>
      <button type="button" className="pt-btn pt-btn-sm" disabled={!v.application.canSubmit} onClick={() => document.querySelector('.pt-submit')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{t.submit}</button>
    </div>
  );
}

function Details({ v, onView }: { v: AppView; onView: (v: AppView) => void }) {
  const { t, L } = usePT();
  const req = useQuery({ queryKey: ['portal-req', `?tenant=${v.tenant.id}`], queryFn: () => p.get<Requirements>(`/public/requirements?tenant=${encodeURIComponent(v.tenant.id)}`), enabled: v.application.canEdit, staleTime: 60_000 });
  const [edit, setEdit] = useState(false);
  const [type, setType] = useState<EntityType | null>(v.application.entityType);
  const [answers, setAnswers] = useState(v.application.answers);
  const [err, setErr] = useState<string | null>(null);
  const questions = useMemo(() => (type === v.application.entityType ? v.application.questions : req.data?.entityTypes.find((e) => e.id === type)?.questions ?? []), [type, v, req.data]);
  const save = async () => {
    setErr(null);
    try {
      onView(await p.patch<AppView>('/portal/application', { ...(type && type !== v.application.entityType ? { entityType: type } : {}), answers }));
      setEdit(false);
    } catch (x) {
      setErr(errMsg(x, t.errorGeneric));
    }
  };
  return (
    <section className="pt-panel">
      <div className="pt-panel-h">
        <h2>{t.details}</h2>
        {v.application.canEdit && !edit && <button type="button" className="pt-linkbtn" onClick={() => { setType(v.application.entityType); setAnswers(v.application.answers); setEdit(true); }}>{t.change}</button>}
      </div>
      {edit ? (
        <div className="pt-stack">
          <select value={type ?? ''} onChange={(e) => setType(e.target.value as EntityType)} aria-label={t.companyType}>
            {req.data?.entityTypes.map((e) => <option key={e.id} value={e.id}>{L(e.label, e.labelAr)}</option>)}
          </select>
          <Questions questions={questions} answers={answers} onChange={setAnswers} />
          {err && <p className="pt-alert" role="alert">{err}</p>}
          <div className="pt-row-actions">
            <button type="button" className="pt-btn pt-btn-sm" onClick={save}>{t.save}</button>
            <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm" onClick={() => setEdit(false)}>{t.back}</button>
          </div>
        </div>
      ) : (
        <dl className="pt-dl">
          <dt>{t.ref}</dt><dd dir="ltr">{v.application.ref}</dd>
          <dt>{t.companyType}</dt><dd>{L(v.application.entityLabel, v.application.entityLabelAr)}</dd>
          {v.application.contact && <><dt>{t.contact}</dt><dd>{v.application.contact.name}, <span dir="ltr">{v.application.contact.emailMasked}</span></dd></>}
          {v.application.questions.filter((q) => v.application.answers[q.id] !== undefined).map((q) => {
            const a = v.application.answers[q.id];
            const shown = typeof a === 'boolean' ? (a ? t.yes : t.no) : L(q.options?.find((o) => o.value === a)?.label ?? String(a), q.options?.find((o) => o.value === a)?.labelAr);
            return <div key={q.id} className="pt-dl-row"><dt>{L(q.label, q.labelAr)}</dt><dd>{shown}</dd></div>;
          })}
        </dl>
      )}
    </section>
  );
}

function Timeline({ v }: { v: AppView }) {
  const { t, lang } = usePT();
  const fmt = (iso: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  return (
    <section className="pt-panel">
      <h2>{t.timeline}</h2>
      <ol className="pt-tl">
        {v.timeline.map((e, i) => (
          <li key={i}><span>{t.ev[e.kind] ?? e.kind}{e.kind === 'documents' && e.detail ? ` (${e.detail})` : ''}</span><time dateTime={e.at}>{fmt(e.at)}</time></li>
        ))}
      </ol>
    </section>
  );
}
