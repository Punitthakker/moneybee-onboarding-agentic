import type { ActorType } from './types.js';
import type { AuditRec, MemoryStore } from './store.js';
import type { Clock } from './util.js';
import { ZERO_HASH, canonicalJson, newId, sha256Hex } from './util.js';

export interface AuditInput {
  tenantId: string;
  actor: { type: ActorType; id: string };
  clientId: string;
  action: string;
  method: string;
  path: string;
  resource: { type: string; id: string } | null;
  scopesUsed: string[];
  result: 'success' | 'denied' | 'error';
  status: number;
  errorCode: string | null;
  requestId: string;
  idempotentReplay: boolean;
}

/** Hash input: the whole record except `hash`, in canonical form. prevHash is part of the record. */
export function computeHash(rec: Omit<AuditRec, 'hash'>): string {
  return sha256Hex(canonicalJson(rec));
}

/**
 * Append-only audit log. Each tenant has its own chain: every record stores the hash of the previous one.
 * Editing, deleting or reordering any record breaks verification at a known sequence number.
 * Production also needs storage-level protection (no UPDATE or DELETE grants, WORM export). See db/001_foundation.sql.
 */
export class AuditLog {
  constructor(
    private store: MemoryStore,
    private clock: Clock,
  ) {}

  record(input: AuditInput): AuditRec {
    const chain = this.store.auditChain(input.tenantId);
    const last = chain[chain.length - 1];
    const base: Omit<AuditRec, 'hash'> = {
      id: newId('aud'),
      seq: (last?.seq ?? 0) + 1,
      tenantId: input.tenantId,
      occurredAt: this.clock.now().toISOString(),
      actor: input.actor,
      clientId: input.clientId,
      action: input.action,
      method: input.method,
      path: input.path,
      resource: input.resource,
      scopesUsed: input.scopesUsed,
      result: input.result,
      status: input.status,
      errorCode: input.errorCode,
      requestId: input.requestId,
      idempotentReplay: input.idempotentReplay,
      prevHash: last?.hash ?? ZERO_HASH,
    };
    const rec: AuditRec = { ...base, hash: computeHash(base) };
    this.store.appendAudit(rec);
    return rec;
  }

  verify(tenantId: string): { tenantId: string; eventsChecked: number; valid: boolean; firstInvalidSeq: number | null } {
    const chain = this.store.auditChain(tenantId);
    let prev = ZERO_HASH;
    let expectedSeq = 1;
    for (const rec of chain) {
      const { hash, ...rest } = rec;
      if (rec.seq !== expectedSeq || rec.prevHash !== prev || computeHash(rest) !== hash) {
        return { tenantId, eventsChecked: chain.length, valid: false, firstInvalidSeq: rec.seq };
      }
      prev = hash;
      expectedSeq++;
    }
    return { tenantId, eventsChecked: chain.length, valid: true, firstInvalidSeq: null };
  }
}

export function auditToApi(r: AuditRec) {
  return {
    id: r.id,
    seq: r.seq,
    tenant_id: r.tenantId,
    occurred_at: r.occurredAt,
    actor: r.actor,
    client_id: r.clientId,
    action: r.action,
    method: r.method,
    path: r.path,
    resource: r.resource,
    scopes_used: r.scopesUsed,
    result: r.result,
    status: r.status,
    error_code: r.errorCode,
    request_id: r.requestId,
    idempotent_replay: r.idempotentReplay,
    prev_hash: r.prevHash,
    hash: r.hash,
  };
}
