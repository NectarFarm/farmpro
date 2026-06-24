CREATE TABLE "overheads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"label" text NOT NULL,
	"amount" double precision NOT NULL,
	"driver" text DEFAULT 'population' NOT NULL
);
