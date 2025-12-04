import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { auctions, users, bids } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import moment from 'moment';
import { AppError, isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';
import { buildPublicBidMessage } from '../utils/privacy';
import { computeCollateral } from '../utils/collateral';

export const data = new SlashCommandBuilder()
    .setName('bid')
    .setDescription('Places a bid on an active auction (toggle anonymity per bid).')
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
    )
    .addBooleanOption(option =>
        option.setName('anonymous')
            .setDescription('Post this bid anonymously? Defaults to true.')
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    
    const auctionId = interaction.options.getInteger('auction_id', true);
    const bidAmount = BigInt(interaction.options.getInteger('amount', true));
    const bidderId = interaction.user.id;
    const anonymous = interaction.options.getBoolean('anonymous') ?? false;

    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);

    try {
        const result = await db.transaction(async (tx) => {
            const auction = await tx.query.auctions.findFirst({
                where: eq(auctions.id, auctionId),
                for: 'update',
            });

            if (!auction) {
                throw new AppError(t('bid.error.notFound', lang), 'AUCTION_NOT_FOUND');
            }
            if (auction.status !== 'ACTIVE') {
                throw new AppError(t('bid.error.inactive', lang), 'AUCTION_INACTIVE');
            }
            if (moment().isAfter(auction.endTime)) {
                throw new AppError(t('bid.error.ended', lang), 'AUCTION_ENDED');
            }
            if (bidAmount <= auction.currentPrice) {
                throw new AppError(t('bid.error.lowAmount', lang, { price: auction.currentPrice.toString() }));
            }
            if (auction.sellerId === bidderId) {
                throw new AppError(t('bid.error.selfBid', lang));
            }

            const bidder = await tx.query.users.findFirst({
                where: eq(users.id, bidderId),
                for: 'update',
            });

            const bidderBalance = bidder?.balance ?? 0n;
            const bidderLockedBalance = bidder?.lockedBalance ?? 0n;

            const previousBid = await tx.query.bids.findFirst({
                where: eq(bids.auctionId, auctionId),
                orderBy: [desc(bids.amount), desc(bids.timestamp)],
            });

            const requiredCollateral = computeCollateral(bidAmount, auction.collateralRatio);

            const refundableCollateral =
                previousBid && previousBid.bidderId === bidderId
                    ? computeCollateral(previousBid.amount, auction.collateralRatio)
                    : 0n;

            const effectiveBalance = bidderBalance + refundableCollateral;
            if (effectiveBalance < requiredCollateral) {
                throw new AppError(
                    t('bid.error.collateral', lang, { required: requiredCollateral.toString() }),
                    'INSUFFICIENT_FUNDS',
                );
            }

            if (previousBid && previousBid.bidderId !== bidderId) {
                const prevBidder = await tx.query.users.findFirst({
                    where: eq(users.id, previousBid.bidderId),
                    for: 'update',
                });
                if (prevBidder) {
                    const prevCollateral = computeCollateral(previousBid.amount, auction.collateralRatio);
                    await tx
                        .update(users)
                        .set({
                            lockedBalance:
                                prevBidder.lockedBalance > prevCollateral
                                    ? prevBidder.lockedBalance - prevCollateral
                                    : 0n,
                            balance: prevBidder.balance + prevCollateral,
                        })
                        .where(eq(users.id, previousBid.bidderId));
                }
            }

            const newLockedBalance = bidderLockedBalance - refundableCollateral + requiredCollateral;
            const newBalance = effectiveBalance - requiredCollateral;
            await tx
                .update(users)
                .set({ lockedBalance: newLockedBalance, balance: newBalance })
                .where(eq(users.id, bidderId));

            // 6. Insert new bid
            await tx.insert(bids).values({
                auctionId: auctionId,
                bidderId: bidderId,
                amount: bidAmount,
                isAnonymous: anonymous,
            });

            // 7. Anti-Snipe Logic
            let newEndTime = auction.endTime;
            if (auction.antiSnipeEnabled) {
                const antiSnipeThreshold = moment(auction.endTime).subtract(auction.antiSnipeTrigger, 'seconds');
                if (moment().isAfter(antiSnipeThreshold)) {
                    newEndTime = moment(auction.endTime).add(auction.antiSnipeExtension, 'seconds').toDate();
                }
            }

            // 8. Update auction price and potentially end time
            await tx.update(auctions).set({
                currentPrice: bidAmount,
                endTime: newEndTime,
            }).where(eq(auctions.id, auctionId));

            return { auction, newEndTime };
        }, { isolationLevel: 'serializable' });


        await interaction.editReply(t('bid.success.ephemeral', lang));

        const publicMessage = buildPublicBidMessage(
            result.auction,
            {
                title: result.auction.title,
                id: result.auction.id,
                amount: bidAmount,
                bidderId,
                endTime: result.newEndTime,
                isAnonymous: anonymous,
            },
            lang,
        );

        await interaction.followUp({ content: publicMessage, ephemeral: false });

        if (anonymous) {
            await interaction.followUp({ content: t('bid.privacyNotice', lang), ephemeral: true });
        }

    } catch (error: any) {
        console.error('Error placing bid:', error);
        const message = isAppError(error) ? error.message : t('errors.generic', lang);
        await interaction.editReply({ content: message, ephemeral: true });
    }
}
