# API surface (design v1.0, 2026-10-24)

Total 65 operations: 11 built (Foundation), 54 designed and not yet built. Generated from the same data as the review document.

Risk classes: read, write, money-moving, decision-recording (human only). Hostnames are placeholders until confirmed.


## Foundation (11, built)

| Call | Operation | Scope | Risk | What it does |
|---|---|---|---|---|
| `POST /oauth/token` | createAccessToken | public (client credentials) | write | Exchange client credentials for an access token |
| `GET /me` | getCurrentContext | public (client credentials) | read | Show the caller's tenant, scopes and environment |
| `GET /audit-events` | listAuditEvents | audit:read | read | List audit events |
| `GET /audit-events/verification` | verifyAuditChain | audit:read | read | Verify the audit hash chain for a tenant |
| `POST /webhook-endpoints` | createWebhookEndpoint | webhooks:write | write | Register a webhook endpoint |
| `GET /webhook-endpoints` | listWebhookEndpoints | webhooks:read | read | List webhook endpoints |
| `DELETE /webhook-endpoints/{endpoint_id}` | disableWebhookEndpoint | webhooks:write | write | Disable a webhook endpoint |
| `POST /webhook-endpoints/{endpoint_id}/ping` | pingWebhookEndpoint | webhooks:write | write | Send a test event to one webhook endpoint |
| `GET /events` | listEvents | events:read | read | List events |
| `POST /events/{event_id}/replay` | replayEvent | events:replay | write | Re-send a past event to webhook endpoints |
| `GET /webhook-deliveries` | listWebhookDeliveries | webhooks:read | read | List webhook deliveries and their attempts |

## Foundation additions (3, to build first)

| Call | Operation | Scope | Risk | What it does |
|---|---|---|---|---|
| `GET /approvals` | listApprovals | approvals:read | read | Pending and past second-person approvals for the caller tenant |
| `GET /approvals/{approval_id}` | getApproval | approvals:read | read | What is being approved, by whom it was requested, and the first decision |
| `POST /approvals/{approval_id}/decision` | decideApproval | approvals:decide | human only | Human only, must be a different person from the requester; reason code required |

## Module A - Onboarding (12)

| Call | Operation | Scope | Risk | What it does |
|---|---|---|---|---|
| `POST /onboarding/applications` | createApplication | onboarding:applications.write | write | Starts a draft application for a merchant |
| `GET /onboarding/applications` | listApplications | onboarding:applications.read | read | Filter by state, risk band, date |
| `GET /onboarding/applications/{application_id}` | getApplication | onboarding:applications.read | read | Current state and history |
| `POST /onboarding/applications/{application_id}/documents` | uploadDocument | onboarding:documents.write | write | Multipart, up to 10 MB, PDF/JPEG/PNG. Malware scan runs after upload |
| `GET /onboarding/applications/{application_id}/documents` | listDocuments | onboarding:applications.read | read | Each document shows scan and extraction status |
| `POST /onboarding/applications/{application_id}/submission` | submitApplication | onboarding:applications.write | write | Locks the documents and starts the agent analysis |
| `GET /onboarding/applications/{application_id}/analysis` | getAnalysis | onboarding:analysis.read | read | Agent-prepared pack: entities, ownership graph, risk band, reason codes, page-level source links. Screening is labelled MOCK in the sandbox |
| `POST /onboarding/applications/{application_id}/information-requests` | requestInformation | onboarding:applications.write | write | Agent or human asks the merchant for more. Free text is untrusted |
| `POST /onboarding/applications/{application_id}/decision` | recordDecision | onboarding:decisions.write | human only | Human underwriter only. Approve, decline or refer, with a reason code. High risk approvals need a second person |
| `GET /onboarding/reason-codes` | listReasonCodes | onboarding:applications.read | read | The fixed list of reason codes a decision may use |
| `GET /onboarding/applications/{application_id}/acquirer-pack` | getAcquirerPack | onboarding:packs.read | read | Available only after approval |
| `POST /onboarding/applications/{application_id}/acquirer-pack/shares` | shareAcquirerPack | onboarding:packs.share | write | Expiring single-use link to a named acquirer |

## Module B - Compliance (22)

