ALTER TABLE "shops" ADD COLUMN "draft_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "preview_token" text;