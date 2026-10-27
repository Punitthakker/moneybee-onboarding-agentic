import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DOC_TYPE_LABELS } from '@moneybee/shared';
import { DOC_AR } from './portal/i18n';
import { DOC_LABELS, ENTITY_LABELS, FIELD_LABELS } from './types';

/**
 * English / Arabic for the ops console. Strings are keyed by their English text, so a missing translation
 * simply shows English. Dynamic text written by the agents (findings, risk notes, memo, UBO explanation)
 * is translated by pattern in trMsg(); anything it does not recognise stays in English.
 */
export type Lang = 'en' | 'ar';

const AR: Record<string, string> = {
  // shell
  Cases: 'الطلبات', 'New case': 'طلب جديد', Settings: 'الإعدادات', 'Sign out': 'تسجيل الخروج', Loading: 'جارٍ التحميل', Menu: 'القائمة', Language: 'اللغة',
  // login
  'Merchant onboarding, done by agents': 'تسجيل التجار، ينجزه وكلاء الذكاء الاصطناعي', 'Sign in.': 'تسجيل الدخول.', 'Review what the agents prepared.': 'راجِع ما أعدّه الوكلاء.',
  Email: 'البريد الإلكتروني', Password: 'كلمة المرور', 'Signing in': 'جارٍ تسجيل الدخول', 'Sign in': 'تسجيل الدخول', 'invalid credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'Applying as a merchant?': 'تتقدم كتاجر؟', 'Open the merchant portal': 'افتح بوابة التاجر',
  // dashboard
  'Beyond the onboarding form': 'أبعد من نموذج التسجيل', 'Merchant cases.': 'طلبات التجار.', 'Prepared by agents, decided by you.': 'يجهّزها الوكلاء، والقرار لك.',
  'Cases today': 'طلبات اليوم', 'Fields auto-completed': 'حقول مكتملة تلقائياً', 'Avg time to pack': 'متوسط وقت التجهيز', 'Awaiting review': 'بانتظار المراجعة',
  'Search merchant or case ref': 'ابحث باسم التاجر أو رقم الطلب', Search: 'بحث', 'Entity type': 'نوع الكيان', 'All entity types': 'كل أنواع الكيانات', all: 'الكل',
  'No cases yet': 'لا توجد طلبات بعد', 'Drop a merchant folder or zip into a new case and the agents take it from there.': 'أضف مجلد التاجر أو ملفاً مضغوطاً في طلب جديد، ويتولى الوكلاء الباقي.',
  Merchant: 'التاجر', Status: 'الحالة', Entity: 'الكيان', Acquirer: 'البنك المستحوذ', Risk: 'المخاطر', Confidence: 'الثقة', Age: 'منذ', Owner: 'المسؤول',
  'agents running': 'الوكلاء يعملون', '{n} field(s) to check': '{n} حقل بحاجة للمراجعة',
  // new case
  'Drop the pack.': 'أضف ملف التاجر.', 'The agents read every page.': 'يقرأ الوكلاء كل صفحة.',
  'PDFs, images, whole folders, zips or a forwarded email. Bundled PDFs are split by document. Nothing is typed by hand.': 'ملفات PDF أو صور أو مجلدات كاملة أو ملفات مضغوطة أو بريد معاد توجيهه. تُقسم ملفات PDF المجمعة حسب المستند، ولا يُكتب أي شيء يدوياً.',
  'Drop zone': 'منطقة الإفلات', 'Drag files, folders or a zip here': 'اسحب الملفات أو المجلدات أو ملفاً مضغوطاً إلى هنا', 'PDF, PNG, JPG, ZIP or .eml, up to 25 MB per file': 'PDF أو PNG أو JPG أو ZIP أو eml، حتى 25 ميجابايت لكل ملف',
  'Choose files': 'اختر الملفات', 'Choose folder': 'اختر مجلداً', 'Attach email': 'أرفق بريداً', '{n} file(s)': '{n} ملف', ' + 1 email': ' + بريد واحد', Clear: 'مسح', '+{n} more': '+{n} أخرى',
  'email: {s}': 'بريد: {s}', '(no subject)': '(بدون موضوع)', 'Case name (optional)': 'اسم الطلب (اختياري)', 'Taken from the licence if empty': 'يؤخذ من الرخصة إذا تُرك فارغاً',
  'Create case and run agents': 'أنشئ الطلب وشغّل الوكلاء', 'Create case': 'أنشئ الطلب', 'Creating case': 'جارٍ إنشاء الطلب', 'Uploading documents': 'جارٍ رفع المستندات', 'Starting agents': 'جارٍ تشغيل الوكلاء',
  'The agents prepare and recommend. Only a human reviewer can approve.': 'الوكلاء يجهّزون ويوصون، والموافقة لموظف مختص فقط.',
  'Documents are optional here. Add them now, later on the case, or email the merchant an upload link.': 'المستندات اختيارية هنا. أضفها الآن أو لاحقاً في الطلب، أو أرسل للتاجر رابط رفع بالبريد.',
  '{n} file(s) rejected: {list}': 'تم رفض {n} ملف: {list}', 'Attach a forwarded email': 'أرفق بريداً معاد توجيهه',
  'Paste the email and add its attachments, or drop the .eml file in the main drop zone. Email text is treated as data, never as instructions.': 'الصق نص البريد وأضف مرفقاته، أو أفلت ملف eml في المنطقة الرئيسية. يُعامل نص البريد كبيانات وليس كتعليمات أبداً.',
  From: 'من', Subject: 'الموضوع', Body: 'النص', Attachments: 'المرفقات', Attach: 'إرفاق', Cancel: 'إلغاء',
  'Your role ({role}) can review cases but cannot create them. Sign in as an underwriter or admin to create a case.': 'دورك ({role}) يتيح مراجعة الطلبات وليس إنشاءها. سجّل الدخول كمسؤول اكتتاب أو مدير لإنشاء طلب.',
  'Your role ({role}) cannot do this. Sign in as {allowed}.': 'دورك ({role}) لا يسمح بهذا الإجراء. سجّل الدخول بصفة {allowed}.', or: 'أو',
  // workspace
  'Loading case': 'جارٍ تحميل الطلب', 'Case not found': 'الطلب غير موجود', 'Entity type pending': 'نوع الكيان قيد التحديد', 'Re-run agents': 'أعد تشغيل الوكلاء', 'Run agents': 'شغّل الوكلاء',
  'Pipeline failed: {e}. Fix the cause (for example the token budget) and re-run.': 'تعذر إكمال المعالجة: {e}. عالج السبب (مثل حد الاستخدام) ثم أعد التشغيل.',
  'Prompt injection suspected.': 'اشتباه بمحاولة حقن تعليمات.', 'A document contains instruction-like text. It was treated as data, did not change any check, and is recorded as a risk signal.': 'يحتوي أحد المستندات على نص يشبه التعليمات. عومل كبيانات ولم يغيّر أي فحص، وسُجّل كمؤشر مخاطر.',
  'MOCK AI EXTRACTION (FIXTURE PARSER) - no real external check was performed': 'استخراج تجريبي (محلل العينات) - لم يُجرَ أي فحص خارجي حقيقي',
  'MOCK SCREENING - no real external check was performed': 'فحص تجريبي - لم يُجرَ أي فحص خارجي حقيقي',
  Documents: 'المستندات', '{a} / {b} files': '{a} / {b} ملفات', 'Add documents': 'أضف مستندات', '{n} added': 'أُضيف {n}', ', {n} rejected': '، ورُفض {n}', 'Re-run the agents to process them.': 'أعد تشغيل الوكلاء لمعالجتها.',
  Checklist: 'قائمة المستندات', received: 'مستلم', missing: 'ناقص', expired: 'منتهي', optional: 'اختياري',
  Fields: 'الحقول', Ownership: 'الملكية', 'Risk and decision': 'المخاطر والقرار', Output: 'المخرجات', Gaps: 'النواقص', 'Merchant portal': 'بوابة التاجر', 'UAE PASS': 'الهوية الرقمية UAE PASS',
  'Agent timeline': 'سجل الوكلاء', tok: 'رمز', 'No runs yet. Upload documents and run the agents.': 'لا توجد عمليات بعد. ارفع المستندات وشغّل الوكلاء.', agent: 'الوكيل', run: 'التشغيل',
  'No fields extracted yet': 'لم تُستخرج أي حقول بعد', 'Run the agents to classify and extract the documents.': 'شغّل الوكلاء لتصنيف المستندات واستخراج بياناتها.',
  'needs review (below {n}%)': 'بحاجة لمراجعة (أقل من {n}%)', source: 'المصدر', edit: 'تعديل', confirm: 'تأكيد', 'by {who}: {why}': 'بواسطة {who}: {why}',
  Corporate: 'شخص اعتباري', 'Natural person': 'شخص طبيعي', Director: 'مدير', Signatory: 'مفوض بالتوقيع', Manager: 'مدير',
  Directors: 'المديرون', 'Authorised signatories': 'المفوضون بالتوقيع', Shareholders: 'الشركاء', 'Ultimate beneficial owners': 'المستفيدون الحقيقيون',
  ownership: 'ملكية', control: 'سيطرة', 'senior managing official': 'مسؤول إداري أول',
  'Confirm {f}': 'تأكيد {f}', 'Edit {f}': 'تعديل {f}', 'Saved and audited': 'تم الحفظ والتسجيل في سجل التدقيق', Value: 'القيمة', 'Current value:': 'القيمة الحالية:',
  'Reason (required, stored in the audit log)': 'السبب (إلزامي، يُحفظ في سجل التدقيق)', 'For example: verified against the original licence': 'مثال: تمت المطابقة مع الرخصة الأصلية', 'Confirm value': 'تأكيد القيمة', 'Save change': 'حفظ التعديل',
  'Ownership not resolved yet': 'لم تُحدد الملكية بعد', 'The UBO resolver runs after verification.': 'يعمل وكيل المستفيد الحقيقي بعد التحقق.', 'threshold {n}%': 'الحد {n}%', '{n} layer(s)': '{n} طبقة', '{n} UBO(s)': '{n} مستفيد حقيقي',
  'untraced: {s}': 'غير متتبع: {s}', 'In plain language': 'بلغة واضحة', 'No risk assessment yet': 'لا يوجد تقييم مخاطر بعد', 'The underwriter agent scores the case after screening.': 'يقيّم وكيل الاكتتاب الطلب بعد الفحص.',
  'First approval recorded. A second reviewer must approve.': 'سُجلت الموافقة الأولى. يجب أن يوافق مراجع ثانٍ.', 'Case is now {s}': 'حالة الطلب الآن: {s}', 'Risk score': 'درجة المخاطر', 'second reviewer required': 'يتطلب مراجعاً ثانياً',
  Screening: 'الفحص', Party: 'الطرف', Role: 'الدور', Result: 'النتيجة', clear: 'لا توجد مطابقة', 'Underwriter memo': 'مذكرة الاكتتاب', 'Recommendation:': 'التوصية:', 'The agent recommends. You decide.': 'الوكيل يوصي، وأنت تقرر.',
  Decision: 'القرار', '{d} by {who}': '{d} بواسطة {who}', 'First approval recorded. A different reviewer with the SECOND REVIEWER role must approve.': 'سُجلت الموافقة الأولى. يجب أن يوافق مراجع آخر بدور المراجع الثاني.',
  'Confirm or correct {n} low-confidence field(s) on the Fields tab before approving.': 'أكّد أو صحّح {n} حقلاً منخفض الثقة في تبويب الحقول قبل الموافقة.', 'Notes (mandatory)': 'الملاحظات (إلزامية)', 'What you checked and why': 'ما الذي راجعته ولماذا',
  Approve: 'موافقة', 'Request info': 'طلب معلومات', Reject: 'رفض', 'Your role cannot decide cases.': 'دورك لا يسمح باتخاذ القرار في الطلبات.', 'Case is {s}.': 'حالة الطلب: {s}.',
  approve: 'موافقة', reject: 'رفض', 'request info': 'طلب معلومات',
  'Acquirer pack': 'ملف البنك المستحوذ', 'Built automatically at the end of the pipeline.': 'يُجهَّز تلقائياً في نهاية المعالجة.', 'Download zip': 'تنزيل الملف المضغوط', Download: 'تنزيل', 'Submit via API (mock)': 'إرسال عبر الواجهة البرمجية (تجريبي)',
  Completion: 'الإكمال', 'System of record written': 'تم التسجيل في نظام السجلات', 'Token id': 'معرّف الرمز', expires: 'ينتهي', 'This is the only time the token is shown. It is stored only as a hash.': 'هذه المرة الوحيدة التي يظهر فيها الرمز، ويُحفظ مشفراً فقط.',
  'Copy claim URL': 'نسخ رابط الاستلام', 'Copy token': 'نسخ الرمز', 'The token was shown once at completion and cannot be displayed again.': 'ظهر الرمز مرة واحدة عند الإكمال ولا يمكن عرضه مجدداً.', 'Revoke token': 'إلغاء الرمز', 'Token revoked': 'تم إلغاء الرمز',
  'Approved by a human reviewer. Completing writes the merchant, parties, documents, decision and a hashed token to the system of record in one atomic write, then fires the signed webhook.': 'وافق عليه مراجع مختص. يسجّل الإكمال التاجر والأطراف والمستندات والقرار ورمزاً مشفراً في نظام السجلات دفعة واحدة، ثم يرسل إشعاراً موقّعاً.',
  Completing: 'جارٍ الإكمال', 'Complete and mint token': 'أكمل وأصدر الرمز', 'Available once the case is approved.': 'متاح بعد الموافقة على الطلب.', 'Webhook deliveries': 'إشعارات الأنظمة', 'No deliveries yet. Configure the webhook URL in Settings.': 'لا توجد إشعارات بعد. اضبط رابط الإشعارات من الإعدادات.',
  Attempts: 'المحاولات', 'Last result': 'آخر نتيجة', Retry: 'إعادة المحاولة', 'Retry queued': 'أُضيفت إعادة المحاولة', Copied: 'تم النسخ', 'Copy failed: select the text manually': 'تعذر النسخ: حدد النص يدوياً',
  'Nothing outstanding': 'لا توجد نواقص', 'All required documents and fields are present.': 'جميع المستندات والحقول المطلوبة موجودة.', 'Outstanding items': 'العناصر الناقصة', 'Draft request to the merchant': 'مسودة طلب للتاجر', 'not sent': 'لم يُرسل',
  'Draft message': 'مسودة الرسالة', 'Copy draft': 'نسخ المسودة', 'Copied. Paste it into your email and send it yourself.': 'تم النسخ. الصقه في بريدك وأرسله بنفسك.', 'MoneyBee never sends this automatically. A human sends it.': 'لا يرسل النظام هذا تلقائياً أبداً؛ يرسله موظف.',
  'Policy checks': 'فحوصات السياسة', 'Deterministic checks. Regulatory interpretation stays with compliance.': 'فحوصات آلية ثابتة، والتفسير التنظيمي يبقى لفريق الامتثال.', 'open document': 'افتح المستند',
  'Select a document': 'اختر مستنداً', 'Text file (email body). Stored as data only.': 'ملف نصي (نص بريد). محفوظ كبيانات فقط.', 'Loading PDF': 'جارٍ تحميل الملف', 'Source: “{s}”': 'المصدر: “{s}”', Previous: 'السابق', Next: 'التالي', 'page {a} / {b}': 'صفحة {a} / {b}',
  fail: 'فشل', warn: 'تنبيه', info: 'معلومة', 'Ownership graph': 'مخطط الملكية',
  // merchant panel
  'Started from': 'بدأ من', 'Merchant started it in the portal': 'بدأه التاجر من البوابة', 'Link sent by your team': 'رابط أرسله فريقك', Contact: 'جهة التواصل', Arabic: 'العربية', English: 'الإنجليزية',
  'Sent for review': 'أُرسل للمراجعة', 'Last seen': 'آخر ظهور', 'Current link': 'الرابط الحالي', 'sent {a}, valid until {b}': 'أُرسل {a}، صالح حتى {b}', Uploads: 'الملفات المرفوعة',
  '{n} file(s), {m} placed against a checklist item': '{n} ملف، منها {m} مرتبطة ببند في القائمة', yes: 'نعم', no: 'لا',
  'This case was created by your team. Email the merchant a secure link to upload documents themselves.': 'أنشأ فريقك هذا الطلب. أرسل للتاجر رابطاً آمناً ليرفع المستندات بنفسه.',
  "Required because of the merchant's answers": 'مطلوب بناءً على إجابات التاجر', 'Send a new upload link': 'أرسل رابط رفع جديداً', 'Send an upload link': 'أرسل رابط رفع',
  'The merchant gets a private link to the upload portal in your brand. A new link replaces the previous one.': 'يحصل التاجر على رابط خاص لبوابة الرفع بهويتك التجارية، ويحل الرابط الجديد محل السابق.',
  'Merchant name': 'اسم التاجر', 'Merchant email': 'بريد التاجر', 'Email upload link': 'أرسل رابط الرفع', 'Upload link emailed to {to}, valid until {until}': 'أُرسل رابط الرفع إلى {to}، صالح حتى {until}',
  vat_registered: 'مسجل في ضريبة القيمة المضافة', licence_kind: 'نوع الرخصة', owner_uae_national: 'المالك مواطن إماراتي', has_corporate_shareholders: 'يوجد شركاء اعتباريون', chamber_member: 'عضو في غرفة التجارة', free_zone_authority: 'سلطة المنطقة الحرة', parent_location: 'موقع الشركة الأم',
  Record: 'السجل', COMPANY: 'الشركة', DIRECTOR: 'مدير', SIGNATORY: 'مفوض بالتوقيع', UBO: 'مستفيد حقيقي', SHAREHOLDER: 'شريك', 'No match in MOCK list': 'لا توجد مطابقة في القائمة التجريبية',
  'Something went wrong. Try again.': 'حدث خطأ. حاول مرة أخرى.',
  // settings
  'Policy and controls.': 'السياسات والضوابط.', 'Every change is versioned.': 'كل تغيير له إصدار محفوظ.', 'Read only. Only an ADMIN can change settings.': 'للقراءة فقط. لا يغيّر الإعدادات إلا مدير النظام.',
  'Base policy': 'السياسة الأساسية', 'Acquirer overrides': 'استثناءات البنوك المستحوذة', 'Tokens and webhook': 'الرموز والإشعارات', 'Users and roles': 'المستخدمون والأدوار',
  'Policies, acquirers, tokens and webhook are managed by MoneyBee for all partners. You can manage your own users.': 'تدير MoneyBee السياسات والبنوك المستحوذة والرموز والإشعارات لجميع الشركاء، ويمكنك إدارة مستخدميك.',
  'Admins manage users.': 'يدير المستخدمين مديرو النظام.', 'User created': 'تم إنشاء المستخدم', Name: 'الاسم', Active: 'نشط', 'Add user': 'إضافة مستخدم', 'Password (12+ chars)': 'كلمة المرور (12 حرفاً أو أكثر)', 'Create user': 'إنشاء المستخدم', Save: 'حفظ',
};

