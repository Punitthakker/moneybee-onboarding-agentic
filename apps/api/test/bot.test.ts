import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import type { BotAnswers, MccResult } from '@moneybee/shared';
import { makeTestApp } from './helpers';
import { BotMachine, buildChecklist, classifyByKeywords, getOrCreateSession, loadBotPolicy, notifyDecision, prescreen, quote, redact, sessionIdFor, type Inbound, type Reply } from '../src/bot';
import { buildResult } from '../src/bot/mcc';

const FIX = path.resolve(__dirname, '../../../fixtures/merchants/03-free-zone-fzco');
const pdf = (name: string): Inbound => ({ type: 'media', name, mime: 'application/pdf', data: fs.readFileSync(path.join(FIX, name)) });
const text = (s: string): Inbound => ({ type: 'text', text: s });
const choice = (id: string): Inbound => ({ type: 'choice', id });

const bot = loadBotPolicy(path.resolve(__dirname, '../../..'));

const baseAnswers = (over: Partial<BotAnswers> = {}): BotAnswers => ({
  consent: true,
  contactName: 'Salma',
  companyName: 'Nimbus Pay Labs FZCO',
  entityChoice: 'free_zone',
  entityType: 'free_zone',
  emirate: 'Dubai',
  description: 'restaurant and cafe in JLT with delivery',
  category: 'food',
  channel: 'both',
  customerType: 'b2c',
  billing: 'oneoff',
  customerLocation: 'uae',
  volumeBand: 'V3',
  ticketBand: 'T2',
  currentGateway: 'none',
  yearsBand: '1to3',
  web: 'nimbus.example',
  noWebPresence: false,
  activityFlags: [],
  ...over,
});

describe('bot policy and keyword classifier', () => {
  it('loads and has every tier represented', () => {
    const tiers = new Set(bot.mccCatalogue.map((e) => e.tier));
    expect(tiers).toEqual(new Set(['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED', 'PROHIBITED']));
    expect(Object.keys(bot.categoryDefaultMcc)).toHaveLength(10);
  });
  it.each([
    ['restaurant and cafe in JLT with delivery', 'food', '5812'],
    ['we sell abayas and women fashion online', 'fashion_beauty', '5621'],
    ['mobile phones and iphone accessories shop', 'electronics', '4812'],
    ['travel agency selling umrah packages and tours', 'travel', '4722'],
    ['crypto exchange and bitcoin otc desk', undefined, '6051'],
    ['online casino and betting', undefined, '7995'],
    ['gym memberships and yoga classes', 'health', '7997'],
  ])('%s -> %s', (desc, cat, mcc) => {
    const r = classifyByKeywords(bot, desc, cat as never);
    expect(r?.mcc).toBe(mcc);
  });
  it('activity flags raise the tier', () => {
    const a = baseAnswers({ activityFlags: ['travel_ticketing'] });
    const r = buildResult(bot, '5812', 0.9, 'x', 'keyword', a);
    expect(r.tier).toBe('HIGH');
    const p = buildResult(bot, '5812', 0.9, 'x', 'keyword', baseAnswers({ activityFlags: ['adult'] }));
    expect(p.tier).toBe('PROHIBITED');
  });
});

describe('checklist', () => {
  it('follows the underwriting policy per entity type', async () => {
    const { ctx } = await makeTestApp();
    const { policy } = await ctx.policies.forAcquirer((await ctx.policies.acquirers())[0].code);
    const fz = buildChecklist(policy, bot, 'free_zone', 'LOW', baseAnswers());
    expect(fz.required).toEqual(expect.arrayContaining(policy.entityTypes.free_zone!.requiredDocuments));
    expect(fz.required[0]).toBe('trade_licence');
    expect(fz.required).not.toContain('processing_statement');
    const sole = buildChecklist(policy, bot, 'sole_establishment', 'LOW', baseAnswers());
    expect(sole.required).toHaveLength(policy.entityTypes.sole_establishment!.requiredDocuments.length);
    const hi = buildChecklist(policy, bot, 'llc', 'HIGH', baseAnswers({ currentGateway: 'telr', activityFlags: ['travel_ticketing'] }));
    expect(hi.required).toContain('bank_statement');
    expect(hi.required).toContain('processing_statement');
  });
});

