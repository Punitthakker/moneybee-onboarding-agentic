import { randomUUID } from 'node:crypto';
import type { BotLang, BotPolicy, BotStep, DocType, EntityType, Policy, Prescreen, PricingQuote } from '@moneybee/shared';
import { detectEntityType } from '../agents/consolidate';
import { transition } from '../agents/orchestrator';
import type { JobQueue } from '../queue';
import { ensureBotUser } from '../auth';
import type { Ctx } from '../context';
import type { BotSessionRec, CaseRec } from '../db/types';
import { createInvite } from '../integrations/uaepass/service';
import { buildChecklist, defer, isComplete, markReceived, nextToAsk, remaining } from './checklist';
import { handleUpload } from './documents';
import { buildResult, classifyMcc } from './mcc';
import { catalogueEntry, loadBotPolicy } from './policy';
import { prescreen, quote } from './prescreen';
import { redact } from './session';
import { DOC_COPY, ENTITY_LABEL, STRINGS, TICKET_LABEL, VOLUME_LABEL, docHint, docLabel, t, type StringKey } from './strings';

/* ---------- channel-agnostic message types ---------- */

export type Inbound =
  | { type: 'text'; text: string }
  | { type: 'choice'; id: string; label?: string }
  | { type: 'media'; name: string; mime: string; data: Buffer }
  | { type: 'unsupported' };

export interface Option {
  id: string;
  label: string;
}
export interface Reply {
  text: string;
  /** up to 3 -> WhatsApp reply buttons; more -> list */
  options?: Option[];
}
export interface TurnResult {
  replies: Reply[];
  session: BotSessionRec;
}

type Lang = BotLang;

/* ---------- option sets ---------- */

const opt = (lang: Lang, pairs: [string, StringKey | { en: string; ar: string }][]): Option[] =>
  pairs.map(([id, k]) => ({ id, label: typeof k === 'string' ? STRINGS[k][lang] : k[lang] }));

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'];
const EMIRATES_AR: Record<string, string> = { Dubai: 'دبي', 'Abu Dhabi': 'أبوظبي', Sharjah: 'الشارقة', Ajman: 'عجمان', 'Ras Al Khaimah': 'رأس الخيمة', Fujairah: 'الفجيرة', 'Umm Al Quwain': 'أم القيوين' };
const FREEZONES = ['DMCC', 'IFZA', 'DIFC', 'ADGM', 'JAFZA', 'DAFZA', 'RAKEZ', 'SHAMS', 'Meydan'];
const GATEWAYS: [string, { en: string; ar: string }][] = [
  ['none', { en: 'No, this is new', ar: 'لا، هذا جديد' }],
  ['network', { en: 'Yes - Network International', ar: 'نعم - Network International' }],
  ['telr', { en: 'Yes - Telr', ar: 'نعم - Telr' }],
  ['paytabs', { en: 'Yes - PayTabs', ar: 'نعم - PayTabs' }],
  ['checkout', { en: 'Yes - Checkout.com', ar: 'نعم - Checkout.com' }],
  ['stripe', { en: 'Yes - Stripe', ar: 'نعم - Stripe' }],
  ['tap', { en: 'Yes - Tap', ar: 'نعم - Tap' }],
  ['ziina', { en: 'Yes - Ziina', ar: 'نعم - Ziina' }],
  ['bank_pos', { en: 'Yes - Bank POS', ar: 'نعم - جهاز البنك' }],
  ['other', { en: 'Yes - other', ar: 'نعم - آخر' }],
];
const CATEGORIES: [string, { en: string; ar: string }][] = [
  ['retail', { en: 'Retail - physical goods', ar: 'تجزئة - سلع' }],
  ['food', { en: 'Restaurants and food delivery', ar: 'مطاعم وتوصيل طعام' }],
  ['fashion_beauty', { en: 'Fashion and beauty', ar: 'أزياء وتجميل' }],
  ['electronics', { en: 'Electronics and gadgets', ar: 'إلكترونيات' }],
  ['professional_services', { en: 'Professional services', ar: 'خدمات مهنية' }],
  ['education', { en: 'Education and training', ar: 'تعليم وتدريب' }],
  ['travel', { en: 'Travel and tourism', ar: 'سفر وسياحة' }],
  ['health', { en: 'Health and wellness', ar: 'صحة وعافية' }],
  ['software', { en: 'Software and digital services', ar: 'برمجيات وخدمات رقمية' }],
  ['other', { en: 'Other', ar: 'أخرى' }],
];
const FLAGS: [string, { en: string; ar: string }][] = [
  ['travel_ticketing', { en: 'Travel or ticketing', ar: 'سفر أو تذاكر' }],
  ['electronics_luxury', { en: 'Electronics or luxury goods', ar: 'إلكترونيات أو سلع فاخرة' }],
  ['forex_crypto', { en: 'Forex, crypto or investments', ar: 'فوركس أو عملات رقمية أو استثمار' }],
  ['gaming_betting', { en: 'Gaming or betting', ar: 'ألعاب أو مراهنات' }],
  ['pharma_supplements', { en: 'Pharma or supplements', ar: 'أدوية أو مكملات' }],
  ['adult', { en: 'Adult content', ar: 'محتوى للبالغين' }],
  ['charity', { en: 'Charity or donations', ar: 'جمعيات خيرية أو تبرعات' }],
  ['telemarketing_trials', { en: 'Telemarketing or trials', ar: 'تسويق هاتفي أو فترات تجريبية' }],
  ['none', { en: 'None of these', ar: 'لا شيء مما سبق' }],
];
const EDIT_TARGETS: [string, { en: string; ar: string }, BotStep][] = [
  ['company', { en: 'Company name', ar: 'اسم الشركة' }, 'S1_COMPANY'],
  ['entity', { en: 'Company type', ar: 'نوع الشركة' }, 'S1_ENTITY'],
  ['description', { en: 'What you sell', ar: 'ماذا تبيع' }, 'S1_DESCRIPTION'],
  ['volume', { en: 'Volume and ticket', ar: 'الحجم والمبلغ' }, 'S1_VOLUME'],
  ['web', { en: 'Website', ar: 'الموقع' }, 'S1_WEB'],
  ['other', { en: 'Something else', ar: 'شيء آخر' }, 'S1_CONTACT'],
];

/* ---------- helpers ---------- */

const say = (text: string, options?: Option[]): Reply => (options ? { text, options } : { text });

