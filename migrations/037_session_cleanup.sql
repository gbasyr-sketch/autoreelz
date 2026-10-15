-- Conservative retention: discard only untouched, empty anonymous visits.
-- No DELETE privilege on base tables is granted to the application.
CREATE INDEX ar_web_sessions_cleanup ON ar_web_sessions(expires_at,id) WHERE customer_id IS NULL;
CREATE INDEX ar_cart_quotes_session ON ar_cart_quotes(session_id);
CREATE INDEX ar_checkout_batches_session ON ar_checkout_batches(session_id);
CREATE INDEX ar_login_challenges_session ON ar_login_challenges(session_id);

CREATE VIEW ar_session_cleanup_candidates AS
SELECT s.id AS session_id,c.id AS cart_id,s.expires_at
FROM ar_web_sessions s JOIN ar_carts c ON c.session_id=s.id
WHERE s.customer_id IS NULL AND s.expires_at < now()-interval '30 days'
 AND c.version=0
 AND NOT EXISTS(SELECT 1 FROM ar_cart_lines l WHERE l.cart_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM ar_orders o WHERE o.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM ar_checkout_batches b WHERE b.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM ar_cart_quotes q WHERE q.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM ar_login_challenges l WHERE l.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM ar_privacy_events p WHERE p.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM ar_service_consents e WHERE e.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM ar_command_results r WHERE r.scope IN
  ('cart:'||s.id::text,'checkout:'||s.id::text,'cancel:'||s.id::text,'pay:'||s.id::text,'privacy:'||s.id::text));
GRANT SELECT ON ar_session_cleanup_candidates TO ar_app;

CREATE TABLE ar_session_cleanup_state (
 id integer PRIMARY KEY CHECK(id=1),
 last_run_at timestamptz,
 deleted_sessions integer NOT NULL DEFAULT 0 CHECK(deleted_sessions>=0),
 deleted_carts integer NOT NULL DEFAULT 0 CHECK(deleted_carts>=0),
 total_deleted_sessions bigint NOT NULL DEFAULT 0 CHECK(total_deleted_sessions>=0)
);
INSERT INTO ar_session_cleanup_state(id) VALUES(1);
GRANT SELECT ON ar_session_cleanup_state TO ar_app;

CREATE FUNCTION ar_cleanup_empty_sessions()
RETURNS TABLE(deleted_sessions integer,deleted_carts integer,skipped boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE candidate record; removed_sessions integer:=0; removed_carts integer:=0; n integer;
BEGIN
 -- A new snapshot for the eligibility recheck is essential after row locking.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Session cleanup requires READ COMMITTED';
 END IF;
 IF NOT pg_try_advisory_xact_lock(320260937) THEN RETURN QUERY SELECT 0,0,true;RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ar_session_cleanup_state WHERE id=1) THEN
  RAISE EXCEPTION 'Session cleanup schedule is missing';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ar_session_cleanup_state t WHERE t.id=1 AND t.last_run_at>now()-interval '1 hour') THEN
  RETURN QUERY SELECT 0,0,true;RETURN;
 END IF;
 -- Future cascading/SET NULL dependencies must be reviewed before retention
 -- can run. Restrictive foreign keys already fail closed on DELETE.
 IF EXISTS(SELECT 1 FROM pg_constraint k
  WHERE k.contype='f' AND k.confrelid IN ('public.ar_web_sessions'::regclass,'public.ar_carts'::regclass)
   AND k.confdeltype IN ('c','n','d')
   AND NOT (k.conname='ar_carts_session_id_fkey' AND k.conrelid='public.ar_carts'::regclass
    AND k.confrelid='public.ar_web_sessions'::regclass AND k.confdeltype='c')
   AND NOT (k.conname='ar_cart_lines_cart_id_fkey' AND k.conrelid='public.ar_cart_lines'::regclass
    AND k.confrelid='public.ar_carts'::regclass AND k.confdeltype='c')) THEN
  RAISE EXCEPTION 'Unexpected cascading session/cart dependency';
 END IF;
 FOR candidate IN
  SELECT s.id AS session_id,c.id AS cart_id
  FROM public.ar_session_cleanup_candidates e
  JOIN public.ar_web_sessions s ON s.id=e.session_id
  JOIN public.ar_carts c ON c.id=e.cart_id
  ORDER BY s.expires_at,s.id LIMIT 200 FOR UPDATE OF s,c SKIP LOCKED
 LOOP
  -- Parent locks prevent new FK children. Recheck after locks to see commits
  -- made since candidate selection, before any cascading DELETE can occur.
  IF EXISTS(SELECT 1 FROM public.ar_session_cleanup_candidates e WHERE e.session_id=candidate.session_id AND e.cart_id=candidate.cart_id) THEN
   DELETE FROM public.ar_carts WHERE id=candidate.cart_id;
   GET DIAGNOSTICS n=ROW_COUNT;removed_carts:=removed_carts+n;
   DELETE FROM public.ar_web_sessions WHERE id=candidate.session_id;
   GET DIAGNOSTICS n=ROW_COUNT;removed_sessions:=removed_sessions+n;
  END IF;
 END LOOP;
 UPDATE public.ar_session_cleanup_state SET last_run_at=now(),deleted_sessions=removed_sessions,
  deleted_carts=removed_carts,total_deleted_sessions=total_deleted_sessions+removed_sessions WHERE id=1;
 RETURN QUERY SELECT removed_sessions,removed_carts,false;
END $$;
REVOKE ALL ON FUNCTION ar_cleanup_empty_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ar_cleanup_empty_sessions() TO ar_app;
