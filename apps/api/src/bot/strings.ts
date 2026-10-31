import type { BotLang, DocType } from '@moneybee/shared';

/**
 * All merchant-facing copy, English and Arabic. Source: docs/bot/01-conversation-script.md.
 * Keys are stable; copy is editable. {var} placeholders are filled by fmt().
 */
type S = Record<string, { en: string; ar: string }>;

export const STRINGS = {
  S0_LANG: {
    en: 'Welcome to MoneyBee. I can set up your business to accept card and online payments, right here in this chat. It takes about 10 minutes plus a few documents.\nFirst, which language would you like?',
    ar: 'أهلاً بك في MoneyBee. يمكنني تجهيز شركتك لقبول المدفوعات بالبطاقات وعبر الإنترنت هنا في هذه المحادثة. يستغرق الأمر نحو 10 دقائق مع بعض المستندات.\nأولاً، أي لغة تفضل؟',
  },
  S0_CONSENT: {
    en: 'To process your application I will collect company and ID documents and share them with our underwriting team. Your data is handled under UAE data protection law and used only for this application.\nDo you agree to continue?',
    ar: 'لمعالجة طلبك سأجمع مستندات الشركة والهوية وأشاركها مع فريق الاكتتاب لدينا. تُعالج بياناتك وفق قانون حماية البيانات في الإمارات وتُستخدم لهذا الطلب فقط.\nهل توافق على المتابعة؟',
  },
  S0_EXIT: { en: 'No problem. Message me whenever you are ready and we will pick up from here.', ar: 'لا مشكلة. راسلني عندما تكون جاهزاً وسنكمل من هنا.' },
  S0_RESUME: { en: 'Welcome back, {contactName}. We stopped at: {stepLabel}. {progress}', ar: 'أهلاً بعودتك يا {contactName}. توقفنا عند: {stepLabel}. {progress}' },
  S1_CONTACT: { en: 'Great. What is your name?', ar: 'ممتاز. ما اسمك؟' },
  S1_COMPANY: { en: 'Nice to meet you, {contactName}. What is the legal name of your company, exactly as on the trade licence?', ar: 'تشرفت بك يا {contactName}. ما الاسم القانوني لشركتك كما هو مكتوب في الرخصة التجارية؟' },
  S1_ENTITY: { en: 'What type of company is {companyName}?', ar: 'ما نوع شركة {companyName}؟' },
  S1_ENTITY_LICENCE: { en: 'No problem. Send me a photo of your trade licence and I will read the company type from it.', ar: 'لا مشكلة. أرسل لي صورة من الرخصة التجارية وسأقرأ نوع الشركة منها.' },
  S1_ENTITY_LICENCE_FAIL: { en: 'I could not read the company type from that. Please pick it from the list.', ar: 'لم أتمكن من قراءة نوع الشركة. اختره من القائمة من فضلك.' },
  S1_EMIRATE: { en: 'Which emirate is the company licensed in?', ar: 'في أي إمارة الشركة مرخصة؟' },
  S1_FREEZONE: { en: 'Which free zone?', ar: 'أي منطقة حرة؟' },
  S1_DESCRIPTION: { en: 'In one or two lines, what does {companyName} sell or do? For example "women\'s fashion online" or "IT consulting for SMEs".', ar: 'في سطر أو سطرين، ماذا تبيع أو تقدم {companyName}؟ مثلاً "أزياء نسائية عبر الإنترنت" أو "استشارات تقنية للشركات الصغيرة".' },
  S1_CATEGORY_CONFIRM: { en: 'Sounds like {mccLabel}. Is that right?', ar: 'يبدو أنها {mccLabel}. هل هذا صحيح؟' },
  S1_CATEGORY_LIST: { en: 'Pick the closest category:', ar: 'اختر الفئة الأقرب:' },
  S1_CHANNEL: { en: 'How do customers pay you?', ar: 'كيف يدفع لك العملاء؟' },
  S1_CUSTOMER_TYPE: { en: 'Who are your customers mostly?', ar: 'من هم عملاؤك غالباً؟' },
  S1_BILLING: { en: 'Are payments one-off or recurring subscriptions?', ar: 'هل المدفوعات لمرة واحدة أم اشتراكات متكررة؟' },
  S1_LOCATION: { en: 'Where are your customers?', ar: 'أين يوجد عملاؤك؟' },
  S1_VOLUME: { en: 'Roughly how much do you expect to process per month in AED?', ar: 'كم تتوقع أن تعالج شهرياً بالدرهم تقريباً؟' },
  S1_TICKET: { en: 'And the typical amount per transaction?', ar: 'وما المبلغ المعتاد لكل عملية؟' },
  S1_TICKET_CONFIRM: { en: 'That works out to about {txPerMonth} transactions a month. Does that sound right?', ar: 'هذا يعني نحو {txPerMonth} عملية شهرياً. هل هذا صحيح؟' },
  S1_GATEWAY: { en: 'Do you accept card payments today?', ar: 'هل تقبل الدفع بالبطاقات حالياً؟' },
  S1_SWITCH_REASON: { en: 'What would you like to be better with MoneyBee?', ar: 'ما الذي تريد أن يكون أفضل مع MoneyBee؟' },
  S1_YEARS: { en: 'How long has the company been operating?', ar: 'منذ متى تعمل الشركة؟' },
  S1_WEB: { en: 'Share your website or app link. If you do not have one yet, your Instagram or TikTok is fine. Or reply "not yet".', ar: 'شارك رابط موقعك أو تطبيقك. إن لم يكن لديك، يكفي حساب إنستغرام أو تيك توك. أو رد بـ "ليس بعد".' },
  S1_FLAGS: { en: 'Last one for this part. Does the business involve any of these? Pick one, or "None".', ar: 'السؤال الأخير في هذا الجزء. هل يشمل النشاط أياً مما يلي؟ اختر واحداً أو "لا شيء".' },
  S1_SUMMARY: {
    en: 'Here is what I have:\n- {companyName}, {entityLabel}, {emirate}\n- {mccLabel}, {channel}, {customerType}\n- About AED {volume} a month, typical ticket AED {ticket}\n- {years}, {web}\nAll correct?',
    ar: 'هذا ما لدي:\n- {companyName}، {entityLabel}، {emirate}\n- {mccLabel}، {channel}، {customerType}\n- نحو {volume} درهم شهرياً، متوسط العملية {ticket} درهم\n- {years}، {web}\nهل كل شيء صحيح؟',
  },
  S1_EDIT_WHICH: { en: 'Which part would you like to change?', ar: 'أي جزء تريد تغييره؟' },
  S2_RESTRICTED: {
    en: 'Businesses in {mccLabel} are welcome at MoneyBee but need a closer look from our underwriting team, so it may take a little longer and we may ask for a few extra documents. Shall we continue?',
    ar: 'الأنشطة في {mccLabel} مرحب بها في MoneyBee لكنها تحتاج مراجعة أدق من فريق الاكتتاب، لذا قد يستغرق الأمر وقتاً أطول وقد نطلب مستندات إضافية. هل نكمل؟',
  },
  S2_PROHIBITED: {
    en: 'Thank you for the details. Unfortunately MoneyBee cannot support {mccLabel} at the moment. I have noted your interest and we will let you know if that changes.',
    ar: 'شكراً على التفاصيل. للأسف لا يمكن لـ MoneyBee دعم {mccLabel} حالياً. سجلت اهتمامك وسنخبرك إذا تغير ذلك.',
  },
  S3_INTRO: {
    en: 'Now the documents. For a {entityLabel} I need {n} items. Send each one as a photo or PDF, one at a time. You can type "later" to skip one and come back.{extraReviewLine}\nBefore we start: would you like to share your Emirates ID and visa automatically through UAE PASS? It is faster and verified.',
    ar: 'الآن المستندات. لـ{entityLabel} أحتاج {n} مستندات. أرسل كل مستند كصورة أو PDF واحداً تلو الآخر. يمكنك كتابة "لاحقاً" لتخطي أي مستند والعودة إليه.{extraReviewLine}\nقبل أن نبدأ: هل تريد مشاركة الهوية الإماراتية والإقامة تلقائياً عبر UAE PASS؟ أسرع وموثق.',
  },
  S3_EXTRA_REVIEW_LINE: { en: '\nBecause this is a {reason}, our team may ask for the parent company documents later.', ar: '\nلأن هذه {reason}، قد يطلب فريقنا مستندات الشركة الأم لاحقاً.' },
  S3_UAEPASS_LINK: { en: 'Open this link, sign in with UAE PASS and approve the share request: {inviteUrl}\nI will continue with the other documents meanwhile.', ar: 'افتح هذا الرابط وسجّل الدخول عبر UAE PASS ووافق على طلب المشاركة: {inviteUrl}\nسأكمل مع بقية المستندات في هذه الأثناء.' },
  S3_ASK: { en: '{index} of {n}: please send your *{docLabel}*. {docHint}', ar: '{index} من {n}: أرسل من فضلك *{docLabel}*. {docHint}' },
  S3_RECEIVED: { en: 'Got it, {docLabel} received.{expiryLine}', ar: 'تم استلام {docLabel}.{expiryLine}' },
  S3_EXPIRY_VALID: { en: ' Valid until {date}.', ar: ' ساري حتى {date}.' },
  S3_EXPIRY_SOON: { en: ' Note: this expires in {days} days; we will accept it but may ask for the renewal.', ar: ' ملاحظة: تنتهي صلاحيته خلال {days} يوماً؛ سنقبله لكن قد نطلب التجديد.' },
  S3_WRONG: { en: 'This looks like a {detectedLabel}, not a {docLabel}. I have kept it anyway. Could you send the {docLabel}?', ar: 'يبدو هذا {detectedLabel} وليس {docLabel}. احتفظت به على أي حال. هل يمكنك إرسال {docLabel}؟' },
  S3_UNREADABLE: { en: 'I could not read that clearly. Please retake it in good light with all four corners visible, or send the PDF.', ar: 'لم أتمكن من قراءته بوضوح. أعد التصوير في إضاءة جيدة مع ظهور الزوايا الأربع، أو أرسل ملف PDF.' },
  S3_EXPIRED: { en: 'This {docLabel} expired on {date}. Do you have the renewed one?', ar: 'انتهت صلاحية {docLabel} في {date}. هل لديك النسخة المجددة؟' },
  S3_BUNDLE: { en: 'That file contains several documents ({labels}). I have split and filed them. Still needed: {remaining}.', ar: 'يحتوي الملف على عدة مستندات ({labels}). قمت بفصلها وحفظها. المتبقي: {remaining}.' },
  S3_UNSUPPORTED: { en: 'I can only read photos and PDFs. Could you send the document as one of those?', ar: 'يمكنني قراءة الصور وملفات PDF فقط. هل يمكنك إرسال المستند بإحدى هاتين الصيغتين؟' },
  S3_LATER: { en: 'Noted, I will come back to {docLabel}.', ar: 'حسناً، سأعود إلى {docLabel} لاحقاً.' },
  S3_PROGRESS: { en: '{received} of {n} received. Remaining: {remaining}.', ar: 'تم استلام {received} من {n}. المتبقي: {remaining}.' },
  S3_DUPLICATE: { en: 'I already have that file. Please send the {docLabel}.', ar: 'لدي هذا الملف بالفعل. أرسل {docLabel} من فضلك.' },
  S3_DEFERRED_RETURN: { en: 'Back to the ones we skipped.', ar: 'نعود إلى ما تخطيناه.' },
  S3_OPTIONAL: { en: 'That is everything required. Anything else you would like to add, such as a bank statement, processing statement or VAT certificate? Send it, or reply "done".', ar: 'هذا كل المطلوب. هل تريد إضافة أي شيء آخر مثل كشف حساب بنكي أو كشف المعالجة أو شهادة الضريبة؟ أرسله، أو رد بـ "تم".' },
  S3_COMPLETE: { en: 'That is everything. Give me a moment while I review your file.', ar: 'هذا كل شيء. أمهلني لحظة لمراجعة ملفك.' },
  S4_LIKELY: {
    en: 'Good news, {contactName}. Based on what you have shared, {companyName} looks like a good fit for MoneyBee.\n\nIndicative pricing for {mccLabel}, subject to underwriting:\n{pricingLines}\n\nNext step: our underwriting team reviews your file. Typical time: {sla}. Shall I submit it?',
    ar: 'خبر جيد يا {contactName}. بناءً على ما شاركته، تبدو {companyName} مناسبة لـ MoneyBee.\n\nالأسعار الإرشادية لـ{mccLabel}، رهناً بالاكتتاب:\n{pricingLines}\n\nالخطوة التالية: يراجع فريق الاكتتاب ملفك. المدة المعتادة: {sla}. هل أقدّم الطلب؟',
  },
  S4_REVIEW: {
    en: 'Thank you, {contactName}. Your file is complete. A few points need a closer look from our underwriting team before we can confirm pricing, so here is an indicative range only, subject to underwriting:\n{pricingLines}\n\nTypical review time: {sla}. Shall I submit it?',
    ar: 'شكراً يا {contactName}. ملفك مكتمل. تحتاج بعض النقاط إلى مراجعة أدق من فريق الاكتتاب قبل تأكيد الأسعار، لذا إليك نطاقاً إرشادياً فقط، رهناً بالاكتتاب:\n{pricingLines}\n\nمدة المراجعة المعتادة: {sla}. هل أقدّم الطلب؟',
  },
  S4_UNLIKELY: {
    en: 'Thank you, {contactName}. Your file is complete. Based on the information so far, approval is not certain, but our underwriting team makes the final decision and will look at it carefully. Shall I submit it?',
    ar: 'شكراً يا {contactName}. ملفك مكتمل. بناءً على المعلومات حتى الآن، الموافقة غير مؤكدة، لكن القرار النهائي لفريق الاكتتاب وسيراجعه بعناية. هل أقدّم الطلب؟',
  },
  P_CNP: { en: '- Online card rate: {mdr}% + AED {fee} per transaction', ar: '- رسوم البطاقات عبر الإنترنت: {mdr}% + {fee} درهم لكل عملية' },
  P_CP: { en: '- In-store card rate: {mdr}% + AED {fee} per transaction', ar: '- رسوم البطاقات في المتجر: {mdr}% + {fee} درهم لكل عملية' },
  P_RANGE: { en: 'between {low}% and {high}%', ar: 'بين {low}% و{high}%' },
  P_CUSTOM: { en: '- Card rate: our team will quote based on your volume', ar: '- رسوم البطاقات: سيقدم فريقنا عرضاً حسب حجم معاملاتك' },
  P_SETTLEMENT: { en: '- Settlement: {settlement}', ar: '- التسوية: {settlement}' },
  P_SETUP: { en: '- Setup fee: {setup}', ar: '- رسوم التأسيس: {setup}' },
  P_SETUP_WAIVED: { en: 'waived', ar: 'معفاة' },
  P_RESERVE: { en: '- A rolling reserve of {pct}% held for {days} days may apply', ar: '- قد يُطبق احتياطي متجدد بنسبة {pct}% لمدة {days} يوماً' },
  S5_SUBMITTED: { en: 'Done. Your application reference is *{caseRef}*. It is now with our underwriting team. I will message you here as soon as there is an update, usually within {sla}.', ar: 'تم. رقم طلبك هو *{caseRef}*. أصبح الآن لدى فريق الاكتتاب. سأراسلك هنا فور وجود أي تحديث، عادةً خلال {sla}.' },
  S5_NEEDS_INFO: { en: 'Hi {contactName}, a quick update on {caseRef}. Our team needs a few more things to continue:\n{items}\nJust send them here when ready.', ar: 'مرحباً {contactName}، تحديث سريع بخصوص {caseRef}. يحتاج فريقنا إلى بعض الأمور الإضافية للمتابعة:\n{items}\nأرسلها هنا عندما تكون جاهزة.' },
  S5_APPROVED: { en: 'Congratulations, {contactName}. {companyName} is approved with MoneyBee.\nYour merchant ID: *{caseRef}*\n{pricingLine}Our team will contact you to go live.', ar: 'مبارك يا {contactName}. تمت الموافقة على {companyName} لدى MoneyBee.\nرقم التاجر: *{caseRef}*\n{pricingLine}سيتواصل معك فريقنا لبدء التشغيل.' },
  S5_REJECTED: { en: 'Thank you for applying, {contactName}. After review, we are not able to onboard {companyName} at this time. {reason}\nIf your circumstances change, you are welcome to apply again.', ar: 'شكراً لتقديمك يا {contactName}. بعد المراجعة، لا يمكننا تسجيل {companyName} في الوقت الحالي. {reason}\nإذا تغيرت ظروفك، نرحب بتقديمك مرة أخرى.' },
  S5_STATUS: { en: '{caseRef} is {status}. {detail}', ar: '{caseRef} حالته {status}. {detail}' },
  S5_WAITING: { en: 'Your application {caseRef} is with our underwriting team. I will message you as soon as there is an update.', ar: 'طلبك {caseRef} لدى فريق الاكتتاب. سأراسلك فور وجود تحديث.' },
  HOLD: { en: 'Sure. I have asked a MoneyBee team member to join. They will reply here during working hours (Mon to Fri, 9 to 6 Gulf time). Your progress is saved.', ar: 'بالتأكيد. طلبت من أحد أعضاء فريق MoneyBee الانضمام. سيرد هنا خلال ساعات العمل (الاثنين إلى الجمعة، 9 إلى 6 بتوقيت الخليج). تم حفظ تقدمك.' },
  NUDGE_1: { en: 'Still there, {contactName}? We were at: {stepLabel}. Reply any time to continue.', ar: 'هل ما زلت معنا يا {contactName}؟ كنا عند: {stepLabel}. رد في أي وقت للمتابعة.' },
  E_NAME: { en: 'Please send your name as text, letters only.', ar: 'أرسل اسمك كنص، أحرف فقط.' },
  E_TEXT: { en: 'Please reply with a short text answer.', ar: 'رد بإجابة نصية قصيرة من فضلك.' },
  E_URL: { en: 'That link does not seem to open. Check it and send again, or reply "not yet".', ar: 'يبدو أن الرابط لا يفتح. تحقق منه وأرسله مرة أخرى، أو رد بـ "ليس بعد".' },
  E_CHOICE: { en: 'Please pick one of the options above.', ar: 'اختر أحد الخيارات أعلاه.' },
  E_GENERIC: { en: 'Something went wrong on my side. I have saved your progress; please try again in a moment.', ar: 'حدث خطأ من جهتي. حفظت تقدمك؛ حاول مرة أخرى بعد قليل.' },
  E_INJECTION: { en: 'I have received that file and our team will review it manually. Let\'s continue with {nextDocLabel}.', ar: 'استلمت الملف وسيراجعه فريقنا يدوياً. لنكمل مع {nextDocLabel}.' },
  FAQ_FALLBACK: { en: 'I can only help with your MoneyBee application here. For other questions, a team member can join - just say "agent".', ar: 'يمكنني المساعدة فقط في طلبك لدى MoneyBee هنا. للأسئلة الأخرى يمكن لأحد أعضاء الفريق الانضمام - فقط اكتب "موظف".' },
  CLOSED: { en: 'This application is closed. Message "start" to begin a new one.', ar: 'هذا الطلب مغلق. اكتب "ابدأ" لبدء طلب جديد.' },
  BTN_YES: { en: 'Yes', ar: 'نعم' },
  BTN_NO: { en: 'No', ar: 'لا' },
  BTN_CORRECT: { en: 'Correct', ar: 'صحيح' },
  BTN_EDIT: { en: 'Edit something', ar: 'تعديل شيء' },
  BTN_CONTINUE: { en: 'Continue', ar: 'متابعة' },
  BTN_NOT_NOW: { en: 'Not now', ar: 'ليس الآن' },
  BTN_AGREE: { en: 'I agree', ar: 'أوافق' },
  BTN_MORE: { en: 'Tell me more', ar: 'أخبرني أكثر' },
  BTN_START_OVER: { en: 'Start over', ar: 'البدء من جديد' },
  BTN_HUMAN: { en: 'Talk to someone', ar: 'التحدث مع موظف' },
  BTN_PICK_OTHER: { en: 'No, pick another', ar: 'لا، اختر غيرها' },
  BTN_NOT_SURE: { en: 'Not sure', ar: 'لست متأكداً' },
  BTN_CHANGE: { en: 'Let me change it', ar: 'دعني أغيّره' },
  BTN_UAEPASS: { en: 'Use UAE PASS', ar: 'استخدام UAE PASS' },
  BTN_MANUAL: { en: 'Upload manually', ar: 'الرفع يدوياً' },
  BTN_SUBMIT: { en: 'Submit my application', ar: 'تقديم طلبي' },
  BTN_QUESTION: { en: 'I have a question', ar: 'لدي سؤال' },
  BTN_SEND_RENEWED: { en: 'Send renewed', ar: 'إرسال المجدد' },
  BTN_RENEWAL_IN_PROGRESS: { en: 'Renewal in progress', ar: 'التجديد قيد الإجراء' },
  BTN_DONE: { en: 'Done', ar: 'تم' },
  FAQ_PRIVACY: { en: 'We collect your company documents and the ID of the owner or signatory to verify the business, as UAE regulations require. They are stored encrypted, used only for this application, and kept only as long as the rules require. You can withdraw at any time by replying "stop".', ar: 'نجمع مستندات الشركة وهوية المالك أو المفوض بالتوقيع للتحقق من النشاط كما تتطلب لوائح الإمارات. تُخزن مشفرة وتُستخدم لهذا الطلب فقط وتُحفظ للمدة التي تتطلبها القواعد. يمكنك الانسحاب في أي وقت بالرد بكلمة "توقف".' },
  FAQ_MDR: { en: 'The card rate (MDR) is the percentage taken from each card payment. For example, at 2.5% a customer paying AED 100 leaves you AED 97.50, minus any fixed fee per transaction.', ar: 'رسوم البطاقات (MDR) هي النسبة المقتطعة من كل عملية دفع بالبطاقة. مثلاً عند 2.5%، عملية بقيمة 100 درهم تترك لك 97.50 درهماً، بعد خصم أي رسوم ثابتة لكل عملية.' },
  FAQ_SETTLEMENT: { en: 'Settlement is when the money reaches your bank account. T+1 means the next working day after the transaction.', ar: 'التسوية هي وصول المبلغ إلى حسابك البنكي. T+1 تعني يوم العمل التالي للعملية.' },
  FAQ_TIME: { en: 'Most applications are reviewed within 1 to 5 working days once all documents are in.', ar: 'تُراجع معظم الطلبات خلال 1 إلى 5 أيام عمل بعد اكتمال المستندات.' },
  FAQ_DOCS: { en: 'Each document confirms something we are required to verify: who owns the company, that it is licensed, and where the money should be settled.', ar: 'كل مستند يؤكد أمراً يجب علينا التحقق منه: من يملك الشركة، وأنها مرخصة، وأين تُسوّى الأموال.' },
  FAQ_INTEGRATION: { en: 'After approval you can take payments by payment link, through plugins for Shopify, WooCommerce and others, by API, or with a POS terminal. Our team will help you set up.', ar: 'بعد الموافقة يمكنك قبول المدفوعات عبر رابط دفع، أو إضافات لمنصات مثل Shopify وWooCommerce، أو عبر API، أو بجهاز نقاط البيع. سيساعدك فريقنا في الإعداد.' },
} satisfies S;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: BotLang, vars: Record<string, string | number> = {}): string {
  const s = STRINGS[key][lang];
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

/** Merchant-facing document labels and hints. Source: docs/bot/02-document-checklist.md. */
export const DOC_COPY: Record<DocType, { en: [string, string]; ar: [string, string] }> = {
  trade_licence: { en: ['Trade licence', 'The current licence from DET or your free zone. All pages.'], ar: ['الرخصة التجارية', 'الرخصة السارية من دائرة الاقتصاد أو المنطقة الحرة. جميع الصفحات.'] },
  emirates_id: { en: ['Emirates ID of the owner or signatory', 'Front and back.'], ar: ['الهوية الإماراتية للمالك أو المفوض بالتوقيع', 'الوجه والظهر.'] },
  passport: { en: ['Passport of the owner or signatory', 'Photo page only.'], ar: ['جواز سفر المالك أو المفوض بالتوقيع', 'صفحة الصورة فقط.'] },
  residence_visa: { en: ['UAE residence visa', 'The visa page or the e-visa PDF.'], ar: ['الإقامة الإماراتية', 'صفحة الإقامة أو ملف الإقامة الإلكترونية.'] },
  lease_ejari: { en: ['Ejari or office lease', 'Ejari certificate, or the free zone lease / flexi-desk agreement.'], ar: ['عقد الإيجار أو إيجاري', 'شهادة إيجاري، أو عقد إيجار المنطقة الحرة / المكتب المرن.'] },
  bank_letter: { en: ['Bank letter or IBAN certificate', 'Shows the company name and IBAN. A bank statement header also works.'], ar: ['خطاب البنك أو شهادة الآيبان', 'يُظهر اسم الشركة ورقم الآيبان. يكفي أيضاً رأس كشف الحساب.'] },
  website_description: { en: ['Website or business description', 'A screenshot of your website or shop page, or a short PDF describing the business.'], ar: ['وصف الموقع أو النشاط', 'لقطة شاشة لموقعك أو صفحة متجرك، أو ملف PDF قصير يصف النشاط.'] },
  moa_aoa: { en: ['Memorandum of Association (MOA)', 'The MOA or AOA with the shareholding. All pages.'], ar: ['عقد التأسيس', 'عقد التأسيس أو النظام الأساسي مع حصص الشركاء. جميع الصفحات.'] },
  register_of_shareholders: { en: ['Register of shareholders', 'Issued by the free zone or DET. Share certificate also accepted.'], ar: ['سجل المساهمين', 'صادر من المنطقة الحرة أو دائرة الاقتصاد. تُقبل شهادة الأسهم أيضاً.'] },
  register_of_directors: { en: ['Register of directors', 'Issued by the free zone.'], ar: ['سجل المديرين', 'صادر من المنطقة الحرة.'] },
  certificate_of_incorporation: { en: ['Certificate of incorporation', 'From the free zone.'], ar: ['شهادة التأسيس', 'من المنطقة الحرة.'] },
  authorised_signatory_letter: { en: ['Signatory authorisation', 'Board resolution, POA or a letter naming who can sign for the company.'], ar: ['تفويض المفوض بالتوقيع', 'قرار مجلس الإدارة أو وكالة أو خطاب يحدد المفوض بالتوقيع عن الشركة.'] },
  ubo_declaration: { en: ['UBO declaration', 'Who owns 25% or more. Reply "form" if you need a one-page template.'], ar: ['إقرار المستفيد الحقيقي', 'من يملك 25% أو أكثر. رد بكلمة "نموذج" إن احتجت قالباً من صفحة واحدة.'] },
  vat_certificate: { en: ['VAT certificate', 'Skip if not VAT registered.'], ar: ['شهادة ضريبة القيمة المضافة', 'تخطَّ إن لم تكن مسجلاً في الضريبة.'] },
  bank_statement: { en: ['Bank statement', 'Last 3 months.'], ar: ['كشف حساب بنكي', 'آخر 3 أشهر.'] },
  processing_statement: { en: ['Processing statement from your current provider', 'Last 3 months.'], ar: ['كشف المعالجة من المزود الحالي', 'آخر 3 أشهر.'] },
  company_profile: { en: ['Company profile', 'A short deck or brochure.'], ar: ['ملف تعريفي للشركة', 'عرض قصير أو كتيب.'] },
  corporate_shareholder_docs: { en: ['Corporate shareholder documents', 'If a company owns shares: its licence and register of shareholders.'], ar: ['مستندات المساهم الاعتباري', 'إذا كانت شركة تملك حصصاً: رخصتها وسجل مساهميها.'] },
  share_certificate: { en: ['Share certificate', 'If you do not have a register of shareholders.'], ar: ['شهادة الأسهم', 'إن لم يكن لديك سجل مساهمين.'] },
  unknown: { en: ['document', ''], ar: ['مستند', ''] },
};

export const docLabel = (d: DocType, lang: BotLang) => DOC_COPY[d][lang][0];
export const docHint = (d: DocType, lang: BotLang) => DOC_COPY[d][lang][1];

export const ENTITY_LABEL: Record<string, { en: string; ar: string }> = {
  sole_establishment: { en: 'Sole Establishment', ar: 'مؤسسة فردية' },
  llc: { en: 'Mainland LLC', ar: 'شركة ذات مسؤولية محدودة' },
  free_zone: { en: 'Free Zone company', ar: 'شركة منطقة حرة' },
  mainland: { en: 'Mainland company', ar: 'شركة بر رئيسي' },
  branch: { en: 'Branch of a foreign company', ar: 'فرع شركة أجنبية' },
  civil: { en: 'Civil company', ar: 'شركة مدنية' },
};

export const VOLUME_LABEL: Record<string, { en: string; ar: string }> = {
  V1: { en: 'under 50,000', ar: 'أقل من 50,000' },
  V2: { en: '50,000 to 200,000', ar: '50,000 إلى 200,000' },
  V3: { en: '200,000 to 500,000', ar: '200,000 إلى 500,000' },
  V4: { en: '500,000 to 2 million', ar: '500,000 إلى 2 مليون' },
  V5: { en: 'over 2 million', ar: 'أكثر من 2 مليون' },
};
export const TICKET_LABEL: Record<string, { en: string; ar: string }> = {
  T1: { en: 'under 100', ar: 'أقل من 100' },
  T2: { en: '100 to 500', ar: '100 إلى 500' },
  T3: { en: '500 to 2,000', ar: '500 إلى 2,000' },
  T4: { en: '2,000 to 10,000', ar: '2,000 إلى 10,000' },
  T5: { en: 'over 10,000', ar: 'أكثر من 10,000' },
};
