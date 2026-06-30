-- Add effectiveTli, tli, loadBand to User (missing migration)
-- LoadBand enum was in schema but never got a migration
DO $$ BEGIN
  CREATE TYPE "LoadBand" AS ENUM ('GREEN', 'AMBER', 'RED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "effectiveTli" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tli"           DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loadBand"      "LoadBand" NOT NULL DEFAULT 'GREEN';
