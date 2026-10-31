# Document checklist - merchant-facing labels and hints (v0.1 draft)

Source of truth for WHICH documents: `policies/base.json` -> `entityTypes.<type>.requiredDocuments` / `optionalDocuments`. This file only adds the merchant-facing wording. If a doc type is added to the policy it must be added here too (test will fail otherwise).

Order below is the order the bot asks in (easiest and most-likely-at-hand first).

| doc_type | EN label | AR label | EN hint | AR hint |
|---|---|---|---|---|
| trade_licence | Trade licence | الرخصة التجارية | The current licence from DET or your free zone. All pages. | الرخصة السارية من دائرة الاقتصاد أو المنطقة الحرة. جميع الصفحات. |
| emirates_id | Emirates ID of the owner or signatory | الهوية الإماراتية للمالك أو المفوض بالتوقيع | Front and back. Or use UAE PASS. | الوجه والظهر. أو استخدم UAE PASS. |
| passport | Passport of the owner or signatory | جواز سفر المالك أو المفوض بالتوقيع | Photo page only. | صفحة الصورة فقط. |
| residence_visa | UAE residence visa | الإقامة الإماراتية | The visa page or the e-visa PDF. | صفحة الإقامة أو ملف الإقامة الإلكترونية. |
| lease_ejari | Ejari or office lease | عقد الإيجار أو إيجاري | Ejari certificate, or the free zone lease / flexi-desk agreement. | شهادة إيجاري، أو عقد إيجار المنطقة الحرة / المكتب المرن. |
| bank_letter | Bank letter or IBAN certificate | خطاب البنك أو شهادة الآيبان | Shows the company name and IBAN. A bank statement header also works. | يُظهر اسم الشركة ورقم الآيبان. يكفي أيضاً رأس كشف الحساب. |
| website_description | Website or business description | وصف الموقع أو النشاط | A screenshot of your website or shop page, or a short PDF describing the business. | لقطة شاشة لموقعك أو صفحة متجرك، أو ملف PDF قصير يصف النشاط. |
| moa_aoa | Memorandum of Association (MOA) | عقد التأسيس | The MOA or AOA with the shareholding. All pages. | عقد التأسيس أو النظام الأساسي مع حصص الشركاء. جميع الصفحات. |
| register_of_shareholders | Register of shareholders | سجل المساهمين | Issued by the free zone or DET. Share certificate also accepted. | صادر من المنطقة الحرة أو دائرة الاقتصاد. تُقبل شهادة الأسهم أيضاً. |
| register_of_directors | Register of directors | سجل المديرين | Issued by the free zone. | صادر من المنطقة الحرة. |
| certificate_of_incorporation | Certificate of incorporation | شهادة التأسيس | From the free zone. | من المنطقة الحرة. |
| authorised_signatory_letter | Signatory authorisation | تفويض المفوض بالتوقيع | Board resolution, POA or a letter naming who can sign for the company. | قرار مجلس الإدارة أو وكالة أو خطاب يحدد المفوض بالتوقيع عن الشركة. |
| ubo_declaration | UBO declaration | إقرار المستفيد الحقيقي | Who owns 25% or more. I can send you a one-page form to fill if you do not have one. | من يملك 25% أو أكثر. يمكنني إرسال نموذج من صفحة واحدة إن لم يكن لديك. |
| vat_certificate | VAT certificate (if registered) | شهادة ضريبة القيمة المضافة (إن وجدت) | Skip if not VAT registered. | تخطَّ إن لم تكن مسجلاً في الضريبة. |
| bank_statement | Bank statement (optional) | كشف حساب بنكي (اختياري) | Last 3 months. Helps if you are switching from another provider. | آخر 3 أشهر. يساعد إذا كنت تنتقل من مزود آخر. |
| processing_statement | Processing statement (optional) | كشف المعالجة من المزود الحالي (اختياري) | From your current payment provider, last 3 months. | من مزود الدفع الحالي، آخر 3 أشهر. |
| company_profile | Company profile (optional) | ملف تعريفي للشركة (اختياري) | A short deck or brochure. | عرض قصير أو كتيب. |
| corporate_shareholder_docs | Corporate shareholder documents | مستندات المساهم الاعتباري | If a company owns shares: its licence and register of shareholders. | إذا كانت شركة تملك حصصاً: رخصتها وسجل مساهميها. |
| share_certificate | Share certificate | شهادة الأسهم | If you do not have a register of shareholders. | إن لم يكن لديك سجل مساهمين. |

## Per entity type (from policy, Oct 2026)

Required = asked in order; Optional = offered once at the end ("Anything else you would like to add? Bank statement, processing statement, VAT certificate...").

**sole_establishment** (7 required): trade_licence, emirates_id, passport, residence_visa, lease_ejari, bank_letter, website_description. Optional: vat_certificate, bank_statement, processing_statement, company_profile.

**llc** (10 required): trade_licence, emirates_id, passport, lease_ejari, bank_letter, website_description, moa_aoa, register_of_shareholders, authorised_signatory_letter, ubo_declaration. Optional: vat_certificate, residence_visa, bank_statement, processing_statement, company_profile, corporate_shareholder_docs, register_of_directors, share_certificate.

**free_zone** (12 required): trade_licence, certificate_of_incorporation, emirates_id, passport, lease_ejari, bank_letter, website_description, moa_aoa, register_of_shareholders, register_of_directors, authorised_signatory_letter, ubo_declaration. Optional: vat_certificate, residence_visa, bank_statement, processing_statement, company_profile, corporate_shareholder_docs, share_certificate.

**mainland** (10 required, same as llc). Used for Branch of foreign company and Civil company until their own blocks exist; both get `flags.extra_review = true` and the bot adds one line at S3.1: "Because this is a {branch|civil company}, our team may ask for the parent company documents later."

## Risk-tier additions (proposed, not yet in policy)

When MCC tier is HIGH or the merchant picked a Stage 1 activity flag, add to required: processing_statement (if currently accepting cards), bank_statement. Proposed as `entityTypes.<type>.highRiskExtraDocuments` in base.json. Compliance to confirm.

## Per-upload behaviour

1. Download media, run `ingest()` (sniff, dedupe, store, injection scan).
2. Run classifier on that one file. If detected type == asked type: S3.3. Else S3.4 (file is kept and filed under its detected type, so a merchant sending docs out of order is not penalised).
3. If classifier returns a bundle: S3.7, tick every detected type.
4. Expiry: if extractor finds an expiry date in the past: S3.6; within `docExpiryWarnDays` (30): S3.3 with warning line.
5. Confidence below `confidenceThreshold` (0.85): accept, mark needsReview, do not tell the merchant.
6. UAE PASS documents arrive via the existing invite flow and tick emirates_id / residence_visa as issuer-verified.
