import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, can } from '../api';
import { useMe } from '../App';
import { useI18n } from '../i18n';
import { Modal, toast } from '../components/ui';
import { ENTITY_LABELS } from '../types';

interface Acq { code: string; label: string; example: boolean }
type Picked = { file: File; path: string };

async function readEntries(items: DataTransferItemList): Promise<Picked[]> {
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file: f, path: prefix + f.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[] = [];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  const entries = Array.from(items).map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  for (const e of entries) await walk(e, '');
  return out;
}

export function NewCase() {
  const nav = useNavigate();
  const me = useMe();
  const { t, entity, role, err } = useI18n();
  const acq = useQuery({ queryKey: ['acquirers'], queryFn: () => api.get<{ acquirers: Acq[] }>('/acquirers') });
  const [entity_, setEntity] = useState('auto');
  const [acquirer, setAcquirer] = useState('');
  const [name, setName] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [email, setEmail] = useState<{ subject: string; from: string; body: string; files: File[] } | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const acqCode = acquirer || acq.data?.acquirers[0]?.code || '';

  const add = (list: Picked[]) => setFiles((cur) => [...cur, ...list.filter((p) => !p.path.split('/').some((s) => s.startsWith('.')))]);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.items?.length && 'webkitGetAsEntry' in DataTransferItem.prototype) add(await readEntries(e.dataTransfer.items));
    else add(Array.from(e.dataTransfer.files).map((f) => ({ file: f, path: f.name })));
  };

  // documents are optional: a case can be created empty and filled later (or by the merchant through an upload link)
  const start = async () => {
    try {
      setBusy(t('Creating case'));
      const c = await api.post<{ id: string }>('/cases', { acquirerCode: acqCode, entityType: entity_, name: name || undefined });
      if (files.length || email) {
        setBusy(t('Uploading documents'));
        const fd = new FormData();
        files.forEach((p) => fd.append('files', p.file, p.path));
        if (email) {
          const attachments = await Promise.all(email.files.map(async (f) => ({ filename: f.name, contentBase64: await toB64(f) })));
          fd.append('email', JSON.stringify({ subject: email.subject, from: email.from, body: email.body, attachments }));
        }
        const up = await api.form<{ added: unknown[]; rejected: { name: string; reason: string }[]; duplicates: string[] }>(`/cases/${c.id}/documents`, fd);
        if (up.rejected.length) toast(t('{n} file(s) rejected: {list}', { n: up.rejected.length, list: up.rejected.map((r) => `${r.name} (${r.reason})`).join(', ') }));
        if (up.added.length) {
          setBusy(t('Starting agents'));
          await api.post(`/cases/${c.id}/run`);
        }
      }
      nav(`/cases/${c.id}`);
    } catch (e) {
      toast(err(e));
      setBusy('');
    }
  };

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 980 }}>
      <div>
        <p className="eyebrow">{t('New case')}</p>
        <h1 className="h1">{t('Drop the pack.')}<span className="grey">{t('The agents read every page.')}</span></h1>
        <p className="lede">{t('PDFs, images, whole folders, zips or a forwarded email. Bundled PDFs are split by document. Nothing is typed by hand.')}</p>
      </div>
      {me && !can.write(me) && <div className="banner warn" role="alert">{t('Your role ({role}) can review cases but cannot create them. Sign in as an underwriter or admin to create a case.', { role: role(me.role) })}</div>}
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        aria-label={t('Drop zone')}
      >
        <div className="hex" aria-hidden style={{ marginBottom: 12 }} />
        <h2 className="h2">{t('Drag files, folders or a zip here')}</h2>
        <p className="muted">{t('PDF, PNG, JPG, ZIP or .eml, up to 25 MB per file')}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-dark" onClick={() => fileRef.current?.click()}>{t('Choose files')}</button>
          <button className="btn" onClick={() => dirRef.current?.click()}>{t('Choose folder')}</button>
          <button className="btn" onClick={() => setShowEmail(true)}>{t('Attach email')}</button>
        </div>
        <input ref={fileRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.zip,.eml" onChange={(e) => add(Array.from(e.target.files ?? []).map((f) => ({ file: f, path: f.name })))} />
        <input ref={dirRef} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => add(Array.from(e.target.files ?? []).map((f) => ({ file: f, path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name })))} />
      </div>

      {(files.length > 0 || email) && (
        <div className="card card-paper">
          <div className="row between"><h3 className="h3">{t('{n} file(s)', { n: files.length })}{email ? t(' + 1 email') : ''}</h3><button className="btn btn-ghost btn-sm" onClick={() => { setFiles([]); setEmail(null); }}>{t('Clear')}</button></div>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            {files.slice(0, 40).map((p, i) => <span key={i} className="chip" title={p.path}>{p.path.length > 38 ? '…' + p.path.slice(-36) : p.path}</span>)}
            {files.length > 40 && <span className="chip">{t('+{n} more', { n: files.length - 40 })}</span>}
            {email && <span className="chip on">{t('email: {s}', { s: email.subject || t('(no subject)') })}</span>}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <div className="field"><label htmlFor="nm">{t('Case name (optional)')}</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Taken from the licence if empty')} /></div>
        <div className="field"><label htmlFor="et">{t('Entity type')}</label>
          <select id="et" className="select" value={entity_} onChange={(e) => setEntity(e.target.value)}>{Object.keys(ENTITY_LABELS).map((k) => <option key={k} value={k}>{entity(k)}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="aq">{t('Acquirer')}</label>
          <select id="aq" className="select" value={acqCode} onChange={(e) => setAcquirer(e.target.value)}>{acq.data?.acquirers.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}</select>
        </div>
      </div>
      <div className="row">
        <button className="btn btn-honey" disabled={!!busy || !acqCode || !can.write(me)} onClick={start}>{busy || (files.length || email ? t('Create case and run agents') : t('Create case'))}</button>
        <span className="muted small">{files.length || email ? t('The agents prepare and recommend. Only a human reviewer can approve.') : t('Documents are optional here. Add them now, later on the case, or email the merchant an upload link.')}</span>
      </div>

      {showEmail && <EmailModal onClose={() => setShowEmail(false)} onSave={(e) => { setEmail(e); setShowEmail(false); }} />}
    </div>
  );
}

function EmailModal({ onClose, onSave }: { onClose: () => void; onSave: (e: { subject: string; from: string; body: string; files: File[] }) => void }) {
  const { t } = useI18n();
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  return (
    <Modal title={t('Attach a forwarded email')} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('Paste the email and add its attachments, or drop the .eml file in the main drop zone. Email text is treated as data, never as instructions.')}</p>
        <div className="field"><label>{t('From')}</label><input className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>{t('Subject')}</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>{t('Body')}</label><textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="field"><label>{t('Attachments')}</label><input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></div>
        <div className="row"><button className="btn btn-dark" onClick={() => onSave({ subject, from, body, files })}>{t('Attach')}</button><button className="btn btn-ghost" onClick={onClose}>{t('Cancel')}</button></div>
      </div>
    </Modal>
  );
}

function toB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}
