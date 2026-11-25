-- Add nullable address column to users table
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "address" varchar(500);
