import { SlashCommandBuilder, CommandInteraction, TextBasedChannel } from 'discord.js';
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
    )
    .addBooleanOption(option =>
        option.setName('vickrey_notify')
            .setDescription('For Vickrey auctions only: send an anonymous channel update for this bid.')
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    
    const auctionId = interaction.options.getInteger('auction_id', true);
    const bidAmount = BigInt(interaction.options.getInteger('amount', true));
    const bidderId = interaction.user.id;
    const anonymous = interaction.options.getBoolean('anonymous') ?? false;
    const notifyOverride = interaction.options.getBoolean('vickrey_notify');

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
            const isVickreyAuction = auction.auctionMode === 'VICKREY';

            if (!isVickreyAuction && bidAmount <= auction.currentPrice) {
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

            let requiredCollateral = computeCollateral(bidAmount, auction.collateralRatio);
            let refundableCollateral = 0n;
            if (previousBid && previousBid.bidderId === bidderId) {
                const previousCollateral = computeCollateral(previousBid.amount, auction.collateralRatio);
                if (bidAmount > previousBid.amount) {
                    refundableCollateral = previousCollateral;
                } else {
                    requiredCollateral = 0n;
                }
            }

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
            if (!isVickreyAuction && auction.antiSnipeEnabled) {
                const antiSnipeThreshold = moment(auction.endTime).subtract(auction.antiSnipeTrigger, 'seconds');
                if (moment().isAfter(antiSnipeThreshold)) {
                    newEndTime = moment(auction.endTime).add(auction.antiSnipeExtension, 'seconds').toDate();
                }
            }

            // 8. Update auction price and potentially end time
            const nextCurrentPrice = isVickreyAuction
                ? (bidAmount > auction.currentPrice ? bidAmount : auction.currentPrice)
                : bidAmount;

            await tx.update(auctions).set({
                currentPrice: nextCurrentPrice,
                endTime: newEndTime,
            }).where(eq(auctions.id, auctionId));

            return { auction, newEndTime };
        }, { isolationLevel: 'serializable' });


        const isVickrey = result.auction.auctionMode === 'VICKREY';
        const shouldNotify = isVickrey
            ? (notifyOverride ?? !!result.auction.notifyNewBids)
            : true;
        const successKey = isVickrey
            ? shouldNotify ? 'bid.success.vickreyNotify' : 'bid.success.vickreySilent'
            : 'bid.success.ephemeral';
        await interaction.editReply(t(successKey, lang));

        const targetChannel = await resolveNotificationChannel(interaction, result.auction.notifyChannelId);
        if (isVickrey) {
            if (shouldNotify && targetChannel) {
                await targetChannel.send(
                    t('auction.vickrey.newBid', lang, {
                        id: result.auction.id.toString(),
                        title: result.auction.title,
                    }),
                );
            }
        } else {
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
            if (targetChannel) {
                await targetChannel.send(publicMessage);
            } else {
                await interaction.followUp({ content: publicMessage, ephemeral: false });
            }
        }

        if (anonymous) {
            await interaction.followUp({ content: t('bid.privacyNotice', lang), ephemeral: true });
        }

    } catch (error: any) {
        console.error('Error placing bid:', error);
        const message = isAppError(error) ? error.message : t('errors.generic', lang);
        await interaction.editReply({ content: message, ephemeral: true });
    }
}

async function resolveNotificationChannel(
    interaction: CommandInteraction,
    preferredChannelId?: string | null,
): Promise<TextBasedChannel | null> {
    const interactionChannel = interaction.channel;
    if (interactionChannel && interactionChannel.isTextBased()) {
        return interactionChannel;
    }

    if (preferredChannelId) {
        try {
            const fetched = await interaction.client.channels.fetch(preferredChannelId);
            if (fetched && fetched.isTextBased()) {
                return fetched;
            }
        } catch (error) {
            console.error('Failed to fetch preferred channel for notification:', error);
        }
    }

    return null;
}
