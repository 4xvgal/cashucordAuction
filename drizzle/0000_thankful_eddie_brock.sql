CREATE TYPE "public"."auction_status" AS ENUM('ACTIVE', 'ENDED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"title" text NOT NULL,
	"start_price" bigint NOT NULL,
	"current_price" bigint NOT NULL,
	"collateral_ratio" integer DEFAULT 20 NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" "auction_status" DEFAULT 'ACTIVE' NOT NULL,
	"anti_snipe_trigger" integer DEFAULT 60 NOT NULL,
	"anti_snipe_extension" integer DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"auction_id" integer NOT NULL,
	"bidder_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proofs" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" integer NOT NULL,
	"secret" text NOT NULL,
	"C" text NOT NULL,
	"id_set" text NOT NULL,
	"mint_url" text NOT NULL,
	"is_reserved" boolean DEFAULT false NOT NULL,
	"raw_proof" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"locked_balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;