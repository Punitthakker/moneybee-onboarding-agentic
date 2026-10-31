# MoneyBee Onboarding Bot - conversation script (v0.1 draft for review)

Status: DRAFT. Every string here is editable. Nothing is coded yet.
Channel: WhatsApp (Meta Cloud API). Telegram reuses the same script with inline keyboards.
Conventions: `[B]` = reply button (max 3 per message on WhatsApp), `[L]` = list picker (max 10 rows per section), free text otherwise. `{var}` = substituted value. AR = Arabic string shown when the session language is Arabic.

Global behaviours (apply at every step)
- One question per message. Max 2 short lines of context before the question.
- "Back" is always accepted as free text and returns to the previous step.
- "Help" or a question mark mid-flow triggers the FAQ agent, then re-asks the current step.
- "Agent" / "human" / "موظف" puts the session on HOLD, creates an underwriter task, and replies with HOLD.1.
- Silence: nudge once after 2 hours (NUDGE.1) and once after 48 hours (NUDGE.2, template message). Session stays resumable for 30 days.
- Every merchant-facing number or rate carries the word "indicative".

---

## Stage 0 - Entry

**S0.1 Greeting (first inbound message, no session)**
EN: Welcome to MoneyBee. I can set up your business to accept card and online payments, right here in this chat. It takes about 10 minutes plus a few documents.
First, which language would you like?
[B] English  [B] العربية
AR: أهلاً بك في MoneyBee. يمكنني تجهيز شركتك لقبول المدفوعات بالبطاقات وعبر الإنترنت هنا في هذه المحادثة. يستغرق الأمر نحو 10 دقائق مع بعض المستندات.
أولاً، أي لغة تفضل؟

**S0.2 Consent**
EN: To process your application I will collect company and ID documents and share them with our underwriting team. Your data is handled under UAE data protection law and used only for this application.
Do you agree to continue?
[B] I agree  [B] Tell me more  [B] Not now
AR: لمعالجة طلبك سأجمع مستندات الشركة والهوية وأشاركها مع فريق الاكتتاب لدينا. تُعالج بياناتك وفق قانون حماية البيانات في الإمارات وتُستخدم لهذا الطلب فقط.
هل توافق على المتابعة؟
[B] أوافق  [B] أخبرني أكثر  [B] ليس الآن

- "Tell me more" -> FAQ.PRIVACY then re-ask S0.2.
- "Not now" -> S0.3 and end.

**S0.3 Exit (not now)**
EN: No problem. Message me whenever you are ready and we will pick up from here.
AR: لا مشكلة. راسلني عندما تكون جاهزاً وسنكمل من هنا.

**S0.4 Resume (returning merchant with open session)**
EN: Welcome back, {contact_name}. We stopped at: {step_label}. {progress_line}
[B] Continue  [B] Start over  [B] Talk to someone
AR: أهلاً بعودتك يا {contact_name}. توقفنا عند: {step_label}. {progress_line}
[B] متابعة  [B] البدء من جديد  [B] التحدث مع موظف

---

## Stage 1 - Business profile

**S1.1 Contact name**
EN: Great. What is your name?
AR: ممتاز. ما اسمك؟
Validation: 2 to 60 characters, letters only. Error E.NAME.

**S1.2 Company name**
EN: Nice to meet you, {contact_name}. What is the legal name of your company, exactly as on the trade licence?
AR: تشرفت بك يا {contact_name}. ما الاسم القانوني لشركتك كما هو مكتوب في الرخصة التجارية؟
Validation: 3 to 120 characters. Store as company.legalName (candidate; verifier will confirm against the licence).

**S1.3 Entity type**
EN: What type of company is {company_name}?
[L] Sole Establishment | Mainland LLC | Free Zone company (FZCO, FZE, FZ-LLC) | Branch of a foreign company | Civil company | Not sure
AR: ما نوع شركة {company_name}؟
[L] مؤسسة فردية | شركة ذات مسؤولية محدودة (البر الرئيسي) | شركة منطقة حرة | فرع شركة أجنبية | شركة مدنية | لست متأكداً
Mapping: Sole Establishment -> sole_establishment; Mainland LLC -> llc; Free Zone -> free_zone; Branch -> mainland + flag extra_review; Civil -> mainland + flag extra_review; Not sure -> entityType auto, ask S1.3a.

