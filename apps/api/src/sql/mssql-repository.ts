import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import type { TokenScope } from '@moneybee/shared';
import type { Logger } from '../logger';
import type {
  CaseBundle,
  ClaimOutcome,
  CompletedRecord,
  OnboardingRepository,
  SavedIds,
  SqlDocument,
  SqlMerchant,
  SqlParty,
  TokenRow,
} from './repository';

const d = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
const iso = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null);

export function dbNameFrom(conn: string): string {
  const m = /(?:Database|Initial Catalog)=([^;]+)/i.exec(conn);
  return m ? m[1] : 'moneybee_onboard';
}

export function createMssqlRepository(connectionString: string, migrationsDir: string, log: Logger): OnboardingRepository {
  let pool: sql.ConnectionPool | null = null;

  async function getPool(): Promise<sql.ConnectionPool> {
    if (pool?.connected) return pool;
    pool = await new sql.ConnectionPool(connectionString).connect();
    return pool;
  }

  async function ensureDatabase() {
    const db = dbNameFrom(connectionString);
    const masterConn = connectionString.replace(/(Database|Initial Catalog)=[^;]+/i, '$1=master');
    let lastErr: unknown;
    for (let i = 0; i < 40; i++) {
      try {
        const p = await new sql.ConnectionPool(masterConn).connect();
        await p.request().query(`IF DB_ID(N'${db.replace(/'/g, "''")}') IS NULL CREATE DATABASE [${db.replace(/]/g, ']]')}]`);
        await p.close();
        return;
      } catch (e) {
        lastErr = e;
        log.info({ attempt: i + 1 }, 'waiting for SQL Server');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw lastErr;
  }

  return {
    async migrate() {
      await ensureDatabase();
      const p = await getPool();
      await p.request().query(`IF OBJECT_ID('dbo.schema_migrations') IS NULL CREATE TABLE dbo.schema_migrations (name NVARCHAR(200) NOT NULL PRIMARY KEY, applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME())`);
      const applied = new Set((await p.request().query('SELECT name FROM dbo.schema_migrations')).recordset.map((r: { name: string }) => r.name));
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      for (const f of files) {
        if (applied.has(f)) continue;
        const text = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
        const batches = text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
        for (const b of batches) await p.request().batch(b);
        await p.request().input('n', sql.NVarChar, f).query('INSERT INTO dbo.schema_migrations (name) VALUES (@n)');
        log.info({ migration: f }, 'applied SQL migration');
      }
    },
    async ping() {
      try {
        const p = await getPool();
        await p.request().query('SELECT 1 AS ok');
        return true;
      } catch {
        return false;
      }
    },
    async saveCompleted(rec: CompletedRecord): Promise<SavedIds> {
      const p = await getPool();
      const tx = new sql.Transaction(p);
      await tx.begin();
      try {
        const req = () => new sql.Request(tx);
        const m = rec.merchant;
        const found = await req()
          .input('lic', sql.NVarChar(60), m.licenceNo)
          .input('auth', sql.NVarChar(200), m.licenceAuthority)
          .query('SELECT id FROM dbo.merchants WITH (UPDLOCK, HOLDLOCK) WHERE licence_no=@lic AND ((licence_authority=@auth) OR (licence_authority IS NULL AND @auth IS NULL))');
        const merchantId: string = found.recordset[0]?.id ?? randomUUID();
        const isNew = found.recordset.length === 0;
        const mr = req()
          .input('id', sql.UniqueIdentifier, merchantId)
          .input('legal', sql.NVarChar(300), m.legalName)
          .input('trade', sql.NVarChar(300), m.tradeName)
          .input('et', sql.VarChar(30), m.entityType)
          .input('lic', sql.NVarChar(60), m.licenceNo)
          .input('auth', sql.NVarChar(200), m.licenceAuthority)
          .input('lexp', sql.Date, d(m.licenceExpiry))
          .input('inc', sql.Date, d(m.incorporationDate))
          .input('trn', sql.VarChar(20), m.trn)
          .input('addr', sql.NVarChar(600), m.registeredAddress)
          .input('web', sql.NVarChar(300), m.website)
          .input('mcc', sql.VarChar(4), m.mcc)
          .input('vol', sql.Decimal(18, 2), m.expectedMonthlyVolume)
          .input('tkt', sql.Decimal(18, 2), m.expectedAvgTicket)
          .input('risk', sql.VarChar(10), m.riskRating)
          .input('st', sql.VarChar(20), m.status);
        if (isNew) {
          await mr.query(`INSERT INTO dbo.merchants (id,legal_name,trade_name,entity_type,licence_no,licence_authority,licence_expiry,incorporation_date,trn,registered_address,website,mcc,expected_monthly_volume,expected_avg_ticket,risk_rating,status)
            VALUES (@id,@legal,@trade,@et,@lic,@auth,@lexp,@inc,@trn,@addr,@web,@mcc,@vol,@tkt,@risk,@st)`);
        } else {
          await mr.query(`UPDATE dbo.merchants SET legal_name=@legal,trade_name=@trade,entity_type=@et,licence_expiry=@lexp,incorporation_date=@inc,trn=@trn,registered_address=@addr,website=@web,mcc=@mcc,expected_monthly_volume=@vol,expected_avg_ticket=@tkt,risk_rating=@risk,status=@st,updated_at=SYSUTCDATETIME() WHERE id=@id`);
          await req().input('id', sql.UniqueIdentifier, merchantId).query('DELETE FROM dbo.merchant_parties WHERE merchant_id=@id; DELETE FROM dbo.merchant_documents WHERE merchant_id=@id;');
        }

        const partyIds: string[] = [];
        for (const pr of rec.parties) {
          const id = randomUUID();
          partyIds.push(id);
          await req()
            .input('id', sql.UniqueIdentifier, id)
            .input('mid', sql.UniqueIdentifier, merchantId)
            .input('role', sql.VarChar(12), pr.role)
            .input('name', sql.NVarChar(300), pr.fullName)
            .input('nat', sql.NVarChar(100), pr.nationality)
            .input('dob', sql.Date, d(pr.dob))
            .input('idt', sql.VarChar(30), pr.idType)
            .input('ide', sql.VarBinary(512), pr.idNumberEnc ? Buffer.from(pr.idNumberEnc, 'utf8') : null)
            .input('kid', sql.VarChar(40), pr.piiKeyId)
            .input('iex', sql.Date, d(pr.idExpiry))
            .input('pct', sql.Decimal(7, 4), pr.ownershipPct)
            .input('pep', sql.Bit, pr.isPep)
            .input('scr', sql.VarChar(20), pr.screeningStatus)
            .query('INSERT INTO dbo.merchant_parties (id,merchant_id,role,full_name,nationality,dob,id_type,id_number_encrypted,pii_key_id,id_expiry,ownership_pct,is_pep,screening_status) VALUES (@id,@mid,@role,@name,@nat,@dob,@idt,@ide,@kid,@iex,@pct,@pep,@scr)');
        }

        const documentIds: string[] = [];
        for (const dc of rec.documents) {
          const id = randomUUID();
          documentIds.push(id);
          await req()
            .input('id', sql.UniqueIdentifier, id)
            .input('mid', sql.UniqueIdentifier, merchantId)
            .input('t', sql.VarChar(40), dc.docType)
            .input('fn', sql.NVarChar(260), dc.fileName)
            .input('k', sql.NVarChar(400), dc.storageKey)
            .input('h', sql.Char(64), dc.sha256)
            .input('iss', sql.Date, d(dc.issuedOn))
            .input('exp', sql.Date, d(dc.expiresOn))
            .input('v', sql.VarChar(20), dc.verifiedStatus)
            .query('INSERT INTO dbo.merchant_documents (id,merchant_id,doc_type,file_name,storage_key,sha256,issued_on,expires_on,verified_status) VALUES (@id,@mid,@t,@fn,@k,@h,@iss,@exp,@v)');
        }

        const sqlCaseId = randomUUID();
        const c = rec.case;
        await req()
          .input('id', sql.UniqueIdentifier, sqlCaseId)
          .input('mid', sql.UniqueIdentifier, merchantId)
          .input('mc', sql.VarChar(40), c.mongoCaseId)
          .input('aq', sql.VarChar(60), c.acquirerCode)
          .input('st', sql.VarChar(20), c.status)
          .input('rr', sql.VarChar(10), c.riskRating)
          .input('dec', sql.VarChar(12), c.decision)
          .input('db', sql.NVarChar(400), c.decidedBy)
          .input('da', sql.DateTime2(3), new Date(c.decidedAt))
          .input('mv', sql.VarChar(80), c.modelVersion)
          .input('pv', sql.VarChar(80), c.promptVersion)
          .query('INSERT INTO dbo.onboarding_cases (id,merchant_id,mongo_case_id,acquirer_code,status,risk_rating,decision,decided_by,decided_at,model_version,prompt_version) VALUES (@id,@mid,@mc,@aq,@st,@rr,@dec,@db,@da,@mv,@pv)');

        for (const s of rec.screening) {
          await req()
            .input('id', sql.UniqueIdentifier, randomUUID())
            .input('cid', sql.UniqueIdentifier, sqlCaseId)
            .input('sub', sql.NVarChar(300), s.subject)
            .input('pr', sql.VarChar(60), s.provider)
            .input('mock', sql.Bit, s.isMock)
            .input('res', sql.VarChar(20), s.result)
            .input('cat', sql.VarChar(20), s.category)
            .input('raw', sql.NVarChar(400), s.rawRef)
            .query('INSERT INTO dbo.screening_results (id,case_id,subject,provider,is_mock,result,category,raw_ref) VALUES (@id,@cid,@sub,@pr,@mock,@res,@cat,@raw)');
        }

        const tokenId = randomUUID();
        await req()
          .input('id', sql.UniqueIdentifier, tokenId)
          .input('cid', sql.UniqueIdentifier, sqlCaseId)
          .input('mid', sql.UniqueIdentifier, merchantId)
          .input('h', sql.Char(64), rec.token.tokenHash)
          .input('sc', sql.VarChar(100), rec.token.scopes.join(','))
          .input('ex', sql.DateTime2(3), new Date(rec.token.expiresAt))
          .input('by', sql.NVarChar(200), rec.token.createdBy)
          .query('INSERT INTO dbo.onboarding_tokens (id,case_id,merchant_id,token_hash,scopes,expires_at,created_by) VALUES (@id,@cid,@mid,@h,@sc,@ex,@by)');

        for (const a of rec.audit) {
          await req()
            .input('a', sql.NVarChar(200), a.actor)
            .input('ac', sql.VarChar(80), a.action)
            .input('e', sql.NVarChar(200), a.entity)
            .input('ip', sql.VarChar(64), a.ip ?? null)
            .query('INSERT INTO dbo.audit_log (actor,action,entity,ip) VALUES (@a,@ac,@e,@ip)');
        }

        await tx.commit();
        return { merchantId, sqlCaseId, tokenId, partyIds, documentIds };
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
    },
    async findTokenByHash(hash) {
      const p = await getPool();
      const r = await p.request().input('h', sql.Char(64), hash).query('SELECT * FROM dbo.onboarding_tokens WHERE token_hash=@h');
      return r.recordset[0] ? rowToToken(r.recordset[0]) : null;
    },
    async findTokenById(id) {
      const p = await getPool();
      const r = await p.request().input('id', sql.UniqueIdentifier, id).query('SELECT * FROM dbo.onboarding_tokens WHERE id=@id');
      return r.recordset[0] ? rowToToken(r.recordset[0]) : null;
    },
    async claimToken(hash, now): Promise<ClaimOutcome> {
      const p = await getPool();
      // Single atomic statement: redeems only if unredeemed, unrevoked, unexpired and scoped for claim.
      const upd = await p
        .request()
        .input('h', sql.Char(64), hash)
        .input('now', sql.DateTime2(3), now)
        .query(`UPDATE dbo.onboarding_tokens SET redeemed_at=@now
                OUTPUT inserted.*
                WHERE token_hash=@h AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > @now AND ','+scopes+',' LIKE '%,claim,%'`);
      if (upd.recordset.length === 1) return { ok: true, token: rowToToken(upd.recordset[0]) };
      const cur = await p.request().input('h', sql.Char(64), hash).query('SELECT * FROM dbo.onboarding_tokens WHERE token_hash=@h');
      const t = cur.recordset[0];
      if (!t) return { ok: false, reason: 'not_found' };
      if (!(',' + t.scopes + ',').includes(',claim,')) return { ok: false, reason: 'scope' };
      if (t.revoked_at) return { ok: false, reason: 'revoked' };
      if (new Date(t.expires_at) <= now) return { ok: false, reason: 'expired' };
      return { ok: false, reason: 'redeemed' };
    },
    async revokeToken(id, now) {
      const p = await getPool();
      const r = await p.request().input('id', sql.UniqueIdentifier, id).input('now', sql.DateTime2(3), now).query('UPDATE dbo.onboarding_tokens SET revoked_at=@now WHERE id=@id AND revoked_at IS NULL');
      return (r.rowsAffected[0] ?? 0) > 0;
    },
    async getBundleByCase(sqlCaseId): Promise<CaseBundle | null> {
      const p = await getPool();
      const c = await p.request().input('id', sql.UniqueIdentifier, sqlCaseId).query('SELECT * FROM dbo.onboarding_cases WHERE id=@id');
      const cr = c.recordset[0];
      if (!cr) return null;
      const m = (await p.request().input('id', sql.UniqueIdentifier, cr.merchant_id).query('SELECT * FROM dbo.merchants WHERE id=@id')).recordset[0];
      const ps = (await p.request().input('id', sql.UniqueIdentifier, cr.merchant_id).query('SELECT * FROM dbo.merchant_parties WHERE merchant_id=@id')).recordset;
      const ds = (await p.request().input('id', sql.UniqueIdentifier, cr.merchant_id).query('SELECT * FROM dbo.merchant_documents WHERE merchant_id=@id')).recordset;
      const ss = (await p.request().input('id', sql.UniqueIdentifier, sqlCaseId).query('SELECT * FROM dbo.screening_results WHERE case_id=@id')).recordset;
      const dstr = (v: Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : null);
      const merchant: SqlMerchant = {
        id: m.id.toLowerCase(), legalName: m.legal_name, tradeName: m.trade_name, entityType: m.entity_type, licenceNo: m.licence_no,
        licenceAuthority: m.licence_authority, licenceExpiry: dstr(m.licence_expiry), incorporationDate: dstr(m.incorporation_date), trn: m.trn,
        registeredAddress: m.registered_address, website: m.website, mcc: m.mcc,
        expectedMonthlyVolume: m.expected_monthly_volume === null ? null : Number(m.expected_monthly_volume),
        expectedAvgTicket: m.expected_avg_ticket === null ? null : Number(m.expected_avg_ticket), riskRating: m.risk_rating, status: m.status,
      };
      const parties: SqlParty[] = ps.map((r: Record<string, any>) => ({
        id: String(r.id).toLowerCase(), role: r.role, fullName: r.full_name, nationality: r.nationality, dob: dstr(r.dob), idType: r.id_type,
        idNumberEnc: r.id_number_encrypted ? Buffer.from(r.id_number_encrypted).toString('utf8') : null, piiKeyId: r.pii_key_id, idExpiry: dstr(r.id_expiry),
        ownershipPct: r.ownership_pct === null ? null : Number(r.ownership_pct), isPep: !!r.is_pep, screeningStatus: r.screening_status,
      }));
      const documents: SqlDocument[] = ds.map((r: Record<string, any>) => ({
        id: String(r.id).toLowerCase(), docType: r.doc_type, fileName: r.file_name, storageKey: r.storage_key, sha256: r.sha256,
        issuedOn: dstr(r.issued_on), expiresOn: dstr(r.expires_on), verifiedStatus: r.verified_status,
      }));
      return {
        merchant, parties, documents,
        caseRow: { id: String(cr.id).toLowerCase(), mongoCaseId: cr.mongo_case_id, acquirerCode: cr.acquirer_code, status: cr.status, riskRating: cr.risk_rating, decision: cr.decision, decidedBy: cr.decided_by, decidedAt: iso(cr.decided_at) },
        screening: ss.map((r: Record<string, any>) => ({ subject: r.subject, provider: r.provider, isMock: !!r.is_mock, result: r.result, category: r.category, rawRef: r.raw_ref })),
      };
    },
    async close() {
      await pool?.close();
    },
  };
}

function rowToToken(r: Record<string, any>): TokenRow {
  return {
    id: String(r.id).toLowerCase(),
    caseId: String(r.case_id).toLowerCase(),
    merchantId: String(r.merchant_id).toLowerCase(),
    scopes: String(r.scopes).split(',') as TokenScope[],
    expiresAt: new Date(r.expires_at).toISOString(),
    redeemedAt: iso(r.redeemed_at),
    revokedAt: iso(r.revoked_at),
    createdBy: r.created_by,
    tokenHash: String(r.token_hash).trim(),
  };
}
