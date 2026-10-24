-- Executable statement of the tenancy and audit rules. Run by db/verify.sh as a superuser.
-- Every check runs as the real runtime role (mb_app / mb_worker), never as the owner.
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;

CREATE TEMP TABLE results (ok boolean, label text);

-- Runs `q` (a query returning one bigint) as `role` with the given tenant. Returns the number.
CREATE FUNCTION pg_temp.as_count(role text, tenant text, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role);
  IF tenant IS NOT NULL THEN PERFORM set_config('mb.tenant_id', tenant, true); ELSE PERFORM set_config('mb.tenant_id', '', true); END IF;
  EXECUTE q INTO n;
  RESET ROLE;
  RETURN n;
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE;
END $$;

-- Expects `q` to fail with the given SQLSTATE when run as role/tenant.
CREATE FUNCTION pg_temp.fails_as(role text, tenant text, q text, expected text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE got text := 'no error';
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', role);
    PERFORM set_config('mb.tenant_id', coalesce(tenant, ''), true);
    EXECUTE q;
  EXCEPTION WHEN OTHERS THEN got := SQLSTATE;
  END;
  RESET ROLE;
  RETURN CASE WHEN got = expected THEN 'ok' ELSE format('expected %s, got %s', expected, got) END;
END $$;

CREATE FUNCTION pg_temp.check_eq(label text, got anyelement, want anyelement) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN INSERT INTO results VALUES (true, label);
  ELSE INSERT INTO results VALUES (false, format('%s: got %s, wanted %s', label, got, want)); END IF;
END $$;

CREATE FUNCTION pg_temp.check_err(label text, outcome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF outcome = 'ok' THEN INSERT INTO results VALUES (true, label); ELSE INSERT INTO results VALUES (false, label || ': ' || outcome); END IF;
END $$;

-- ---------------------------------------------------------------- fixtures (as superuser, RLS bypassed)
INSERT INTO mb.tenants (id, level, parent_id, path, name) VALUES
  ('plat', 'platform', NULL,   '{plat}',          'Platform'),
  ('pa',   'partner',  'plat', '{plat,pa}',       'Partner A'),
  ('pb',   'partner',  'plat', '{plat,pb}',       'Partner B'),
  ('ma1',  'merchant', 'pa',   '{plat,pa,ma1}',   'Merchant A1'),
  ('ma2',  'merchant', 'pa',   '{plat,pa,ma2}',   'Merchant A2'),
  ('mb1',  'merchant', 'pb',   '{plat,pb,mb1}',   'Merchant B1');

INSERT INTO mb.clients (client_id, tenant_id, secret_hash, actor_type, scopes) VALUES
  ('mb_test_ma1', 'ma1', repeat('a', 64), 'service', '{events:read}'),
  ('mb_test_ma2', 'ma2', repeat('b', 64), 'service', '{events:read}');

INSERT INTO mb.webhook_endpoints (id, tenant_id, url, events, status, secret_ciphertext) VALUES
  ('e_pa',        'pa',  'https://pa.example.com/h',  '{*}',                'active',   '\x00'),
  ('e_ma1',       'ma1', 'https://ma1.example.com/h', '{example.created}',  'active',   '\x00'),
  ('e_ma1_off',   'ma1', 'https://ma1.example.com/o', '{*}',                'disabled', '\x00'),
  ('e_ma1_other', 'ma1', 'https://ma1.example.com/x', '{example.decided}',  'active',   '\x00'),
  ('e_ma2',       'ma2', 'https://ma2.example.com/h', '{*}',                'active',   '\x00'),
  ('e_pb',        'pb',  'https://pb.example.com/h',  '{*}',                'active',   '\x00');

INSERT INTO mb.events (id, tenant_id, type, api_version, data_version, livemode, data) VALUES
  ('ev_ma1', 'ma1', 'example.created', '2026-10-24', 1, false, '{}'),
  ('ev_ma2', 'ma2', 'example.created', '2026-10-24', 1, false, '{}'),
  ('ev_mb1', 'mb1', 'example.created', '2026-10-24', 1, false, '{}'),
  ('ev_pa',  'pa',  'example.created', '2026-10-24', 1, false, '{}');

-- ---------------------------------------------------------------- 1. visibility
SELECT pg_temp.check_eq('no tenant set sees no events',          pg_temp.as_count('mb_app', NULL,  'SELECT count(*) FROM mb.events'), 0::bigint);
SELECT pg_temp.check_eq('no tenant set sees no tenants',         pg_temp.as_count('mb_app', NULL,  'SELECT count(*) FROM mb.tenants'), 0::bigint);
SELECT pg_temp.check_eq('merchant sees only its own events',     pg_temp.as_count('mb_app', 'ma1', 'SELECT count(*) FROM mb.events'), 1::bigint);
SELECT pg_temp.check_eq('partner sees itself and its merchants', pg_temp.as_count('mb_app', 'pa',  'SELECT count(*) FROM mb.events'), 3::bigint);
SELECT pg_temp.check_eq('other partner sees only its own tree',  pg_temp.as_count('mb_app', 'pb',  'SELECT count(*) FROM mb.events'), 1::bigint);
SELECT pg_temp.check_eq('platform sees everything',              pg_temp.as_count('mb_app', 'plat','SELECT count(*) FROM mb.events'), 4::bigint);
SELECT pg_temp.check_eq('merchant sees its tenants subtree only',pg_temp.as_count('mb_app', 'ma1', 'SELECT count(*) FROM mb.tenants'), 1::bigint);
SELECT pg_temp.check_eq('child cannot see sibling endpoint',     pg_temp.as_count('mb_app', 'ma2', $q$SELECT count(*) FROM mb.webhook_endpoints WHERE id = 'e_ma1'$q$), 0::bigint);
SELECT pg_temp.check_eq('endpoints visible to merchant',         pg_temp.as_count('mb_app', 'ma1', 'SELECT count(*) FROM mb.webhook_endpoints'), 3::bigint);
SELECT pg_temp.check_eq('endpoints visible to partner',          pg_temp.as_count('mb_app', 'pa',  'SELECT count(*) FROM mb.webhook_endpoints'), 5::bigint);
SELECT pg_temp.check_eq('tenant id injection sees nothing',      pg_temp.as_count('mb_app', $t$ma1' OR '1'='1$t$, 'SELECT count(*) FROM mb.events'), 0::bigint);
SELECT pg_temp.check_eq('prefix of a tenant id is not that tenant', pg_temp.as_count('mb_app', 'ma', 'SELECT count(*) FROM mb.events'), 0::bigint);

-- ---------------------------------------------------------------- 2. writes
SELECT pg_temp.check_err('merchant cannot insert an event for a sibling',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.events VALUES ('ev_x','ma2','example.created','2026-10-24',1,false,'{}', now())$q$, '42501'));
SELECT pg_temp.check_err('partner cannot insert an event for its merchant',
  pg_temp.fails_as('mb_app', 'pa', $q$INSERT INTO mb.events VALUES ('ev_y','ma1','example.created','2026-10-24',1,false,'{}', now())$q$, '42501'));
SELECT pg_temp.check_err('merchant can insert its own event',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.events VALUES ('ev_z','ma1','example.created','2026-10-24',1,false,'{}', now())$q$, 'no error'));
DELETE FROM mb.events WHERE id = 'ev_z';

