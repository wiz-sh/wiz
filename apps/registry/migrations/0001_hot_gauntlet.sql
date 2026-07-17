ALTER TABLE "webhooks" ADD COLUMN "secret_encrypted" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;