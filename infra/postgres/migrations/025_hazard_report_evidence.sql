-- Extend the existing roadside hazard reporting workflow with map-report metadata and evidence.
ALTER TABLE road_hazard_events ADD COLUMN IF NOT EXISTS title varchar(160);
ALTER TABLE road_hazard_events ADD COLUMN IF NOT EXISTS severity varchar(16);

CREATE TABLE IF NOT EXISTS hazard_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id uuid NOT NULL REFERENCES road_hazard_events(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  media_type varchar(16) NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  file_url varchar(500) NOT NULL,
  storage_key varchar(500) NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  content_type varchar(128),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hazard_evidence_hazard_id ON hazard_evidence(hazard_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hazard_evidence_storage_key
  ON hazard_evidence(hazard_id, storage_key);