SELECT pg_temp.check_eq('partner UPDATE of a merchant endpoint changes nothing',
  pg_temp.as_count('mb_app', 'pa', $q$WITH u AS (UPDATE mb.webhook_endpoints SET status = 'disabled' WHERE id = 'e_ma1' RETURNING 1) SELECT count(*) FROM u$q$), 0::bigint);
SELECT pg_temp.check_eq('owner UPDATE of its own endpoint works',
  pg_temp.as_count('mb_app', 'ma1', $q$WITH u AS (UPDATE mb.webhook_endpoints SET description = 'x' WHERE id = 'e_ma1' RETURNING 1) SELECT count(*) FROM u$q$), 1::bigint);
UPDATE mb.webhook_endpoints SET description = NULL WHERE id = 'e_ma1';
SELECT pg_temp.check_err('merchant cannot move a row to another tenant',
  pg_temp.fails_as('mb_app', 'ma1', $q$UPDATE mb.webhook_endpoints SET tenant_id = 'ma2' WHERE id = 'e_ma1'$q$, '42501'));
SELECT pg_temp.check_err('runtime role cannot write tenants',
  pg_temp.fails_as('mb_app', 'plat', $q$INSERT INTO mb.tenants VALUES ('evil','merchant','plat','{plat,evil}','Evil', now())$q$, '42501'));
SELECT pg_temp.check_err('events cannot be updated by the runtime role',
  pg_temp.fails_as('mb_app', 'ma1', $q$UPDATE mb.events SET type = 'x' WHERE id = 'ev_ma1'$q$, '42501'));