**S1.3a Not sure helper**
EN: No problem. Send me a photo of your trade licence and I will read the company type from it.
AR: لا مشكلة. أرسل لي صورة من الرخصة التجارية وسأقرأ نوع الشركة منها.
(Runs the classifier + extractor on that one file, fills entity type, continues to S1.4.)

**S1.4 Emirate**
EN: Which emirate is the company licensed in?
[L] Dubai | Abu Dhabi | Sharjah | Ajman | Ras Al Khaimah | Fujairah | Umm Al Quwain
AR: في أي إمارة الشركة مرخصة؟

**S1.5 Free zone name (only if free_zone)**
EN: Which free zone?
[L] DMCC | IFZA | DIFC | ADGM | JAFZA | DAFZA | RAKEZ | SHAMS | Meydan | Other (type it)
AR: أي منطقة حرة؟

**S1.6 What the business sells**
EN: In one or two lines, what does {company_name} sell or do? For example "women's fashion online" or "IT consulting for SMEs".
AR: في سطر أو سطرين، ماذا تبيع أو تقدم {company_name}؟ مثلاً "أزياء نسائية عبر الإنترنت" أو "استشارات تقنية للشركات الصغيرة".
Validation: min 10 characters. This is the main MCC classifier input.

**S1.7 Category confirm (classifier proposes)**
EN: Sounds like {mcc_plain_label}. Is that right?
[B] Yes  [B] No, pick another  [B] Not sure
AR: يبدو أنها {mcc_plain_label}. هل هذا صحيح؟
- "No" -> S1.7a list of top categories.
- If classifier confidence < 0.6, skip S1.7 and go straight to S1.7a.

**S1.7a Category list**
EN: Pick the closest category:
[L] Retail - physical goods | Restaurants and food delivery | Fashion and beauty | Electronics and gadgets | Professional services | Education and training | Travel and tourism | Health and wellness | Software and digital services | Other (describe)
AR: اختر الفئة الأقرب:

**S1.8 Sales channel**
EN: How do customers pay you?
[B] Online only  [B] In store only  [B] Both
AR: كيف يدفع لك العملاء؟
[B] عبر الإنترنت فقط  [B] في المتجر فقط  [B] الاثنان

**S1.9 Customer type**
EN: Who are your customers mostly?
[B] Consumers (B2C)  [B] Businesses (B2B)  [B] Both
AR: من هم عملاؤك غالباً؟

**S1.10 Billing model**
EN: Are payments one-off or recurring subscriptions?
[B] One-off  [B] Subscriptions  [B] Both
AR: هل المدفوعات لمرة واحدة أم اشتراكات متكررة؟

**S1.11 Customer location**
EN: Where are your customers? Pick all that apply.
[L] UAE only | UAE and GCC | International
AR: أين يوجد عملاؤك؟

**S1.12 Monthly volume**
EN: Roughly how much do you expect to process per month in AED?
[L] Under 50,000 | 50,000 to 200,000 | 200,000 to 500,000 | 500,000 to 2 million | Over 2 million | Just starting, not sure
AR: كم تتوقع أن تعالج شهرياً بالدرهم تقريباً؟

**S1.13 Average ticket**
EN: And the typical amount per transaction?
[L] Under AED 100 | 100 to 500 | 500 to 2,000 | 2,000 to 10,000 | Over 10,000
AR: وما المبلغ المعتاد لكل عملية؟
Validation: volume / ticket implies transactions per month; if > 50,000 or < 5, ask S1.13a to confirm.

**S1.13a Sanity check**
EN: That works out to about {tx_per_month} transactions a month. Does that sound right?
[B] Yes  [B] Let me change it
AR: هذا يعني نحو {tx_per_month} عملية شهرياً. هل هذا صحيح؟

**S1.14 Current gateway**
EN: Do you accept card payments today?
[L] No, this is new | Yes - Network International | Yes - Telr | Yes - PayTabs | Yes - Checkout.com | Yes - Stripe | Yes - Tap | Yes - Ziina | Yes - Bank POS | Yes - other
AR: هل تقبل الدفع بالبطاقات حالياً؟

**S1.14a Why switching (only if currently accepting)**
EN: What would you like to be better with MoneyBee?
[L] Lower fees | Faster settlement | Better support | More payment methods | Easier integration | Other
AR: ما الذي تريد أن يكون أفضل مع MoneyBee؟

**S1.15 Years in operation**
EN: How long has the company been operating?
[B] Under 1 year  [B] 1 to 3 years  [B] Over 3 years
AR: منذ متى تعمل الشركة؟