describe('prescreen and pricing', () => {
  const mcc = (tier: MccResult['tier']): MccResult => ({ primaryMcc: '5812', secondaryMccs: [], confidence: 0.9, reason: '', tier, labelEn: 'Restaurants', labelAr: 'مطاعم', source: 'keyword' });
  it('clean low-tier merchant is LIKELY with exact pricing', async () => {
    const { ctx } = await makeTestApp();
    const { policy } = await ctx.policies.forAcquirer((await ctx.policies.acquirers())[0].code);
    const p = prescreen(policy, bot, baseAnswers(), mcc('LOW'), null, new Date());
    expect(p.band).toBe('LIKELY');
    const q = quote(bot, mcc('LOW'), baseAnswers(), p.band)!;
    expect(q.cnp?.mdrPct).toBe(bot.pricing.cnp.LOW!.V3.mdrPct);
    expect(q.cp).not.toBeNull();
    expect(q.rangeUpliftPct).toBeNull();
    expect(q.reserve).toBeNull();
  });
  it('young, high-tier, flagged merchant drops to REVIEW or UNLIKELY and never gets an exact rate', async () => {
    const { ctx } = await makeTestApp();
    const { policy } = await ctx.policies.forAcquirer((await ctx.policies.acquirers())[0].code);
    const a = baseAnswers({ yearsBand: 'lt1', noWebPresence: true, web: undefined, activityFlags: ['electronics_luxury'], ticketBand: 'T4' });
    const p = prescreen(policy, bot, a, mcc('HIGH'), null, new Date());
    expect(['REVIEW', 'UNLIKELY']).toContain(p.band);
    expect(p.score).toBeLessThan(70);
    const q = quote(bot, mcc('HIGH'), a, 'REVIEW')!;
    expect(q.rangeUpliftPct).toBe(bot.pricing.reviewRangeUpliftPct);
    expect(q.reserve).not.toBeNull();
    expect(quote(bot, mcc('HIGH'), a, 'UNLIKELY')).toBeNull();
  });
  it('restricted tier caps at REVIEW', async () => {
    const { ctx } = await makeTestApp();
    const { policy } = await ctx.policies.forAcquirer((await ctx.policies.acquirers())[0].code);
    const p = prescreen(policy, bot, baseAnswers({ yearsBand: 'gt3' }), mcc('RESTRICTED'), null, new Date());
    expect(p.band).toBe('REVIEW');
  });
  it('international customers and subscriptions add the uplifts', () => {
    const q = quote(bot, mcc('MEDIUM'), baseAnswers({ customerLocation: 'international', billing: 'subscription', channel: 'online' }), 'LIKELY')!;
    expect(q.cnp?.mdrPct).toBeCloseTo(bot.pricing.cnp.MEDIUM!.V3.mdrPct + bot.pricing.components.MEDIUM!.internationalUpliftPct + bot.pricing.components.MEDIUM!.recurringUpliftPct, 2);
    expect(q.cp).toBeNull();
  });
});

describe('session helpers', () => {
  it('session id is stable and non-reversible; redact masks PII', () => {
    expect(sessionIdFor('whatsapp', '+971501234567')).toBe(sessionIdFor('whatsapp', ' +971501234567 '));
    expect(sessionIdFor('whatsapp', '+971501234567')).not.toContain('971');
    expect(redact('call me on +971 50 123 4567 or a@b.com, iban AE070331234567890123456')).toBe('call me on [number] or [email], iban [iban]');
  });
});

