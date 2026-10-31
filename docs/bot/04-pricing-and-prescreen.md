# Indicative pricing and pre-approval score (v0.1 draft, EXAMPLE VALUES)

Every number below is a placeholder for Punit / commercial to set. The structure is what gets coded. Values will live in `policies/pricing.json` (new) and `policies/base.json -> risk` (existing).

## 1. Pricing table (`policies/pricing.json`)

Lookup key: (MCC tier) x (monthly volume band) x (card present vs card not present). Output: MDR %, fixed fee AED, settlement, setup fee, rolling reserve.

### Volume bands (from S1.12)
| band | AED / month |
|---|---|
| V1 | under 50,000 or "just starting" |
| V2 | 50,000 to 200,000 |
| V3 | 200,000 to 500,000 |
| V4 | 500,000 to 2,000,000 |
| V5 | over 2,000,000 |

### MDR % (card not present, online) - EXAMPLE
| tier | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|
| LOW | 2.50 | 2.35 | 2.20 | 2.00 | custom |
| MEDIUM | 2.75 | 2.60 | 2.45 | 2.25 | custom |
| HIGH | 3.50 | 3.30 | 3.10 | 2.90 | custom |
| RESTRICTED | range only: 3.5 to 4.5 | | | | |

### MDR % (card present, POS) - EXAMPLE
| tier | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|
| LOW | 1.75 | 1.65 | 1.55 | 1.45 | custom |
| MEDIUM | 1.95 | 1.85 | 1.75 | 1.65 | custom |
| HIGH | 2.50 | 2.40 | 2.30 | 2.20 | custom |

"Both" channels: show both lines in S4.1.
"custom" (V5): S4.2 wording, "our team will quote".

### Other components - EXAMPLE
| component | LOW | MEDIUM | HIGH | RESTRICTED |
|---|---|---|---|---|
| fixed fee per txn | AED 1.00 | AED 1.00 | AED 1.50 | AED 1.50 |
| settlement | T+1 | T+2 | T+3 | T+7 |
| setup fee | waived | waived | AED 500 | AED 1,000 |
| rolling reserve | none | none | 5% for 90 days | 10% for 180 days |
| international cards uplift | +0.75% | +0.75% | +1.00% | +1.00% |
| subscription / recurring | no change | no change | +0.25% | +0.25% |

reserve_line in S4.1/S4.2 only appears when a reserve applies: "A rolling reserve of {pct}% held for {days} days may apply."

### Pre-approval band -> what the merchant sees
| band | pricing shown |
|---|---|
| Likely approve | exact indicative line from the table |
| Needs review | range: table value to table value + 0.75% |
| Unlikely | no pricing; S4.3 |

## 2. Pre-screen score (reuse of `policies/base.json -> risk.weights`)

Score = 100 minus the sum of applicable weights, computed from Stage 1 answers plus whatever the extractor already pulled from documents. Same weights as the underwriter agent so the two never disagree in direction; the underwriter adds what the bot cannot see (screening, UBO complexity, verification findings).

| signal | source | existing weight key | applies when |
|---|---|---|---|
| MCC MEDIUM | S2 | mccMedium (10) | tier MEDIUM |
| MCC HIGH / RESTRICTED | S2 | mccHigh (25), +15 if RESTRICTED | |
| jurisdiction | S1.11 + licence emirate | jurisdiction (20) | customer base includes a `highRiskJurisdictions` entry, or international + V1 |
| young business | S1.15 | youngBusiness (10) | under 1 year |
| high volume | S1.12 | highVolume (10) | V4 or V5 and under 3 years |
| high ticket | S1.13 | highTicket (5) | ticket band over 2,000 |
| doc quality | S3 | docQuality (10) | any doc below confidenceThreshold or expiring within 30 days |
| injection suspected | S3 | injectionSuspected (25) | any file flagged |
| no web presence | S1.16 | NEW: noWebPresence (10) | "not yet" |
| activity flag | S1.17 | NEW: activityFlag (10 each, cap 20) | any flag other than None |
| switching for "better support" with existing processor | S1.14a | NEW: switchingSignal (0 to 5) | optional, informational |

Bands (EXAMPLE): 70 to 100 Likely approve; 45 to 69 Needs review; under 45 Unlikely. Any RESTRICTED tier caps at Needs review. Any PROHIBITED ends at S2.3 before scoring.

Stored on the case as `botIntake.prescreen = { score, band, signals[], computedAt, policyVersion }`. Shown to the underwriter in the Bot intake panel. Never shown to the merchant.

## 3. Review time (`sla` variable)
| band | EN | AR |
|---|---|---|
| Likely approve | 1 to 2 working days | يوم إلى يومي عمل |
| Needs review | 3 to 5 working days | 3 إلى 5 أيام عمل |
| Unlikely | up to 5 working days | حتى 5 أيام عمل |

## 4. Open decisions for Punit
1. Do we show the exact indicative MDR for Likely approve, or always a range? (Prompt says exact; a range is safer commercially.)
2. Do we show pricing before documents to hook the merchant (range after S1.18), or only after (current script)?
3. Are POS / card present rates in scope for the bot launch, or online only?
4. Who can edit pricing.json in production: a Settings page in the back office (ADMIN), or deploy-time only?