**S1.16 Website or social**
EN: Share your website or app link. If you do not have one yet, your Instagram or TikTok is fine.
AR: شارك رابط موقعك أو تطبيقك. إن لم يكن لديك، يكفي حساب إنستغرام أو تيك توك.
Validation: URL resolves (HEAD request) or handle format. Error E.URL. "Not yet" accepted, flagged no_web_presence.

**S1.17 Activity flags**
EN: Last one for this part. Does the business involve any of these? Pick all that apply, or "None".
[L] Travel or ticketing | Electronics or luxury goods | Forex, crypto or investments | Gaming or betting | Pharma or supplements | Adult content | Charity or donations | Telemarketing or subscriptions with trials | None of these
AR: السؤال الأخير في هذا الجزء. هل يشمل النشاط أياً مما يلي؟

**S1.18 Profile summary**
EN: Here is what I have:
- {company_name}, {entity_label}, {emirate}
- {mcc_plain_label}, {channel}, {customer_type}
- About AED {volume_band} a month, typical ticket AED {ticket_band}
- {years_label}, {web_or_social}
All correct?
[B] Correct  [B] Edit something
AR: هذا ما لدي: ... هل كل شيء صحيح؟
[B] صحيح  [B] تعديل شيء

---

## Stage 2 - MCC outcome

**S2.1 Standard or low tier (silent, continue to S3.1)**

**S2.2 Restricted tier**
EN: Businesses in {mcc_plain_label} are welcome at MoneyBee but need a closer look from our underwriting team, so it may take a little longer and we may ask for a few extra documents. Shall we continue?
[B] Continue  [B] Not now
AR: الأنشطة في {mcc_plain_label} مرحب بها في MoneyBee لكنها تحتاج مراجعة أدق من فريق الاكتتاب، لذا قد يستغرق الأمر وقتاً أطول وقد نطلب مستندات إضافية. هل نكمل؟

**S2.3 Prohibited tier**
EN: Thank you for the details. Unfortunately MoneyBee cannot support {mcc_plain_label} at the moment. I have noted your interest and we will let you know if that changes.
AR: شكراً على التفاصيل. للأسف لا يمكن لـ MoneyBee دعم {mcc_plain_label} حالياً. سجلت اهتمامك وسنخبرك إذا تغير ذلك.
(Lead saved. Session closed. No case created.)

---

## Stage 3 - Documents

**S3.1 Intro**
EN: Now the documents. For a {entity_label} I need {n} items. Send each one as a photo or PDF, one at a time. You can type "later" to skip one and come back.
Before we start: would you like to share your Emirates ID and visa automatically through UAE PASS? It is faster and verified.
[B] Use UAE PASS  [B] Upload manually
AR: الآن المستندات. لـ{entity_label} أحتاج {n} مستندات. أرسل كل مستند كصورة أو PDF واحداً تلو الآخر. يمكنك كتابة "لاحقاً" لتخطي أي مستند والعودة إليه.
قبل أن نبدأ: هل تريد مشاركة الهوية الإماراتية والإقامة تلقائياً عبر UAE PASS؟ أسرع وموثق.

**S3.1a UAE PASS link**
EN: Open this link, sign in with UAE PASS and approve the share request: {invite_url}
I will continue with the other documents meanwhile.
AR: افتح هذا الرابط وسجّل الدخول عبر UAE PASS ووافق على طلب المشاركة: {invite_url}
سأكمل مع بقية المستندات في هذه الأثناء.

**S3.2 Ask for document (template, one per doc type)**
EN: {index} of {n}: please send your **{doc_label}**. {doc_hint}
AR: {index} من {n}: أرسل من فضلك **{doc_label_ar}**. {doc_hint_ar}
Doc labels and hints are in 02-document-checklist.md.

**S3.3 Received and correct**
EN: Got it, {doc_label} received. {expiry_line}
AR: تم استلام {doc_label_ar}. {expiry_line}
expiry_line examples: "Valid until {date}." / "Note: this expires in {days} days; we will accept it but may ask for the renewal."

**S3.4 Wrong document**
EN: This looks like a {detected_label}, not a {doc_label}. I have kept it anyway. Could you send the {doc_label}?
AR: يبدو هذا {detected_label_ar} وليس {doc_label_ar}. احتفظت به على أي حال. هل يمكنك إرسال {doc_label_ar}؟

