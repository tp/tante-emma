-- Order status rework: pg enum `order_status` → plain text with a CHECK
-- constraint (lifecycle: pending_payment | paid | ready). Hand-hardened after
-- `db:generate`, which doesn't emit the cast/normalize steps:
--   1. drop the old enum-typed default (else the type change fails)
--   2. convert the column to text with an explicit cast
--   3. normalise legacy values (e.g. 'placed') BEFORE adding the CHECK, or the
--      constraint would reject the existing row
--   4. set the new default, add the CHECK, drop the now-unused enum type
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
UPDATE "orders" SET "status" = 'pending_payment' WHERE "status" NOT IN ('pending_payment', 'paid', 'ready');--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending_payment';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("status" IN ('pending_payment', 'paid', 'ready'));--> statement-breakpoint
DROP TYPE "public"."order_status";
