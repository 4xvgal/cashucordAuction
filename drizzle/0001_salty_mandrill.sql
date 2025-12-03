ALTER TABLE "auctions" ADD COLUMN "is_privacy_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "winner_id" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "is_anonymous" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;