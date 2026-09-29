DO $$ BEGIN IF current_database() !~ '^ar_qa_dashboard_' THEN RAISE EXCEPTION 'Dashboard fixture requires an isolated QA database'; END IF; END $$;
-- Synthetic read-model fixture only. Run solely in a new ar_qa_dashboard_* DB.
CREATE TABLE ar_orders(id uuid PRIMARY KEY,number text,kind text,status text,payment_status text,delivery_status text,expires_at timestamptz,created_at timestamptz DEFAULT now(),product_total_rubles numeric(16,2),shipping_cost_rubles numeric(16,2));
CREATE TABLE ar_payments(id uuid PRIMARY KEY,order_id uuid,provider text,status text);
CREATE TABLE ar_payment_events(id uuid DEFAULT gen_random_uuid(),payment_id uuid,outcome text,created_at timestamptz DEFAULT now());
CREATE TABLE ar_reviews(status text);
CREATE TABLE ar_products(id uuid PRIMARY KEY,name text,status text,is_demo boolean DEFAULT false,kind text DEFAULT 'single',description text);
CREATE TABLE ar_skus(id uuid PRIMARY KEY,product_id uuid,article text,name text,status text,media_mode text DEFAULT 'inherit',fitment_mode text DEFAULT 'inherit',package_id uuid);
CREATE TABLE ar_stock(sku_id uuid,on_hand integer,reserved integer);
CREATE TABLE ar_product_media(product_id uuid);
CREATE TABLE ar_sku_media(sku_id uuid);
CREATE TABLE ar_fitment(product_id uuid,sku_id uuid,state text);
CREATE TABLE ar_bundle_components(id uuid DEFAULT gen_random_uuid(),bundle_id uuid,sku_id uuid,quantity integer);
INSERT INTO ar_orders VALUES
 ('00000000-0000-4000-8000-000000000001','QA-1','ordinary','paid','paid','quoted',null,now()-interval '40 days',1800,200),
 ('00000000-0000-4000-8000-000000000002','QA-2','preorder','paid','paid','delivered',null,now(),2000.50,300.10),
 ('00000000-0000-4000-8000-000000000003','QA-3','ordinary','manual_review','review','quoted',null,now(),100,10),
 ('00000000-0000-4000-8000-000000000004','QA-4','ordinary','cancelled','paid','quoted',null,now(),100,10),
 ('00000000-0000-4000-8000-000000000005','QA-5','ordinary','paid','paid','delivered',null,now(),999,10),
 ('00000000-0000-4000-8000-000000000006','QA-6','ordinary','awaiting_payment','pending','quoted',now()-interval '1 hour',now(),100,10),
 ('00000000-0000-4000-8000-000000000007','QA-7','preorder','preorder_pending','unpaid','pending_quote',null,now(),100,null);
INSERT INTO ar_payments VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','simulation','succeeded'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','yookassa-sandbox','succeeded'),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','simulation','succeeded'),
 ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','simulation','succeeded'),
 ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000005','future-real-provider','succeeded'),
 ('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','simulation','failed');
INSERT INTO ar_payment_events(payment_id,outcome,created_at) SELECT id,'paid',now()-interval '2 minutes' FROM ar_payments WHERE status='succeeded';
INSERT INTO ar_payment_events(payment_id,outcome) VALUES('10000000-0000-4000-8000-000000000001','paid'),('10000000-0000-4000-8000-000000000001','duplicate');
INSERT INTO ar_reviews VALUES ('pending'),('approved');
INSERT INTO ar_products VALUES
 ('20000000-0000-4000-8000-000000000001','QA complete','published',false,'single','Description'),
 ('20000000-0000-4000-8000-000000000002','QA incomplete','published',false,'single',''),
 ('20000000-0000-4000-8000-000000000003','QA demo','published',true,'single',''),
 ('20000000-0000-4000-8000-000000000004','QA archived','archived',false,'single',''),
 ('20000000-0000-4000-8000-000000000005','QA bundle','published',false,'bundle','Description'),
 ('20000000-0000-4000-8000-000000000006','QA empty bundle','draft',false,'bundle','Description');
INSERT INTO ar_skus VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','QA-1','Complete','published','inherit','inherit','40000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','QA-2','Incomplete','published','replace','replace',null),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','QA-3','Demo','published','inherit','inherit',null);
INSERT INTO ar_stock VALUES('30000000-0000-4000-8000-000000000001',5,3),('30000000-0000-4000-8000-000000000002',0,0),('30000000-0000-4000-8000-000000000003',99,0);
INSERT INTO ar_product_media VALUES('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
INSERT INTO ar_fitment VALUES('20000000-0000-4000-8000-000000000001',null,'compatible'),('20000000-0000-4000-8000-000000000002',null,'compatible'),('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','unknown');
INSERT INTO ar_bundle_components(bundle_id,sku_id,quantity) VALUES('20000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001',2);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ar_app;