describe('WhatsApp conversation: free zone merchant end to end (mock LLM)', () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>;
  let m: BotMachine;
  beforeAll(async () => {
    app = await makeTestApp();
    m = new BotMachine(app.ctx, app.queue, bot);
  });

  const allText = (r: Reply[]) => r.map((x) => x.text).join('\n');

  it('walks the whole flow and lands the case in AWAITING_REVIEW', async () => {
    const { session: s } = await getOrCreateSession(app.ctx, 'whatsapp', '+971501234567');
    const turn = async (i: Inbound) => (await m.handle(s, i)).replies;

    // first contact: greeting with language buttons
    let r = await turn(text('Hi'));
    expect(r[0].options?.map((o) => o.id)).toEqual(['en', 'ar']);
    r = await turn(choice('en'));
    expect(s.step).toBe('S0_CONSENT');
    r = await turn(choice('more'));
    expect(allText(r)).toMatch(/UAE data protection|withdraw/);
    r = await turn(choice('agree'));
    expect(s.step).toBe('S1_CONTACT');
    expect(s.answers.consentAt).toBeTruthy();

    r = await turn(text('12345678'));
    expect(allText(r)).toMatch(/letters only/);
    r = await turn(text('Salma'));
    r = await turn(text('Nimbus Pay Labs FZCO'));
    expect(allText(r)).toMatch(/What type of company is Nimbus Pay Labs FZCO/);
    r = await turn(choice('free_zone'));
    expect(s.answers.entityType).toBe('free_zone');
    r = await turn(text('Dubai'));
    expect(s.step).toBe('S1_FREEZONE');
    r = await turn(choice('DMCC'));
    r = await turn(text('Restaurant and cafe in JLT, dine-in and delivery'));
    expect(s.mcc?.primaryMcc).toBe('5812');
    expect(s.step).toBe('S1_CATEGORY_CONFIRM');
    expect(allText(r)).toMatch(/Sounds like Restaurants/);
    r = await turn(choice('yes'));
    r = await turn(choice('both'));
    r = await turn(choice('b2c'));
    r = await turn(choice('oneoff'));
    r = await turn(choice('uae'));
    r = await turn(choice('V3'));
    r = await turn(choice('T2'));
    expect(s.step).toBe('S1_GATEWAY');
    r = await turn(choice('none'));
    expect(s.step).toBe('S1_YEARS');
    r = await turn(choice('1to3'));
    r = await turn(text('nimbus.example'));
    r = await turn(choice('none'));
    expect(s.step).toBe('S1_SUMMARY');
    expect(allText(r)).toMatch(/Nimbus Pay Labs FZCO, Free Zone company, Dubai/);
    r = await turn(choice('ok'));

    // Stage 3: case exists, checklist from policy
    expect(s.step).toBe('S3_INTRO');
    expect(s.caseId).toBeTruthy();
    expect(s.checklist?.required.length).toBeGreaterThanOrEqual(12);
    r = await turn(choice('manual'));
    expect(s.step).toBe('S3_COLLECT');
    expect(allText(r)).toMatch(/1 of \d+: please send your \*Trade licence\*/);

    // wrong-doc path: send the passport when the licence is asked - it is still a required doc, so it is filed and ticked
    r = await turn(pdf('passport.pdf'));
    expect(s.checklist?.received).toContain('passport');
    expect(allText(r)).toMatch(/Passport of the owner or signatory received/);
    expect(allText(r)).toMatch(/Trade licence/); // still asking for it

    // unsupported, later, duplicate
    r = await turn({ type: 'unsupported' });
    expect(allText(r)).toMatch(/only read photos and PDFs/);
    r = await turn(pdf('passport.pdf'));
    expect(allText(r)).toMatch(/already have that file/);

    // mid-flow question returns to the step
    r = await turn(text('what is the MDR?'));
    expect(allText(r)).toMatch(/percentage taken from each card payment/);
    expect(s.step).toBe('S3_COLLECT');

    for (const f of ['trade_licence.pdf', 'eid.pdf', 'ejari.pdf', 'bank_letter.pdf', 'website.pdf', 'certificate_of_incorporation.pdf', 'moa.pdf', 'register_of_shareholders.pdf', 'register_of_directors.pdf', 'signatory.pdf', 'ubo_declaration.pdf', 'vat.pdf']) {
      r = await turn(pdf(f));
      if (s.step !== 'S3_COLLECT') break;
    }
    // the example acquirer policy makes the VAT certificate required, so the bot asked for it too
    expect(s.step).toBe('S3_OPTIONAL');
    expect(s.checklist?.received).toContain('vat_certificate');
    expect(allText(r)).toMatch(/Anything else you would like to add/);
    r = await turn(choice('done'));

    // Stage 4
    expect(s.step).toBe('S4_RESULT');
    expect(s.prescreen?.band).toBe('LIKELY');
    const offer = allText(r);
    expect(offer).toMatch(/Indicative pricing for Restaurants, subject to underwriting/);
    expect(offer).toMatch(/Online card rate: \d\.\d\d% \+ AED/);
    expect(offer).toMatch(/In-store card rate/);
    expect(offer).not.toMatch(/score/i);

    // Stage 5: submit -> pipeline runs inline -> AWAITING_REVIEW
    r = await turn(choice('submit'));
    expect(s.step).toBe('S5_SUBMITTED');
    expect(allText(r)).toMatch(new RegExp(`Your application reference is \\*${s.caseRef}\\*`));
    const c = (await app.ctx.store.cases.get(s.caseId!))!;
    expect(c.status).toBe('AWAITING_REVIEW');
    expect(c.ownerEmail).toBe('bot@moneybee.local');
    expect(c.fields['activity.mcc']?.value).toBe('5812');
    expect(c.fields['activity.mcc']?.edited?.by).toBe('bot@moneybee.local');
    expect(c.botIntake?.submittedAt).toBeTruthy();
    expect(c.botIntake?.prescreen?.band).toBe('LIKELY');
    expect(c.botIntake?.transcript.some((x) => x.from === 'merchant')).toBe(true);
    expect(c.documents.filter((d) => d.docType === 'trade_licence').length).toBeGreaterThan(0);
    expect(c.risk).toBeTruthy();

    // status check
    r = await turn(text('status'));
    expect(allText(r)).toMatch(/under review/);

    // the bot user can never log in
    const u = await app.ctx.store.users.findByEmail('bot@moneybee.local');
    expect(u?.active).toBe(false);

    // human decision -> outbox, never from an agent
    const s2 = await notifyDecision(app.ctx, c, { kind: 'needs_info', message: '- Renewed trade licence' });
    expect(s2?.outbox[0].text).toMatch(/needs a few more things/);
    expect(s2?.outbox[0].template?.name).toBe('moneybee_needs_info_v1');
  });

  it('prohibited activity ends politely with no case', async () => {
    const { session: s } = await getOrCreateSession(app.ctx, 'whatsapp', '+971509999999');
    const turn = async (i: Inbound) => (await m.handle(s, i)).replies;
    await turn(text('hello'));
    await turn(choice('en'));
    await turn(choice('agree'));
    await turn(text('Omar'));
    await turn(text('Lucky Bets LLC'));
    await turn(choice('llc'));
    await turn(choice('Dubai'));
    const r = await turn(text('online casino and sports betting site'));
    // confidence from keywords is high enough to ask for confirmation
    expect(s.mcc?.tier).toBe('PROHIBITED');
    await turn(choice('yes'));
    for (const id of ['online', 'b2c', 'oneoff', 'international', 'V2', 'T2', 'none', '1to3']) await turn(choice(id));
    await turn(text('luckybets.example'));
    await turn(choice('none'));
    const end = await turn(choice('ok'));
    expect(s.step).toBe('CLOSED_PROHIBITED');
    expect(end.map((x) => x.text).join()).toMatch(/cannot support Gambling and betting/);
    expect(s.caseId).toBeUndefined();
    expect(r.length).toBeGreaterThan(0);
  });

  it('restricted activity warns and asks before continuing; Arabic switch works; branch maps to mainland with extra review', async () => {
    const { session: s } = await getOrCreateSession(app.ctx, 'whatsapp', '+971507777777');
    const turn = async (i: Inbound) => (await m.handle(s, i)).replies;
    await turn(text('مرحبا'));
    expect(s.lang).toBe('ar');
    expect(s.step).toBe('S0_CONSENT');
    await turn(choice('agree'));
    await turn(text('خالد'));
    await turn(text('Gold Souk Trading Branch'));
    await turn(choice('branch'));
    expect(s.answers.entityType).toBe('mainland');
    expect(s.extraReview?.on).toBe(true);
    await turn(choice('Dubai'));
    await turn(text('gold trading and bullion wholesale'));
    expect(s.mcc?.primaryMcc).toBe('5094');
    expect(s.mcc?.tier).toBe('RESTRICTED');
    if (s.step === 'S1_CATEGORY_CONFIRM') await turn(choice('yes'));
    else await turn(choice('retail'));
    for (const id of ['instore', 'b2b', 'oneoff', 'gcc', 'V4', 'T5', 'bank_pos', 'fees', 'gt3']) await turn(choice(id));
    await turn(text('not yet'));
    await turn(choice('none'));
    const r = await turn(choice('ok'));
    expect(s.step).toBe('S2_RESTRICTED');
    expect(r[0].text).toMatch(/مرحب بها في MoneyBee/);
    const r2 = await turn(choice('continue'));
    expect(s.step).toBe('S3_INTRO');
    expect(r2[0].text).toMatch(/الشركة الأم/);
    expect(s.checklist?.required).toContain('bank_statement');
    expect(s.checklist?.required).toContain('processing_statement');
  });
});
