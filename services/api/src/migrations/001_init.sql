-- NEXUS core tables (docs/DATA_MODELS.md "Database tables"). Documents are stored as validated JSONB with
-- key columns pulled out for lookups. Spatial columns wait for a configured lunar SRID; until then anchors
-- keep sceneLocal + terrainFeatureId inside the document.
CREATE TABLE IF NOT EXISTS observations (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS utterances (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS field_notes (
  id text PRIMARY KEY,
  observation_id text NOT NULL REFERENCES observations(id),
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id text PRIMARY KEY,
  observation_id text NOT NULL REFERENCES observations(id),
  status text NOT NULL,
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS findings_observation_idx ON findings (observation_id);

CREATE TABLE IF NOT EXISTS reviews (
  id bigserial PRIMARY KEY,
  finding_id text NOT NULL REFERENCES findings(id),
  session_id text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sie_decisions (
  id text PRIMARY KEY,
  subject_id text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  observation_id text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit tables (SECURITY_PRIVACY.md): updates and deletes are refused at the database.
CREATE OR REPLACE FUNCTION nexus_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sie_decisions', 'reviews', 'agent_runs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION nexus_append_only()', t, t);
  END LOOP;
END $$;
