-- Persist discount type/value on contracts and quotations (run once on PostgreSQL).
ALTER TABLE "Contract"
  ADD COLUMN IF NOT EXISTS "base_daily_rate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "discount_type" TEXT,
  ADD COLUMN IF NOT EXISTS "discount_value" DOUBLE PRECISION;

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "base_daily_rate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "discount_type" TEXT,
  ADD COLUMN IF NOT EXISTS "discount_value" DOUBLE PRECISION;
