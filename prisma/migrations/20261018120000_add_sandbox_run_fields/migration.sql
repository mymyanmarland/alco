-- Add M5 sandbox execution fields
ALTER TABLE "sandbox_runs" ADD COLUMN "driver" TEXT;
ALTER TABLE "sandbox_runs" ADD COLUMN "snapshotRef" TEXT;
