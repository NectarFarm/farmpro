CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"data" text NOT NULL,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"captured_by" text,
	"captured_at" text,
	"created_at" timestamp DEFAULT now()
);
