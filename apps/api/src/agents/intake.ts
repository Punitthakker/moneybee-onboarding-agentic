import { createHash, randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { simpleParser } from 'mailparser';
import type { Ctx } from '../context';
import type { FileRec } from '../db/types';
import { pdfPageCount, pdfPages } from '../util/pdf';
import { sanitizeFilename, scanForInjection, sniff } from '../util/safety';

export interface IntakeInput {
  name: string;
  data: Buffer;
  originPath?: string;
  source?: FileRec['source'];
  /** plain text email body: stored and scanned, never classified */
  asEmailBody?: boolean;
}
export interface IntakeResult {
  added: FileRec[];
  duplicates: string[];
  rejected: { name: string; reason: string }[];
}

const MAX_ZIP_ENTRIES = 300;
const MAX_ZIP_TOTAL = 300 * 1024 * 1024;
const MAX_ENTRY = 40 * 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Intake agent (deterministic): type sniffing, zip and email expansion, dedupe, storage, injection scan. */
export async function ingest(ctx: Ctx, caseId: string, inputs: IntakeInput[]): Promise<IntakeResult> {
  const result: IntakeResult = { added: [], duplicates: [], rejected: [] };
  const existing = new Set((await ctx.store.cases.get(caseId))?.files.map((f) => f.sha256) ?? []);
  const maxBytes = ctx.cfg.MAX_UPLOAD_MB * 1024 * 1024;

  const addFile = async (name: string, data: Buffer, source: FileRec['source'], originPath?: string, forceMime?: string) => {
    const safe = sanitizeFilename(name);
    if (data.length === 0) return void result.rejected.push({ name: safe, reason: 'empty file' });
    if (data.length > maxBytes && source !== 'zip') return void result.rejected.push({ name: safe, reason: `larger than ${ctx.cfg.MAX_UPLOAD_MB} MB` });
    const kind = forceMime ? { mime: forceMime, kind: 'unknown' as const } : sniff(data, safe);
    if (!['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(kind.mime)) return void result.rejected.push({ name: safe, reason: `unsupported or mismatched file type (${kind.mime})` });
    const hash = sha(data);
    if (existing.has(hash)) return void result.duplicates.push(safe);
    existing.add(hash);

    const id = randomUUID();
    const storageKey = `cases/${caseId}/files/${id}/${safe}`;
    let pageCount: number | undefined;
    let injectionMatches: string[] = [];
    if (kind.mime === 'application/pdf') {
      try {
        pageCount = await pdfPageCount(data);
        const text = (await pdfPages(data)).join('\n');
        injectionMatches = scanForInjection(text);
      } catch {
        return void result.rejected.push({ name: safe, reason: 'PDF could not be parsed (corrupt or encrypted)' });
      }
    } else if (kind.mime === 'text/plain') {
      injectionMatches = scanForInjection(data.toString('utf8'));
    }
    await ctx.blobs.put(storageKey, data);
    result.added.push({
      id, name: safe, mime: kind.mime, size: data.length, sha256: hash, storageKey, pageCount, source, originPath,
      injectionSuspected: injectionMatches.length > 0 || undefined,
      injectionMatches: injectionMatches.length ? injectionMatches : undefined,
      createdAt: ctx.now().toISOString(),
    });
  };

  for (const input of inputs) {
    const safe = sanitizeFilename(input.name);
    const kind = sniff(input.data, safe);
    if (input.asEmailBody) {
      await addFile(input.name, input.data, 'email_body', input.originPath, 'text/plain');
    } else if (kind.kind === 'zip') {
      try {
        const zip = new AdmZip(input.data);
        const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.startsWith('__MACOSX/') && !/(^|\/)\.[^/]+$/.test(e.entryName));
        if (entries.length > MAX_ZIP_ENTRIES) throw new Error(`zip has more than ${MAX_ZIP_ENTRIES} files`);
        let total = 0;
        for (const e of entries) {
          total += e.header.size;
          if (e.header.size > MAX_ENTRY) throw new Error(`zip entry ${sanitizeFilename(e.entryName)} is too large`);
          if (total > MAX_ZIP_TOTAL) throw new Error('zip expands to more than the allowed size (possible zip bomb)');
        }
        for (const e of entries) {
          const data = e.getData(); // never written to disk by path: no zip-slip
          if (sniff(data, e.entryName).kind === 'zip') {
            result.rejected.push({ name: sanitizeFilename(e.entryName), reason: 'nested archives are not expanded' });
            continue;
          }
          await addFile(e.entryName, data, 'zip', e.entryName);
        }
      } catch (e) {
        result.rejected.push({ name: safe, reason: `zip rejected: ${e instanceof Error ? e.message : 'invalid archive'}` });
      }
    } else if (kind.kind === 'eml') {
      try {
        const mail = await simpleParser(input.data);
        const body = `From: ${mail.from?.text ?? ''}\nSubject: ${mail.subject ?? ''}\n\n${mail.text ?? ''}`;
        await addFile(`email-body-${sanitizeFilename(mail.subject ?? 'message')}.txt`, Buffer.from(body, 'utf8'), 'email_body', `email:${mail.subject ?? ''}`, 'text/plain');
        for (const att of mail.attachments ?? []) await addFile(att.filename ?? 'attachment', att.content, 'email', `email:${mail.subject ?? ''}`);
      } catch {
        result.rejected.push({ name: safe, reason: 'email could not be parsed' });
      }
    } else {
      await addFile(input.name, input.data, input.source ?? 'upload', input.originPath);
    }
  }
  return result;
}