SELECT pg_temp.check_err('events cannot be deleted by the runtime role',
  pg_temp.fails_as('mb_app', 'ma1', $q$DELETE FROM mb.events WHERE id = 'ev_ma1'$q$, '42501'));

-- ---------------------------------------------------------------- 3. authentication lookup
SELECT pg_temp.check_eq('clients are not listable without a tenant', pg_temp.as_count('mb_app', NULL, 'SELECT count(*) FROM mb.clients'), 0::bigint);
SELECT pg_temp.check_eq('clients of siblings are not visible',        pg_temp.as_count('mb_app', 'ma1', 'SELECT count(*) FROM mb.clients'), 1::bigint);
SELECT pg_temp.check_eq('authenticate_client works before the tenant is known',
  pg_temp.as_count('mb_app', NULL, $q$SELECT count(*) FROM mb.authenticate_client('mb_test_ma2')$q$), 1::bigint);
SELECT pg_temp.check_eq('authenticate_client finds nothing for an unknown id',
  pg_temp.as_count('mb_app', NULL, $q$SELECT count(*) FROM mb.authenticate_client('nope')$q$), 0::bigint);
SELECT pg_temp.check_err('worker role cannot read clients',
  pg_temp.fails_as('mb_worker', NULL, 'SELECT * FROM mb.clients', '42501'));

-- ---------------------------------------------------------------- 4. webhook fan-out
SELECT pg_temp.check_eq('fan-out reaches the merchant and its partner only',
  pg_temp.as_count('mb_app', 'ma1', $q$SELECT count(*) FROM mb.fan_out_event('ev_ma1')$q$), 2::bigint);
SELECT pg_temp.check_eq('fan-out skipped disabled, unsubscribed and unrelated endpoints',
  (SELECT string_agg(endpoint_id, ',' ORDER BY endpoint_id) FROM mb.webhook_deliveries WHERE event_id = 'ev_ma1'), 'e_ma1,e_pa');
SELECT pg_temp.check_eq('delivery belongs to the endpoint owner',
  (SELECT string_agg(tenant_id, ',' ORDER BY tenant_id) FROM mb.webhook_deliveries WHERE event_id = 'ev_ma1'), 'ma1,pa');
SELECT pg_temp.check_eq('fan-out of a sibling event creates nothing',
  pg_temp.as_count('mb_app', 'ma1', $q$SELECT count(*) FROM mb.fan_out_event('ev_ma2')$q$), 0::bigint);
SELECT pg_temp.check_eq('fan-out of an unknown event creates nothing',
  pg_temp.as_count('mb_app', 'ma1', $q$SELECT count(*) FROM mb.fan_out_event('nope')$q$), 0::bigint);
SELECT pg_temp.check_eq('fan-out to one endpoint only',
  pg_temp.as_count('mb_app', 'ma1', $q$SELECT count(*) FROM mb.fan_out_event('ev_ma1', 'e_pa')$q$), 1::bigint);
SELECT pg_temp.check_eq('merchant sees the delivery of its own endpoint, not the partner one',
  pg_temp.as_count('mb_app', 'ma1', 'SELECT count(*) FROM mb.webhook_deliveries'), 1::bigint);
SELECT pg_temp.check_eq('partner sees its own deliveries and its merchants',
  pg_temp.as_count('mb_app', 'pa', 'SELECT count(*) FROM mb.webhook_deliveries'), 3::bigint);
SELECT pg_temp.check_eq('sibling sees none of them',
  pg_temp.as_count('mb_app', 'ma2', 'SELECT count(*) FROM mb.webhook_deliveries'), 0::bigint);
SELECT pg_temp.check_err('fan_out_event is not callable without a role grant',
  pg_temp.fails_as('mb_worker', NULL, $q$SELECT mb.fan_out_event('ev_ma1')$q$, '42501'));

-- ---------------------------------------------------------------- 5. worker
SELECT pg_temp.check_eq('worker sees pending deliveries across tenants',
  pg_temp.as_count('mb_worker', NULL, $q$SELECT count(*) FROM mb.webhook_deliveries WHERE status = 'pending'$q$), 3::bigint);
SELECT pg_temp.check_err('worker cannot create events',
  pg_temp.fails_as('mb_worker', NULL, $q$INSERT INTO mb.events VALUES ('ev_w','ma1','example.created','2026-10-24',1,false,'{}', now())$q$, '42501'));
