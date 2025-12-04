ALTER TABLE "auctions" ADD COLUMN "notify_new_bids" boolean DEFAULT false NOT NULL;
ALTER TABLE "auctions" ADD COLUMN "notify_channel_id" text;