const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة', RECEIVED: 'مستلم', CLASSIFIED: 'مصنّف', EXTRACTED: 'تم الاستخراج', VERIFIED: 'تم التحقق', UBO_RESOLVED: 'تم تحديد المستفيد', SCREENED: 'تم الفحص', RISK_SCORED: 'تم تقييم المخاطر',
  PACK_BUILT: 'الملف جاهز', AWAITING_REVIEW: 'بانتظار المراجعة', NEEDS_INFO: 'بحاجة لمعلومات', APPROVED: 'موافق عليه', REJECTED: 'مرفوض', COMPLETED: 'مكتمل',
  FLAGGED: 'بحاجة لمراجعة', UNVERIFIED: 'لم يُتحقق منه', EXPIRED: 'منتهي الصلاحية',
};
const RISK_AR: Record<string, string> = { LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'مرتفعة', REFER: 'إحالة' };
const ROLE_EN: Record<string, string> = { ADMIN: 'admin', UNDERWRITER: 'underwriter', SECOND_REVIEWER: 'second reviewer', VIEWER: 'viewer' };
const ROLE_AR: Record<string, string> = { ADMIN: 'مدير النظام', UNDERWRITER: 'مسؤول الاكتتاب', SECOND_REVIEWER: 'المراجع الثاني', VIEWER: 'قراءة فقط' };
const ENTITY_AR: Record<string, string> = { auto: 'تحديد تلقائي', sole_establishment: 'مؤسسة فردية', llc: 'شركة ذات مسؤولية محدودة (بر رئيسي)', free_zone: 'شركة منطقة حرة', mainland: 'بر رئيسي (دائرة الاقتصاد)', branch: 'فرع' };
const FIELD_AR: Record<string, string> = {
  'company.legalName': 'الاسم القانوني', 'company.tradeName': 'الاسم التجاري', 'company.legalForm': 'الشكل القانوني', 'company.incorporationDate': 'تاريخ التأسيس', 'company.trn': 'الرقم الضريبي', 'company.registeredAddress': 'العنوان المسجل', 'company.website': 'الموقع الإلكتروني',
  'licence.number': 'رقم الرخصة', 'licence.authority': 'جهة الإصدار', 'licence.issueDate': 'تاريخ الإصدار', 'licence.expiryDate': 'تاريخ الانتهاء', 'licence.activities': 'الأنشطة المرخصة',
  'banking.iban': 'رقم الآيبان', 'banking.bankName': 'البنك', 'banking.accountName': 'اسم الحساب',
  'activity.description': 'وصف النشاط', 'activity.mcc': 'رمز فئة التاجر (MCC)', 'activity.expectedMonthlyVolume': 'الحجم الشهري المتوقع (درهم)', 'activity.expectedAvgTicket': 'متوسط قيمة العملية (درهم)', 'activity.chargebackRatioPct': 'نسبة المبالغ المستردة (%)',
};
const SECTION_AR: Record<string, string> = { Company: 'الشركة', Licence: 'الرخصة', Banking: 'البيانات البنكية', 'Expected activity': 'النشاط المتوقع' };
const STEP_AR: Record<string, string> = {
  'Classify documents': 'تصنيف المستندات', 'Extract fields': 'استخراج البيانات', 'Policy checks': 'فحوصات السياسة', 'Resolve beneficial owners': 'تحديد المستفيدين الحقيقيين', 'Screen parties': 'فحص الأطراف',
  'Screen related parties': 'فحص الأطراف ذات الصلة', 'Screening (MOCK)': 'الفحص (تجريبي)', Screening: 'الفحص', 'Score risk and draft memo': 'تقييم المخاطر وصياغة المذكرة', 'Build acquirer pack': 'تجهيز ملف البنك المستحوذ', 'Draft merchant request': 'صياغة طلب للتاجر', 'Classify portal upload': 'تصنيف ملفات البوابة',
};
const WHY_AR: Record<string, string> = { 'licence owner': 'مالك الرخصة', director: 'المدير', 'authorised signatory': 'المفوض بالتوقيع', shareholder: 'الشريك', 'declared UBO': 'المستفيد المصرَّح به' };
const RECO_AR: Record<string, string> = {
  'Recommend approval after reviewer confirms flagged fields.': 'يوصى بالموافقة بعد أن يؤكد المراجع الحقول المشار إليها.',
  'Recommend approval subject to reviewer checks of listed drivers.': 'يوصى بالموافقة بشرط مراجعة العوامل المذكورة.',
  'Refer for senior review before any approval.': 'يحال لمراجعة عليا قبل أي موافقة.',
};

