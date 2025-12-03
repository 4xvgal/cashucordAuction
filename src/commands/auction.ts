import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { auctions, users, bids } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import moment from 'moment';
import { auctionService } from '../services/AuctionService';
import { AppError, isAppError } from '../utils/errors';
import '../utils/env';
import { canManageAuction } from '../utils/permissions';

const resolveDefaultCollateralRatio = () => {
    const raw = process.env.DEFAULT_COLLATERAL_RATIO ?? '20';
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return 20;
    return Math.min(100, Math.max(1, Math.floor(parsed)));
};

export const data = new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Manages auctions.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('create')
            .setDescription('Creates a new auction.')
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('The title of the auction item.')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName('start_price')
                    .setDescription('The starting price in satoshis.')
                    .setRequired(true)
                    .setMinValue(1)
            )
            .addStringOption(option =>
                option.setName('end_time')
                    .setDescription('The end time for the auction (e.g., "24h", "3d", "1w"). Defaults to 24 hours.')
                    .setRequired(false)
            )
            .addIntegerOption(option =>
                option.setName('collateral_ratio')
                    .setDescription('Percentage of bid required as collateral (1-100). Defaults to 20.')
                    .setMinValue(1)
                    .setMaxValue(100)
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('cancel')
            .setDescription('Cancels one of your auctions (admins can cancel any auction).')
            .addIntegerOption(option =>
                option.setName('auction_id')
                    .setDescription('ID of the auction to cancel.')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('Lists auctions by status.')
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('Status to filter.')
                    .addChoices(
                        { name: 'Active', value: 'ACTIVE' },
                        { name: 'Ended', value: 'ENDED' },
                        { name: 'Cancelled', value: 'CANCELLED' },
                        { name: 'All', value: 'ALL' },
                    )
            )
            .addIntegerOption(option =>
                option.setName('limit')
                    .setDescription('Number of auctions to list (1-25).')
                    .setMinValue(1)
                    .setMaxValue(25)
            )
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
        await handleCreateAuction(interaction);
    } else if (subcommand === 'list') {
        await handleListAuctions(interaction);
    } else if (subcommand === 'cancel') {
        await handleCancelAuction(interaction);
    }
}

async function handleCreateAuction(interaction: CommandInteraction) {
    await interaction.deferReply();

    try {
        const title = interaction.options.getString('title', true);
        const startPrice = interaction.options.getInteger('start_price', true);
        const endTimeStr = interaction.options.getString('end_time') ?? '24h';
        const defaultCollateralRatio = resolveDefaultCollateralRatio();
        const collateralRatio = interaction.options.getInteger('collateral_ratio') ?? defaultCollateralRatio;

        const sellerId = interaction.user.id;

        // Ensure user exists
        const user = await db.query.users.findFirst({ where: eq(users.id, sellerId) });
        if (!user) {
            await db.insert(users).values({ id: sellerId });
        }
        
        const endTime = computeEndTime(endTimeStr);

        const [newAuction] = await db.insert(auctions).values({
            sellerId,
            title,
            startPrice: BigInt(startPrice),
            currentPrice: BigInt(startPrice),
            collateralRatio,
            endTime,
            status: 'ACTIVE',
        }).returning();

        await interaction.editReply(
            `🎉 **Auction Created!** 🎉\n\n` +
            `**Item:** ${newAuction.title}\n` +
            `**Starting Price:** ${newAuction.startPrice} sats\n` +
            `**Ends:** <t:${Math.floor(newAuction.endTime.getTime() / 1000)}:R>\n` +
            `**Collateral:** ${newAuction.collateralRatio}%\n\n` +
            `Use \\\`/bid ${newAuction.id} <amount>\\\` to place your bid!`
        );

    } catch (error) {
        console.error('Error creating auction:', error);
        const message = isAppError(error) ? error.message : 'Could not create the auction. Please try again later.';
        await interaction.editReply(message);
    }
}

