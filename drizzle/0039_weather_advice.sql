CREATE TABLE "weather_advice" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"farm_id" text,
	"payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_weather_advice_tenant" ON "weather_advice" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_weather_advice_tenant_farm" ON "weather_advice" USING btree ("tenant_id","farm_id");
