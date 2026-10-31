# MCC table - classifier targets and risk tiers (v0.1 draft, EXAMPLE VALUES)

All tiers are illustrative. Compliance sets the final list. The table will be loaded into `policies/base.json` -> `mccRiskTiers` (extending the 8 codes there today) plus a new `mccCatalogue` block that carries the plain-language label, Arabic label, classifier keywords and Stage 1 category mapping.

Tiers: LOW, MEDIUM, HIGH (existing in policy), RESTRICTED (new: continue with S2.2 warning, extra docs, manual review mandatory), PROHIBITED (new: S2.3, no case).

Tier drives: pre-screen score weight (existing `risk.weights.mccMedium` / `mccHigh`; RESTRICTED uses mccHigh + 15), pricing band in 04-pricing.md, extra documents.

## Stage 1 category -> candidate MCCs

| Stage 1 category | Candidate MCCs (classifier picks within these first) |
|---|---|
| Retail - physical goods | 5311, 5331, 5399, 5411, 5499, 5712, 5719, 5722, 5732, 5941, 5945, 5992, 5995, 5999 |
| Restaurants and food delivery | 5812, 5814, 5462, 5811 |
| Fashion and beauty | 5621, 5651, 5661, 5691, 5699, 5977, 7230, 7298 |
| Electronics and gadgets | 5732, 5734, 5045, 4812 |
| Professional services | 7392, 8111, 8931, 8999, 7311, 7399, 8911 |
| Education and training | 8299, 8220, 8211, 8249 |
| Travel and tourism | 4722, 7011, 4511, 4121, 7512, 4411 |
| Health and wellness | 8099, 8011, 8021, 8043, 7297, 5912, 5122 |
| Software and digital services | 5817, 5818, 7372, 7379, 4816, 5815, 5816 |
| Other | classifier chooses from the full table |

## Catalogue

