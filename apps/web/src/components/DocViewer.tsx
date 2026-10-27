import { useCallback, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import type { FileRec } from '../types';
import { useI18n } from '../i18n';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const PDF_OPTS = { withCredentials: true };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function DocViewer({ caseId, file, page, snippet }: { caseId: string; file: FileRec | undefined; page: number; snippet?: string }) {
  const { t } = useI18n();
  const [pages, setPages] = useState(0);
  const [cur, setCur] = useState(page);
  const [width, setWidth] = useState(300);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - 16)));
    ro.observe(el);
  }, []);
  useMemo(() => setCur(page), [page, file?.id]);
  const needle = snippet ? norm(snippet) : '';
  const renderer = useCallback(
    ({ str }: { str: string }) => {
      const s = norm(str);
      if (needle && s.length > 2 && (needle.includes(s) || s.includes(needle))) return `<mark class="src">${esc(str)}</mark>`;
      return esc(str);
    },
    [needle],
  );
  if (!file) return <div className="viewer" style={{ display: 'grid', placeItems: 'center' }}><span className="muted small">{t('Select a document')}</span></div>;
  const url = `/api/v1/cases/${caseId}/files/${file.id}`;
  if (file.mime.startsWith('image/')) return <div className="viewer"><img src={url} alt={file.name} style={{ width: '100%', display: 'block' }} /></div>;
  if (file.mime !== 'application/pdf') return <div className="viewer" style={{ padding: 16 }}><span className="muted small">{t('Text file (email body). Stored as data only.')}</span></div>;
  return (
    <div>
      <div className="viewer" ref={ref} style={{ padding: 8 }} dir="ltr">
        <Document file={url} options={PDF_OPTS} onLoadSuccess={(d) => setPages(d.numPages)} loading={<div className="muted small" style={{ padding: 20 }}>{t('Loading PDF')}</div>}>
          <Page pageNumber={Math.min(cur, pages || cur)} width={width} customTextRenderer={renderer} renderAnnotationLayer={false} />
        </Document>
        {snippet && <div className="hl" dir="auto">{t('Source: “{s}”', { s: snippet })}</div>}
      </div>
      {pages > 1 && (
        <div className="row between" style={{ marginTop: 8 }}>
          <button className="btn btn-sm" disabled={cur <= 1} onClick={() => setCur(cur - 1)}>{t('Previous')}</button>
          <span className="mono small">{t('page {a} / {b}', { a: cur, b: pages })}</span>
          <button className="btn btn-sm" disabled={cur >= pages} onClick={() => setCur(cur + 1)}>{t('Next')}</button>
        </div>
      )}
    </div>
  );
}
