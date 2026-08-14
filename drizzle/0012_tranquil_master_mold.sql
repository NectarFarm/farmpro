CREATE TABLE "tenant_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'dark-farm' NOT NULL,
	"font_size" text DEFAULT 'normal' NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"sound_alerts_enabled" boolean DEFAULT false NOT NULL,
	"offline_mode_enabled" boolean DEFAULT true NOT NULL,
	"accent_color" text DEFAULT '#4ade80' NOT NULL,
	"logo_emoji" text DEFAULT '🌾' NOT NULL,
	"dashboard_greeting" text DEFAULT 'Good morning!' NOT NULL,
	"currency_symbol" text DEFAULT 'KSh' NOT NULL,
	"weight_unit" text DEFAULT 'kg' NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
