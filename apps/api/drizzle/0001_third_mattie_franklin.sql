CREATE TABLE "scheduled_flag_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"flag_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"execute_at" timestamp with time zone NOT NULL,
	"base_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "scheduled_flag_changes" ADD CONSTRAINT "scheduled_flag_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_flag_changes" ADD CONSTRAINT "scheduled_flag_changes_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_flag_changes" ADD CONSTRAINT "scheduled_flag_changes_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_flag_changes" ADD CONSTRAINT "scheduled_flag_changes_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_flag_change_due_idx" ON "scheduled_flag_changes" USING btree ("status","execute_at");--> statement-breakpoint
CREATE INDEX "scheduled_flag_change_environment_idx" ON "scheduled_flag_changes" USING btree ("flag_id","environment_id","created_at");