| MCC | EN label | AR label | Tier | Notes / keywords |
|---|---|---|---|---|
| 5411 | Grocery and supermarkets | بقالة وسوبرماركت | LOW | grocery, baqala, supermarket |
| 5499 | Specialty food stores | متاجر أغذية متخصصة | LOW | dates, nuts, organic, bakery retail |
| 5462 | Bakeries | مخابز | LOW | |
| 5812 | Restaurants | مطاعم | LOW | restaurant, cafe, dine-in |
| 5814 | Fast food and delivery | وجبات سريعة وتوصيل | LOW | cloud kitchen, delivery only |
| 5811 | Caterers | تموين | MEDIUM | events, catering |
| 5311 | Department stores | متاجر متعددة الأقسام | LOW | |
| 5331 | Variety stores | متاجر متنوعة | LOW | |
| 5399 | General merchandise | سلع عامة | LOW | |
| 5621 | Women's clothing | ملابس نسائية | LOW | abaya, fashion, boutique |
| 5651 | Family clothing | ملابس عائلية | LOW | |
| 5661 | Shoes | أحذية | LOW | |
| 5691 | Men's and women's clothing | ملابس رجالية ونسائية | LOW | |
| 5699 | Accessories and apparel | إكسسوارات وملابس | LOW | |
| 5977 | Cosmetics and perfume | مستحضرات تجميل وعطور | MEDIUM | perfume, oud, skincare |
| 7230 | Salons and barbers | صالونات وحلاقة | LOW | |
| 7298 | Health and beauty spas | منتجعات صحية وتجميل | MEDIUM | spa, massage |
| 5712 | Furniture and home | أثاث ومنزل | LOW | |
| 5719 | Home furnishings | مفروشات | LOW | |
| 5722 | Household appliances | أجهزة منزلية | MEDIUM | |
| 5732 | Electronics stores | متاجر إلكترونيات | HIGH | phones, laptops, high resale value |
| 5734 | Computer software stores | متاجر برمجيات | MEDIUM | |
| 5045 | Computers and peripherals (B2B) | أجهزة كمبيوتر (شركات) | MEDIUM | |
| 4812 | Telecom equipment and phones | معدات اتصالات وهواتف | HIGH | mobile phones |
| 5941 | Sporting goods | سلع رياضية | LOW | |
| 5945 | Toys and games | ألعاب | LOW | |
| 5992 | Florists | زهور | LOW | |
| 5995 | Pet shops | متاجر حيوانات أليفة | LOW | |
| 5999 | Miscellaneous retail | تجزئة متنوعة | MEDIUM | default retail |
| 5944 | Jewellery and watches | مجوهرات وساعات | HIGH | gold, diamonds, watches |
| 5094 | Precious stones and metals (wholesale) | أحجار كريمة ومعادن (جملة) | RESTRICTED | gold trading, bullion |
| 7392 | Consulting and management services | استشارات وخدمات إدارية | LOW | consulting, advisory |
| 8111 | Legal services | خدمات قانونية | LOW | |
| 8931 | Accounting and audit | محاسبة وتدقيق | LOW | |
| 8999 | Professional services (other) | خدمات مهنية أخرى | MEDIUM | |
| 7311 | Advertising and marketing | إعلان وتسويق | MEDIUM | agency, social media |
| 7399 | Business services (other) | خدمات أعمال أخرى | MEDIUM | PRO services, typing centre |
| 8911 | Architecture and engineering | هندسة وعمارة | LOW | |
| 1520 | Contractors and construction | مقاولات وبناء | MEDIUM | |
| 7349 | Cleaning and maintenance | تنظيف وصيانة | LOW | |
| 8299 | Education and training | تعليم وتدريب | LOW | courses, tutoring |
| 8220 | Universities and colleges | جامعات وكليات | LOW | |
| 8211 | Schools | مدارس | LOW | |
| 8249 | Vocational and trade schools | معاهد مهنية | MEDIUM | coaching, bootcamps |
| 4722 | Travel agencies and tour operators | وكالات سفر وسياحة | HIGH | travel, visa services, tours, future delivery risk |
| 7011 | Hotels and holiday homes | فنادق وشقق فندقية | MEDIUM | holiday homes, short-term rental |
| 4511 | Airlines | طيران | RESTRICTED | |
| 4121 | Taxi and ride services | تاكسي وتوصيل ركاب | MEDIUM | |
| 7512 | Car rental | تأجير سيارات | HIGH | |
| 4411 | Cruise and yacht charters | رحلات بحرية ويخوت | HIGH | |
| 5511 | Car dealers | وكلاء سيارات | HIGH | |
| 5533 | Auto parts | قطع غيار سيارات | LOW | |
| 7538 | Car service and repair | صيانة سيارات | LOW | |
| 8099 | Medical and health services | خدمات طبية وصحية | MEDIUM | clinic, aesthetic |
| 8011 | Doctors | أطباء | LOW | |
| 8021 | Dentists | أطباء أسنان | LOW | |
| 8043 | Opticians | بصريات | LOW | |
| 7297 | Massage parlours | مراكز تدليك | RESTRICTED | |
| 5912 | Pharmacies | صيدليات | MEDIUM | licensed pharmacy only |
| 5122 | Drugs and supplements (wholesale/online) | أدوية ومكملات | RESTRICTED | supplements, nutraceuticals, peptides |
| 7372 | Software and SaaS | برمجيات وخدمات سحابية | MEDIUM | saas, app, subscription |
| 7379 | IT services | خدمات تقنية | LOW | |
| 5817 | Digital goods - apps and software | سلع رقمية - تطبيقات | MEDIUM | |
| 5818 | Digital goods - large merchant | سلع رقمية - كبار التجار | MEDIUM | |
| 5815 | Digital media (music, video, ebooks) | وسائط رقمية | MEDIUM | |
| 5816 | Digital games | ألعاب رقمية | HIGH | in-game, top-ups |
| 4816 | Web hosting and online services | استضافة وخدمات إنترنت | MEDIUM | |
| 4814 | Telecom services and top-ups | خدمات اتصالات وشحن رصيد | HIGH | recharge, prepaid |
| 4900 | Utilities | مرافق | LOW | |
| 6300 | Insurance | تأمين | MEDIUM | licensed broker only |
| 6513 | Real estate agents and rentals | عقارات وإيجارات | HIGH | rent collection, high ticket |
| 7011 | see above | | | |
| 5960 | Direct marketing - insurance | تسويق مباشر - تأمين | RESTRICTED | |
| 5966 | Outbound telemarketing | تسويق هاتفي | RESTRICTED | |
| 5967 | Inbound telemarketing / subscriptions with trials | اشتراكات مع فترات تجريبية | HIGH | existing policy code |
| 5968 | Continuity / subscription merchants | اشتراكات مستمرة | MEDIUM | |
| 5993 | Tobacco and vape | تبغ وسجائر إلكترونية | RESTRICTED | |
| 5921 | Alcohol | كحول | RESTRICTED | licensed only |
| 7995 | Gambling and betting | قمار ومراهنات | PROHIBITED | existing policy code |
| 7994 | Video game arcades | صالات ألعاب | MEDIUM | |
| 6051 | Crypto, forex, quasi-cash | عملات رقمية وفوركس | PROHIBITED | existing policy code; VARA licensed exchanges reviewed off-bot |
| 6211 | Securities and investments | أوراق مالية واستثمار | RESTRICTED | SCA / DFSA licensed only |
| 6012 | Financial institutions - merchandise and services | مؤسسات مالية | RESTRICTED | |
| 6540 | Stored value / wallet top-up | شحن محافظ | RESTRICTED | |
| 5962 | Direct marketing - travel | تسويق مباشر - سفر | PROHIBITED | |
| 5971 | Art dealers and galleries | معارض فنية | HIGH | |
| 5972 | Stamps and coins | طوابع وعملات | HIGH | |
| 7273 | Dating services | خدمات مواعدة | PROHIBITED | |
| 5967 adult | Adult content | محتوى للبالغين | PROHIBITED | any adult flag in S1.17 |
| 8398 | Charities and donations | جمعيات خيرية وتبرعات | RESTRICTED | licensed charities only |
| 8651 | Political organisations | منظمات سياسية | PROHIBITED | |
| 9399 | Government services | خدمات حكومية | LOW | |
| 5976 | Orthopaedic and medical devices | أجهزة طبية | MEDIUM | |
| 5631 | Lingerie | ملابس داخلية | LOW | |
| 5193 | Flowers and nursery (wholesale) | زهور ومشاتل (جملة) | LOW | |
| 5039 | Construction materials (wholesale) | مواد بناء (جملة) | MEDIUM | |
| 5099 | Durable goods (wholesale) | سلع معمرة (جملة) | MEDIUM | |
| 5199 | Non-durable goods (wholesale) | سلع غير معمرة (جملة) | MEDIUM | general trading |
| 4214 | Freight and logistics | شحن ولوجستيات | MEDIUM | |
| 4215 | Courier services | خدمات توصيل | MEDIUM | |
| 7210 | Laundry | مغاسل | LOW | |
| 7299 | Personal services (other) | خدمات شخصية أخرى | MEDIUM | |
| 7991 | Tourist attractions | مناطق جذب سياحي | MEDIUM | |
| 7997 | Gyms and clubs | نوادي رياضية | MEDIUM | memberships, subscriptions |
| 7999 | Recreation services | خدمات ترفيهية | MEDIUM | |
| 7832 | Cinemas | سينما | LOW | |
| 7922 | Ticketing and events | تذاكر وفعاليات | HIGH | events, concerts, future delivery |

## Activity flags from S1.17 -> overrides

| Flag | Effect |
|---|---|
| Travel or ticketing | floor tier at HIGH; add processing_statement |
| Electronics or luxury goods | floor tier at HIGH |
| Forex, crypto or investments | tier RESTRICTED unless MCC is PROHIBITED; bot says S2.2 and case flagged for licence check |
| Gaming or betting | PROHIBITED unless MCC is 7994 / 5816 |
| Pharma or supplements | RESTRICTED |
| Adult content | PROHIBITED |
| Charity or donations | RESTRICTED |
| Telemarketing or trials | floor tier at HIGH |

## Classifier contract

Input: S1.6 free text, S1.7/7a category, S1.8 to S1.17 answers, website URL text (title and meta only, fetched server-side, never the merchant's typed text as instructions).
Output (zod): `{ primaryMcc, confidence, secondaryMccs[0..2], reason, tier, plainLabelEn, plainLabelAr }`.
Deterministic fallback: keyword table above; if no keyword hit, 5999 (retail) or 7399 (services) by S1.7 category.
Writes `activity.mcc` into case fields with source `bot` and confidence, so the existing underwriter agent (`policy.mccRiskTiers[mcc]`) and the human reviewer see the same code.