| Call | Operation | Scope | Risk | What it does |
|---|---|---|---|---|
| `POST /compliance/rules` | createRule | compliance:rules.write | write | Creates the rule and its version 1 as a draft |
| `GET /compliance/rules` | listRules | compliance:rules.read | read | Filter by state and typology |
| `GET /compliance/rules/{rule_id}` | getRule | compliance:rules.read | read | Includes the list of versions |
| `POST /compliance/rules/{rule_id}/versions` | createRuleVersion | compliance:rules.write | write | Versions are immutable. A change is always a new version |
| `POST /compliance/rules/{rule_id}/versions/{version}/backtests` | runBacktest | compliance:backtests.write | write | Runs asynchronously over a historic window |
| `GET /compliance/backtests/{backtest_id}` | getBacktest | compliance:rules.read | read | Alert volume, precision against labelled history, difference from the active version |
| `POST /compliance/rules/{rule_id}/versions/{version}/activation` | activateRuleVersion | compliance:rules.activate | human only | Human compliance officer only. Needs a finished backtest and a second person |
| `POST /compliance/rules/{rule_id}/versions/{version}/deactivation` | deactivateRuleVersion | compliance:rules.activate | human only | Human only, reason code required |
| `POST /compliance/transactions` | ingestTransactions | compliance:transactions.write | write | Batch up to 500, amounts in minor units. Returns 202; alerts arrive by webhook |
| `GET /compliance/alerts` | listAlerts | compliance:alerts.read | read | Filter by rule, state, severity |
| `GET /compliance/alerts/{alert_id}` | getAlert | compliance:alerts.read | read | Shows the rule version that fired and the data it saw |
| `POST /compliance/alerts/{alert_id}/disposition` | dispositionAlert | compliance:alerts.decide | human only | Human analyst only: false positive, escalate, or close. Reason code required |
| `POST /compliance/cases` | openCase | compliance:cases.write | write | Opens a case from one or more alerts. An agent may open one |
| `GET /compliance/cases` | listCases | compliance:cases.read | read | Filter by state and owner |
| `GET /compliance/cases/{case_id}` | getCase | compliance:cases.read | read | Alerts, notes and decisions in order |
| `POST /compliance/cases/{case_id}/notes` | addCaseNote | compliance:cases.write | write | Free text is untrusted |
| `POST /compliance/cases/{case_id}/decision` | decideCase | compliance:cases.decide | human only | Human MLRO only: close, escalate, or file a report. Filing needs a second person |
| `POST /compliance/cases/{case_id}/evidence-bundles` | createEvidenceBundle | compliance:evidence.write | write | Collects alerts, rule versions in force, decisions and audit extract into a hash-chained bundle |
| `GET /compliance/evidence-bundles/{bundle_id}` | getEvidenceBundle | compliance:evidence.read | read | Returns the bundle and its root hash |
| `GET /compliance/evidence-bundles/{bundle_id}/verification` | verifyEvidenceBundle | compliance:evidence.read | read | Recomputes the chain and names the first broken item |
| `POST /compliance/cases/{case_id}/exports` | createGoamlExport | compliance:exports.write | write | Builds a goAML-formatted file for review. The API never submits it to the regulator |
| `GET /compliance/exports/{export_id}` | getGoamlExport | compliance:exports.read | read | Download the file and its validation result |

## Module C - QSS (17)

| Call | Operation | Scope | Risk | What it does |
|---|---|---|---|---|
| `POST /qss/keys` | createKey | qss:keys.write | write | Hybrid key pair, either for encryption (ML-KEM-768 + X25519) or signing (ML-DSA + ECDSA). Private keys never leave the QSS service |
| `GET /qss/keys` | listKeys | qss:keys.read | read | Public parts and status only |
| `GET /qss/keys/{key_id}` | getKey | qss:keys.read | read | Public parts and status only |
| `POST /qss/keys/{key_id}/rotation` | rotateKey | qss:keys.write | write | The old key keeps verifying and opening until retired |
| `POST /qss/keys/{key_id}/revocation` | revokeKey | qss:keys.revoke | human only | Human security officer only. Cannot be undone |
| `POST /qss/envelopes` | sealEnvelope | qss:envelopes.seal | write | Encrypts a payload to a recipient key (envelope v2). Synthetic card numbers only in the sandbox |
| `POST /qss/envelopes/opening` | openEnvelope | qss:envelopes.open | money-moving | Releases the plaintext. Agents are blocked outright. Needs the PCI decision below |
| `POST /qss/signatures` | signPayload | qss:signatures.write | write | Composite signature with a required domain label |
| `POST /qss/signatures/verification` | verifySignature | qss:signatures.read | read | Both signatures must verify. Safe to repeat, no idempotency key needed |
| `POST /qss/agent-tokens` | issueAgentToken | qss:agents.issue | human only | Human only. Short-lived, bound to one mandate |
| `GET /qss/agent-tokens` | listAgentTokens | qss:agents.read | read | Never returns the token value |
| `POST /qss/agent-tokens/{token_id}/revocation` | revokeAgentToken | qss:agents.issue | write | Takes effect at once. Reducing authority is never gated |
| `POST /qss/mandates` | createMandate | qss:mandates.issue | human only | Human only. Limits per payment and per period, allowed merchant categories, currency, expiry. Signed with a composite signature |
| `GET /qss/mandates` | listMandates | qss:mandates.read | read | Filter by state and card |
| `GET /qss/mandates/{mandate_id}` | getMandate | qss:mandates.read | read | Terms, signature and usage so far |
| `POST /qss/mandates/{mandate_id}/revocation` | revokeMandate | qss:mandates.write | write | Immediate. Reducing authority is never gated |
| `POST /qss/mandates/{mandate_id}/authorizations` | authorizePayment | qss:mandates.authorize | money-moving | An agent presents its token and an intended payment. Returns a signed authorization or a denial with the reason |

## Webhook events (designed)

- **Foundation**: webhook.ping, approval.requested, approval.decided
- **Onboarding**: application.submitted, application.analysis_ready, application.information_requested, application.decided, document.rejected, pack.shared
- **Compliance**: alert.created, alert.dispositioned, case.opened, case.decided, rule_version.activated, backtest.completed, evidence_bundle.created, export.ready
- **QSS**: key.rotated, key.revoked, mandate.created, mandate.revoked, agent_token.issued, authorization.granted, authorization.denied

## MCP tools for agents (18)

- Read: get_current_context, list_audit_events, get_application, get_analysis, list_reason_codes, list_alerts, get_alert, get_case, get_backtest, verify_evidence_bundle
- Prepare: create_application, request_information, run_backtest, create_rule_version, open_case, add_case_note, create_evidence_bundle
- Pay within a mandate: authorize_payment
- Never offered to agents: record_decision, decide_approval, disposition_alert, decide_case, activate_rule_version, create_mandate, issue_agent_token, revoke_key, open_envelope
