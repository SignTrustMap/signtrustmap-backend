-- Upgrade SignTrustMap database: add REJECTED to submission_status enum
ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'REJECTED';
