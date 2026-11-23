-- =============================================================================
-- 035_remove_unapproved_system_parameters.sql
-- Removes accidental / unapproved parameter variables from system_parameters
-- (e.g. MISSIONS_STREAK_BONUS_CREDITS and Vu_A_Vu) to enforce strict schema.
-- =============================================================================

BEGIN;

DELETE FROM system_parameters
WHERE key IN ('MISSIONS_STREAK_BONUS_CREDITS', 'Vu_A_Vu');

COMMIT;
