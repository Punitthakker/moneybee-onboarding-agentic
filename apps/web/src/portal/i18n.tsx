import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ar';

const EN = {
  start: 'Start',
  resumeLink: 'Already started? Get a new link',
  stepType: 'Your company type',
  stepQuestions: 'A few questions',
  stepContact: 'Your details',
  typeHelp: 'Pick the one on your trade licence. You can change it until you send the application.',
  questionsHelp: 'Your answers decide which documents we ask for.',
  yes: 'Yes',
  no: 'No',
  businessName: 'Business name (as on the licence)',
  yourName: 'Your name',
  email: 'Email',
  mobile: 'Mobile (optional)',
  consent: 'I agree that my documents and details are used to check my application.',
  emailNote: 'We email you a private link so you can come back on any device.',
  begin: 'Start my application',
  starting: 'Starting',
  youWillNeed: 'You will need',
  ifApplicable: 'if it applies to you',
  next: 'Continue',
  back: 'Back',
  sentTitle: 'Check your email',
  sentBody: (m: string) => `We sent a private link to ${m}. Open it on any device to carry on. You can also keep going here.`,
  continueHere: 'Continue here',
  resumeTitle: 'Get back to your application',
  resumeBody: 'Enter the email you used. If we find an open application, we send you a new link. Older links stop working.',
  sendLink: 'Email me a link',
  resumeSent: (m: string) => `If ${m} has an open application, a new link is on its way.`,
  openingLink: 'Opening your application',
  linkBad: 'This link has expired or was replaced by a newer one.',
  getNewLink: 'Email me a new link',
  noSession: 'Open the link we emailed you to see your application.',
  docsIn: (a: number, b: number) => `${a} of ${b} documents in`,
  allIn: 'Everything we need is here',
  required: 'Required',
  optional: 'Optional',
  addFile: 'Add file',
  replace: 'Add another',
  received: 'Received',
  missing: 'Not yet',
  expired: 'Expired: please add a valid copy',
  tooOld: 'Too old: please add a recent copy',
  needed: 'Needed because',
  dropAll: 'Drop all your documents here',
  dropAllSub: 'PDF, JPG or PNG, one file per document or one bundle. We sort them for you.',
  choose: 'Choose files',
  uploading: 'Uploading and checking',
  yourFiles: 'Your files',
  checking: 'Checking',
  unrecognised: 'We could not tell what this is',
  remove: 'Remove',
  looksLike: (d: string) => `This looks like: ${d}`,
  notSlot: (got: string, want: string) => `This looks like ${got}, not ${want}. We kept it under ${got}.`,
  submit: 'Send my application',
  submitting: 'Sending',
  submitBlocked: 'Add the required documents to send your application.',
  submitHelp: 'Once sent, our team checks everything and contacts you if anything is missing.',
  details: 'Application details',
  change: 'Change',
  save: 'Save',
  ref: 'Reference',
  contact: 'Contact',
  companyType: 'Company type',
  signOut: 'Sign out',
  timeline: 'What has happened',
  ev: { started: 'Application started', documents: 'Documents added', submitted: 'Application sent', needs_info: 'We asked for more information', approved: 'Approved', rejected: 'Not approved', completed: 'Onboarding complete' } as Record<string, string>,
  phase: {
    collecting: ['Add your documents', 'Upload what is on the list. The list updates as each document arrives.'],
    submitted: ['We are checking your documents', 'This usually takes a few minutes. You can close this page.'],
    in_review: ['Your application is with our team', 'A reviewer is looking at it now. We email you when there is news.'],
    needs_info: ['We need a little more', 'Add the documents below, then send the application again.'],
    approved: ['Approved', 'Your account is being set up. We will be in touch with next steps.'],
    rejected: ['We could not approve this application', 'Contact us if you have questions.'],
    completed: ['You are all set', 'Your merchant account is ready.'],
  } as Record<string, [string, string]>,
  whatNext: 'What happens next',
  whatNextList: ['We read your documents and check the details match.', 'A person on our team reviews your application.', 'We email you the decision or ask for anything missing.'],
  help: 'Need help?',
  errorGeneric: 'Something went wrong. Try again.',
  people: { owner: 'For the owner', each_ubo_and_signatory: 'For each owner of 25% or more and each signatory', branch_manager: 'For the branch manager and each signatory' } as Record<string, string>,
};
export type Dict = typeof EN;

