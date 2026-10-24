import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Config } from './config.js';
import { E } from './errors.js';
import type { MemoryStore, ClientRec } from './store.js';
import type { Principal } from './types.js';
import type { Clock } from './util.js';

const ISSUER = 'moneybee-open-api';

/** Derives a purpose-specific key so one secret never signs two different kinds of thing. */
export function deriveKey(secret: string, label: string): Buffer {
  return createHmac('sha256', secret).update(label).digest();
}

/**
 * Access tokens are HS256 JWTs. This is a symmetric, server-verified token, so it does not carry the
 * post-quantum signature risk of public-key JWTs. Short lifetime and re-checking the client on every request
 * give revocation without a token blocklist: disabling a client invalidates its tokens at once.
 */
export class TokenService {
  private key: Buffer;
  constructor(
    private cfg: Config,
    private store: MemoryStore,
    private clock: Clock,
  ) {
    this.key = deriveKey(cfg.signingSecret, 'access-token-v1');
  }

  private audience() {
    return `moneybee-open-api:${this.cfg.env}`;
  }

  async issue(client: ClientRec, requestedScopes: string[] | null): Promise<{ accessToken: string; expiresIn: number; scopes: string[] }> {
    const scopes = requestedScopes ?? client.scopes;
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT({ scope: scopes.join(' '), tid: client.tenantId, env: this.cfg.env })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setIssuer(ISSUER)
      .setAudience(this.audience())
      .setSubject(client.clientId)
      .setJti(randomUUID())
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + this.cfg.tokenTtlSeconds)
      .sign(this.key);
    return { accessToken: token, expiresIn: this.cfg.tokenTtlSeconds, scopes };
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: this.audience(),
        algorithms: ['HS256'],
        typ: 'at+jwt',
        currentDate: this.clock.now(),
      });
      const client = this.store.getClient(String(payload.sub));
      if (!client || !client.active) throw new Error('client inactive');
      const tenant = this.store.getTenant(client.tenantId);
      if (!tenant || payload.tid !== tenant.id || payload.env !== this.cfg.env) throw new Error('claim mismatch');
      // Scopes can only shrink: a token never keeps a scope the client has since lost.
      const granted = String(payload.scope ?? '')
        .split(' ')
        .filter((s) => s && client.scopes.includes(s));
      return {
        clientId: client.clientId,
        tenant,
        scopes: granted,
        roles: client.roles,
        actorType: client.actorType,
        actorId: client.clientId,
        env: this.cfg.env,
      };
    } catch {
      throw E.unauthenticated();
    }
  }
}
