CREATE TABLE ar_customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK(email=lower(btrim(email))),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_web_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
 csrf_token text NOT NULL, customer_id uuid REFERENCES ar_customers(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE ar_carts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL UNIQUE REFERENCES ar_web_sessions(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_cart_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cart_id uuid NOT NULL REFERENCES ar_carts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES ar_products(id), sku_id uuid REFERENCES ar_skus(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 last_name text NOT NULL, last_price_kopecks bigint NOT NULL, last_image text NOT NULL,
 UNIQUE NULLS NOT DISTINCT(cart_id,product_id,sku_id)
);
CREATE TABLE ar_cart_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES ar_web_sessions(id),
 cart_version integer NOT NULL, input jsonb NOT NULL, snapshot jsonb NOT NULL, fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE ar_checkout_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES ar_web_sessions(id),
 quote_id uuid NOT NULL UNIQUE REFERENCES ar_cart_quotes(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE ar_order_number_seq START 10001;
CREATE TABLE ar_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number text NOT NULL UNIQUE DEFAULT ('AR-'||to_char(now(),'YY')||'-'||lpad(nextval('ar_order_number_seq')::text,6,'0')),
 batch_id uuid NOT NULL REFERENCES ar_checkout_batches(id), session_id uuid NOT NULL REFERENCES ar_web_sessions(id),
 kind text NOT NULL CHECK(kind IN('ordinary','preorder')),
 status text NOT NULL CHECK(status IN('open','preorder_pending','awaiting_payment','paid','expired','cancelled','manual_review')),
 payment_status text NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','pending','paid','failed','review')),
 delivery_status text NOT NULL CHECK(delivery_status IN('pending_quote','quoted','packing','shipped','delivered')),
 allocation_state text NOT NULL DEFAULT 'none' CHECK(allocation_state IN('none','reserved','debited','settled','released')),
 customer_name text NOT NULL, customer_phone text NOT NULL, customer_email text NOT NULL,
 delivery_snapshot jsonb NOT NULL, items_snapshot jsonb NOT NULL,
 product_total_kopecks bigint NOT NULL CHECK(product_total_kopecks>=0),
 shipping_cost_kopecks bigint CHECK(shipping_cost_kopecks>=0),
 shipping_reason text, shipping_version integer NOT NULL DEFAULT 0, shipping_package jsonb,
 terms text, review_reason text, expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,kind),
 CHECK(delivery_status='pending_quote' OR shipping_cost_kopecks IS NOT NULL)
);
CREATE INDEX ar_orders_session ON ar_orders(session_id,created_at DESC);
CREATE INDEX ar_orders_email ON ar_orders(customer_email,created_at DESC);
CREATE INDEX ar_orders_due ON ar_orders(expires_at) WHERE allocation_state IN('reserved','debited');
CREATE TABLE ar_order_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ar_orders(id),
 sku_id uuid NOT NULL REFERENCES ar_skus(id), quantity integer NOT NULL CHECK(quantity>0), UNIQUE(order_id,sku_id)
);
CREATE TABLE ar_order_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ar_orders(id),
 event_type text NOT NULL, note text NOT NULL DEFAULT '', actor_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_command_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text NOT NULL, request_key uuid NOT NULL,
 request_hash text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope,request_key)
);
CREATE TABLE ar_stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku_id uuid NOT NULL REFERENCES ar_skus(id),
 order_id uuid REFERENCES ar_orders(id), operation_key text NOT NULL,
 stock_delta integer NOT NULL DEFAULT 0, reserved_delta integer NOT NULL DEFAULT 0,
 reason text NOT NULL, actor_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(operation_key,sku_id)
);
CREATE TABLE ar_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ar_orders(id),
 amount_kopecks bigint NOT NULL CHECK(amount_kopecks>=0), currency text NOT NULL DEFAULT 'RUB' CHECK(currency='RUB'),
 method text NOT NULL CHECK(method IN('card','sbp')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','succeeded','failed','review')),
 shipping_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ar_payment_pending ON ar_payments(order_id) WHERE status='pending';
CREATE TABLE ar_payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_event_id text NOT NULL UNIQUE,
 payment_id uuid NOT NULL REFERENCES ar_payments(id), payload_hash text NOT NULL,
 outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_login_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES ar_web_sessions(id),
 email text NOT NULL, code_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 ip_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
CREATE INDEX ar_login_email ON ar_login_challenges(email,created_at DESC);
CREATE INDEX ar_login_ip ON ar_login_challenges(ip_hash,created_at DESC);
CREATE TABLE ar_mail_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 deduplication_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','delivered')),
 created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE TABLE ar_packing_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 package_id uuid NOT NULL REFERENCES ar_packages(id), active boolean NOT NULL DEFAULT true,
 components jsonb NOT NULL CHECK(jsonb_typeof(components)='object'),
 is_demo boolean NOT NULL DEFAULT false
);
CREATE TABLE ar_worker_heartbeat (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 last_run_at timestamptz NOT NULL DEFAULT now(), last_error text
);

CREATE FUNCTION ar_order_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.batch_id,NEW.session_id,NEW.kind,NEW.customer_name,NEW.customer_phone,NEW.customer_email,NEW.delivery_snapshot,NEW.items_snapshot,NEW.product_total_kopecks,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.batch_id,OLD.session_id,OLD.kind,OLD.customer_name,OLD.customer_phone,OLD.customer_email,OLD.delivery_snapshot,OLD.items_snapshot,OLD.product_total_kopecks,OLD.created_at)
 THEN RAISE EXCEPTION 'Снимок заказа неизменяем'; END IF;
 NEW.updated_at=now();RETURN NEW;
END $$;
CREATE TRIGGER ar_order_snapshot_guard BEFORE UPDATE ON ar_orders FOR EACH ROW EXECUTE FUNCTION ar_order_snapshot_guard();
CREATE FUNCTION ar_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Историческая запись неизменяема'; END $$;
CREATE TRIGGER ar_order_components_immutable BEFORE UPDATE OR DELETE ON ar_order_components FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
CREATE TRIGGER ar_stock_movements_immutable BEFORE UPDATE OR DELETE ON ar_stock_movements FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
CREATE TRIGGER ar_order_events_immutable BEFORE UPDATE OR DELETE ON ar_order_events FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
CREATE TRIGGER ar_payment_events_immutable BEFORE UPDATE OR DELETE ON ar_payment_events FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();

GRANT SELECT,INSERT,UPDATE ON ar_customers,ar_web_sessions,ar_carts,ar_cart_quotes,ar_checkout_batches,
 ar_orders,ar_command_results,ar_payments,ar_login_challenges,ar_mail_outbox,ar_worker_heartbeat TO ar_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ar_cart_lines TO ar_app;
GRANT SELECT,INSERT ON ar_order_components,ar_order_events,ar_stock_movements,ar_payment_events TO ar_app;
GRANT SELECT,INSERT,UPDATE ON ar_stock TO ar_app;
GRANT SELECT ON ar_packing_rules TO ar_app;
GRANT USAGE,SELECT ON ar_order_number_seq,ar_cart_lines_ordinal_seq TO ar_app;
GRANT SELECT ON ar_orders,ar_order_components,ar_order_events,ar_stock_movements,ar_payments TO ar_cms;
GRANT SELECT,INSERT,UPDATE,DELETE ON ar_packing_rules TO ar_cms;
GRANT SELECT(id,storage,filename_disk,type,filesize,width,height,title,modified_on) ON directus_files TO ar_app;
