import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
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
  const acq = useQuery({ queryKey: ['acquirers'], queryFn: () => api.get<{ acquirers: Acq[] }>('/acquirers') });
  const [entity, setEntity] = useState('auto');
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

  const start = async () => {
    if (!files.length && !email) return toast('Add files, a folder, a zip or an email first');
    try {
      setBusy('Creating case');
      const c = await api.post<{ id: string }>('/cases', { acquirerCode: acqCode, entityType: entity, name: name || undefined });
      setBusy('Uploading documents');
      const fd = new FormData();
      files.forEach((p) => fd.append('files', p.file, p.path));
      if (email) {
        const attachments = await Promise.all(email.files.map(async (f) => ({ filename: f.name, contentBase64: await toB64(f) })));
        fd.append('email', JSON.stringify({ subject: email.subject, from: email.from, body: email.body, attachments }));
      }
      const up = await api.form<{ added: unknown[]; rejected: { name: string; reason: string }[]; duplicates: string[] }>(`/cases/${c.id}/documents`, fd);
      if (up.rejected.length) toast(`${up.rejected.length} file(s) rejected: ${up.rejected.map((r) => `${r.name} (${r.reason})`).join(', ')}`);
      if (up.added.length) {
        setBusy('Starting agents');
        await api.post(`/cases/${c.id}/run`);
      }
      nav(`/cases/${c.id}`);
    } catch (e) {
      toast((e as Error).message);
      setBusy('');
    }
  };

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 980 }}>
      <div>
        <p className="eyebrow">New case</p>
        <h1 className="h1">Drop the pack.<span className="grey">The agents read every page.</span></h1>
        <p className="lede">PDFs, images, whole folders, zips or a forwarded email. Bundled PDFs are split by document. Nothing is typed by hand.</p>
      </div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        aria-label="Drop zone"
      >
        <div className="hex" aria-hidden style={{ marginBottom: 12 }} />
        <h2 className="h2">Drag files, folders or a zip here</h2>
        <p className="muted">PDF, PNG, JPG, ZIP or .eml, up to 25 MB per file</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-dark" onClick={() => fileRef.current?.click()}>Choose files</button>
          <button className="btn" onClick={() => dirRef.current?.click()}>Choose folder</button>
          <button className="btn" onClick={() => setShowEmail(true)}>Attach email</button>
        </div>
        <input ref={fileRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.zip,.eml" onChange={(e) => add(Array.from(e.target.files ?? []).map((f) => ({ file: f, path: f.name })))} />
        <input ref={dirRef} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => add(Array.from(e.target.files ?? []).map((f) => ({ file: f, path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name })))} />
      </div>

      {(files.length > 0 || email) && (
        <div className="card card-paper">
          <div className="row between"><h3 className="h3">{files.length} file(s){email ? ' + 1 email' : ''}</h3><button className="btn btn-ghost btn-sm" onClick={() => { setFiles([]); setEmail(null); }}>Clear</button></div>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            {files.slice(0, 40).map((p, i) => <span key={i} className="chip" title={p.path}>{p.path.length > 38 ? '…' + p.path.slice(-36) : p.path}</span>)}
            {files.length > 40 && <span className="chip">+{files.length - 40} more</span>}
            {email && <span className="chip on">email: {email.subject || '(no subject)'}</span>}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <div className="field"><label htmlFor="nm">Case name (optional)</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from the licence if empty" /></div>
        <div className="field"><label htmlFor="et">Entity type</label>
          <select id="et" className="select" value={entity} onChange={(e) => setEntity(e.target.value)}>{Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="aq">Acquirer</label>
          <select id="aq" className="select" value={acqCode} onChange={(e) => setAcquirer(e.target.value)}>{acq.data?.acquirers.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}</select>
        </div>
      </div>
      <div className="row">
        <button className="btn btn-honey" disabled={!!busy || !acqCode} onClick={start}>{busy || 'Create case and run agents'}</button>
        <span className="muted small">The agents prepare and recommend. Only a human reviewer can approve.</span>
      </div>

      {showEmail && <EmailModal onClose={() => setShowEmail(false)} onSave={(e) => { setEmail(e); setShowEmail(false); }} />}
    </div>
  );
}

function EmailModal({ onClose, onSave }: { onClose: () => void; onSave: (e: { subject: string; from: string; body: string; files: File[] }) => void }) {
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  return (
    <Modal title="Attach a forwarded email" onClose={onClose}>
      <div className="stack">
        <p className="muted small">Paste the email and add its attachments, or drop the .eml file in the main drop zone. Email text is treated as data, never as instructions.</p>
        <div className="field"><label>From</label><input className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>Body</label><textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="field"><label>Attachments</label><input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></div>
        <div className="row"><button className="btn btn-dark" onClick={() => onSave({ subject, from, body, files })}>Attach</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
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