function pick(inbound: Inbound, options: Option[]): string | null {
  if (inbound.type === 'choice') return options.some((o) => o.id === inbound.id) ? inbound.id : null;
  if (inbound.type !== 'text') return null;
  const txt = inbound.text.trim().toLowerCase();
  const n = Number(txt);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].id;
  const hit = options.find((o) => o.label.toLowerCase() === txt || o.id === txt);
  if (hit) return hit.id;
  const partial = options.filter((o) => o.label.toLowerCase().includes(txt) && txt.length >= 3);
  return partial.length === 1 ? partial[0].id : null;
}

const textOf = (i: Inbound) => (i.type === 'text' ? i.text.trim() : i.type === 'choice' ? (i.label ?? i.id) : '');

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

const GLOBAL = {
  back: /^(back|رجوع|الرجوع)$/i,
  help: /^(help|\?|مساعدة)$/i,
  human: /^(agent|human|person|موظف|شخص)$/i,
  status: /^(status|update|الحالة|تحديث)$/i,
  start: /^(start|restart|hi|hello|ابدأ|مرحبا|السلام عليكم)$/i,
  later: /^(later|skip|لاحقا|لاحقاً|تخطي)$/i,
  done: /^(done|finish|تم|انتهيت)$/i,
  notYet: /^(not yet|none|no|ليس بعد|لا)$/i,
};

function stepLabel(s: BotSessionRec): string {
  const l = s.lang;
  if (s.step.startsWith('S1')) return l === 'en' ? 'your business profile' : 'ملف نشاطك';
  if (s.step.startsWith('S3')) return l === 'en' ? 'documents' : 'المستندات';
  if (s.step.startsWith('S4')) return l === 'en' ? 'your indicative offer' : 'عرضك الإرشادي';
  return l === 'en' ? 'the start' : 'البداية';
}

function fmtPricing(q: PricingQuote | null, lang: Lang): string {
  if (!q) return '';
  const lines: string[] = [];
  const rate = (cell: { mdrPct: number; fixedFeeAed: number }, key: 'P_CNP' | 'P_CP') => {
    const mdr = q.rangeUpliftPct != null ? t('P_RANGE', lang, { low: cell.mdrPct.toFixed(2), high: (cell.mdrPct + q.rangeUpliftPct).toFixed(2) }) : cell.mdrPct.toFixed(2);
    return t(key, lang, { mdr, fee: cell.fixedFeeAed.toFixed(2) });
  };
  if (q.custom) lines.push(t('P_CUSTOM', lang));
  else {
    if (q.cnp) lines.push(rate(q.cnp, 'P_CNP'));
    if (q.cp) lines.push(rate(q.cp, 'P_CP'));
  }
  lines.push(t('P_SETTLEMENT', lang, { settlement: q.settlement }));
  lines.push(t('P_SETUP', lang, { setup: q.setupFeeAed ? `AED ${q.setupFeeAed}` : t('P_SETUP_WAIVED', lang) }));
  if (q.reserve) lines.push(t('P_RESERVE', lang, { pct: q.reserve.pct, days: q.reserve.days }));
  return lines.join('\n');
}

/* ---------- the machine ---------- */

export class BotMachine {
  private bot: BotPolicy;
  constructor(private ctx: Ctx, private queue: JobQueue, botPolicy?: BotPolicy) {
    this.bot = botPolicy ?? loadBotPolicy();
  }