async function handleListAuctions(interaction: CommandInteraction) {
    await interaction.deferReply();
    try {
        const status = (interaction.options.getString('status') ?? 'ACTIVE') as 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'ALL';
        const limit = interaction.options.getInteger('limit') ?? 5;

        const listings = await auctionService.listAuctions({ status, limit });
        if (listings.length === 0) {
            await interaction.editReply('No auctions found for the selected filter.');
            return;
        }

        const lines = listings.map(({ auction, topBid }) => {
            const endLabel = auction.status === 'ACTIVE'
                ? `Ends <t:${Math.floor(auction.endTime.getTime() / 1000)}:R>`
                : `Ended <t:${Math.floor(auction.endTime.getTime() / 1000)}:R>`;

            const topBidLine = topBid
                ? `Top Bid: ${topBid.amount} sats by <@${topBid.bidderId}>`
                : 'No bids yet';

            return (
                `**#${auction.id} • ${auction.title}**\n` +
                `Seller: <@${auction.sellerId}> • ${endLabel}\n` +
                `Current Price: ${auction.currentPrice} sats • Collateral: ${auction.collateralRatio}%\n` +
                `${topBidLine}`
            );
        });

        await interaction.editReply(lines.join('\n\n'));
    } catch (error) {
        console.error('Error listing auctions:', error);
        await interaction.editReply('Could not fetch the auction list right now.');
    }
}

async function handleCancelAuction(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const auctionId = interaction.options.getInteger('auction_id', true);
        const userId = interaction.user.id;

        const result = await db.transaction(async (tx) => {
            const auction = await tx.query.auctions.findFirst({
                where: eq(auctions.id, auctionId),
                for: 'update',
            });

            if (!auction) {
                throw new AppError('Auction not found.', 'AUCTION_NOT_FOUND');
            }

            if (auction.status !== 'ACTIVE') {
                throw new AppError('Only active auctions can be cancelled.', 'AUCTION_INACTIVE');
            }

            if (!canManageAuction(userId, auction.sellerId)) {
                throw new AppError('You do not have permission to cancel this auction.', 'VALIDATION');
            }

            const topBid = await tx.query.bids.findFirst({
                where: eq(bids.auctionId, auction.id),
                orderBy: [desc(bids.amount)],
            });

            if (topBid) {
                const bidder = await tx.query.users.findFirst({
                    where: eq(users.id, topBid.bidderId),
                    for: 'update',
                });

                if (bidder) {
                    const collateral = (topBid.amount * BigInt(auction.collateralRatio)) / 100n;
                    const updatedLocked = bidder.lockedBalance > collateral
                        ? bidder.lockedBalance - collateral
                        : 0n;
                    await tx.update(users)
                        .set({ lockedBalance: updatedLocked })
                        .where(eq(users.id, bidder.id));
                }
            }

            await tx.update(auctions)
                .set({ status: 'CANCELLED' })
                .where(eq(auctions.id, auction.id));

            return { auction, topBid };
        });

        await interaction.editReply(
            `🛑 Auction #${result.auction.id} (${result.auction.title}) has been cancelled.`
        );
    } catch (error) {
        console.error('Error cancelling auction:', error);
        const message = isAppError(error) ? error.message : 'Could not cancel the auction right now.';
        await interaction.editReply(message);
    }
}

function computeEndTime(input: string | null): Date {
    const fallback = moment().add(24, 'hours').toDate();
    if (!input) {
        return fallback;
    }

    const trimmed = input.trim();
    const match = trimmed.match(/^(\d+)\s*(s|m|h|d|w)$/i);
    if (!match) {
        throw new AppError('Invalid end time format. Use numbers followed by s/m/h/d/w, e.g. "30m" or "3d".', 'VALIDATION');
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
        throw new AppError('End time must be greater than zero.', 'VALIDATION');
    }

    const unit = match[2].toLowerCase();
    const duration = moment.duration(value, unit as moment.unitOfTime.DurationConstructor);
    const milliseconds = duration.asMilliseconds();
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        throw new AppError('Invalid end time duration.', 'VALIDATION');
    }

    return moment().add(duration).toDate();
}
