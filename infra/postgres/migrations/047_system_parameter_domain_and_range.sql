-- 047_system_parameter_domain_and_range.sql
-- Add domain and range columns to system_parameters for administrative input guidance

BEGIN;

-- 1. Add domain, domain_label, and range columns to system_parameters table
ALTER TABLE system_parameters ADD COLUMN IF NOT EXISTS domain VARCHAR(50);
ALTER TABLE system_parameters ADD COLUMN IF NOT EXISTS domain_label VARCHAR(100);
ALTER TABLE system_parameters ADD COLUMN IF NOT EXISTS range VARCHAR(150);

-- 2. Populate domain and domain_label based on category
UPDATE system_parameters
SET domain = category::text
WHERE domain IS NULL;

UPDATE system_parameters
SET domain_label = CASE category::text
  WHEN 'CONSENSUS' THEN 'Consensus & Voting'
  WHEN 'REVIEWER' THEN 'Reviewer & Quests'
  WHEN 'REVALIDATION' THEN 'Revalidation & Lifecycles'
  WHEN 'HAZARDS' THEN 'Hazards & Traffic Warnings'
  WHEN 'NAVIGATION' THEN 'Navigation & Routing'
  WHEN 'ECONOMY' THEN 'Economy & Missions'
  WHEN 'INGESTION' THEN 'Ingestion & Surveyor'
  WHEN 'AIOPS' THEN 'AI Operations & Models'
  WHEN 'SECURITY' THEN 'Security & Access'
  WHEN 'INFRASTRUCTURE' THEN 'Infrastructure & System'
  ELSE category::text
END
WHERE domain_label IS NULL;

-- 3. Populate range based on data_type and validation_rules
UPDATE system_parameters
SET range = CASE
  WHEN data_type::text = 'BOOLEAN' THEN 'true - false'
  WHEN validation_rules ? 'allowedValues' AND jsonb_array_length(validation_rules->'allowedValues') > 0 THEN
    (SELECT string_agg(elem::text, ', ') FROM jsonb_array_elements_text(validation_rules->'allowedValues') AS elem)
  WHEN (data_type::text IN ('INTEGER', 'NUMBER', 'PERCENTAGE')) AND (validation_rules ? 'min') AND (validation_rules ? 'max') THEN
    CONCAT((validation_rules->>'min'), ' - ', (validation_rules->>'max'))
  WHEN (data_type::text IN ('INTEGER', 'NUMBER', 'PERCENTAGE')) AND (validation_rules ? 'min') THEN
    CONCAT('>= ', (validation_rules->>'min'))
  WHEN (data_type::text IN ('INTEGER', 'NUMBER', 'PERCENTAGE')) AND (validation_rules ? 'max') THEN
    CONCAT('<= ', (validation_rules->>'max'))
  WHEN data_type::text = 'PERCENTAGE' THEN '0 - 100'
  WHEN data_type::text = 'INTEGER' THEN 'Any integer'
  WHEN data_type::text = 'NUMBER' THEN 'Any number'
  WHEN data_type::text = 'DURATION' THEN 'Format: [number][s|m|h|d] (e.g. 15m, 1h, 7d)'
  WHEN data_type::text = 'JSON' THEN 'Valid JSON object'
  WHEN validation_rules ? 'pattern' THEN
    CASE
      WHEN validation_rules->>'pattern' = '^[0-9]+[smhd]$' THEN 'Format: [number][s|m|h|d] (e.g. 15m, 1h, 7d)'
      ELSE CONCAT('Pattern: ', validation_rules->>'pattern')
    END
  ELSE 'Any string'
END
WHERE range IS NULL OR range = '';

COMMIT;
