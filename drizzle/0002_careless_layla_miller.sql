CREATE TYPE "public"."auction_mode" AS ENUM('ENGLISH', 'VICKREY');--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"auction_id" integer NOT NULL,
	"proposer_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "mode" "auction_mode" DEFAULT 'ENGLISH' NOT NULL;--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "final_price" bigint;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;