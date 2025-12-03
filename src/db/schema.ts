import {
  pgTable,
  text,
  bigint,
  timestamp,
  serial,
  integer,
  boolean,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enum for Auction Status
export const auctionStatusEnum = pgEnum('auction_status', ['ACTIVE', 'ENDED', 'CANCELLED']);

// Users Table
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Discord User ID
  balance: bigint('balance', { mode: 'bigint' }).notNull().default(0n),
  lockedBalance: bigint('locked_balance', { mode: 'bigint' }).notNull().default(0n),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
	auctions: many(auctions),
    bids: many(bids),
}));


// Treasury Proofs Table
export const proofs = pgTable('proofs', {
  id: serial('id').primaryKey(),
  amount: integer('amount').notNull(),
  secret: text('secret').notNull(), // Encrypted secret
  C: text('C').notNull(),
  id_set: text('id_set').notNull(),
  mint_url: text('mint_url').notNull(),
  isReserved: boolean('is_reserved').notNull().default(false),
  rawProof: jsonb('raw_proof').notNull(),
});

// Auctions Table
export const auctions = pgTable('auctions', {
  id: serial('id').primaryKey(),
  sellerId: text('seller_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  startPrice: bigint('start_price', { mode: 'bigint' }).notNull(),
  currentPrice: bigint('current_price', { mode: 'bigint' }).notNull(),
  collateralRatio: integer('collateral_ratio').notNull().default(20), // Represents 20%
  endTime: timestamp('end_time').notNull(),
  status: auctionStatusEnum('status').notNull().default('ACTIVE'),
  antiSnipeTrigger: integer('anti_snipe_trigger').notNull().default(60), // 60 seconds
  antiSnipeExtension: integer('anti_snipe_extension').notNull().default(60), // 60 seconds
  isPrivacyMode: boolean('is_privacy_mode').notNull().default(false),
  winnerId: text('winner_id').references(() => users.id),
});

export const auctionsRelations = relations(auctions, ({ one, many }) => ({
	seller: one(users, {
		fields: [auctions.sellerId],
		references: [users.id],
	}),
	bids: many(bids),
}));


// Bids Table
export const bids = pgTable('bids', {
  id: serial('id').primaryKey(),
  auctionId: integer('auction_id').notNull().references(() => auctions.id),
  bidderId: text('bidder_id').notNull().references(() => users.id),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  isAnonymous: boolean('is_anonymous').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bidsRelations = relations(bids, ({ one }) => ({
	auction: one(auctions, {
		fields: [bids.auctionId],
		references: [auctions.id],
	}),
	bidder: one(users, {
		fields: [bids.bidderId],
		references: [users.id],
	}),
}));
