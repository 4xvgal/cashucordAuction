import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { auctions, users, bids } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import moment from 'moment';
import { AppError, isAppError } from '../utils/errors';

export const data = new SlashCommandBuilder()
    .setName('bid')
    .setDescription('Places a bid on an active auction.')
    .addIntegerOption(option =>
        option.setName('auction_id')
            .setDescription('The ID of the auction to bid on.')
            .setRequired(true)
    )
    .addIntegerOption(option =>
        option.setName('amount')
            .setDescription('The amount in satoshis you want to bid.')
            .setRequired(true)
            .setMinValue(1)
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    
    const auctionId = interaction.options.getInteger('auction_id', true);
    const bidAmount = BigInt(interaction.options.getInteger('amount', true));
    const bidderId = interaction.user.id;

    await interaction.deferReply();

    try {
        const result = await db.transaction(async (tx) => {
            // 1. Get auction and lock it
            const auction = await tx.query.auctions.findFirst({
                where: eq(auctions.id, auctionId),
                for: 'update',
            });

            if (!auction) { throw new AppError('Auction not found.', 'AUCTION_NOT_FOUND'); }
            if (auction.status !== 'ACTIVE') { throw new AppError('This auction is not active.', 'AUCTION_INACTIVE'); }
            if (moment().isAfter(auction.endTime)) { throw new AppError('This auction has already ended.', 'AUCTION_ENDED'); }
            if (bidAmount <= auction.currentPrice) { throw new AppError(`Your bid must be higher than the current price of ${auction.currentPrice} sats.`); }
            if (auction.sellerId === bidderId) { throw new AppError('You cannot bid on your own auction.'); }

            // 2. Get bidder and lock them
            const bidder = await tx.query.users.findFirst({
                where: eq(users.id, bidderId),
                for: 'update',
            });
            
            const bidderBalance = bidder?.balance ?? 0n;
            const bidderLockedBalance = bidder?.lockedBalance ?? 0n;

            // 3. Collateral Check
            const requiredCollateral = (bidAmount * BigInt(auction.collateralRatio)) / 100n;
            const availableBalance = bidderBalance - bidderLockedBalance;

            if (availableBalance < requiredCollateral) {
                throw new AppError(`Insufficient collateral. You need at least ${requiredCollateral} sats available (Balance - Locked) to place this bid.`, 'INSUFFICIENT_FUNDS');
            }

            // 4. Find previous top bidder to release their collateral
            const previousBid = await tx.query.bids.findFirst({
                where: eq(bids.auctionId, auctionId),
                orderBy: [desc(bids.amount)],
            });

            let newLockedBalance = bidderLockedBalance;

            if (previousBid && previousBid.bidderId !== bidderId) {
                // Release previous bidder's collateral
                const prevBidder = await tx.query.users.findFirst({ where: eq(users.id, previousBid.bidderId), for: 'update' });
                if (prevBidder) {
                    const prevCollateral = (previousBid.amount * BigInt(auction.collateralRatio)) / 100n;
                    await tx.update(users)
                        .set({ lockedBalance: prevBidder.lockedBalance - prevCollateral })
                        .where(eq(users.id, previousBid.bidderId));
                }
            }
            
            // If the current bidder was the previous top bidder, their old collateral needs to be "refunded" before the new one is locked
            if (previousBid && previousBid.bidderId === bidderId) {
                const prevCollateral = (previousBid.amount * BigInt(auction.collateralRatio)) / 100n;
                newLockedBalance -= prevCollateral;
            }

            // 5. Lock new collateral for the current bidder
            newLockedBalance += requiredCollateral;
            await tx.update(users).set({ lockedBalance: newLockedBalance }).where(eq(users.id, bidderId));

            // 6. Insert new bid
            await tx.insert(bids).values({
                auctionId: auctionId,
                bidderId: bidderId,
                amount: bidAmount,
            });

            // 7. Anti-Snipe Logic
            let newEndTime = auction.endTime;
            const antiSnipeThreshold = moment(auction.endTime).subtract(auction.antiSnipeTrigger, 'seconds');
            if (moment().isAfter(antiSnipeThreshold)) {
                newEndTime = moment(auction.endTime).add(auction.antiSnipeExtension, 'seconds').toDate();
            }

            // 8. Update auction price and potentially end time
            await tx.update(auctions).set({
                currentPrice: bidAmount,
                endTime: newEndTime,
            }).where(eq(auctions.id, auctionId));

            return { auction, newEndTime };
        }, { isolationLevel: 'serializable' });


        await interaction.editReply(
            `🚀 **New Highest Bid!**\n\n` +
            `**Auction:** ${result.auction.title} (#${result.auction.id})\n` +
            `**New Price:** ${bidAmount} sats\n` +
            `**Bidder:** <@${bidderId}>\n\n` +
            (result.newEndTime !== result.auction.endTime ? `**ANTI-SNIPE!** Auction extended! New end time: <t:${Math.floor(result.newEndTime.getTime() / 1000)}:R>` : `**Ends:** <t:${Math.floor(result.newEndTime.getTime() / 1000)}:R>`)
        );

    } catch (error: any) {
        console.error('Error placing bid:', error);
        const message = isAppError(error) ? error.message : `Could not place your bid. **Error:** ${error.message}`;
        await interaction.editReply(message);
    }
}
