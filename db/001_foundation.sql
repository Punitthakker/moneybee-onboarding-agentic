-- MoneyBee Open API - foundation schema (PostgreSQL 14+)
--
-- STATUS: written and exercised by db/verify.sh against PostgreSQL 16. Not yet wired to the application,
-- which still uses the in-memory store (src/core/store.ts). The in-memory TenantScope and the policies
-- below implement the same rule, and db/verify.sh is the executable statement of that rule.
--
-- Tenant model (ASSUMPTION - the existing repos have no tenant hierarchy; correct this file when they do):
--   platform -> partner -> merchant. A caller sees its own tenant and all tenants below it, and changes
--   only its own tenant's rows. Foreign rows are invisible, so a lookup returns "not found", not "forbidden".
--
-- How the application uses this file, once per request, inside one transaction:
--   SELECT set_config('mb.tenant_id', $1, true);   -- $1 comes from the verified credential, never from input
-- RLS limits the damage of a missing WHERE clause or a bad query. It does not protect against a compromised
-- application, because the application sets mb.tenant_id itself. Treat it as a second wall, not the only wall.
--
-- Roles (create with your infrastructure tooling; the DO block below only makes local development work):
--   mb_owner   owns the objects, runs migrations, is not used at runtime
--   mb_app     runtime role for API requests. Subject to RLS. No access to the worker-only operations
--   mb_worker  webhook delivery worker. Reads deliveries across tenants, can only update delivery state

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mb_app') THEN CREATE ROLE mb_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mb_worker') THEN CREATE ROLE mb_worker NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS mb;
GRANT USAGE ON SCHEMA mb TO mb_app, mb_worker;

-- ---------------------------------------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE mb.tenants (
  id          text PRIMARY KEY,
  level       text NOT NULL CHECK (level IN ('platform', 'partner', 'merchant')),
  parent_id   text REFERENCES mb.tenants (id),
  -- Ancestors from the platform down to and including this tenant. Maintained by the migration/admin tooling.
  path        text[] NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_path_ends_with_self CHECK (path[array_upper(path, 1)] = id),
  CONSTRAINT tenants_root_has_no_parent CHECK ((level = 'platform') = (parent_id IS NULL)),
  CONSTRAINT tenants_path_matches_parent CHECK (parent_id IS NULL OR path[array_upper(path, 1) - 1] = parent_id)
);
CREATE INDEX tenants_path_gin ON mb.tenants USING gin (path);

-- Current tenant for this transaction. NULL when the application did not set it, which sees nothing.
CREATE FUNCTION mb.current_tenant() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('mb.tenant_id', true), '') $$;

-- True when `t` is the current tenant or sits below it. SECURITY DEFINER so it can read mb.tenants
-- without being filtered by that table's own policy. search_path is pinned to stop hijacking.
CREATE FUNCTION mb.can_see(t text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = mb, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM mb.tenants x WHERE x.id = t AND x.path @> ARRAY[mb.current_tenant()]) $$;

