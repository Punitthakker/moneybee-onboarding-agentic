import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ar';

const EN = {
  brandSub: 'Merchant onboarding',
  powered: 'Powered by MoneyBee',
  signInTitle: 'Verify with UAE PASS.',
  signInGrey: 'Skip the paperwork.',
  signInLede: 'Sign in once with your UAE PASS and we fetch your Emirates ID straight from the issuer. No photos, no email attachments.',
  continueUaePass: 'Continue with UAE PASS',
  opening: 'Opening UAE PASS',
  openingSub: 'You will approve the sign-in in the UAE PASS app.',
  cancel: 'Cancel',
  weReceive: 'What we receive',
  weReceiveList: ['Your name', 'Emirates ID number (masked on screen)', 'Mobile number and email', 'Your account level'],
  weNever: 'What we never get',
  weNeverList: ['Your UAE PASS PIN or password', 'Documents you did not approve'],
  simulated: 'SIMULATED UAE PASS - no real UAE PASS data is used',
  stepSignIn: 'Sign in',
  stepShare: 'Share documents',
  stepSign: 'Review and sign',
  verifiedTitle: 'Verified with UAE PASS',
  emiratesId: 'Emirates ID',
  level: 'Account level',
  levelSop3: 'SOP3 - verified',
  levelSop2: 'SOP2 - verified',
  shareTitle: 'Share your documents',
  shareLede: 'We send a request to your UAE PASS app. Approve it there and the documents arrive here, verified by the issuer.',
  docsToShare: 'Documents to request',
  optional: 'optional',
  sendRequest: 'Send request to my UAE PASS app',
  sendAnother: 'Send a new request',
  openApp: 'Open UAE PASS app',
  scanQr: 'On a computer? Scan with your phone',
  waiting: 'Waiting for your approval in UAE PASS',
  sharedTitle: 'Sharing was successful',
  expiredTitle: 'Sharing request expired',
  declinedTitle: 'Sharing request declined',
  requestedBy: 'Documents requested by',
  purpose: 'Purpose',
  requestedOn: 'Requested on',
  sharedOn: 'Shared on',
  expiresIn: 'Expires in',
  expiredOn: 'Expired on',
  declinedOn: 'Declined on',
  requestNo: 'Request No.',
  mandatory: 'Mandatory documents',
  personal: 'Personal details',
  email: 'Email',
  phone: 'Phone number',
  shared: 'Shared',
  requested: 'Requested',
  declined: 'Declined',
  vaultTitle: 'Your verified documents',
  vaultLede: 'Documents delivered by the issuer through UAE PASS. Our team still runs the usual checks on them.',
  issuerVerified: 'Issuer verified',
  issuer: 'Issuer',
  validUntil: 'Valid until',
  noneYet: 'Nothing here yet.',
  signTitle: 'Review and sign',
  signLede: 'Sign the merchant agreement with your UAE PASS signature. It takes one approval in the app.',
  reviewAgreement: 'Merchant services agreement',
  signWith: 'Sign with UAE PASS',
  signWaiting: 'Waiting for your signature in UAE PASS',
  signedTitle: 'Agreement signed',
  signedSub: 'Signature valid',
  signExpired: 'Signature request expired',
  signDeclined: 'Signature declined',
  startAgain: 'Start again',
  signOut: 'Sign out',
  sopLow: 'Your UAE PASS account is not verified with your Emirates ID (SOP1). Upgrade it in the UAE PASS app, then try again.',
  cancelled: 'You cancelled the UAE PASS sign-in. Nothing was shared.',
  stateInvalid: 'That sign-in session could not be confirmed. Please start again.',
  failed: 'UAE PASS sign-in did not complete. Please try again.',
  inviteInvalid: 'This link is invalid or has expired. Ask your onboarding contact for a new one.',
  noLink: 'Open the link your onboarding contact sent you.',
  loading: 'Loading',
  minutes: 'min',
  seconds: 's',
  secured: 'Your details are encrypted and used only for this application.',
};
export type Dict = typeof EN;