  /** Render the prompt for the session's current step (used on entry and on resume). */
  async prompt(s: BotSessionRec): Promise<Reply[]> {
    const l = s.lang;
    const a = s.answers;
    const v = { contactName: a.contactName ?? '', companyName: a.companyName ?? '' };
    switch (s.step) {
      case 'S0_LANG':
        return [say(STRINGS.S0_LANG.en, [{ id: 'en', label: 'English' }, { id: 'ar', label: 'العربية' }])];
      case 'S0_CONSENT':
        return [say(t('S0_CONSENT', l), opt(l, [['agree', 'BTN_AGREE'], ['more', 'BTN_MORE'], ['no', 'BTN_NOT_NOW']]))];
      case 'S1_CONTACT':
        return [say(t('S1_CONTACT', l))];
      case 'S1_COMPANY':
        return [say(t('S1_COMPANY', l, v))];
      case 'S1_ENTITY':
        return [say(t('S1_ENTITY', l, v), opt(l, [['sole_establishment', ENTITY_LABEL.sole_establishment], ['llc', ENTITY_LABEL.llc], ['free_zone', ENTITY_LABEL.free_zone], ['branch', ENTITY_LABEL.branch], ['civil', ENTITY_LABEL.civil], ['unsure', 'BTN_NOT_SURE']]))];
      case 'S1_ENTITY_LICENCE':
        return [say(t('S1_ENTITY_LICENCE', l))];
      case 'S1_EMIRATE':
        return [say(t('S1_EMIRATE', l), EMIRATES.map((e) => ({ id: e, label: l === 'en' ? e : EMIRATES_AR[e] })))];
      case 'S1_FREEZONE':
        return [say(t('S1_FREEZONE', l), [...FREEZONES.map((z) => ({ id: z, label: z })), { id: 'other', label: l === 'en' ? 'Other (type it)' : 'أخرى (اكتبها)' }])];
      case 'S1_DESCRIPTION':
        return [say(t('S1_DESCRIPTION', l, v))];
      case 'S1_CATEGORY_CONFIRM':
        return [say(t('S1_CATEGORY_CONFIRM', l, { mccLabel: this.mccLabel(s) }), opt(l, [['yes', 'BTN_YES'], ['no', 'BTN_PICK_OTHER'], ['unsure', 'BTN_NOT_SURE']]))];
      case 'S1_CATEGORY_LIST':
        return [say(t('S1_CATEGORY_LIST', l), opt(l, CATEGORIES))];
      case 'S1_CHANNEL':
        return [say(t('S1_CHANNEL', l), opt(l, [['online', { en: 'Online only', ar: 'عبر الإنترنت فقط' }], ['instore', { en: 'In store only', ar: 'في المتجر فقط' }], ['both', { en: 'Both', ar: 'الاثنان' }]]))];
      case 'S1_CUSTOMER_TYPE':
        return [say(t('S1_CUSTOMER_TYPE', l), opt(l, [['b2c', { en: 'Consumers (B2C)', ar: 'أفراد' }], ['b2b', { en: 'Businesses (B2B)', ar: 'شركات' }], ['both', { en: 'Both', ar: 'الاثنان' }]]))];
      case 'S1_BILLING':
        return [say(t('S1_BILLING', l), opt(l, [['oneoff', { en: 'One-off', ar: 'لمرة واحدة' }], ['subscription', { en: 'Subscriptions', ar: 'اشتراكات' }], ['both', { en: 'Both', ar: 'الاثنان' }]]))];
      case 'S1_LOCATION':
        return [say(t('S1_LOCATION', l), opt(l, [['uae', { en: 'UAE only', ar: 'الإمارات فقط' }], ['gcc', { en: 'UAE and GCC', ar: 'الإمارات والخليج' }], ['international', { en: 'International', ar: 'دولي' }]]))];
      case 'S1_VOLUME':
        return [say(t('S1_VOLUME', l), [...Object.keys(VOLUME_LABEL).map((k) => ({ id: k, label: VOLUME_LABEL[k][l] })), { id: 'unsure', label: l === 'en' ? 'Just starting, not sure' : 'بداية، لست متأكداً' }])];
      case 'S1_TICKET':
        return [say(t('S1_TICKET', l), Object.keys(TICKET_LABEL).map((k) => ({ id: k, label: TICKET_LABEL[k][l] })))];
      case 'S1_TICKET_CONFIRM':
        return [say(t('S1_TICKET_CONFIRM', l, { txPerMonth: this.txPerMonth(s).toLocaleString('en-US') }), opt(l, [['yes', 'BTN_YES'], ['change', 'BTN_CHANGE']]))];
      case 'S1_GATEWAY':
        return [say(t('S1_GATEWAY', l), opt(l, GATEWAYS))];
      case 'S1_SWITCH_REASON':
        return [say(t('S1_SWITCH_REASON', l), opt(l, [['fees', { en: 'Lower fees', ar: 'رسوم أقل' }], ['settlement', { en: 'Faster settlement', ar: 'تسوية أسرع' }], ['support', { en: 'Better support', ar: 'دعم أفضل' }], ['methods', { en: 'More payment methods', ar: 'طرق دفع أكثر' }], ['integration', { en: 'Easier integration', ar: 'تكامل أسهل' }], ['other', { en: 'Other', ar: 'أخرى' }]]))];
      case 'S1_YEARS':
        return [say(t('S1_YEARS', l), opt(l, [['lt1', { en: 'Under 1 year', ar: 'أقل من سنة' }], ['1to3', { en: '1 to 3 years', ar: '1 إلى 3 سنوات' }], ['gt3', { en: 'Over 3 years', ar: 'أكثر من 3 سنوات' }]]))];
      case 'S1_WEB':
        return [say(t('S1_WEB', l))];
      case 'S1_FLAGS':
        return [say(t('S1_FLAGS', l), opt(l, FLAGS))];
      case 'S1_SUMMARY':
        return [say(this.summary(s), opt(l, [['ok', 'BTN_CORRECT'], ['edit', 'BTN_EDIT']]))];
      case 'S2_RESTRICTED':
        return [say(t('S2_RESTRICTED', l, { mccLabel: this.mccLabel(s) }), opt(l, [['continue', 'BTN_CONTINUE'], ['no', 'BTN_NOT_NOW']]))];
      case 'S3_INTRO': {
        const extra = s.extraReview?.on ? t('S3_EXTRA_REVIEW_LINE', l, { reason: s.extraReview.reason ?? '' }) : '';
        return [say(t('S3_INTRO', l, { entityLabel: this.entityLabel(s), n: s.checklist?.required.length ?? 0, extraReviewLine: extra }), opt(l, [['uaepass', 'BTN_UAEPASS'], ['manual', 'BTN_MANUAL']]))];
      }
      case 'S3_COLLECT':
        return [this.askDoc(s)];
      case 'S3_OPTIONAL':
        return [say(t('S3_OPTIONAL', l), opt(l, [['done', 'BTN_DONE']]))];
      case 'S4_RESULT':
        return [this.resultReply(s)];
      case 'S5_SUBMITTED':
        return [say(t('S5_WAITING', l, { caseRef: s.caseRef ?? '' }))];
      case 'HOLD':
        return [say(t('HOLD', l))];
      case 'CLOSED_PROHIBITED':
      case 'CLOSED_DECLINED':
        return [say(t('CLOSED', l))];
      default:
        return [say(t('E_GENERIC', l))];
    }
  }

  /** Process one inbound message. Persists the session. */
  async handle(s: BotSessionRec, inbound: Inbound): Promise<TurnResult> {
    const now = this.ctx.now().toISOString();
    s.lastInboundAt = now;
    const incoming = inbound.type === 'media' ? `[file ${inbound.name}]` : inbound.type === 'unsupported' ? '[unsupported media]' : textOf(inbound);
    this.log(s, 'merchant', incoming);
    let replies: Reply[];
    try {
      replies = await this.dispatch(s, inbound);
    } catch (e) {
      this.ctx.log.error(`bot turn failed: ${e instanceof Error ? e.stack ?? e.message : e}`);
      replies = [say(t('E_GENERIC', s.lang))];
    }
    for (const r of replies) this.log(s, 'bot', r.text);
    s.updatedAt = this.ctx.now().toISOString();
    s.lastOutboundAt = s.updatedAt;
    await this.ctx.store.botSessions.put(s);
    await this.syncIntake(s);
    return { replies, session: s };
  }

