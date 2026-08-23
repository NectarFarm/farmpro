ALTER TABLE "tasks" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "approver_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_until" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_parent_id" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "assigned_approver_id" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "decided_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_tasks_assignee" ON "tasks" USING btree ("tenant_id","assignee_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_approver" ON "tasks" USING btree ("tenant_id","approver_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_approver" ON "approval_requests" USING btree ("tenant_id","assigned_approver_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_decided_by" ON "approval_requests" USING btree ("tenant_id","decided_by");