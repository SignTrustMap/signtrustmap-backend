-- =============================================================================
-- 007_seed_allowed_vehicles.sql
-- Populates `traffic_sign_types.allowed_vehicles` from the authoritative
-- ID<->vehicle-group mapping (Task 3 of AI_Agent_Routing_Implementation_Guide).
--
-- Groups (empty = strictly prohibited for every vehicle):
--   A: id 3,31,32,33,34,45,46,109                       -> []
--   B: id 23,24,25,91                                  -> [MOTORCYCLE,BICYCLE,PEDESTRIAN]
--   C: id 26                                           -> [CAR,TRUCK,BUS,BICYCLE,PEDESTRIAN]
--   D: id 27,28                                        -> [CAR,MOTORCYCLE,BUS,BICYCLE,PEDESTRIAN]
--   E: id 80                                           -> [CAR,TRUCK,BUS,PEDESTRIAN]
--   F: id 82                                           -> [CAR,MOTORCYCLE,BICYCLE,PEDESTRIAN]
--   G: id 66,74                                        -> [CAR,MOTORCYCLE,TRUCK,BUS]
--   H: id 106,107                                      -> [CAR,TRUCK,BUS]
--   I: id 29                                           -> [CAR,MOTORCYCLE,TRUCK,BUS,BICYCLE]
--   J: every other sign type                           -> all six vehicle types
--
-- Idempotent UPDATEs: re-running yields identical results.
-- =============================================================================
WITH mapping AS (
  SELECT id, allowed_vehicles FROM (VALUES
    (3,   '{}'::text[]),
    (31,  '{}'::text[]),
    (32,  '{}'::text[]),
    (33,  '{}'::text[]),
    (34,  '{}'::text[]),
    (45,  '{}'::text[]),
    (46,  '{}'::text[]),
    (109, '{}'::text[]),
    (23,  ARRAY['MOTORCYCLE','BICYCLE','PEDESTRIAN']::text[]),
    (24,  ARRAY['MOTORCYCLE','BICYCLE','PEDESTRIAN']::text[]),
    (25,  ARRAY['MOTORCYCLE','BICYCLE','PEDESTRIAN']::text[]),
    (91,  ARRAY['MOTORCYCLE','BICYCLE','PEDESTRIAN']::text[]),
    (26,  ARRAY['CAR','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[]),
    (27,  ARRAY['CAR','MOTORCYCLE','BUS','BICYCLE','PEDESTRIAN']::text[]),
    (28,  ARRAY['CAR','MOTORCYCLE','BUS','BICYCLE','PEDESTRIAN']::text[]),
    (80,  ARRAY['CAR','TRUCK','BUS','PEDESTRIAN']::text[]),
    (82,  ARRAY['CAR','MOTORCYCLE','BICYCLE','PEDESTRIAN']::text[]),
    (66,  ARRAY['CAR','MOTORCYCLE','TRUCK','BUS']::text[]),
    (74,  ARRAY['CAR','MOTORCYCLE','TRUCK','BUS']::text[]),
    (106, ARRAY['CAR','TRUCK','BUS']::text[]),
    (107, ARRAY['CAR','TRUCK','BUS']::text[]),
    (29,  ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE']::text[])
  ) AS m(id, allowed_vehicles)
)
UPDATE "traffic_sign_types" sign_type
SET    "allowed_vehicles" = mapping.allowed_vehicles,
       "updated_at" = now()
FROM   mapping
WHERE  sign_type."id" = mapping.id;

-- Group J: every sign type not listed above is allowed for all six vehicles.
UPDATE "traffic_sign_types" sign_type
SET    "allowed_vehicles" =
         ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[],
       "updated_at" = now()
WHERE  sign_type."id" NOT IN (
  3, 31, 32, 33, 34, 45, 46, 109,
  23, 24, 25, 91,
  26, 27, 28, 29, 66, 74, 80, 82, 106, 107
);