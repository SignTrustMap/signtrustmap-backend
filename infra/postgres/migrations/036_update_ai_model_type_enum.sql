-- Migration: 036_update_ai_model_type_enum.sql
-- Description: Standardize ai_model_type enum with YOLO26 and TRACKER, migrate legacy YOLO12 and BOTSORT

ALTER TYPE ai_model_type ADD VALUE IF NOT EXISTS 'YOLO26';
ALTER TYPE ai_model_type ADD VALUE IF NOT EXISTS 'TRACKER';

UPDATE model_training_jobs SET model_type = 'YOLO26' WHERE model_type = 'YOLO12';
UPDATE model_training_jobs SET model_type = 'TRACKER' WHERE model_type = 'BOTSORT';
UPDATE ai_model_versions SET model_type = 'YOLO26' WHERE model_type = 'YOLO12';
UPDATE ai_model_versions SET model_type = 'TRACKER' WHERE model_type = 'BOTSORT';