/** English document label (as the API writes it) -> doc type, to translate document names inside messages. */
const DOC_BY_LABEL = new Map<string, string>([
  ...Object.entries(DOC_TYPE_LABELS).map(([k, v]) => [String(v).toLowerCase(), k] as [string, string]),
  ...Object.entries(DOC_LABELS).map(([k, v]) => [v.toLowerCase(), k] as [string, string]),
]);
const docAr = (label: string) => {
  const k = DOC_BY_LABEL.get(label.trim().toLowerCase());
  return k && DOC_AR[k] ? DOC_AR[k] : label;
};
const fieldAr = (path: string) => FIELD_AR[path.trim()] ?? path;

type Rule = [RegExp, (m: RegExpExecArray) => string];
const RULES: Rule[] = [
  // findings
  [/^Required document missing: (.+?)\.(?: \((.+)\))?$/, (m) => `مستند مطلوب غير موجود: ${docAr(m[1])}.`],
  [/^Required field not found: (.+)\.$/, (m) => `حقل مطلوب غير موجود: ${fieldAr(m[1])}.`],
  [/^(.+) expired on (.+)\.$/, (m) => `${docAr(m[1])}: انتهت الصلاحية في ${m[2]}.`],
  [/^(.+) expires in (\d+) days \((.+)\)\.$/, (m) => `${docAr(m[1])}: تنتهي الصلاحية خلال ${m[2]} يوماً (${m[3]}).`],
  [/^Licence number "(.+)" does not match the expected format for (.+)\.$/, (m) => `رقم الرخصة "${m[1]}" لا يطابق الصيغة المتوقعة لدى ${m[2]}.`],
  [/^Emirates ID number for (.+) is not in the expected 784-YYYY-NNNNNNN-C format\.$/, (m) => `رقم الهوية الإماراتية لـ ${m[1]} ليس بالصيغة المتوقعة 784-YYYY-NNNNNNN-C.`],
  [/^TRN "(.+)" is not a 15 digit number\.$/, (m) => `الرقم الضريبي "${m[1]}" ليس مكوناً من 15 رقماً.`],
  [/^(.+?) "(.+)" does not match any identity document \(closest: "(.+)", similarity ([\d.]+)\)\.$/, (m) => `${WHY_AR[m[1].toLowerCase()] ?? m[1]} "${m[2]}" لا يطابق أي مستند هوية (الأقرب: "${m[3]}"، نسبة التشابه ${m[4]}).`],
  [/^(.+?) "(.+)" is close to but not identical with "(.+)" \(similarity ([\d.]+)\)\..*$/, (m) => `${WHY_AR[m[1].toLowerCase()] ?? m[1]} "${m[2]}" قريب من "${m[3]}" لكنه غير مطابق (نسبة التشابه ${m[4]}). قد يكون الاختلاف في كتابة الاسم بالحروف اللاتينية.`],
  [/^Company name on (.+) \("(.+)"\) differs from the licence \("(.+)"\)\.$/, (m) => `اسم الشركة في ${docAr(m[1])} ("${m[2]}") يختلف عن الرخصة ("${m[3]}").`],
  [/^Registered address on the licence differs from the lease \/ Ejari address\.$/, () => 'العنوان المسجل في الرخصة يختلف عن عنوان عقد الإيجار / إيجاري.'],
  [/^Shareholder percentages add up to (.+), not 100\.$/, (m) => `مجموع نسب الشركاء ${m[1]} وليس 100.`],
  [/^Low confidence extraction for (.+) \((\d+)%\)\. Human review required\.$/, (m) => `ثقة منخفضة في استخراج ${fieldAr(m[1])} (${m[2]}%). يلزم مراجعة بشرية.`],
  [/^A document contains instruction-like text aimed at an AI system\..*$/, () => 'يحتوي أحد المستندات على نص يشبه تعليمات موجهة لنظام ذكاء اصطناعي. عومل كبيانات وتم تجاهله، وسُجل كمؤشر مخاطر.'],
  [/^(.+) is older than (\d+) days\.$/, (m) => `${docAr(m[1])} أقدم من ${m[2]} يوماً.`],
  [/^Policy check flagged: (.+) A reviewer should compare the source documents before relying on this field\.$/, (m) => `أشار الفحص إلى: ${trMsgAr(m[1])} على المراجع مقارنة المستندات الأصلية قبل الاعتماد على هذا الحقل.`],
  // gaps
  [/^Missing: (.+)\.$/, (m) => `ناقص: ${docAr(m[1])}.`],
  [/^(.+) has expired \((.+)\)\. Please provide a valid copy\.$/, (m) => `${docAr(m[1])} منتهي الصلاحية (${m[2]}). يرجى تقديم نسخة سارية.`],
  [/^Please send a (.+) issued in the last (\d+) days\.$/, (m) => `يرجى إرسال ${docAr(m[1])} صادر خلال آخر ${m[2]} يوماً.`],
  [/^Please provide a clearer copy showing (.+)\.$/, (m) => `يرجى تقديم نسخة أوضح تُظهر ${fieldAr(m[1])}.`],
  [/^Information needed: (.+)\.$/, (m) => `معلومة مطلوبة: ${fieldAr(m[1])}.`],
  [/^The name "(.+)" on the company documents does not match the identity documents provided\..*$/, (m) => `الاسم "${m[1]}" في مستندات الشركة لا يطابق مستندات الهوية المقدمة. يرجى التأكيد أو تقديم الهوية الصحيحة.`],
  // risk breakdown
  [/^MCC (.+) is in the high risk tier\.$/, (m) => `رمز MCC ${m[1]} ضمن فئة المخاطر المرتفعة.`],
  [/^MCC (.+) is in the medium risk tier\.$/, (m) => `رمز MCC ${m[1]} ضمن فئة المخاطر المتوسطة.`],
  [/^A related party has high risk jurisdiction link: (.+)\.$/, (m) => `أحد الأطراف ذات الصلة مرتبط بدولة عالية المخاطر: ${m[1]}.`],
  [/^Business is (\d+) months old\.$/, (m) => `عمر النشاط ${m[1]} شهراً.`],
  [/^Ownership spans (\d+) layers( with untraced entities)?\.$/, (m) => `تمتد الملكية عبر ${m[1]} طبقات${m[2] ? ' مع جهات غير متتبعة' : ''}.`],
  [/^Expected monthly volume AED (.+)\.$/, (m) => `الحجم الشهري المتوقع ${m[1]} درهم.`],
  [/^Expected average ticket AED (.+)\.$/, (m) => `متوسط قيمة العملية المتوقع ${m[1]} درهم.`],
  [/^Previous chargeback ratio (.+)%\.$/, (m) => `نسبة المبالغ المستردة سابقاً ${m[1]}%.`],
  [/^A related party matches a sanctions list entry\. Hard REFER trigger\.$/, () => 'أحد الأطراف يطابق قيداً في قوائم العقوبات. يستوجب الإحالة.'],
  [/^A related party is a politically exposed person\.$/, () => 'أحد الأطراف شخص معرّض سياسياً.'],
  [/^Adverse media match on a related party\.$/, () => 'تطابق مع أخبار سلبية لأحد الأطراف.'],
  [/^(\d+) of (\d+) fields are low confidence\.$/, (m) => `${m[1]} من ${m[2]} حقلاً منخفضة الثقة.`],
  [/^(\d+) failed policy check\(s\): (.+)\.$/, (m) => `${m[1]} فحص لم ينجح: ${m[2]}.`],
  [/^(\d+) policy check warning\(s\)\.$/, (m) => `${m[1]} تنبيه في فحوصات السياسة.`],
  [/^Instruction-like text was found inside a document.*$/, () => 'وُجد نص يشبه التعليمات داخل مستند (عومل كبيانات وسُجل كمؤشر مخاطر).'],
  [/^A company party does not match the identity documents\.$/, () => 'أحد أطراف الشركة لا يطابق مستندات الهوية.'],
  // agent summaries
  [/^(\d+) document\(s\) classified$/, (m) => `تم تصنيف ${m[1]} مستند`],
  [/^(\d+) document\(s\) classified from the merchant portal$/, (m) => `تم تصنيف ${m[1]} مستند من بوابة التاجر`],
  [/^(\d+) document\(s\) extracted$/, (m) => `تم استخراج بيانات ${m[1]} مستند`],
  [/^(\d+) fail, (\d+) warn$/, (m) => `${m[1]} فشل، ${m[2]} تنبيه`],
  [/^(\d+) subject\(s\) screened( - MOCK SCREENING, not a real check)?$/, (m) => `تم فحص ${m[1]} طرف${m[2] ? ' - فحص تجريبي وليس حقيقياً' : ''}`],
  [/^(LOW|MEDIUM|HIGH|REFER) \(score (\d+)\)$/, (m) => `${RISK_AR[m[1]]} (الدرجة ${m[2]})`],
  [/^(\d+) outstanding item\(s\); draft NOT sent$/, (m) => `${m[1]} عنصر ناقص؛ لم تُرسل المسودة`],
  [/^Nothing outstanding$/, () => 'لا توجد نواقص'],
  [/^(\d+) file\(s\) in pack for (.+?)( \(example acquirer\))?$/, (m) => `${m[1]} ملف في ملف ${m[2]}${m[3] ? ' (بنك مستحوذ تجريبي)' : ''}`],
  // UBO explanation
  [/^No natural person reaches the (\d+)% threshold\. The UBO declaration states control by other means;.*$/, (m) => `لا يبلغ أي شخص طبيعي حد ${m[1]}%. يذكر إقرار المستفيد الحقيقي وجود سيطرة بوسائل أخرى، لذا أُدرج الأشخاص المصرَّح بهم كمستفيدين حقيقيين ليؤكدهم المراجع.`],
  [/^No natural person reaches the (\d+)% threshold, no control by other means was declared and no managing official was identified\./, (m) => `لا يبلغ أي شخص طبيعي حد ${m[1]}%، ولم يُصرَّح بسيطرة بوسائل أخرى، ولم يُحدَّد مسؤول إداري. يتطلب الطلب تحديد المستفيد الحقيقي يدوياً.`],
  [/^No natural person reaches the (\d+)% threshold and no control by other means was declared\. As a fallback, the senior managing official \((.+)\) is listed; the underwriter must confirm\.$/, (m) => `لا يبلغ أي شخص طبيعي حد ${m[1]}% ولم يُصرَّح بسيطرة بوسائل أخرى. كبديل، أُدرج المسؤول الإداري الأول (${m[2]}) ويجب على المراجع التأكيد.`],
  // truncated UBO explanations in the agent timeline (160 characters)
  [/^Ownership was traced through (\d+) layers? to natural persons\./, (m) => `تم تتبع الملكية عبر ${m[1]} طبقة وصولاً إلى أشخاص طبيعيين.`],
  [/^No natural person reaches the (\d+)% threshold/, (m) => `لا يبلغ أي شخص طبيعي حد ${m[1]}%. راجع تبويب الملكية.`],
];
function trMsgAr(en: string): string {
  const s = en.trim();
  for (const [re, f] of RULES) {
    const m = re.exec(s);
    if (m) return f(m);
  }
  return en;
}
/** Ownership explanation: "Ownership was traced through N layer(s) ... X holds P% effective ownership (...) ..." */
function uboAr(en: string): string {
  let s = en;
  const tail = /\s*Ownership could not be traced past: (.+) \(no shareholder documents provided\)\.$/.exec(s);
  if (tail) s = s.slice(0, tail.index);
  const head = /^Ownership was traced through (\d+) layers? to natural persons\. (.+)\. Persons at or above the (\d+)% policy threshold are flagged as beneficial owners\.$/.exec(s);
  let out: string;
  if (head) {
    const people = head[2].split(/\. (?=[^.]+ holds )/).map((p) => {
      const m = /^(.+) holds ([\d.]+)% effective ownership \((.+)\)$/.exec(p);
      return m ? `${m[1]} يملك ${m[2]}% ملكية فعلية (${m[3]})` : p;
    });
    out = `تم تتبع الملكية عبر ${head[1]} طبقة وصولاً إلى أشخاص طبيعيين. ${people.join('. ')}. يُعتبر كل من يبلغ حد ${head[3]}% أو أكثر مستفيداً حقيقياً.`;
  } else out = trMsgAr(s);
  if (tail) out += ` تعذر تتبع الملكية بعد: ${tail[1]} (لم تُقدَّم مستندات الشركاء).`;
  return out;
}
/** Mock memo: header, drivers (one per line) and closing sentence. A live model's memo stays as written. */
function memoAr(en: string): string {
  return en.split('\n').map((line) => {
    let m = /^MOCK-GENERATED MEMO\. Rating (\w+) \(score (\d+)\)\.$/.exec(line);
    if (m) return `مذكرة تجريبية. التصنيف ${RISK_AR[m[1]] ?? m[1]} (الدرجة ${m[2]}).`;
    if (line === 'Drivers:') return 'العوامل:';
    if (line === '- No risk drivers fired.') return '- لم يظهر أي عامل مخاطر.';
    m = /^- ([A-Z_]+) \(\+(\d+)\): (.+)$/.exec(line);
    if (m) return `- ${m[1]} (+${m[2]}): ${trMsgAr(m[3])}`;
    if (line.startsWith('This memo is a recommendation for the human underwriter')) return 'هذه المذكرة توصية لمسؤول الاكتتاب، وليست قراراً.';
    return line;
  }).join('\n');
}

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : s);

