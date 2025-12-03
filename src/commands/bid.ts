import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { auctions, users, bids } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import moment from 'moment';
import { AppError, isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';

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
    const lang = getInteractionLanguage(interaction);

    try {
        const result = await db.transaction(async (tx) => {
            // 1. Get auction and lock it
            const auction = await tx.query.auctions.findFirst({
                where: eq(auctions.id, auctionId),
                for: 'update',
            });

            if (!auction) { throw new AppError(t('bid.error.notFound', lang), 'AUCTION_NOT_FOUND'); }
            if (auction.status !== 'ACTIVE') { throw new AppError(t('bid.error.inactive', lang), 'AUCTION_INACTIVE'); }
            if (moment().isAfter(auction.endTime)) { throw new AppError(t('bid.error.ended', lang), 'AUCTION_ENDED'); }
            if (bidAmount <= auction.currentPrice) { throw new AppError(t('bid.error.lowAmount', lang, { price: auction.currentPrice.toString() })); }
            if (auction.sellerId === bidderId) { throw new AppError(t('bid.error.selfBid', lang)); }

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
                throw new AppError(t('bid.error.collateral', lang, { required: requiredCollateral.toString() }), 'INSUFFICIENT_FUNDS');
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


        const endNote = result.newEndTime !== result.auction.endTime
            ? t('bid.endNote.extended', lang, { timestamp: Math.floor(result.newEndTime.getTime() / 1000).toString() })
            : t('bid.endNote.normal', lang, { timestamp: Math.floor(result.newEndTime.getTime() / 1000).toString() });

        await interaction.editReply(
            t('bid.success', lang, {
                title: result.auction.title,
                id: result.auction.id.toString(),
                amount: bidAmount.toString(),
                bidder: bidderId,
                endNote,
            }),
        );

    } catch (error: any) {
        console.error('Error placing bid:', error);
        const message = isAppError(error) ? error.message : t('errors.generic', lang);
        await interaction.editReply(message);
    }
}
