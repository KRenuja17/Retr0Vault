-- Accounts: users, their sessions, and an owner for every reference and
-- collection. Existing rows stay unowned (visible to no account) until an
-- account adopts them (`npm run users -- create <name> --adopt-unowned`).
-- Collection slugs become unique per account.
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_check" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"username_key" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_check" CHECK ("users"."username" ~ '^[A-Za-z0-9._-]{3,32}$'),
	CONSTRAINT "users_username_key_check" CHECK ("users"."username_key" = lower("users"."username")),
	CONSTRAINT "users_password_hash_check" CHECK ("users"."password_hash" like 'scrypt$%')
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "collections_slug_unique";--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "references" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_index" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key_unique" ON "users" USING btree ("username_key");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_owner_slug_unique" ON "collections" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "collections_owner_index" ON "collections" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "references_owner_index" ON "references" USING btree ("owner_id");