SELECT pg_temp.check_err('worker cannot delete deliveries',
  pg_temp.fails_as('mb_worker', NULL, 'DELETE FROM mb.webhook_deliveries', '42501'));
SELECT pg_temp.check_eq('worker can record an outcome',
  pg_temp.as_count('mb_worker', NULL, $q$WITH u AS (UPDATE mb.webhook_deliveries SET status = 'delivered', next_attempt_at = NULL WHERE id = (SELECT min(id) FROM mb.webhook_deliveries) RETURNING 1) SELECT count(*) FROM u$q$), 1::bigint);
SELECT pg_temp.check_err('a pending delivery must have a next attempt time',
  pg_temp.fails_as('mb_worker', NULL, $q$UPDATE mb.webhook_deliveries SET next_attempt_at = NULL WHERE status = 'pending'$q$, '23514'));

-- ---------------------------------------------------------------- 6. audit log
INSERT INTO mb.audit_events (id, tenant_id, seq, occurred_at, actor_type, actor_id, client_id, action, method, path, scopes_used, result, status, request_id, prev_hash, hash)
SELECT 'aud_' || g, 'ma1', g, now(), 'service', 'mb_test_ma1', 'mb_test_ma1', 'getCurrentContext', 'GET', '/v1/me', '{tenancy:read}', 'success', 200, 'req_' || g,
       repeat(CASE g WHEN 1 THEN '0' ELSE (g - 1)::text END, 64), repeat(g::text, 64)
FROM generate_series(1, 3) g;
SELECT pg_temp.check_eq('chain accepted three linked records (owner insert)', (SELECT count(*) FROM mb.audit_events WHERE tenant_id = 'ma1'), 3::bigint);

SELECT pg_temp.check_err('runtime role can append the next record',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.audit_events (id,tenant_id,seq,occurred_at,actor_type,actor_id,client_id,action,method,path,result,status,request_id,prev_hash,hash)
    VALUES ('aud_4','ma1',4,now(),'service','c','c','a','GET','/p','success',200,'r',repeat('3',64),repeat('4',64))$q$, 'no error'));

SELECT pg_temp.check_err('a gap in seq is rejected',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.audit_events (id,tenant_id,seq,occurred_at,actor_type,actor_id,client_id,action,method,path,result,status,request_id,prev_hash,hash)
    VALUES ('aud_7','ma1',7,now(),'service','c','c','a','GET','/p','success',200,'r',repeat('4',64),repeat('7',64))$q$, '23514'));
SELECT pg_temp.check_err('a fork (reused seq) is rejected',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.audit_events (id,tenant_id,seq,occurred_at,actor_type,actor_id,client_id,action,method,path,result,status,request_id,prev_hash,hash)
    VALUES ('aud_4b','ma1',4,now(),'service','c','c','a','GET','/p','success',200,'r',repeat('3',64),repeat('9',64))$q$, '23514'));
SELECT pg_temp.check_err('a wrong prev_hash is rejected',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.audit_events (id,tenant_id,seq,occurred_at,actor_type,actor_id,client_id,action,method,path,result,status,request_id,prev_hash,hash)
    VALUES ('aud_5','ma1',5,now(),'service','c','c','a','GET','/p','success',200,'r',repeat('f',64),repeat('5',64))$q$, '23514'));
SELECT pg_temp.check_err('another tenant cannot write into this chain',
  pg_temp.fails_as('mb_app', 'ma2', $q$INSERT INTO mb.audit_events (id,tenant_id,seq,occurred_at,actor_type,actor_id,client_id,action,method,path,result,status,request_id,prev_hash,hash)
    VALUES ('aud_s','ma1',5,now(),'service','c','c','a','GET','/p','success',200,'r',repeat('4',64),repeat('5',64))$q$, '42501'));
SELECT pg_temp.check_err('first record of a new chain must start from the zero hash',
  pg_temp.fails_as('mb_app', 'ma2', $q$INSERT INTO mb.audit_events (id,tenant_id,seq,occurred_at,actor_type,actor_id,client_id,action,method,path,result,status,request_id,prev_hash,hash)
    VALUES ('aud_n1','ma2',1,now(),'service','c','c','a','GET','/p','success',200,'r',repeat('1',64),repeat('2',64))$q$, '23514'));
SELECT pg_temp.check_err('runtime role cannot UPDATE the audit log',
  pg_temp.fails_as('mb_app', 'ma1', $q$UPDATE mb.audit_events SET status = 500 WHERE id = 'aud_1'$q$, '42501'));
