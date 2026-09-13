CREATE TABLE "leaderboard_entries" (
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"user_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_entries_period_metric_user_id_pk" PRIMARY KEY("period","metric","user_id")
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"placement" integer NOT NULL,
	"won" boolean NOT NULL,
	"participated" boolean NOT NULL,
	"points" integer NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "match_players_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"mode" text,
	"player_count" integer NOT NULL,
	"registered_count" integer NOT NULL,
	"ranked" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"games_won" integer DEFAULT 0 NOT NULL,
	"guess_games" integer DEFAULT 0 NOT NULL,
	"guess_wins" integer DEFAULT 0 NOT NULL,
	"draw_games" integer DEFAULT 0 NOT NULL,
	"draw_wins" integer DEFAULT 0 NOT NULL,
	"rounds_played" integer DEFAULT 0 NOT NULL,
	"rounds_won" integer DEFAULT 0 NOT NULL,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"wrong_answers" integer DEFAULT 0 NOT NULL,
	"missed_answers" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"correct_ms_total" bigint DEFAULT 0 NOT NULL,
	"guess_points" bigint DEFAULT 0 NOT NULL,
	"draw_score" bigint DEFAULT 0 NOT NULL,
	"draw_best_score" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaderboard_period_metric_value_idx" ON "leaderboard_entries" USING btree ("period","metric","value" DESC NULLS LAST,"updated_at");--> statement-breakpoint
CREATE INDEX "leaderboard_user_idx" ON "leaderboard_entries" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "match_players_user_id_idx" ON "match_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "matches_ended_at_idx" ON "matches" USING btree ("ended_at");