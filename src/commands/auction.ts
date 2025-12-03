import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { auctions, users, bids } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import moment from 'moment';
import { auctionService } from '../services/AuctionService';
import { AppError, isAppError } from '../utils/errors';
import '../utils/env';
import { canManageAuction } from '../utils/permissions';
import { getInteractionLanguage, t } from '../utils/i18n';
import { formatBidderDisplay } from '../utils/privacy';

const resolveDefaultCollateralRatio = () => {
    const raw = process.env.DEFAULT_COLLATERAL_RATIO ?? '20';
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return 20;
    return Math.min(100, Math.max(1, Math.floor(parsed)));
};

export const data = new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Create, list, or cancel auctions (supports Vickrey mode, anti-snipe, privacy).')
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
            .addBooleanOption(option =>
                option.setName('anti_snipe_enabled')
                    .setDescription('Enable or disable anti-snipe auto extension (default: enabled).')
            )
            .addIntegerOption(option =>
                option.setName('anti_snipe_trigger')
                    .setDescription('Seconds before end to trigger anti-snipe extension.')
                    .setMinValue(5)
                    .setRequired(false)
            )
            .addIntegerOption(option =>
                option.setName('anti_snipe_extension')
                    .setDescription('Number of seconds to extend when anti-snipe triggers.')
                    .setMinValue(5)
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('mode')
                    .setDescription('Auction mode.')
                    .addChoices(
                        { name: 'English (default)', value: 'ENGLISH' },
                        { name: 'Vickrey (second price)', value: 'VICKREY' },
                    )
            )
            .addBooleanOption(option =>
                option.setName('privacy_mode')
                    .setDescription('Enable anonymous bidding for this auction.')
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
        const lang = getInteractionLanguage(interaction);
        const title = interaction.options.getString('title', true);
        const startPrice = interaction.options.getInteger('start_price', true);
        const endTimeStr = interaction.options.getString('end_time') ?? '24h';
        const defaultCollateralRatio = resolveDefaultCollateralRatio();
        const collateralRatio = interaction.options.getInteger('collateral_ratio') ?? defaultCollateralRatio;
        const isPrivacyMode = interaction.options.getBoolean('privacy_mode') ?? false;
        const auctionMode = (interaction.options.getString('mode') as 'ENGLISH' | 'VICKREY' | null) ?? 'ENGLISH';
        const antiSnipeEnabled = interaction.options.getBoolean('anti_snipe_enabled') ?? true;
        const antiSnipeTrigger = interaction.options.getInteger('anti_snipe_trigger') ?? 60;
        const antiSnipeExtension = interaction.options.getInteger('anti_snipe_extension') ?? 60;

        const sellerId = interaction.user.id;

        // Ensure user exists
        const user = await db.query.users.findFirst({ where: eq(users.id, sellerId) });
        if (!user) {
            await db.insert(users).values({ id: sellerId });
        }
        
        const endTime = computeEndTime(endTimeStr, lang);

        const [newAuction] = await db.insert(auctions).values({
            sellerId,
            title,
            startPrice: BigInt(startPrice),
            currentPrice: BigInt(startPrice),
            collateralRatio,
            endTime,
            status: 'ACTIVE',
            isPrivacyMode,
            auctionMode,
            antiSnipeEnabled,
            antiSnipeTrigger,
            antiSnipeExtension,
        }).returning();

        await interaction.editReply(
            t('auction.create.success', lang, {
                title: newAuction.title,
                startPrice: newAuction.startPrice.toString(),
                endTimestamp: Math.floor(newAuction.endTime.getTime() / 1000).toString(),
                collateral: newAuction.collateralRatio.toString(),
                id: newAuction.id.toString(),
            }),
        );

    } catch (error) {
        console.error('Error creating auction:', error);
        const lang = getInteractionLanguage(interaction);
        const message = isAppError(error) ? error.message : t('errors.generic', lang);
        await interaction.editReply(message);
    }
}

async function handleListAuctions(interaction: CommandInteraction) {
    await interaction.deferReply();
    try {
        const lang = getInteractionLanguage(interaction);
        const status = (interaction.options.getString('status') ?? 'ACTIVE') as 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'ALL';
        const limit = interaction.options.getInteger('limit') ?? 5;

        const listings = await auctionService.listAuctions({ status, limit });
        if (listings.length === 0) {
            await interaction.editReply(t('auction.list.empty', lang));
            return;
        }

        const lines = listings.map(({ auction, topBid }) => {
            const endLabel = t(
                auction.status === 'ACTIVE' ? 'auction.list.end.active' : 'auction.list.end.ended',
                lang,
                { timestamp: Math.floor(auction.endTime.getTime() / 1000).toString() },
            );

            const topBidLine = topBid
                ? t('auction.list.topBid', lang, {
                    amount: topBid.amount.toString(),
                    bidder: formatBidderDisplay(auction.id, topBid.bidderId, topBid.isAnonymous),
                  })
                : t('auction.list.noBids', lang);

            return t('auction.list.entry', lang, {
                id: auction.id.toString(),
                title: auction.title,
                seller: auction.sellerId,
                endLabel,
                price: auction.currentPrice.toString(),
                collateral: auction.collateralRatio.toString(),
                topBid: topBidLine,
            });
        });

        await interaction.editReply(lines.join('\n\n'));
    } catch (error) {
        console.error('Error listing auctions:', error);
        const lang = getInteractionLanguage(interaction);
        await interaction.editReply(t('errors.generic', lang));
    }
}

async function handleCancelAuction(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const lang = getInteractionLanguage(interaction);
        const auctionId = interaction.options.getInteger('auction_id', true);
        const userId = interaction.user.id;

        const result = await db.transaction(async (tx) => {
            const auction = await tx.query.auctions.findFirst({
                where: eq(auctions.id, auctionId),
                for: 'update',
            });

            if (!auction) {
                throw new AppError(t('bid.error.notFound', lang), 'AUCTION_NOT_FOUND');
            }

            if (auction.status !== 'ACTIVE') {
                throw new AppError(t('auction.cancel.inactive', lang), 'AUCTION_INACTIVE');
            }

            if (!canManageAuction(userId, auction.sellerId)) {
                throw new AppError(t('auction.cancel.noPermission', lang), 'VALIDATION');
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
            t('auction.cancel.success', lang, {
                id: result.auction.id.toString(),
                title: result.auction.title,
            }),
        );
    } catch (error) {
        console.error('Error cancelling auction:', error);
        const lang = getInteractionLanguage(interaction);
        const message = isAppError(error) ? error.message : t('errors.generic', lang);
        await interaction.editReply(message);
    }
}

function computeEndTime(input: string | null, lang: string): Date {
    const fallback = moment().add(24, 'hours').toDate();
    if (!input) {
        return fallback;
    }

    const trimmed = input.trim();
    const match = trimmed.match(/^(\d+)\s*(s|m|h|d|w)$/i);
    if (!match) {
        throw new AppError(t('errors.invalidEndTime', lang as any), 'VALIDATION');
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
        throw new AppError(t('errors.invalidEndTime', lang as any), 'VALIDATION');
    }

    const unit = match[2].toLowerCase();
    const duration = moment.duration(value, unit as moment.unitOfTime.DurationConstructor);
    const milliseconds = duration.asMilliseconds();
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        throw new AppError(t('errors.invalidEndTime', lang as any), 'VALIDATION');
    }

    return moment().add(duration).toDate();
}
