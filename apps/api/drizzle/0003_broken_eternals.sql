CREATE TABLE "evaluation_events" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"flag_key" text NOT NULL,
	"variation" text NOT NULL,
	"reason" text NOT NULL,
	"subject_hash" text,
	"latency_ms" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_events" ADD CONSTRAINT "evaluation_events_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_events" ADD CONSTRAINT "evaluation_events_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_event_environment_id_idx" ON "evaluation_events" USING btree ("environment_id","id");--> statement-breakpoint
CREATE INDEX "evaluation_event_project_time_idx" ON "evaluation_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "evaluation_event_time_idx" ON "evaluation_events" USING btree ("created_at");