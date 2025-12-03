import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { offers, auctions, users } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { isRootAdmin } from '../utils/permissions';
import { auctionService } from '../services/AuctionService';

export const data = new SlashCommandBuilder()
  .setName('offer')
  .setDescription('Submit or manage direct offers.')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Send a direct purchase offer.')
      .addIntegerOption(option =>
        option.setName('auction_id').setDescription('Auction ID').setRequired(true),
      )
      .addIntegerOption(option =>
        option.setName('amount').setDescription('Offer amount in sats').setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('accept')
      .setDescription('Accept a pending offer (seller or admin).')
      .addIntegerOption(option =>
        option.setName('offer_id').setDescription('Offer ID').setRequired(true),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('decline')
      .setDescription('Decline a pending offer (seller or admin).')
      .addIntegerOption(option =>
        option.setName('offer_id').setDescription('Offer ID').setRequired(true),
      ),
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') {
    await handleCreate(interaction);
  } else if (subcommand === 'accept') {
    await handleAccept(interaction);
  } else if (subcommand === 'decline') {
    await handleDecline(interaction);
  }
}

async function handleCreate(interaction: CommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const auctionId = interaction.options.getInteger('auction_id', true);
  const amount = BigInt(interaction.options.getInteger('amount', true));

  const auction = await db.query.auctions.findFirst({ where: eq(auctions.id, auctionId) });
  if (!auction || auction.status !== 'ACTIVE') {
    await interaction.editReply('Auction not found or not active.');
    return;
  }

  await db.insert(offers).values({
    auctionId,
    proposerId: interaction.user.id,
    amount,
  });

  await interaction.editReply('Offer submitted. The seller will review it soon.');
}

async function handleAccept(interaction: CommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const offerId = interaction.options.getInteger('offer_id', true);

  try {
    const result = await db.transaction(async (tx) => {
      const offerRecord = await tx.query.offers.findFirst({
        where: eq(offers.id, offerId),
      });

      if (!offerRecord) throw new Error('Offer not found.');
      if (offerRecord.status !== 'PENDING') throw new Error('Offer already processed.');

      const auctionRecord = await tx.query.auctions.findFirst({
        where: eq(auctions.id, offerRecord.auctionId),
        for: 'update',
      });
      if (!auctionRecord || auctionRecord.status !== 'ACTIVE') {
        throw new Error('Auction not active.');
      }

      if (
        auctionRecord.sellerId !== interaction.user.id &&
        !isRootAdmin(interaction.user.id)
      ) {
        throw new Error('Only the seller or an admin can accept offers.');
      }

      const proposer = await tx.query.users.findFirst({
        where: eq(users.id, offerRecord.proposerId),
        for: 'update',
      });
      if (!proposer || proposer.balance! < offerRecord.amount) {
        throw new Error('Buyer has insufficient balance.');
      }

      const seller = await tx.query.users.findFirst({
        where: eq(users.id, auctionRecord.sellerId),
        for: 'update',
      });
      if (!seller) {
        await tx.insert(users).values({ id: auctionRecord.sellerId }).onConflictDoNothing();
      }

      const buyerBalanceAfter = proposer.balance! - offerRecord.amount;
      await tx.update(users)
        .set({ balance: buyerBalanceAfter })
        .where(eq(users.id, proposer.id));

      const sellerRow = await tx.query.users.findFirst({
        where: eq(users.id, auctionRecord.sellerId),
        for: 'update',
      });
      const sellerBalance = sellerRow?.balance ?? 0n;
      const sellerBalanceAfter = sellerBalance + offerRecord.amount;
      await tx.update(users)
        .set({ balance: sellerBalanceAfter })
        .where(eq(users.id, auctionRecord.sellerId));

      await tx.update(offers)
        .set({ status: 'ACCEPTED' })
        .where(eq(offers.id, offerId));

      const [updatedAuction] = await tx.update(auctions)
        .set({
          status: 'ENDED',
          currentPrice: offerRecord.amount,
          finalPrice: offerRecord.amount,
          winnerId: offerRecord.proposerId,
        })
        .where(eq(auctions.id, auctionRecord.id))
        .returning();

      await tx.update(offers)
        .set({ status: 'DECLINED' })
        .where(and(eq(offers.auctionId, auctionRecord.id), eq(offers.status, 'PENDING')));

      return {
        auction: updatedAuction,
        amount: offerRecord.amount,
        winner: offerRecord.proposerId,
        buyerBalance: buyerBalanceAfter,
        sellerBalance: sellerBalanceAfter,
      };
    });

    await auctionService.announceConclusion({
      status: 'ENDED',
      auction: result.auction,
      winnerId: result.winner,
      bidAmount: result.amount,
      depositAmount: result.amount,
      winnerIsAnonymous: false,
      buyerBalance: result.buyerBalance,
      sellerBalance: result.sellerBalance,
    });

    await interaction.editReply('Offer accepted. Auction closed.');
  } catch (error: any) {
    await interaction.editReply(`Could not accept offer: ${error.message}`);
  }
}

async function handleDecline(interaction: CommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const offerId = interaction.options.getInteger('offer_id', true);

  const offerRecord = await db.query.offers.findFirst({ where: eq(offers.id, offerId) });
  if (!offerRecord) {
    await interaction.editReply('Offer not found.');
    return;
  }

  const auctionRecord = await db.query.auctions.findFirst({ where: eq(auctions.id, offerRecord.auctionId) });
  if (
    auctionRecord?.sellerId !== interaction.user.id &&
    !isRootAdmin(interaction.user.id)
  ) {
    await interaction.editReply('Only the seller or an admin can decline offers.');
    return;
  }

  await db.update(offers)
    .set({ status: 'DECLINED' })
    .where(eq(offers.id, offerId));

  await interaction.editReply('Offer declined.');
}
