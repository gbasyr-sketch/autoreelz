-- Existing vehicle IDs, URLs and fitment references stay untouched.
GRANT INSERT,UPDATE ON ar_vehicles,ar_vehicle_versions TO ar_app;
CREATE TABLE ar_vehicle_editor_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('vehicle','version')),
 entity_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('create','update')),
 before_data jsonb,
 after_data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON ar_vehicle_editor_events TO ar_app;
