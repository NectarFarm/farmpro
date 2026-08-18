ALTER TABLE "tasks" ADD COLUMN "approver_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_by_task_id" text;