SELECT pg_temp.check_err('runtime role cannot DELETE from the audit log',
  pg_temp.fails_as('mb_app', 'ma1', $q$DELETE FROM mb.audit_events WHERE id = 'aud_1'$q$, '42501'));
SELECT pg_temp.check_err('runtime role cannot TRUNCATE the audit log',
  pg_temp.fails_as('mb_app', 'ma1', 'TRUNCATE mb.audit_events', '42501'));
SELECT pg_temp.check_err('even the owner/superuser is stopped by the trigger (UPDATE)',
  pg_temp.fails_as(current_user, NULL, $q$UPDATE mb.audit_events SET status = 500 WHERE id = 'aud_1'$q$, '42501'));
SELECT pg_temp.check_err('even the owner/superuser is stopped by the trigger (DELETE)',
  pg_temp.fails_as(current_user, NULL, $q$DELETE FROM mb.audit_events$q$, '42501'));
SELECT pg_temp.check_err('even the owner/superuser is stopped by the trigger (TRUNCATE)',
  pg_temp.fails_as(current_user, NULL, 'TRUNCATE mb.audit_events', '42501'));
SELECT pg_temp.check_eq('partner reads its merchants audit trail', pg_temp.as_count('mb_app', 'pa', $q$SELECT count(*) FROM mb.audit_events WHERE tenant_id = 'ma1'$q$), 4::bigint);
SELECT pg_temp.check_eq('sibling reads nothing of it',            pg_temp.as_count('mb_app', 'ma2', $q$SELECT count(*) FROM mb.audit_events WHERE tenant_id = 'ma1'$q$), 0::bigint);

-- ---------------------------------------------------------------- 7. idempotency records
INSERT INTO mb.idempotency_records (tenant_id, client_id, key, fingerprint, state, response_status, response_body, expires_at)
VALUES ('ma1', 'mb_test_ma1', 'k1', 'f', 'done', 201, '{}', now() + interval '24 hours');
SELECT pg_temp.check_eq('idempotency record visible to its owner', pg_temp.as_count('mb_app', 'ma1', 'SELECT count(*) FROM mb.idempotency_records'), 1::bigint);
SELECT pg_temp.check_eq('idempotency record invisible to a sibling', pg_temp.as_count('mb_app', 'ma2', 'SELECT count(*) FROM mb.idempotency_records'), 0::bigint);
SELECT pg_temp.check_eq('sibling cannot delete it', pg_temp.as_count('mb_app', 'ma2', $q$WITH d AS (DELETE FROM mb.idempotency_records RETURNING 1) SELECT count(*) FROM d$q$), 0::bigint);
SELECT pg_temp.check_err('a finished record needs a response',
  pg_temp.fails_as('mb_app', 'ma1', $q$INSERT INTO mb.idempotency_records (tenant_id,client_id,key,fingerprint,state,expires_at) VALUES ('ma1','c','k2','f','done', now())$q$, '23514'));

-- ---------------------------------------------------------------- 8. structure
SELECT pg_temp.check_err('tenant path must end with the tenant id',
  pg_temp.fails_as(current_user, NULL, $q$INSERT INTO mb.tenants VALUES ('bad','merchant','pa','{plat,pa,other}','Bad', now())$q$, '23514'));
SELECT pg_temp.check_err('a platform tenant cannot have a parent',
  pg_temp.fails_as(current_user, NULL, $q$INSERT INTO mb.tenants VALUES ('bad2','platform','pa','{plat,pa,bad2}','Bad', now())$q$, '23514'));
SELECT pg_temp.check_eq('every tenant-owned table has RLS enabled and forced',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mb' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)), 0::bigint);
SELECT pg_temp.check_eq('runtime roles are not superusers and cannot bypass RLS',
  (SELECT count(*) FROM pg_roles WHERE rolname IN ('mb_app', 'mb_worker') AND (rolsuper OR rolbypassrls)), 0::bigint);
SELECT pg_temp.check_eq('no table is readable by PUBLIC',
  (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'mb' AND grantee = 'PUBLIC'), 0::bigint);

-- ---------------------------------------------------------------- report
SELECT format('%s %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, label) AS result FROM results ORDER BY ok, label;
\echo
SELECT format('%s passed, %s failed', count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)) AS summary FROM results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM results WHERE NOT ok) THEN RAISE EXCEPTION 'database verification failed'; END IF; END $$;