-- ---------------------------------------------------------------------------------------------------------
-- API clients (credentials). Secrets are random 256-bit values, so a plain SHA-256 is adequate here.
-- Do NOT reuse this table for human passwords.
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE mb.clients (
  client_id    text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES mb.tenants (id),
  secret_hash  text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  actor_type   text NOT NULL CHECK (actor_type IN ('user', 'service', 'agent')),
  roles        text[] NOT NULL DEFAULT '{}',
  scopes       text[] NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_tenant ON mb.clients (tenant_id);

-- The token endpoint must find a client before it knows the tenant, so it cannot use RLS. It goes through
-- this function, which returns only what authentication needs and never lists clients.
CREATE FUNCTION mb.authenticate_client(p_client_id text)
  RETURNS TABLE (client_id text, tenant_id text, secret_hash text, actor_type text, roles text[], scopes text[], active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = mb, pg_temp
  AS $$ SELECT c.client_id, c.tenant_id, c.secret_hash, c.actor_type, c.roles, c.scopes, c.active FROM mb.clients c WHERE c.client_id = p_client_id $$;

-- ---------------------------------------------------------------------------------------------------------
-- Webhooks and events
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE mb.webhook_endpoints (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES mb.tenants (id),
  url                text NOT NULL CHECK (url ~ '^https?://'),
  events             text[] NOT NULL CHECK (cardinality(events) > 0),
  description        text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- Signing secret, encrypted by the application with a KMS data key before insert. Never store it in clear.
  secret_ciphertext  bytea NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_tenant ON mb.webhook_endpoints (tenant_id, created_at DESC, id DESC);

CREATE TABLE mb.events (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES mb.tenants (id),
  type          text NOT NULL,
  api_version   text NOT NULL,
  data_version  integer NOT NULL,
  livemode      boolean NOT NULL,
  data          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_tenant_time ON mb.events (tenant_id, created_at DESC, id DESC);

-- tenant_id is the tenant that owns the ENDPOINT, which can be an ancestor of the event's tenant.
CREATE TABLE mb.webhook_deliveries (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES mb.tenants (id),
  event_id         text NOT NULL REFERENCES mb.events (id),
  endpoint_id      text NOT NULL REFERENCES mb.webhook_endpoints (id),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled')),
  next_attempt_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliveries_pending_has_next_attempt CHECK ((status = 'pending') = (next_attempt_at IS NOT NULL))
);
CREATE INDEX webhook_deliveries_due ON mb.webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_tenant ON mb.webhook_deliveries (tenant_id, created_at DESC, id DESC);

CREATE TABLE mb.webhook_delivery_attempts (
  delivery_id  text NOT NULL REFERENCES mb.webhook_deliveries (id),
  number       integer NOT NULL CHECK (number BETWEEN 1 AND 6),
  at           timestamptz NOT NULL,
  status_code  integer,
  error        text,
  duration_ms  integer NOT NULL,
  PRIMARY KEY (delivery_id, number)
);

-- Creates one delivery for every active endpoint that is subscribed to the event and belongs to the event's
-- tenant or one of its ancestors (a partner hears about its merchants). SECURITY DEFINER because the rows it
-- writes belong to other tenants, which the caller's own policies would forbid. It takes only an event id,
-- so a caller cannot use it to write anything the event itself does not justify.
CREATE FUNCTION mb.fan_out_event(p_event_id text, p_only_endpoint text DEFAULT NULL)
  RETURNS SETOF text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = mb, pg_temp
  AS $$
DECLARE
  ev mb.events%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM mb.events e WHERE e.id = p_event_id;
  IF NOT FOUND OR NOT mb.can_see(ev.tenant_id) THEN RETURN; END IF; -- unknown or foreign events fan out to nothing
  RETURN QUERY
  INSERT INTO mb.webhook_deliveries (id, tenant_id, event_id, endpoint_id, status, next_attempt_at)
  SELECT 'dlv_' || replace(gen_random_uuid()::text, '-', ''), w.tenant_id, ev.id, w.id, 'pending', now()
  FROM mb.webhook_endpoints w
  JOIN mb.tenants et ON et.id = ev.tenant_id
  WHERE w.status = 'active'
    AND w.tenant_id = ANY (et.path)
    AND (p_only_endpoint IS NULL OR w.id = p_only_endpoint)
    AND (w.events @> ARRAY['*'] OR w.events @> ARRAY[ev.type])
  RETURNING id;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Audit log: append-only, one hash chain per tenant.
-- The application computes `hash` (SHA-256 over the canonical JSON of the record, see src/core/audit.ts) and
-- verifies it when reading. The database guarantees the chain's SHAPE: no gaps, no forks, no edits, no deletes.
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE mb.audit_events (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES mb.tenants (id),
  seq               bigint NOT NULL CHECK (seq >= 1),
  occurred_at       timestamptz NOT NULL,
  actor_type        text NOT NULL CHECK (actor_type IN ('user', 'service', 'agent')),
  actor_id          text NOT NULL,
  client_id         text NOT NULL,
  action            text NOT NULL,
  method            text NOT NULL,
  path              text NOT NULL,
  resource_type     text,
  resource_id       text,
  scopes_used       text[] NOT NULL DEFAULT '{}',
  result            text NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  status            integer NOT NULL,
  error_code        text,
  request_id        text NOT NULL,
  idempotent_replay boolean NOT NULL DEFAULT false,
  prev_hash         text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash              text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (tenant_id, seq),
  CONSTRAINT audit_resource_pair CHECK ((resource_type IS NULL) = (resource_id IS NULL))
);
CREATE INDEX audit_events_tenant_time ON mb.audit_events (tenant_id, occurred_at DESC, id DESC);

-- SECURITY DEFINER so the guard always sees the real chain, whatever the caller's row visibility. Without it a
-- caller that cannot see a chain would be judged against an empty one and get a misleading error.
CREATE FUNCTION mb.audit_chain_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = mb, pg_temp AS $$
DECLARE
  last_seq  bigint;
  last_hash text;
BEGIN
  -- Serialise writers per tenant so two concurrent requests cannot both claim the same seq.
  PERFORM pg_advisory_xact_lock(hashtextextended('mb.audit:' || NEW.tenant_id, 0));
  SELECT a.seq, a.hash INTO last_seq, last_hash
    FROM mb.audit_events a WHERE a.tenant_id = NEW.tenant_id ORDER BY a.seq DESC LIMIT 1;
  IF NEW.seq IS DISTINCT FROM coalesce(last_seq, 0) + 1 THEN
    RAISE EXCEPTION 'audit chain: expected seq %, got %', coalesce(last_seq, 0) + 1, NEW.seq USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.prev_hash IS DISTINCT FROM coalesce(last_hash, repeat('0', 64)) THEN
    RAISE EXCEPTION 'audit chain: prev_hash does not match the previous record' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain_guard BEFORE INSERT ON mb.audit_events FOR EACH ROW EXECUTE FUNCTION mb.audit_chain_guard();

CREATE FUNCTION mb.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mb.audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON mb.audit_events FOR EACH ROW EXECUTE FUNCTION mb.audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON mb.audit_events FOR EACH STATEMENT EXECUTE FUNCTION mb.audit_immutable();

-- ---------------------------------------------------------------------------------------------------------
-- Idempotency records. The window (24h) is enforced by the application; a cleanup job deletes expired rows.
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE mb.idempotency_records (
  tenant_id         text NOT NULL REFERENCES mb.tenants (id),
  client_id         text NOT NULL,
  key               text NOT NULL,
  fingerprint       text NOT NULL,
  state             text NOT NULL CHECK (state IN ('in_progress', 'done')),
  response_status   integer,
  response_headers  jsonb,
  response_body     jsonb,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, client_id, key),
  CONSTRAINT idem_done_has_response CHECK (state = 'in_progress' OR response_status IS NOT NULL)
);
CREATE INDEX idempotency_expiry ON mb.idempotency_records (expires_at);

-- ---------------------------------------------------------------------------------------------------------
-- Row-level security. FORCE makes it apply to the table owner too, so a migration role mistake cannot
-- silently bypass it. Only superusers and roles with BYPASSRLS skip it; give runtime roles neither.
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE mb.tenants                   ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.tenants                   FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.clients                   ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.clients                   FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.webhook_endpoints         ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.webhook_endpoints         FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.events                    ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.events                    FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.webhook_deliveries        ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.webhook_deliveries        FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.webhook_delivery_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.webhook_delivery_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.audit_events              ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.audit_events              FORCE ROW LEVEL SECURITY;
ALTER TABLE mb.idempotency_records       ENABLE ROW LEVEL SECURITY; ALTER TABLE mb.idempotency_records       FORCE ROW LEVEL SECURITY;

-- Tenants: read your own subtree. No runtime writes (tenants are provisioned by admin tooling as mb_owner).
CREATE POLICY tenants_read ON mb.tenants FOR SELECT TO mb_app, mb_worker USING (path @> ARRAY[mb.current_tenant()]);
CREATE POLICY tenants_owner ON mb.tenants FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);

-- The same four rules for every tenant-owned table: read your subtree, change only your own rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'webhook_endpoints', 'events', 'webhook_deliveries', 'audit_events', 'idempotency_records'] LOOP
    EXECUTE format('CREATE POLICY %1$s_read   ON mb.%1$s FOR SELECT TO mb_app USING (mb.can_see(tenant_id))', t);
    EXECUTE format('CREATE POLICY %1$s_insert ON mb.%1$s FOR INSERT TO mb_app WITH CHECK (tenant_id = mb.current_tenant())', t);
    EXECUTE format('CREATE POLICY %1$s_owner  ON mb.%1$s FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['clients', 'webhook_endpoints', 'webhook_deliveries', 'idempotency_records'] LOOP
    EXECUTE format('CREATE POLICY %1$s_update ON mb.%1$s FOR UPDATE TO mb_app USING (tenant_id = mb.current_tenant()) WITH CHECK (tenant_id = mb.current_tenant())', t);
  END LOOP;
END $$;
CREATE POLICY idempotency_records_delete ON mb.idempotency_records FOR DELETE TO mb_app USING (tenant_id = mb.current_tenant());

-- Attempts follow their delivery.
CREATE POLICY attempts_read ON mb.webhook_delivery_attempts FOR SELECT TO mb_app
  USING (EXISTS (SELECT 1 FROM mb.webhook_deliveries d WHERE d.id = delivery_id AND mb.can_see(d.tenant_id)));
CREATE POLICY attempts_owner ON mb.webhook_delivery_attempts FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);

-- The worker is a system process: it must see every pending delivery, but it can only record outcomes.
CREATE POLICY deliveries_worker_read   ON mb.webhook_deliveries        FOR SELECT TO mb_worker USING (true);
CREATE POLICY deliveries_worker_update ON mb.webhook_deliveries        FOR UPDATE TO mb_worker USING (true) WITH CHECK (true);
CREATE POLICY attempts_worker_read     ON mb.webhook_delivery_attempts FOR SELECT TO mb_worker USING (true);
CREATE POLICY attempts_worker_insert   ON mb.webhook_delivery_attempts FOR INSERT TO mb_worker WITH CHECK (true);
CREATE POLICY events_worker_read       ON mb.events                    FOR SELECT TO mb_worker USING (true);
CREATE POLICY endpoints_worker_read    ON mb.webhook_endpoints         FOR SELECT TO mb_worker USING (true);

-- ---------------------------------------------------------------------------------------------------------
-- Grants. Least privilege; anything not listed is denied.
-- ---------------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA mb FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mb FROM PUBLIC;

GRANT SELECT                         ON mb.tenants                   TO mb_app, mb_worker;
GRANT SELECT, INSERT, UPDATE         ON mb.clients                   TO mb_app;
GRANT SELECT, INSERT, UPDATE         ON mb.webhook_endpoints         TO mb_app;
GRANT SELECT                         ON mb.webhook_endpoints         TO mb_worker;
GRANT SELECT, INSERT                 ON mb.events                    TO mb_app;
GRANT SELECT                         ON mb.events                    TO mb_worker;
GRANT SELECT, INSERT, UPDATE         ON mb.webhook_deliveries        TO mb_app;
GRANT SELECT, UPDATE                 ON mb.webhook_deliveries        TO mb_worker;
GRANT SELECT                         ON mb.webhook_delivery_attempts TO mb_app;
GRANT SELECT, INSERT                 ON mb.webhook_delivery_attempts TO mb_worker;
GRANT SELECT, INSERT                 ON mb.audit_events              TO mb_app;     -- no UPDATE, no DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON mb.idempotency_records       TO mb_app;

GRANT EXECUTE ON FUNCTION mb.current_tenant()                  TO mb_app, mb_worker;
GRANT EXECUTE ON FUNCTION mb.can_see(text)                     TO mb_app, mb_worker;
GRANT EXECUTE ON FUNCTION mb.authenticate_client(text)         TO mb_app;
GRANT EXECUTE ON FUNCTION mb.fan_out_event(text, text)         TO mb_app;

COMMIT;
