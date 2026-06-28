CREATE TABLE "observations" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"unit_id" text,
	"water_level" text,
	"water_colour" text,
	"temp_c" double precision,
	"do_mgl" double precision,
	"ph" double precision,
	"ammonia" double precision,
	"abnormal" boolean DEFAULT false NOT NULL,
	"abnormal_note" text,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_counts" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"unit_id" text,
	"system_count" integer NOT NULL,
	"physical_count" integer NOT NULL,
	"variance" integer NOT NULL,
	"reason" text,
	"notes" text,
	"reconciled" boolean DEFAULT false NOT NULL,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_samples" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"sample_size" integer,
	"avg_weight_kg" double precision NOT NULL,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
