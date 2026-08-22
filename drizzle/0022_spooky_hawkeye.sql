CREATE TABLE "notification_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "role" text;--> statement-breakpoint
CREATE INDEX "idx_notification_reads_notification" ON "notification_reads" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "idx_notification_reads_user" ON "notification_reads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_notification_reads_unique" ON "notification_reads" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id");