const AR: Dict = {
  start: 'ابدأ',
  resumeLink: 'بدأت من قبل؟ احصل على رابط جديد',
  stepType: 'نوع شركتك',
  stepQuestions: 'بعض الأسئلة',
  stepContact: 'بياناتك',
  typeHelp: 'اختر النوع المذكور في رخصتك التجارية. يمكنك تغييره حتى ترسل الطلب.',
  questionsHelp: 'إجاباتك تحدد المستندات التي نطلبها.',
  yes: 'نعم',
  no: 'لا',
  businessName: 'اسم النشاط (كما في الرخصة)',
  yourName: 'اسمك',
  email: 'البريد الإلكتروني',
  mobile: 'الجوال (اختياري)',
  consent: 'أوافق على استخدام مستنداتي وبياناتي لدراسة طلبي.',
  emailNote: 'نرسل لك رابطاً خاصاً للعودة من أي جهاز.',
  begin: 'ابدأ طلبي',
  starting: 'جارٍ البدء',
  youWillNeed: 'ستحتاج إلى',
  ifApplicable: 'إذا كان ينطبق عليك',
  next: 'متابعة',
  back: 'رجوع',
  sentTitle: 'تحقق من بريدك',
  sentBody: (m: string) => `أرسلنا رابطاً خاصاً إلى ${m}. افتحه من أي جهاز للمتابعة، أو تابع هنا.`,
  continueHere: 'تابع هنا',
  resumeTitle: 'عُد إلى طلبك',
  resumeBody: 'أدخل البريد الذي استخدمته. إذا وجدنا طلباً مفتوحاً نرسل لك رابطاً جديداً، وتتوقف الروابط القديمة.',
  sendLink: 'أرسل لي رابطاً',
  resumeSent: (m: string) => `إذا كان لدى ${m} طلب مفتوح، فالرابط الجديد في الطريق.`,
  openingLink: 'جارٍ فتح طلبك',
  linkBad: 'انتهت صلاحية هذا الرابط أو استُبدل برابط أحدث.',
  getNewLink: 'أرسل لي رابطاً جديداً',
  noSession: 'افتح الرابط الذي أرسلناه إلى بريدك لعرض طلبك.',
  docsIn: (a: number, b: number) => `وصل ${a} من ${b} مستندات`,
  allIn: 'وصل كل ما نحتاجه',
  required: 'مطلوب',
  optional: 'اختياري',
  addFile: 'أضف ملفاً',
  replace: 'أضف ملفاً آخر',
  received: 'تم الاستلام',
  missing: 'لم يصل بعد',
  expired: 'منتهي الصلاحية: أضف نسخة سارية',
  tooOld: 'قديم: أضف نسخة حديثة',
  needed: 'مطلوب لأن',
  dropAll: 'أفلت كل مستنداتك هنا',
  dropAllSub: 'PDF أو JPG أو PNG، ملف لكل مستند أو ملف واحد يجمعها. نحن نرتبها لك.',
  choose: 'اختر الملفات',
  uploading: 'جارٍ الرفع والتحقق',
  yourFiles: 'ملفاتك',
  checking: 'جارٍ التحقق',
  unrecognised: 'لم نتعرف على هذا الملف',
  remove: 'إزالة',
  looksLike: (d: string) => `يبدو أنه: ${d}`,
  notSlot: (got: string, want: string) => `يبدو أن هذا ${got} وليس ${want}. حفظناه تحت ${got}.`,
  submit: 'أرسل طلبي',
  submitting: 'جارٍ الإرسال',
  submitBlocked: 'أضف المستندات المطلوبة لإرسال طلبك.',
  submitHelp: 'بعد الإرسال يراجع فريقنا كل شيء ويتواصل معك إذا نقص شيء.',
  details: 'بيانات الطلب',
  change: 'تغيير',
  save: 'حفظ',
  ref: 'رقم الطلب',
  contact: 'جهة التواصل',
  companyType: 'نوع الشركة',
  signOut: 'تسجيل الخروج',
  timeline: 'ما حدث حتى الآن',
  ev: { started: 'بدأ الطلب', documents: 'أُضيفت مستندات', submitted: 'أُرسل الطلب', needs_info: 'طلبنا معلومات إضافية', approved: 'تمت الموافقة', rejected: 'لم تتم الموافقة', completed: 'اكتمل التسجيل' },
  phase: {
    collecting: ['أضف مستنداتك', 'ارفع ما في القائمة. تتحدث القائمة مع وصول كل مستند.'],
    submitted: ['نتحقق من مستنداتك', 'يستغرق ذلك عادة بضع دقائق. يمكنك إغلاق الصفحة.'],
    in_review: ['طلبك لدى فريقنا', 'يراجعه أحد الموظفين الآن، وسنراسلك عند وجود جديد.'],
    needs_info: ['نحتاج المزيد قليلاً', 'أضف المستندات أدناه ثم أرسل الطلب مرة أخرى.'],
    approved: ['تمت الموافقة', 'نجهز حسابك الآن وسنتواصل معك بالخطوات التالية.'],
    rejected: ['تعذرت الموافقة على الطلب', 'تواصل معنا إذا كان لديك أي سؤال.'],
    completed: ['كل شيء جاهز', 'حساب التاجر الخاص بك جاهز.'],
  },
  whatNext: 'ماذا بعد',
  whatNextList: ['نقرأ مستنداتك ونتأكد من تطابق البيانات.', 'يراجع أحد أفراد فريقنا طلبك.', 'نراسلك بالقرار أو نطلب ما ينقص.'],
  help: 'تحتاج مساعدة؟',
  errorGeneric: 'حدث خطأ. حاول مرة أخرى.',
  people: { owner: 'للمالك', each_ubo_and_signatory: 'لكل مالك 25% أو أكثر ولكل مفوض بالتوقيع', branch_manager: 'لمدير الفرع وكل مفوض بالتوقيع' },
};