  private async dispatch(s: BotSessionRec, inbound: Inbound): Promise<Reply[]> {
    const l = s.lang;
    const txt = textOf(inbound);

    // language switch anywhere
    if (/^(arabic|عربي|العربية)$/i.test(txt)) {
      s.lang = 'ar';
      return this.prompt(s);
    }
    if (/^english$/i.test(txt)) {
      s.lang = 'en';
      return this.prompt(s);
    }

    // global commands (not in S0_LANG where anything starts the flow)
    if (s.step !== 'S0_LANG' && inbound.type === 'text') {
      if (GLOBAL.human.test(txt)) return this.hold(s);
      if (GLOBAL.help.test(txt)) return [say(this.faq(s, 'general')), ...(await this.prompt(s))];
      if (GLOBAL.status.test(txt) && s.caseId) return [await this.statusReply(s)];
      if (GLOBAL.back.test(txt) && s.prevStep && s.step.startsWith('S1')) {
        s.step = s.prevStep;
        return this.prompt(s);
      }
      if (GLOBAL.start.test(txt) && (s.step === 'CLOSED_DECLINED' || s.step === 'CLOSED_PROHIBITED')) {
        await this.reset(s);
        return this.prompt(s);
      }
      if (txt.endsWith('?') && !s.step.startsWith('S0')) {
        const ans = this.faq(s, txt);
        return [say(ans), ...(await this.prompt(s))];
      }
    }

    switch (s.step) {
      case 'S0_LANG': {
        const choice = pick(inbound, [{ id: 'en', label: 'English' }, { id: 'ar', label: 'العربية' }]);
        if (!choice && isArabic(txt)) s.lang = 'ar';
        else if (choice) s.lang = choice as Lang;
        else if (!s.transcript.some((x) => x.from === 'bot')) return this.prompt(s); // first contact: show greeting, wait for language
        return this.go(s, 'S0_CONSENT');
      }
      case 'S0_CONSENT': {
        const c = pick(inbound, opt(l, [['agree', 'BTN_AGREE'], ['more', 'BTN_MORE'], ['no', 'BTN_NOT_NOW']]));
        if (c === 'agree' || /^(yes|ok|agree|نعم|موافق)/i.test(txt)) {
          s.answers.consent = true;
          s.answers.consentAt = this.ctx.now().toISOString();
          return this.go(s, 'S1_CONTACT');
        }
        if (c === 'more') return [say(t('FAQ_PRIVACY', l)), ...(await this.prompt(s))];
        if (c === 'no') {
          s.step = 'CLOSED_DECLINED';
          return [say(t('S0_EXIT', l))];
        }
        return this.invalid(s, 'E_CHOICE');
      }
      case 'S1_CONTACT': {
        if (inbound.type !== 'text' || txt.length < 2 || txt.length > 60 || /\d{3,}/.test(txt)) return this.invalid(s, 'E_NAME');
        s.answers.contactName = txt;
        return this.go(s, 'S1_COMPANY');
      }
      case 'S1_COMPANY': {
        if (inbound.type !== 'text' || txt.length < 3 || txt.length > 120) return this.invalid(s, 'E_TEXT');
        s.answers.companyName = txt;
        return this.go(s, 'S1_ENTITY');
      }
      case 'S1_ENTITY': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.entityChoice = c as never;
        if (c === 'unsure') return this.go(s, 'S1_ENTITY_LICENCE');
        this.applyEntity(s, c);
        return this.go(s, 'S1_EMIRATE');
      }
      case 'S1_ENTITY_LICENCE': {
        if (inbound.type !== 'media') return this.invalid(s, 'S3_UNSUPPORTED');
        await this.ensureCase(s);
        const policy = await this.policy(s);
        const out = await handleUpload(this.ctx, s.caseId!, policy, inbound.name, inbound.data);
        const lic = out.docs.find((d) => d.docType === 'trade_licence');
        let mapped: EntityType | undefined;
        if (lic) {
          const tmp = (await this.ctx.store.cases.get(s.caseId!))!;
          const f = lic.fields ?? {};
          const asField = (k: string) => (f[k] ? { value: f[k].value, confidence: f[k].confidence ?? 0.5, needsReview: false } : undefined);
          const probe: CaseRec = { ...tmp, fields: { ...tmp.fields, ...(asField('legalForm') ? { 'company.legalForm': asField('legalForm')! } : {}), ...(asField('legalName') ? { 'company.legalName': asField('legalName')! } : {}), ...(asField('authority') ? { 'licence.authority': asField('authority')! } : {}) } as CaseRec['fields'] };
          mapped = detectEntityType(probe);
        }
        if (!mapped) {
          s.step = 'S1_ENTITY';
          return [say(t('S1_ENTITY_LICENCE_FAIL', l)), ...(await this.prompt(s))];
        }
        s.answers.entityChoice = mapped === 'mainland' ? 'llc' : (mapped as never);
        s.answers.entityType = mapped;
        return this.go(s, 'S1_EMIRATE');
      }
      case 'S1_EMIRATE': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.emirate = c;
        return this.go(s, s.answers.entityType === 'free_zone' ? 'S1_FREEZONE' : 'S1_DESCRIPTION');
      }
      case 'S1_FREEZONE': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (c && c !== 'other') s.answers.freeZone = c;
        else if (inbound.type === 'text' && txt.length >= 2) s.answers.freeZone = txt;
        else return this.invalid(s, 'E_CHOICE');
        return this.go(s, 'S1_DESCRIPTION');
      }
      case 'S1_DESCRIPTION': {
        if (inbound.type !== 'text' || txt.length < 10) return this.invalid(s, 'E_TEXT');
        s.answers.description = txt;
        s.mcc = await classifyMcc(this.ctx, this.bot, s.answers);
        if (s.mcc.confidence < 0.6) return this.go(s, 'S1_CATEGORY_LIST');
        return this.go(s, 'S1_CATEGORY_CONFIRM');
      }
      case 'S1_CATEGORY_CONFIRM': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (c === 'yes') {
          s.answers.category = catalogueEntry(this.bot, s.mcc!.primaryMcc)?.category;
          return this.go(s, 'S1_CHANNEL');
        }
        if (c === 'no' || c === 'unsure') return this.go(s, 'S1_CATEGORY_LIST');
        return this.invalid(s, 'E_CHOICE');
      }
      case 'S1_CATEGORY_LIST': {
        const c = pick(inbound, opt(l, CATEGORIES));
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.category = c as never;
        const r = await classifyMcc(this.ctx, this.bot, s.answers);
        // the merchant picked the category: keep the keyword/LLM pick inside it, else the category default
        s.mcc = r.source === 'category_default' ? buildResult(this.bot, this.bot.categoryDefaultMcc[c as never], 0.5, 'merchant picked category', 'merchant_pick', s.answers) : r;
        return this.go(s, 'S1_CHANNEL');
      }
      case 'S1_CHANNEL':
        return this.choiceStep(s, inbound, 'channel', 'S1_CUSTOMER_TYPE');
      case 'S1_CUSTOMER_TYPE':
        return this.choiceStep(s, inbound, 'customerType', 'S1_BILLING');
      case 'S1_BILLING':
        return this.choiceStep(s, inbound, 'billing', 'S1_LOCATION');
      case 'S1_LOCATION':
        return this.choiceStep(s, inbound, 'customerLocation', 'S1_VOLUME');
      case 'S1_VOLUME': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.volumeBand = c === 'unsure' ? 'V1' : (c as never);
        return this.go(s, 'S1_TICKET');
      }
      case 'S1_TICKET': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.ticketBand = c as never;
        const tx = this.txPerMonth(s);
        return this.go(s, tx > 50000 || tx < 5 ? 'S1_TICKET_CONFIRM' : 'S1_GATEWAY');
      }
      case 'S1_TICKET_CONFIRM': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (c === 'yes') return this.go(s, 'S1_GATEWAY');
        if (c === 'change') return this.go(s, 'S1_VOLUME');
        return this.invalid(s, 'E_CHOICE');
      }
      case 'S1_GATEWAY': {
        const c = pick(inbound, opt(l, GATEWAYS));
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.currentGateway = c;
        return this.go(s, c === 'none' ? 'S1_YEARS' : 'S1_SWITCH_REASON');
      }
      case 'S1_SWITCH_REASON': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.switchReason = c;
        return this.go(s, 'S1_YEARS');
      }
      case 'S1_YEARS':
        return this.choiceStep(s, inbound, 'yearsBand', 'S1_WEB');
      case 'S1_WEB': {
        if (inbound.type !== 'text') return this.invalid(s, 'E_TEXT');
        if (GLOBAL.notYet.test(txt)) {
          s.answers.noWebPresence = true;
          s.answers.web = undefined;
          return this.go(s, 'S1_FLAGS');
        }
        const ok = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(txt) || /^@?[\w.]{3,30}$/.test(txt);
        if (!ok) return this.invalid(s, 'E_URL');
        s.answers.web = txt;
        s.answers.noWebPresence = false;
        return this.go(s, 'S1_FLAGS');
      }
      case 'S1_FLAGS': {
        const c = pick(inbound, opt(l, FLAGS));
        if (!c) return this.invalid(s, 'E_CHOICE');
        s.answers.activityFlags = c === 'none' ? [] : [c as never];
        // re-evaluate the tier with the flags applied
        if (s.mcc) s.mcc = buildResult(this.bot, s.mcc.primaryMcc, s.mcc.confidence, s.mcc.reason, s.mcc.source, s.answers, s.mcc.secondaryMccs);
        return this.go(s, 'S1_SUMMARY');
      }
      case 'S1_SUMMARY': {
        const c = pick(inbound, opt(l, [['ok', 'BTN_CORRECT'], ['edit', 'BTN_EDIT']]));
        if (c === 'edit') return [say(t('S1_EDIT_WHICH', l), EDIT_TARGETS.map(([id, lab]) => ({ id: `edit:${id}`, label: lab[l] })))];
        if (inbound.type === 'choice' && inbound.id.startsWith('edit:')) {
          const target = EDIT_TARGETS.find(([id]) => `edit:${id}` === inbound.id);
          if (target) return this.go(s, target[2]);
        }
        if (c !== 'ok') return this.invalid(s, 'E_CHOICE');
        return this.afterProfile(s);
      }
      case 'S2_RESTRICTED': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (c === 'continue') return this.startDocuments(s);
        if (c === 'no') {
          s.step = 'CLOSED_DECLINED';
          return [say(t('S0_EXIT', l))];
        }
        return this.invalid(s, 'E_CHOICE');
      }
      case 'S3_INTRO': {
        const c = pick(inbound, (await this.prompt(s))[0].options!);
        if (!c) return this.invalid(s, 'E_CHOICE');
        const out: Reply[] = [];
        if (c === 'uaepass') {
          const inv = await createInvite(this.ctx, s.caseId!);
          out.push(say(t('S3_UAEPASS_LINK', l, { inviteUrl: `${this.ctx.cfg.PUBLIC_WEB_URL}/m/${inv.invite}` })));
        }
        s.prevStep = s.step;
        s.step = 'S3_COLLECT';
        out.push(this.askDoc(s));
        return out;
      }
      case 'S3_COLLECT':
        return this.collect(s, inbound);
      case 'S3_OPTIONAL': {
        if (inbound.type === 'media') {
          const r = await this.absorbUpload(s, inbound);
          return [...r, ...(await this.prompt(s))];
        }
        if (GLOBAL.done.test(txt) || pick(inbound, opt(l, [['done', 'BTN_DONE']]))) return this.evaluate(s);
        return this.invalid(s, 'E_CHOICE');
      }
      case 'S4_RESULT': {
        const c = pick(inbound, opt(l, [['submit', 'BTN_SUBMIT'], ['question', 'BTN_QUESTION'], ['no', 'BTN_NOT_NOW']]));
        if (c === 'submit' || /^(yes|submit|ok|نعم|قدم)/i.test(txt)) return this.submit(s);
        if (c === 'question') return [say(this.faq(s, 'general')), ...(await this.prompt(s))];
        if (c === 'no') return [say(t('S0_EXIT', l))];
        return this.invalid(s, 'E_CHOICE');
      }
      case 'S5_SUBMITTED': {
        if (inbound.type === 'media') {
          // documents sent after submission (needs_info loop): file them on the case, underwriter re-runs
          const r = await this.absorbUpload(s, inbound);
          return [...r, say(t('S5_WAITING', l, { caseRef: s.caseRef ?? '' }))];
        }
        return [await this.statusReply(s)];
      }
      case 'HOLD':
        return [say(t('HOLD', l))];
      case 'CLOSED_PROHIBITED':
      case 'CLOSED_DECLINED':
        return [say(t('CLOSED', l))];
      default:
        return [say(t('E_GENERIC', l))];
    }
  }

  /* ---------- step helpers ---------- */

  private async go(s: BotSessionRec, next: BotStep): Promise<Reply[]> {
    s.prevStep = s.step;
    s.step = next;
    return this.prompt(s);
  }

  private async invalid(s: BotSessionRec, key: StringKey): Promise<Reply[]> {
    return [say(t(key, s.lang)), ...(await this.prompt(s))];
  }

  private async choiceStep(s: BotSessionRec, inbound: Inbound, field: 'channel' | 'customerType' | 'billing' | 'customerLocation' | 'yearsBand', next: BotStep): Promise<Reply[]> {
    const c = pick(inbound, (await this.prompt(s))[0].options!);
    if (!c) return this.invalid(s, 'E_CHOICE');
    (s.answers as Record<string, unknown>)[field] = c;
    return this.go(s, next);
  }

  private applyEntity(s: BotSessionRec, choice: string) {
    const map: Record<string, EntityType> = { sole_establishment: 'sole_establishment', llc: 'llc', free_zone: 'free_zone', branch: 'mainland', civil: 'mainland' };
    s.answers.entityType = map[choice];
    if (choice === 'branch' || choice === 'civil') s.extraReview = { on: true, reason: ENTITY_LABEL[choice][s.lang].toLowerCase() };
    else s.extraReview = { on: false };
  }

  private txPerMonth(s: BotSessionRec): number {
    const vol: Record<string, number> = { V1: 25000, V2: 125000, V3: 350000, V4: 1250000, V5: 3000000 };
    const tk: Record<string, number> = { T1: 50, T2: 300, T3: 1250, T4: 6000, T5: 15000 };
    return Math.round(vol[s.answers.volumeBand ?? 'V1'] / tk[s.answers.ticketBand ?? 'T2']);
  }

  private mccLabel(s: BotSessionRec): string {
    return s.mcc ? (s.lang === 'en' ? s.mcc.labelEn : s.mcc.labelAr) : '';
  }
  private entityLabel(s: BotSessionRec): string {
    const k = s.answers.entityChoice && s.answers.entityChoice !== 'unsure' ? s.answers.entityChoice : (s.answers.entityType ?? 'llc');
    return ENTITY_LABEL[k]?.[s.lang] ?? k;
  }

  private summary(s: BotSessionRec): string {
    const a = s.answers;
    const l = s.lang;
    const lab = (pairs: [string, { en: string; ar: string }][], id?: string) => pairs.find(([i]) => i === id)?.[1][l] ?? (id ?? '');
    return t('S1_SUMMARY', l, {
      companyName: a.companyName ?? '',
      entityLabel: this.entityLabel(s),
      emirate: l === 'en' ? (a.emirate ?? '') : (EMIRATES_AR[a.emirate ?? ''] ?? a.emirate ?? ''),
      mccLabel: this.mccLabel(s),
      channel: lab([['online', { en: 'online', ar: 'عبر الإنترنت' }], ['instore', { en: 'in store', ar: 'في المتجر' }], ['both', { en: 'online and in store', ar: 'عبر الإنترنت وفي المتجر' }]], a.channel),
      customerType: lab([['b2c', { en: 'consumers', ar: 'أفراد' }], ['b2b', { en: 'businesses', ar: 'شركات' }], ['both', { en: 'consumers and businesses', ar: 'أفراد وشركات' }]], a.customerType),
      volume: VOLUME_LABEL[a.volumeBand ?? 'V1'][l],
      ticket: TICKET_LABEL[a.ticketBand ?? 'T2'][l],
      years: lab([['lt1', { en: 'under 1 year', ar: 'أقل من سنة' }], ['1to3', { en: '1 to 3 years', ar: '1 إلى 3 سنوات' }], ['gt3', { en: 'over 3 years', ar: 'أكثر من 3 سنوات' }]], a.yearsBand),
      web: a.web ?? (l === 'en' ? 'no website yet' : 'لا يوجد موقع بعد'),
    });
  }

  /* ---------- stage transitions ---------- */

  private async afterProfile(s: BotSessionRec): Promise<Reply[]> {
    const l = s.lang;
    if (!s.mcc) s.mcc = await classifyMcc(this.ctx, this.bot, s.answers);
    if (s.mcc.tier === 'PROHIBITED') {
      s.step = 'CLOSED_PROHIBITED';
      await this.syncIntake(s);
      return [say(t('S2_PROHIBITED', l, { mccLabel: this.mccLabel(s) }))];
    }
    if (s.mcc.tier === 'RESTRICTED') return this.go(s, 'S2_RESTRICTED');
    return this.startDocuments(s);
  }

  private async startDocuments(s: BotSessionRec): Promise<Reply[]> {
    await this.ensureCase(s);
    const policy = await this.policy(s);
    s.checklist = buildChecklist(policy, this.bot, s.answers.entityType ?? 'llc', s.mcc!.tier, s.answers);
    // documents already on the case (licence sent at S1_ENTITY_LICENCE, UAE PASS) count
    const c = await this.ctx.store.cases.get(s.caseId!);
    if (c) markReceived(s.checklist, c.documents.map((d) => d.docType));
    return this.go(s, 'S3_INTRO');
  }

  private askDoc(s: BotSessionRec): Reply {
    const l = s.lang;
    const c = s.checklist!;
    const d = nextToAsk(c);
    if (!d) return say(t('S3_COMPLETE', l));
    const index = c.required.indexOf(d) + 1;
    return say(t('S3_ASK', l, { index: index > 0 ? index : c.received.length + 1, n: c.required.length, docLabel: docLabel(d, l), docHint: docHint(d, l) }));
  }

  private async collect(s: BotSessionRec, inbound: Inbound): Promise<Reply[]> {
    const l = s.lang;
    const c = s.checklist!;
    const txt = textOf(inbound);
    if (inbound.type === 'unsupported') return [say(t('S3_UNSUPPORTED', l)), this.askDoc(s)];
    if (inbound.type === 'text' && GLOBAL.later.test(txt)) {
      const cur = nextToAsk(c);
      if (cur) {
        defer(c, cur);
        const out = [say(t('S3_LATER', l, { docLabel: docLabel(cur, l) }))];
        if (!nextToAsk(c) || c.required.every((d) => c.received.includes(d) || c.deferred.includes(d))) {
          // everything left is deferred: go round again
          c.deferred = [];
          c.current = nextToAsk(c);
          if (c.current) out.push(say(t('S3_DEFERRED_RETURN', l)));
        }
        return isComplete(c) ? [...out, ...(await this.toOptional(s))] : [...out, this.askDoc(s)];
      }
    }
    if (inbound.type === 'text' && /^(form|نموذج)$/i.test(txt) && nextToAsk(c) === 'ubo_declaration') {
      return [say(l === 'en' ? 'UBO form: ' + this.ctx.cfg.PUBLIC_WEB_URL + '/forms/ubo-declaration.pdf' : 'نموذج المستفيد الحقيقي: ' + this.ctx.cfg.PUBLIC_WEB_URL + '/forms/ubo-declaration.pdf'), this.askDoc(s)];
    }
    if (inbound.type !== 'media') return [say(t('E_CHOICE', l)), this.askDoc(s)];

    const out = await this.absorbUpload(s, inbound);
    if (isComplete(c)) return [...out, ...(await this.toOptional(s))];
    // progress line every 3 documents
    if (c.received.length % 3 === 0 && c.received.length > 0) {
      out.push(say(t('S3_PROGRESS', l, { received: c.received.filter((d) => c.required.includes(d)).length, n: c.required.length, remaining: remaining(c).map((d) => docLabel(d, l)).join(', ') })));
    }
    return [...out, this.askDoc(s)];
  }

  /** Ingest + classify one file against the checklist; returns the merchant-facing reaction only. */
  private async absorbUpload(s: BotSessionRec, inbound: Extract<Inbound, { type: 'media' }>): Promise<Reply[]> {
    const l = s.lang;
    const c = s.checklist!;
    const asked = nextToAsk(c);
    if (!/^(image\/(png|jpe?g)|application\/pdf)$/.test(inbound.mime)) return [say(t('S3_UNSUPPORTED', l))];
    const policy = await this.policy(s);
    const out = await handleUpload(this.ctx, s.caseId!, policy, inbound.name, inbound.data);

    if (out.kind === 'duplicate') return [say(t('S3_DUPLICATE', l, { docLabel: asked ? docLabel(asked, l) : '' }))];
    if (out.kind === 'rejected') return [say(t('S3_UNSUPPORTED', l))];
    if (out.injectionSuspected) {
      // never echo flagged content; file it, move on
      markReceived(c, out.detected);
      const nxt = nextToAsk(c);
      return [say(t('E_INJECTION', l, { nextDocLabel: nxt ? docLabel(nxt, l) : '' }))];
    }
    if (out.kind === 'unreadable') return [say(t('S3_UNREADABLE', l))];

    const ticked = markReceived(c, out.detected);
    const first = out.docs[0];
    const now = this.ctx.now();
    const expiry = (d: typeof first) => {
      if (!d?.expiresOn) return '';
      const days = Math.round((new Date(d.expiresOn).getTime() - now.getTime()) / 86400000);
      if (days < 0) return null;
      return days <= policy.docExpiryWarnDays ? t('S3_EXPIRY_SOON', l, { days }) : t('S3_EXPIRY_VALID', l, { date: d.expiresOn });
    };

    if (out.detected.length > 1) {
      return [say(t('S3_BUNDLE', l, { labels: out.detected.map((d) => docLabel(d, l)).join(', '), remaining: remaining(c).map((d) => docLabel(d, l)).join(', ') || '-' }))];
    }
    const got = out.detected[0];
    if (asked && got && got !== asked && !c.required.includes(got) && !c.optional.includes(got)) {
      return [say(t('S3_WRONG', l, { detectedLabel: docLabel(got, l), docLabel: docLabel(asked, l) }))];
    }
    if (asked && got && got !== asked) {
      // a different required doc: accepted and ticked, keep asking for the current one
      const e = expiry(first);
      if (e === null) return [say(t('S3_EXPIRED', l, { docLabel: docLabel(got, l), date: first.expiresOn ?? '' }))];
      return [say(t('S3_RECEIVED', l, { docLabel: docLabel(got, l), expiryLine: e }))];
    }
    const e = expiry(first);
    if (e === null) {
      // expired: untick so it is asked again
      c.received = c.received.filter((d) => d !== got);
      c.current = nextToAsk(c);
      return [say(t('S3_EXPIRED', l, { docLabel: docLabel(got ?? asked ?? 'unknown', l), date: first.expiresOn ?? '' }), opt(l, [['renewed', 'BTN_SEND_RENEWED'], ['progress', 'BTN_RENEWAL_IN_PROGRESS']]))];
    }
    return [say(t('S3_RECEIVED', l, { docLabel: docLabel(got ?? asked ?? 'unknown', l), expiryLine: e }))];
  }

  private async toOptional(s: BotSessionRec): Promise<Reply[]> {
    s.prevStep = s.step;
    s.step = 'S3_OPTIONAL';
    return this.prompt(s);
  }

  private async evaluate(s: BotSessionRec): Promise<Reply[]> {
    const policy = await this.policy(s);
    const c = await this.ctx.store.cases.get(s.caseId!);
    s.prescreen = prescreen(policy, this.bot, s.answers, s.mcc!, c, this.ctx.now());
    s.pricing = quote(this.bot, s.mcc!, s.answers, s.prescreen.band);
    s.prevStep = s.step;
    s.step = 'S4_RESULT';
    return [say(t('S3_COMPLETE', s.lang)), this.resultReply(s)];
  }

  private resultReply(s: BotSessionRec): Reply {
    const l = s.lang;
    const band = s.prescreen?.band ?? 'REVIEW';
    const sla = (l === 'en' ? this.bot.prescreen.reviewSlaEn : this.bot.prescreen.reviewSlaAr)[band];
    const vars = { contactName: s.answers.contactName ?? '', companyName: s.answers.companyName ?? '', mccLabel: this.mccLabel(s), pricingLines: fmtPricing(s.pricing ?? null, l), sla: sla ?? '' };
    const options = band === 'UNLIKELY' ? opt(l, [['submit', 'BTN_SUBMIT'], ['no', 'BTN_NOT_NOW']]) : opt(l, [['submit', 'BTN_SUBMIT'], ['question', 'BTN_QUESTION']]);
    return say(t(band === 'LIKELY' ? 'S4_LIKELY' : band === 'REVIEW' ? 'S4_REVIEW' : 'S4_UNLIKELY', l, vars), options);
  }

  private async submit(s: BotSessionRec): Promise<Reply[]> {
    const l = s.lang;
    const bot = await ensureBotUser(this.ctx);
    const caseId = s.caseId!;
    await this.ctx.store.cases.update(caseId, (x) => {
      x.legalName = s.answers.companyName;
      x.name = s.answers.companyName ?? x.name;
      const at = this.ctx.now().toISOString();
      const botField = (value: string | number, confidence: number, needsReview = false) => ({ value, confidence, needsReview, edited: { by: 'bot@moneybee.local', reason: 'merchant answer in onboarding bot', at, previous: x.fields['activity.mcc']?.value ?? null } });
      x.fields['activity.mcc'] = botField(s.mcc!.primaryMcc, s.mcc!.confidence, s.mcc!.confidence < 0.8);
      x.fields['activity.expectedMonthlyVolume'] = botField({ V1: 25000, V2: 125000, V3: 350000, V4: 1250000, V5: 3000000 }[s.answers.volumeBand ?? 'V1'], 0.7);
      x.fields['activity.expectedAvgTicket'] = botField({ T1: 50, T2: 300, T3: 1250, T4: 6000, T5: 15000 }[s.answers.ticketBand ?? 'T2'], 0.7);
      if (x.status === 'NEEDS_INFO' || x.status === 'AWAITING_REVIEW') transition(x, 'RECEIVED', { type: 'system' });
    });
    s.prevStep = s.step;
    s.step = 'S5_SUBMITTED';
    await this.syncIntake(s, this.ctx.now().toISOString());
    await this.ctx.store.audit.add({ id: randomUUID(), actor: bot.email, action: 'bot.submitted', entity: `case:${caseId}`, at: this.ctx.now().toISOString(), meta: { channel: s.channel, band: s.prescreen?.band } });
    const fresh = (await this.ctx.store.cases.get(caseId))!;
    const seq = (fresh.run?.seq ?? 0) + 1;
    await this.ctx.store.cases.update(caseId, (x) => {
      x.run = { seq, state: 'queued' };
    });
    await this.queue.enqueuePipeline({ caseId, runSeq: seq, from: 'classify' });
    const sla = (l === 'en' ? this.bot.prescreen.reviewSlaEn : this.bot.prescreen.reviewSlaAr)[s.prescreen?.band ?? 'REVIEW'] ?? '';
    return [say(t('S5_SUBMITTED', l, { caseRef: s.caseRef ?? '', sla }))];
  }

  private async statusReply(s: BotSessionRec): Promise<Reply> {
    const l = s.lang;
    const c = s.caseId ? await this.ctx.store.cases.get(s.caseId) : null;
    if (!c) return say(t('CLOSED', l));
    const map: Record<string, { en: string; ar: string }> = {
      AWAITING_REVIEW: { en: 'under review', ar: 'قيد المراجعة' },
      NEEDS_INFO: { en: 'waiting for documents from you', ar: 'بانتظار مستندات منك' },
      APPROVED: { en: 'approved', ar: 'تمت الموافقة' },
      REJECTED: { en: 'closed', ar: 'مغلق' },
      COMPLETED: { en: 'live', ar: 'مفعّل' },
    };
    const st = map[c.status] ?? { en: 'being processed', ar: 'قيد المعالجة' };
    return say(t('S5_STATUS', l, { caseRef: c.ref, status: st[l], detail: '' }).trim());
  }

  private async hold(s: BotSessionRec): Promise<Reply[]> {
    s.prevStep = s.step;
    s.step = 'HOLD';
    await this.ctx.store.audit.add({ id: randomUUID(), actor: 'bot', action: 'bot.hold_requested', entity: s.caseId ? `case:${s.caseId}` : `bot_session:${s.id}`, at: this.ctx.now().toISOString() });
    return [say(t('HOLD', s.lang))];
  }

  /** Bounded FAQ. No case internals. Keyword routed; the LLM is only used to pick a topic when live. */
  faq(s: BotSessionRec, q: string): string {
    const l = s.lang;
    const x = q.toLowerCase();
    if (/mdr|rate|fee|commission|رسوم|نسبة|عمولة/.test(x)) return t('FAQ_MDR', l);
    if (/settle|payout|when.*money|تسوية|متى.*المبلغ/.test(x)) return t('FAQ_SETTLEMENT', l);
    if (/how long|time|days|كم.*الوقت|متى|أيام/.test(x)) return t('FAQ_TIME', l);
    if (/why.*(document|need)|لماذا.*مستند/.test(x)) return t('FAQ_DOCS', l);
    if (/integrat|plugin|api|pos|shopify|woo|link|تكامل|ربط|رابط/.test(x)) return t('FAQ_INTEGRATION', l);
    if (/privacy|data|secure|خصوصية|بيانات|آمن/.test(x)) return t('FAQ_PRIVACY', l);
    return t('FAQ_FALLBACK', l);
  }

  /* ---------- case plumbing ---------- */

  private async acquirerCode(): Promise<string> {
    const acqs = await this.ctx.policies.acquirers();
    const want = this.ctx.cfg.BOT_ACQUIRER_CODE;
    const hit = want ? acqs.find((a) => a.code === want) : acqs[0];
    if (!hit) throw new Error(`bot acquirer not found (${want ?? 'first'})`);
    return hit.code;
  }

  private async policy(s: BotSessionRec): Promise<Policy> {
    const c = s.caseId ? await this.ctx.store.cases.get(s.caseId) : null;
    return (await this.ctx.policies.forAcquirer(c?.acquirerCode ?? (await this.acquirerCode()))).policy;
  }

  /** Create the case as soon as a file can arrive (licence photo or Stage 3). Owned by the bot service user. */
  private async ensureCase(s: BotSessionRec): Promise<CaseRec> {
    if (s.caseId) {
      const c = await this.ctx.store.cases.get(s.caseId);
      if (c) return c;
    }
    const bot = await ensureBotUser(this.ctx);
    const n = (await this.ctx.store.cases.count()) + 1;
    const now = this.ctx.now().toISOString();
    const c: CaseRec = {
      id: randomUUID(),
      ref: `MB-${new Date(now).getUTCFullYear()}-${String(n).padStart(4, '0')}`,
      version: 1,
      name: s.answers.companyName ?? 'Bot merchant',
      legalName: s.answers.companyName,
      status: 'RECEIVED',
      entityTypeRequested: s.answers.entityType ?? 'auto',
      entityType: s.answers.entityType,
      acquirerCode: await this.acquirerCode(),
      ownerId: bot.id,
      ownerEmail: bot.email,
      createdAt: now,
      updatedAt: now,
      files: [],
      documents: [],
      fields: {},
      directors: [],
      shareholders: [],
      signatories: [],
      idHolders: [],
      findings: [],
      checklist: [],
      reviews: [],
      needsReviewFields: [],
      injectionSuspected: false,
      usage: { tokens: 0, budget: this.ctx.cfg.CASE_TOKEN_BUDGET, calls: 0 },
      run: { seq: 0, state: 'idle' },
    };
    await this.ctx.store.cases.create(c);
    await this.ctx.store.audit.add({ id: randomUUID(), actor: bot.email, action: 'case.created', entity: `case:${c.id}`, at: now, meta: { via: 'bot', channel: s.channel } });
    s.caseId = c.id;
    s.caseRef = c.ref;
    return c;
  }

  /** Mirror the session onto the case for the underwriter's Bot intake panel. */
  private async syncIntake(s: BotSessionRec, submittedAt?: string) {
    if (!s.caseId) return;
    await this.ctx.store.cases.update(s.caseId, (x) => {
      if (s.answers.entityType && !x.entityType) x.entityType = s.answers.entityType;
      x.botIntake = {
        sessionId: s.id,
        channel: s.channel,
        lang: s.lang,
        answers: s.answers,
        mcc: s.mcc ?? null,
        prescreen: s.prescreen ?? null,
        pricing: s.pricing ?? null,
        flags: { extraReview: !!s.extraReview?.on, extraReviewReason: s.extraReview?.reason },
        submittedAt: submittedAt ?? x.botIntake?.submittedAt ?? null,
        transcript: s.transcript.slice(-200),
      };
    });
  }

  private async reset(s: BotSessionRec) {
    s.step = 'S0_CONSENT';
    s.prevStep = undefined;
    s.answers = { activityFlags: [] };
    s.mcc = null;
    s.checklist = null;
    s.prescreen = null;
    s.pricing = null;
    s.caseId = undefined;
    s.caseRef = undefined;
  }

  private log(s: BotSessionRec, from: 'merchant' | 'bot' | 'system', text: string) {
    s.transcript.push({ at: this.ctx.now().toISOString(), from, step: s.step, text: redact(text).slice(0, 1000) });
    if (s.transcript.length > 400) s.transcript = s.transcript.slice(-400);
  }
}

export { DOC_COPY };
export type { DocType };