**S3.5 Unreadable**
EN: I could not read that clearly. Please retake it in good light with all four corners visible, or send the PDF.
AR: لم أتمكن من قراءته بوضوح. أعد التصوير في إضاءة جيدة مع ظهور الزوايا الأربع، أو أرسل ملف PDF.

**S3.6 Expired**
EN: This {doc_label} expired on {date}. Do you have the renewed one?
[B] Send renewed  [B] Renewal in progress
AR: انتهت صلاحية {doc_label_ar} في {date}. هل لديك النسخة المجددة؟

**S3.7 Bundle detected**
EN: That file contains several documents ({labels}). I have split and filed them. Still needed: {remaining_labels}.
AR: يحتوي الملف على عدة مستندات ({labels}). قمت بفصلها وحفظها. المتبقي: {remaining_labels}.

**S3.8 Unsupported media**
EN: I can only read photos and PDFs. Could you send the document as one of those?
AR: يمكنني قراءة الصور وملفات PDF فقط. هل يمكنك إرسال المستند بإحدى هاتين الصيغتين؟

**S3.9 Later**
EN: Noted, I will come back to {doc_label}. Next: {next_doc_label}.
AR: حسناً، سأعود إلى {doc_label_ar} لاحقاً. التالي: {next_doc_label_ar}.

**S3.10 Progress (sent after every 3 documents)**
EN: {received} of {n} received. Remaining: {remaining_labels}.
AR: تم استلام {received} من {n}. المتبقي: {remaining_labels}.

**S3.11 Checklist complete**
EN: That is everything. Give me a moment while I review your file.
AR: هذا كل شيء. أمهلني لحظة لمراجعة ملفك.

---

## Stage 4 - Pre-approval and indicative pricing

**S4.1 Likely approve**
EN: Good news, {contact_name}. Based on what you have shared, {company_name} looks like a good fit for MoneyBee.

Indicative pricing for {mcc_plain_label}, subject to underwriting:
- Card rate: {mdr}% + AED {fixed_fee} per transaction
- Settlement: {settlement}
- Setup fee: {setup_fee}
{reserve_line}

Next step: our underwriting team reviews your file. Typical time: {sla}. Shall I submit it?
[B] Submit my application  [B] I have a question
AR: خبر جيد يا {contact_name}. بناءً على ما شاركته، تبدو {company_name} مناسبة لـ MoneyBee.

الأسعار الإرشادية لـ{mcc_plain_label}، رهناً بالاكتتاب:
- رسوم البطاقات: {mdr}% + {fixed_fee} درهم لكل عملية
- التسوية: {settlement}
- رسوم التأسيس: {setup_fee}
{reserve_line}

الخطوة التالية: يراجع فريق الاكتتاب ملفك. المدة المعتادة: {sla}. هل أقدّم الطلب؟

**S4.2 Needs review**
EN: Thank you, {contact_name}. Your file is complete. A few points need a closer look from our underwriting team before we can confirm pricing, so I will share an indicative range only:
- Card rate: between {mdr_low}% and {mdr_high}% + AED {fixed_fee} per transaction
- Settlement: {settlement}
{reserve_line}
Typical review time: {sla}. Shall I submit it?
[B] Submit my application  [B] I have a question
AR: شكراً يا {contact_name}. ملفك مكتمل. تحتاج بعض النقاط إلى مراجعة أدق من فريق الاكتتاب قبل تأكيد الأسعار، لذا سأشارك نطاقاً إرشادياً فقط: ...

**S4.3 Unlikely**
EN: Thank you, {contact_name}. Your file is complete. Based on the information so far, approval is not certain, but our underwriting team makes the final decision and will look at it carefully. Shall I submit it?
[B] Submit my application  [B] Not now
AR: شكراً يا {contact_name}. ملفك مكتمل. بناءً على المعلومات حتى الآن، الموافقة غير مؤكدة، لكن القرار النهائي لفريق الاكتتاب وسيراجعه بعناية. هل أقدّم الطلب؟

Rules: the numeric score is never shown. No reasons for Needs review / Unlikely are given beyond "a few points". "Indicative" and "subject to underwriting" appear in every pricing message.

---

## Stage 5 - Submission and after

**S5.1 Submitted**
EN: Done. Your application reference is **{case_ref}**. It is now with our underwriting team. I will message you here as soon as there is an update, usually within {sla}.
AR: تم. رقم طلبك هو **{case_ref}**. أصبح الآن لدى فريق الاكتتاب. سأراسلك هنا فور وجود أي تحديث، عادةً خلال {sla}.