const AR: Dict = {
  brandSub: 'تسجيل التجار',
  powered: 'بدعم من MoneyBee',
  signInTitle: 'تحقق عبر الهوية الرقمية.',
  signInGrey: 'من دون أوراق.',
  signInLede: 'سجّل الدخول مرة واحدة بالهوية الرقمية وسنحصل على هويتك الإماراتية مباشرة من الجهة المصدرة. بلا صور ولا مرفقات.',
  continueUaePass: 'المتابعة بالهوية الرقمية UAE PASS',
  opening: 'جارٍ فتح UAE PASS',
  openingSub: 'ستوافق على تسجيل الدخول داخل تطبيق UAE PASS.',
  cancel: 'إلغاء',
  weReceive: 'ما نستلمه',
  weReceiveList: ['اسمك', 'رقم الهوية الإماراتية (مخفي جزئياً)', 'رقم الجوال والبريد الإلكتروني', 'مستوى حسابك'],
  weNever: 'ما لا نستلمه أبداً',
  weNeverList: ['رمز PIN أو كلمة مرور UAE PASS', 'مستندات لم توافق عليها'],
  simulated: 'محاكاة UAE PASS - لا تُستخدم بيانات حقيقية',
  stepSignIn: 'تسجيل الدخول',
  stepShare: 'مشاركة المستندات',
  stepSign: 'المراجعة والتوقيع',
  verifiedTitle: 'تم التحقق عبر UAE PASS',
  emiratesId: 'الهوية الإماراتية',
  level: 'مستوى الحساب',
  levelSop3: 'SOP3 - موثّق',
  levelSop2: 'SOP2 - موثّق',
  shareTitle: 'شارك مستنداتك',
  shareLede: 'نرسل طلباً إلى تطبيق UAE PASS. وافق عليه هناك وستصل المستندات إلى هنا موثّقة من الجهة المصدرة.',
  docsToShare: 'المستندات المطلوبة',
  optional: 'اختياري',
  sendRequest: 'أرسل الطلب إلى تطبيق UAE PASS',
  sendAnother: 'إرسال طلب جديد',
  openApp: 'افتح تطبيق UAE PASS',
  scanQr: 'على الكمبيوتر؟ امسح الرمز بهاتفك',
  waiting: 'بانتظار موافقتك في UAE PASS',
  sharedTitle: 'تمت المشاركة بنجاح',
  expiredTitle: 'انتهت صلاحية طلب المشاركة',
  declinedTitle: 'تم رفض طلب المشاركة',
  requestedBy: 'المستندات مطلوبة من',
  purpose: 'الغرض',
  requestedOn: 'تاريخ الطلب',
  sharedOn: 'تاريخ المشاركة',
  expiresIn: 'ينتهي خلال',
  expiredOn: 'انتهى في',
  declinedOn: 'رُفض في',
  requestNo: 'رقم الطلب',
  mandatory: 'المستندات المطلوبة',
  personal: 'البيانات الشخصية',
  email: 'البريد الإلكتروني',
  phone: 'رقم الهاتف',
  shared: 'تمت المشاركة',
  requested: 'مطلوب',
  declined: 'مرفوض',
  vaultTitle: 'مستنداتك الموثّقة',
  vaultLede: 'مستندات سلّمتها الجهة المصدرة عبر UAE PASS. يواصل فريقنا إجراء الفحوصات المعتادة عليها.',
  issuerVerified: 'موثّق من الجهة المصدرة',
  issuer: 'الجهة المصدرة',
  validUntil: 'صالح حتى',
  noneYet: 'لا يوجد شيء بعد.',
  signTitle: 'المراجعة والتوقيع',
  signLede: 'وقّع اتفاقية التاجر بتوقيع UAE PASS. تحتاج موافقة واحدة في التطبيق.',
  reviewAgreement: 'اتفاقية خدمات التاجر',
  signWith: 'التوقيع عبر UAE PASS',
  signWaiting: 'بانتظار توقيعك في UAE PASS',
  signedTitle: 'تم توقيع الاتفاقية',
  signedSub: 'التوقيع صالح',
  signExpired: 'انتهت صلاحية طلب التوقيع',
  signDeclined: 'تم رفض التوقيع',
  startAgain: 'ابدأ من جديد',
  signOut: 'تسجيل الخروج',
  sopLow: 'حسابك في UAE PASS غير موثّق بالهوية الإماراتية (SOP1). قم بترقيته من التطبيق ثم حاول مجدداً.',
  cancelled: 'ألغيت تسجيل الدخول عبر UAE PASS. لم تتم مشاركة أي شيء.',
  stateInvalid: 'تعذر تأكيد جلسة تسجيل الدخول. ابدأ من جديد.',
  failed: 'لم يكتمل تسجيل الدخول عبر UAE PASS. حاول مرة أخرى.',
  inviteInvalid: 'هذا الرابط غير صالح أو منتهي. اطلب رابطاً جديداً من جهة الاتصال.',
  noLink: 'افتح الرابط الذي أرسلته لك جهة الاتصال.',
  loading: 'جارٍ التحميل',
  minutes: 'د',
  seconds: 'ث',
  secured: 'بياناتك مشفّرة وتُستخدم لهذا الطلب فقط.',
};

const LangCtx = createContext<{ lang: Lang; t: Dict; setLang: (l: Lang) => void }>({ lang: 'en', t: EN, setLang: () => {} });
export const useT = () => useContext(LangCtx);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      return (q === 'ar' || q === 'en' ? q : (localStorage.getItem('mb_lang') as Lang)) === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('mb_lang', l); } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <LangCtx.Provider value={{ lang, t: lang === 'ar' ? AR : EN, setLang }}>
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className={`up-root ${lang}`}>{children}</div>
    </LangCtx.Provider>
  );
}

export function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="up-lang" role="group" aria-label="Language">
      <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      <button className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>العربية</button>
    </div>
  );
}

/** "19 Sep 2026 • 05:27 AM GST" in Gulf Standard Time, Latin digits in both languages. */
export function fmtGst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year} • ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()} GST`;
}