/** Arabic names for document types (the API sends English labels). */
export const DOC_AR: Record<string, string> = {
  trade_licence: 'الرخصة التجارية', certificate_of_incorporation: 'شهادة التأسيس', moa_aoa: 'عقد التأسيس والنظام الأساسي', share_certificate: 'شهادة الأسهم',
  register_of_shareholders: 'سجل الشركاء', register_of_directors: 'سجل المديرين', authorised_signatory_letter: 'قرار أو وكالة المفوض بالتوقيع', emirates_id: 'الهوية الإماراتية',
  passport: 'جواز السفر', residence_visa: 'تأشيرة الإقامة', lease_ejari: 'عقد الإيجار / إيجاري', bank_letter: 'خطاب البنك / شهادة الآيبان', bank_statement: 'كشف الحساب البنكي',
  vat_certificate: 'شهادة ضريبة القيمة المضافة', ubo_declaration: 'إقرار المالك المستفيد', website_description: 'الموقع أو وصف المنتجات', processing_statement: 'كشف معالجة المدفوعات',
  company_profile: 'ملف الشركة', corporate_shareholder_docs: 'مستندات الشريك الاعتباري', parent_company_documents: 'مستندات الشركة الأم', branch_board_resolution: 'قرار مجلس الشركة الأم بفتح الفرع',
  parent_ownership_chart: 'هيكل ملكية الشركة الأم', chamber_certificate: 'شهادة غرفة التجارة', incumbency_certificate: 'شهادة شاغلي المناصب / حسن السيرة', local_service_agent_agreement: 'اتفاقية وكيل الخدمات المحلي',
  unknown: 'غير مصنف',
};

const Ctx = createContext<{ lang: Lang; t: Dict; setLang: (l: Lang) => void; L: (en: string | null | undefined, ar: string | null | undefined) => string; docLabel: (docType: string, en: string) => string }>(null as never);
export const usePT = () => useContext(Ctx);

export function PortalLang({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (initial) return initial;
    try {
      const q = new URLSearchParams(location.search).get('lang');
      return (q === 'ar' || q === 'en' ? q : localStorage.getItem('mb_lang')) === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('mb_lang', l); } catch { /* storage unavailable */ }
  };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const L = (en: string | null | undefined, ar: string | null | undefined) => (lang === 'ar' && ar ? ar : en ?? '');
  const docLabel = (docType: string, en: string) => (lang === 'ar' ? DOC_AR[docType] ?? en : en);
  return (
    <Ctx.Provider value={{ lang, t: lang === 'ar' ? AR : EN, setLang, L, docLabel }}>
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className={`pt-root ${lang}`}>{children}</div>
    </Ctx.Provider>
  );
}

export function PortalLangToggle() {
  const { lang, setLang } = usePT();
  return (
    <div className="pt-lang" role="group" aria-label="Language">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
      <button type="button" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')} lang="ar">العربية</button>
    </div>
  );
}
