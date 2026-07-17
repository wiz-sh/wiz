ALTER TABLE "packages" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "quarantine_reason" text;