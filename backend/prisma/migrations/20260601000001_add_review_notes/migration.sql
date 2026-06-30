-- Add notes column to Review table for persistent reviewer feedback storage
ALTER TABLE "Review" ADD COLUMN "notes" TEXT;