**S5.2 Needs info (underwriter request_info; gap chaser draft, editable by underwriter before send; template message if outside 24h)**
EN: Hi {contact_name}, a quick update on {case_ref}. Our team needs a few more things to continue:
{gap_items}
Just send them here when ready.
AR: مرحباً {contact_name}، تحديث سريع بخصوص {case_ref}. يحتاج فريقنا إلى بعض الأمور الإضافية للمتابعة:
{gap_items}
أرسلها هنا عندما تكون جاهزة.

**S5.3 Approved (human decision only)**
EN: Congratulations, {contact_name}. {company_name} is approved with MoneyBee.
Your merchant ID: **{case_ref}**
Confirmed pricing: {mdr}% + AED {fixed_fee}, settlement {settlement}.
Next: {next_step_line}
AR: مبارك يا {contact_name}. تمت الموافقة على {company_name} لدى MoneyBee. ...

**S5.4 Rejected (human decision only, merchant-safe reason)**
EN: Thank you for applying, {contact_name}. After review, we are not able to onboard {company_name} at this time. {merchant_safe_reason}
If your circumstances change, you are welcome to apply again.
AR: شكراً لتقديمك يا {contact_name}. بعد المراجعة، لا يمكننا تسجيل {company_name} في الوقت الحالي. {merchant_safe_reason}
إذا تغيرت ظروفك، نرحب بتقديمك مرة أخرى.

**S5.5 Status check (merchant asks "status" / "any update")**
EN: {case_ref} is {status_plain}. {status_detail}
AR: {case_ref} حالته {status_plain_ar}. {status_detail_ar}
status_plain map: AWAITING_REVIEW -> "under review"; NEEDS_INFO -> "waiting for documents from you"; APPROVED -> "approved"; REJECTED -> "closed"; COMPLETED -> "live".

---

## HOLD, NUDGE, FAQ, ERRORS

**HOLD.1**
EN: Sure. I have asked a MoneyBee team member to join. They will reply here during working hours (Mon to Fri, 9 to 6 Gulf time). Your progress is saved.
AR: بالتأكيد. طلبت من أحد أعضاء فريق MoneyBee الانضمام. سيرد هنا خلال ساعات العمل (الاثنين إلى الجمعة، 9 إلى 6 بتوقيت الخليج). تم حفظ تقدمك.

**NUDGE.1 (2h, inside 24h window)**
EN: Still there, {contact_name}? We were at: {step_label}. Reply any time to continue.
AR: هل ما زلت معنا يا {contact_name}؟ كنا عند: {step_label}. رد في أي وقت للمتابعة.

**NUDGE.2 (48h, approved template `moneybee_resume_v1`)**
EN: Hi {{1}}, your MoneyBee application is saved at step {{2}}. Reply "continue" to finish it.
AR: مرحباً {{1}}، تم حفظ طلبك لدى MoneyBee عند الخطوة {{2}}. رد بكلمة "متابعة" لإكماله.

**FAQ (bounded, no case internals). Topics and one-line answers to be expanded:**
- PRIVACY: what we collect, why, retention, how to withdraw.
- MDR: what a card rate is, example on AED 100.
- SETTLEMENT: when money reaches the bank account.
- TIME: typical review time.
- DOCS: why a document is needed.
- INTEGRATION: payment link, plugins, API, POS - one line each and "our team will help after approval".
- Anything else: "I can only help with your MoneyBee application here. For other questions, a team member can join - just say 'agent'."

**Errors**
- E.NAME: "Please send your name as text, letters only." / "أرسل اسمك كنص، أحرف فقط."
- E.URL: "That link does not seem to open. Check it and send again, or reply 'not yet'." / "يبدو أن الرابط لا يفتح. تحقق منه وأرسله مرة أخرى، أو رد بـ 'ليس بعد'."
- E.CHOICE: "Please pick one of the options above." / "اختر أحد الخيارات أعلاه."
- E.GENERIC: "Something went wrong on my side. I have saved your progress; please try again in a moment." / "حدث خطأ من جهتي. حفظت تقدمك؛ حاول مرة أخرى بعد قليل."
- E.INJECTION (document or text flagged by safety scan): never echo the content. "I have received that file and our team will review it manually. Let's continue with {next_doc_label}." / "استلمت الملف وسيراجعه فريقنا يدوياً. لنكمل مع {next_doc_label_ar}."