export interface I18n {
  lang: Lang;
  ar: boolean;
  setLang: (l: Lang) => void;
  t: (en: string, vars?: Record<string, string | number>) => string;
  doc: (docType: string) => string;
  entity: (type: string) => string;
  status: (s: string) => string;
  risk: (r: string) => string;
  field: (path: string) => string;
  section: (title: string) => string;
  role: (r: string) => string;
  step: (s: string) => string;
  msg: (en: string | null | undefined) => string;
  ubo: (en: string) => string;
  memo: (en: string) => string;
  reco: (en: string) => string;
  date: (iso: string | Date, withTime?: boolean) => string;
  /** turns an API error into a readable, translated sentence (role errors name the role that is needed) */
  err: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

export function readLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'ar' || q === 'en') return q;
    return localStorage.getItem('mb_lang') === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('mb_lang', l); } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    return () => { document.documentElement.dir = 'ltr'; document.documentElement.lang = 'en'; };
  }, [lang]);
  const value = useMemo<I18n>(() => {
    const ar = lang === 'ar';
    const t = (en: string, vars?: Record<string, string | number>) => fill(ar ? AR[en] ?? en : en, vars);
    const roleName = (r: string) => (ar ? ROLE_AR[r] : ROLE_EN[r]) ?? r.toLowerCase().replace(/_/g, ' ');
    return {
      lang, ar, setLang, t,
      doc: (d) => (ar ? DOC_AR[d] : undefined) ?? DOC_LABELS[d] ?? d,
      entity: (e) => (ar ? ENTITY_AR[e] : undefined) ?? ENTITY_LABELS[e] ?? e,
      status: (s) => (ar ? STATUS_AR[s] : undefined) ?? s.replace(/_/g, ' '),
      risk: (r) => (ar ? RISK_AR[r] : undefined) ?? r,
      field: (p) => (ar ? FIELD_AR[p] : undefined) ?? FIELD_LABELS[p] ?? p,
      section: (s) => (ar ? SECTION_AR[s] : undefined) ?? s,
      role: roleName,
      step: (s) => (ar ? STEP_AR[s] : undefined) ?? s,
      msg: (en) => (en ? (ar ? trMsgAr(en) : en) : ''),
      ubo: (en) => (ar ? uboAr(en) : en),
      memo: (en) => (ar ? memoAr(en) : en),
      reco: (en) => (ar ? RECO_AR[en] ?? en : en),
      date: (iso, withTime = true) => new Intl.DateTimeFormat(ar ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: withTime ? undefined : 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(iso)),
      err: (e) => {
        const body = (e as { body?: { code?: string; role?: string; allowed?: string[] } })?.body;
        if (body?.code === 'role_forbidden' && body.role) {
          const names = (body.allowed ?? []).map(roleName);
          const allowed = names.length > 1 ? `${names.slice(0, -1).join(ar ? '، ' : ', ')} ${t('or')} ${names[names.length - 1]}` : names[0] ?? '';
          return t('Your role ({role}) cannot do this. Sign in as {allowed}.', { role: roleName(body.role), allowed });
        }
        const m = (e as Error)?.message ?? '';
        return ar ? AR[m] ?? trMsgAr(m) : m;
      },
    };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Works outside the provider too (English), so shared components never crash. */
const FALLBACK: I18n = {
  lang: 'en', ar: false, setLang: () => undefined, t: (s, v) => fill(s, v), doc: (d) => DOC_LABELS[d] ?? d, entity: (e) => ENTITY_LABELS[e] ?? e, status: (s) => s.replace(/_/g, ' '), risk: (r) => r,
  field: (p) => FIELD_LABELS[p] ?? p, section: (s) => s, role: (r) => ROLE_EN[r] ?? r, step: (s) => s, msg: (s) => s ?? '', ubo: (s) => s, memo: (s) => s, reco: (s) => s,
  date: (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }), err: (e) => (e as Error)?.message ?? String(e),
};
export const useI18n = () => useContext(Ctx) ?? FALLBACK;

export function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`lang-toggle ${className}`} role="group" aria-label="Language / اللغة">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
      <button type="button" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')} lang="ar">العربية</button>
    </div>
  );
}
