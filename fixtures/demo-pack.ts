/**
 * Builds the DEMO PACK: three synthetic merchants for live demos of the onboarding portal and console.
 * Every name, number, company and authority is invented and every page says so. The documents use the
 * "Label: value" text layer that the mock extractor reads, so the demo works without a live model.
 *
 *   npx tsx fixtures/demo-pack.ts            writes demo-pack/<scenario>/*.pdf and demo-pack/README.txt
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const OUT = path.resolve(__dirname, '..', 'demo-pack');
const DET = 'Synthetic Department of Economy and Tourism (Demo)';
const FZ = 'Synthetic Free Zone Authority (Demo)';
const ADDR = 'Shop 4, Demo Plaza, Al Wasl Road, Dubai';

type Row = [string, string];
interface DocSpec { title: string; issuer: string; rows: Row[]; pages?: { heading: string; rows: Row[] }[] }

const INK = rgb(0.09, 0.1, 0.12);
const GREY = rgb(0.42, 0.44, 0.48);
const BAND = rgb(0.13, 0.2, 0.3);
const ACCENT = rgb(0.85, 0.66, 0.27);

function header(p: PDFPage, font: PDFFont, bold: PDFFont, title: string, issuer: string) {
  const { width, height } = p.getSize();
  p.drawRectangle({ x: 0, y: height - 34, width, height: 34, color: BAND });
  p.drawText('SAMPLE DOCUMENT - SYNTHETIC DEMO DATA - NOT VALID FOR ANY PURPOSE', { x: 40, y: height - 22, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  p.drawText(title, { x: 40, y: height - 80, size: 19, font: bold, color: INK });
  p.drawText(`Issued by ${issuer}`, { x: 40, y: height - 100, size: 10, font, color: GREY });
  p.drawRectangle({ x: 40, y: height - 114, width: 60, height: 3, color: ACCENT });
  p.drawLine({ start: { x: 104, y: height - 112.5 }, end: { x: width - 40, y: height - 112.5 }, thickness: 0.6, color: rgb(0.85, 0.86, 0.88) });
}
function rows(p: PDFPage, font: PDFFont, bold: PDFFont, list: Row[], startY: number) {
  let y = startY;
  for (const [k, v] of list) {
    p.drawText(`${k}: `, { x: 40, y, size: 10.5, font: bold, color: INK });
    p.drawText(v, { x: 210, y, size: 10.5, font, color: INK });
    y -= 22;
  }
  return y;
}
function footer(p: PDFPage, font: PDFFont, n: number, of: number) {
  p.drawLine({ start: { x: 40, y: 58 }, end: { x: p.getSize().width - 40, y: 58 }, thickness: 0.6, color: rgb(0.85, 0.86, 0.88) });
  p.drawText('Demo pack for the MoneyBee onboarding demonstration. All names, numbers and authorities are invented.', { x: 40, y: 42, size: 7.5, font, color: GREY });
  p.drawText(`Page ${n} of ${of}`, { x: p.getSize().width - 90, y: 42, size: 7.5, font, color: GREY });
}

async function pdf(d: DocSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-10-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-10-01T00:00:00Z'));
  doc.setTitle(`${d.title} (synthetic demo document)`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const extra = d.pages ?? [];
  const total = 1 + extra.length;
  const p = doc.addPage([595, 842]);
  header(p, font, bold, d.title, d.issuer);
  rows(p, font, bold, d.rows, 842 - 150);
  footer(p, font, 1, total);
  extra.forEach((x, i) => {
    const q = doc.addPage([595, 842]);
    q.drawRectangle({ x: 0, y: 842 - 34, width: 595, height: 34, color: BAND });
    q.drawText('SAMPLE DOCUMENT - SYNTHETIC DEMO DATA - NOT VALID FOR ANY PURPOSE', { x: 40, y: 842 - 22, size: 8.5, font: bold, color: rgb(1, 1, 1) });
    q.drawText(x.heading, { x: 40, y: 842 - 80, size: 13, font: bold, color: INK });
    rows(q, font, bold, x.rows, 842 - 120);
    footer(q, font, i + 2, total);
  });
  return doc.save();
}

interface Person { name: string; nat: string; eid: string; dob: string; passport: string }
const person = (name: string, n: number, nat: string): Person => ({ name, nat, eid: `784-1988-${String(2400000 + n * 13).padStart(7, '0')}-${n % 10}`, dob: `198${n % 9}-0${(n % 8) + 1}-1${n % 9}`, passport: `DEMO${String(4100000 + n)}` });
type Sh = { name: string; type?: 'natural' | 'corporate'; pct: number; nat?: string };
const shRows = (list: Sh[]): Row[] => list.map((s, i) => [`Shareholder ${i + 1}`, `${s.name} | ${s.type ?? 'natural'} | ${s.pct} | ${s.nat ?? 'Demoland'}`]);

const D = {
  licence: (o: { legal: string; trade: string; no: string; auth: string; form: string; issue: string; expiry: string; owners: string[]; managers: string[]; activities: string }): DocSpec => ({
    title: 'TRADE LICENCE', issuer: o.auth,
    rows: [['Authority', o.auth], ['Legal Name', o.legal], ['Trade Name', o.trade], ['Licence Number', o.no], ['Licence Authority', o.auth], ['Legal Form', o.form], ['Issue Date', o.issue], ['Expiry Date', o.expiry], ['Activities', o.activities], ['Registered Address', ADDR], ['Owner Names', o.owners.join('; ')], ['Manager Names', o.managers.join('; ')]],
  }),
  moa: (o: { legal: string; sh: Sh[]; dirs: Person[] }): DocSpec => ({
    title: 'MEMORANDUM OF ASSOCIATION', issuer: 'Notary Public (Demo)',
    rows: [['Legal Name', o.legal], ['Share Capital', '300000'], ...shRows(o.sh)],
    pages: [{ heading: 'Management', rows: o.dirs.map((d, i) => [`Director ${i + 1}`, `${d.name} | ${d.nat} | Manager`] as Row) }],
  }),
  register: (o: { legal: string; sh: Sh[] }): DocSpec => ({ title: 'REGISTER OF SHAREHOLDERS', issuer: 'Company Secretary (Demo)', rows: [['Legal Name', o.legal], ['As Of Date', '2026-09-30'], ...shRows(o.sh)] }),
  corp: (o: { legal: string; reg: string; sh: Sh[] }): DocSpec => ({ title: 'CORPORATE SHAREHOLDER DOCUMENTS', issuer: FZ, rows: [['Legal Name', o.legal], ['Registration Number', o.reg], ['Jurisdiction', 'Demoland Free Zone'], ...shRows(o.sh)] }),
  signatory: (o: { legal: string; sig: Person[] }): DocSpec => ({
    title: 'BOARD RESOLUTION - AUTHORISED SIGNATORY LETTER', issuer: 'Board of Directors (Demo)',
    rows: [['Legal Name', o.legal], ...o.sig.map((s, i) => [`Authorised Signatory ${i + 1}`, `${s.name} | ${s.nat} | Signatory`] as Row), ['Issue Date', '2026-01-10'], ['Expiry Date', '2028-01-09']],
  }),
  eid: (p: Person): DocSpec => ({ title: 'UNITED ARAB EMIRATES - EMIRATES ID', issuer: 'Synthetic Identity Authority (Demo)', rows: [['Full Name', p.name], ['ID Number', p.eid], ['Nationality', p.nat], ['DOB', p.dob], ['Expiry Date', '2028-11-30']] }),
  passport: (p: Person): DocSpec => ({ title: 'PASSPORT', issuer: 'Synthetic Passport Office (Demo)', rows: [['Full Name', p.name], ['Passport Number', p.passport], ['Nationality', p.nat], ['DOB', p.dob], ['Issue Date', '2023-02-01'], ['Expiry Date', '2033-01-31']] }),
  lease: (o: { tenant: string }): DocSpec => ({ title: 'EJARI TENANCY CONTRACT', issuer: 'Synthetic Land Department (Demo)', rows: [['Tenant Name', o.tenant], ['Address', ADDR], ['Ejari Number', 'EJ-DEMO-778899'], ['Start Date', '2025-01-01'], ['Expiry Date', '2027-12-31']] }),
  bank: (o: { acct: string; iban: string }): DocSpec => ({ title: 'BANK LETTER - IBAN CERTIFICATE', issuer: 'Demo National Bank', rows: [['Account Name', o.acct], ['Bank Name', 'Demo National Bank'], ['IBAN', o.iban], ['Account Opened Date', '2023-04-01']] }),
  vat: (o: { legal: string; trn: string }): DocSpec => ({ title: 'VAT REGISTRATION CERTIFICATE', issuer: 'Synthetic Tax Authority (Demo)', rows: [['Legal Name', o.legal], ['TRN', o.trn], ['Registered Address', ADDR], ['Effective Date', '2024-01-01']] }),
  ubo: (o: { legal: string; ubos: { name: string; pct: number; nat: string }[] }): DocSpec => ({
    title: 'UBO DECLARATION', issuer: 'Declared by the company (Demo)',
    rows: [['Legal Name', o.legal], ['Control By Other Means', 'No'], ...o.ubos.map((u, i) => [`UBO ${i + 1}`, `${u.name} | natural | ${u.pct} | ${u.nat}`] as Row), ['Signed Date', '2026-09-01']],
  }),
  website: (o: { site: string; desc: string; products: string; mcc: string; vol: number; ticket: number }): DocSpec => ({
    title: 'WEBSITE AND PRODUCT DESCRIPTION', issuer: 'Prepared by the merchant (Demo)',
    rows: [['Website', o.site], ['Business Description', o.desc], ['Products', o.products], ['MCC', o.mcc], ['Expected Monthly Volume', String(o.vol)], ['Expected Avg Ticket', String(o.ticket)]],
  }),
};

const scenarios: { slug: string; title: string; entity: string; expect: string; docs: Record<string, DocSpec> }[] = [];

// A. clean mainland LLC, two owners 60/40 -> LOW risk, approve and complete
{
  const legal = 'Golden Palm Restaurant LLC';
  const a = person('Sara Al Demo', 1, 'Demoland');
  const b = person('Omar Al Sample', 2, 'Demoland');
  const sh: Sh[] = [{ name: a.name, pct: 60 }, { name: b.name, pct: 40 }];
  scenarios.push({
    slug: 'A - Golden Palm Restaurant (clean, low risk)', title: legal, entity: 'LLC (mainland)',
    expect: 'All 11 required documents recognised, fields extracted, owners matched to their IDs, 2 beneficial owners (60% and 40%), screening clear, risk LOW. Approve, then complete to mint the onboarding token.',
    docs: {
      'Trade Licence.pdf': D.licence({ legal, trade: 'Golden Palm Cafe', no: 'DEMO-245001', auth: DET, form: 'LLC', issue: '2023-03-15', expiry: '2027-03-14', owners: [a.name, b.name], managers: [a.name], activities: 'Restaurants; Cafe; Food delivery' }),
      'Memorandum of Association.pdf': D.moa({ legal, sh, dirs: [a] }),
      'Register of Shareholders.pdf': D.register({ legal, sh }),
      'Emirates ID - Sara Al Demo.pdf': D.eid(a), 'Emirates ID - Omar Al Sample.pdf': D.eid(b), 'Passport - Sara Al Demo.pdf': D.passport(a),
      'Ejari Tenancy Contract.pdf': D.lease({ tenant: legal }), 'Bank Letter - IBAN.pdf': D.bank({ acct: legal, iban: 'AE460331234567890123401' }),
      'Authorised Signatory Letter.pdf': D.signatory({ legal, sig: [a] }), 'UBO Declaration.pdf': D.ubo({ legal, ubos: [{ name: a.name, pct: 60, nat: a.nat }, { name: b.name, pct: 40, nat: b.nat }] }),
      'Website and Products.pdf': D.website({ site: 'https://goldenpalm.example', desc: 'Cafe and restaurant taking in-store and app payments', products: 'Meals; Coffee; Desserts', mcc: '5812', vol: 250000, ticket: 85 }),
      'VAT Certificate.pdf': D.vat({ legal, trn: '100245001200003' }),
    },
  });
}

// B. two-layer corporate ownership -> ownership graph, 2 UBOs found through the chain
{
  const legal = 'Blue Dhow Logistics LLC';
  const huda = person('Huda Al Example', 3, 'Demoland');
  const yousef = person('Yousef Al Sample', 4, 'Demoland');
  const noura = person('Noura Demo', 5, 'Demoland');
  const karim = person('Karim Testwood', 6, 'Demoland');
  const coral = 'Coral Bay Holdings FZE';
  const pearl = 'Pearl Ridge Capital FZCO';
  const sh: Sh[] = [{ name: coral, type: 'corporate', pct: 70 }, { name: huda.name, pct: 30 }];
  scenarios.push({
    slug: 'B - Blue Dhow Logistics (layered ownership)', title: legal, entity: 'LLC (mainland)',
    expect: '70% is held through two holding companies. The agents trace the chain: Huda Al Example (30%) and Yousef Al Sample (28% through Coral Bay) are beneficial owners; Noura Demo and Karim Testwood (21% each) fall below the 25% threshold. See the Ownership tab.',
    docs: {
      'Trade Licence.pdf': D.licence({ legal, trade: 'Blue Dhow Express', no: 'DEMO-245002', auth: DET, form: 'LLC', issue: '2022-05-10', expiry: '2027-05-09', owners: [coral, huda.name], managers: [huda.name], activities: 'Courier services; Last mile delivery' }),
      'Memorandum of Association.pdf': D.moa({ legal, sh, dirs: [huda] }),
      'Register of Shareholders.pdf': D.register({ legal, sh }),
      'Coral Bay Holdings - shareholder documents.pdf': D.corp({ legal: coral, reg: 'CBH-2201', sh: [{ name: pearl, type: 'corporate', pct: 60 }, { name: yousef.name, pct: 40 }] }),
      'Pearl Ridge Capital - shareholder documents.pdf': D.corp({ legal: pearl, reg: 'PRC-1907', sh: [{ name: noura.name, pct: 50 }, { name: karim.name, pct: 50 }] }),
      'Emirates ID - Huda Al Example.pdf': D.eid(huda), 'Emirates ID - Yousef Al Sample.pdf': D.eid(yousef), 'Emirates ID - Noura Demo.pdf': D.eid(noura), 'Emirates ID - Karim Testwood.pdf': D.eid(karim),
      'Passport - Huda Al Example.pdf': D.passport(huda), 'Ejari Tenancy Contract.pdf': D.lease({ tenant: legal }), 'Bank Letter - IBAN.pdf': D.bank({ acct: legal, iban: 'AE460331234567890123402' }),
      'Authorised Signatory Letter.pdf': D.signatory({ legal, sig: [huda] }), 'UBO Declaration.pdf': D.ubo({ legal, ubos: [{ name: huda.name, pct: 30, nat: huda.nat }, { name: yousef.name, pct: 28, nat: yousef.nat }] }),
      'Website and Products.pdf': D.website({ site: 'https://bluedhow.example', desc: 'Same day courier and parcel delivery', products: 'Parcel delivery; Cash on delivery', mcc: '4215', vol: 400000, ticket: 60 }),
      'VAT Certificate.pdf': D.vat({ legal, trn: '100245002200003' }),
    },
  });
}

// C. owner on the (mock) sanctions list -> REFER, second reviewer required
{
  const legal = 'Redline General Trading LLC';
  const o = person('Testov Sanctionedov', 7, 'Demoland');
  const sh: Sh[] = [{ name: o.name, pct: 100 }];
  scenarios.push({
    slug: 'C - Redline General Trading (sanctions hit)', title: legal, entity: 'LLC (mainland)',
    expect: 'The sole owner matches an entry on the MOCK sanctions list (a made-up name). Rating REFER, a second reviewer is required, and the memo explains why. Shows that the agents recommend but never approve.',
    docs: {
      'Trade Licence.pdf': D.licence({ legal, trade: 'Redline Trading', no: 'DEMO-245003', auth: DET, form: 'LLC', issue: '2024-02-01', expiry: '2027-01-31', owners: [o.name], managers: [o.name], activities: 'General trading' }),
      'Memorandum of Association.pdf': D.moa({ legal, sh, dirs: [o] }), 'Register of Shareholders.pdf': D.register({ legal, sh }),
      'Emirates ID.pdf': D.eid(o), 'Passport.pdf': D.passport(o), 'Ejari Tenancy Contract.pdf': D.lease({ tenant: legal }), 'Bank Letter - IBAN.pdf': D.bank({ acct: legal, iban: 'AE460331234567890123403' }),
      'Authorised Signatory Letter.pdf': D.signatory({ legal, sig: [o] }), 'UBO Declaration.pdf': D.ubo({ legal, ubos: [{ name: o.name, pct: 100, nat: o.nat }] }),
      'Website and Products.pdf': D.website({ site: 'https://redline.example', desc: 'General trading of household goods', products: 'Household goods', mcc: '5812', vol: 200000, ticket: 120 }),
      'VAT Certificate.pdf': D.vat({ legal, trn: '100245003200003' }),
    },
  });
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  for (const s of scenarios) {
    const dir = path.join(OUT, s.slug);
    mkdirSync(dir, { recursive: true });
    for (const [name, spec] of Object.entries(s.docs)) writeFileSync(path.join(dir, name), await pdf(spec));
  }
  const readme = [
    'MoneyBee x Botim onboarding - demo pack',
    '========================================',
    '',
    'Synthetic documents for three made-up merchants. Every page is marked SAMPLE / NOT VALID.',
    'Upload a whole folder: in the merchant portal (drop all files at once) or in the ops console (New case).',
    '',
    ...scenarios.flatMap((s) => [`${s.slug}`, `  Company: ${s.title} - choose "${s.entity}"`, `  Files: ${Object.keys(s.docs).length}`, `  What the agents show: ${s.expect}`, '']),
    'Portal answers that match these packs: VAT registered = Yes, corporate shareholders = No (Yes for B), chamber member = No.',
    'Real documents also upload fine. Without a live model the agents cannot read them, so they are sorted by file name',
    'or the merchant picks the type ("What is this document?") and a reviewer confirms. Documents are optional at every step.',
  ].join('\n');
  writeFileSync(path.join(OUT, 'README.txt'), readme + '\n');
  console.log(`demo pack written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
