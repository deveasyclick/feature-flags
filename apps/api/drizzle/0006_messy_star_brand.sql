CREATE TABLE "flag_rollback_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"flag_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"created_by" text NOT NULL,
	"current_version" integer NOT NULL,
	"target_version" integer NOT NULL,
	"error_percentage" double precision NOT NULL,
	"minimum_samples" integer NOT NULL,
	"window_minutes" integer NOT NULL,
	"status" text DEFAULT 'armed' NOT NULL,
	"armed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"user_id" text NOT NULL,
	"audit_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_user_id_audit_id_pk" PRIMARY KEY("user_id","audit_id")
);
--> statement-breakpoint
ALTER TABLE "evaluation_events" ADD COLUMN "kind" text DEFAULT 'evaluation' NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_events" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "evaluation_events" ADD COLUMN "flag_version" integer;--> statement-breakpoint
ALTER TABLE "flag_rollback_policies" ADD CONSTRAINT "flag_rollback_policies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_rollback_policies" ADD CONSTRAINT "flag_rollback_policies_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_rollback_policies" ADD CONSTRAINT "flag_rollback_policies_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_rollback_policies" ADD CONSTRAINT "flag_rollback_policies_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_audit_id_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flag_rollback_due_idx" ON "flag_rollback_policies" USING btree ("status","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flag_rollback_armed_idx" ON "flag_rollback_policies" USING btree ("flag_id","environment_id") WHERE "flag_rollback_policies"."status" = 'armed';