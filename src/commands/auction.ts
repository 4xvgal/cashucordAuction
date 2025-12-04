import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import moment from 'moment';
import { db } from '../db';
import { auctions, bids, users } from '../db/schema';
import { auctionService } from '../services/AuctionService';
import '../utils/env';
import { AppError, isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';
import { canManageAuction } from '../utils/permissions';
import { formatBidderDisplay } from '../utils/privacy';
import { computeCollateral } from '../utils/collateral';

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
                        { name: 'Vickrey (second price, notify)', value: 'VICKREY_NOTIFY' },
                    )
            )
            .addBooleanOption(option =>
                option.setName('privacy_mode')
                    .setDescription('Enable anonymous bidding for this auction.')
            )
            .addBooleanOption(option =>
                option.setName('vickrey_notify')
                    .setDescription('For Vickrey auctions only: send anonymous updates when new bids come in.')
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('edit')
            .setDescription('Edit one of your auctions (title always, start price/collateral only if no bids).')
            .addIntegerOption(option =>
                option.setName('auction_id')
                    .setDescription('ID of the auction to edit.')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('Updated title for the auction.')
                    .setRequired(false)
            )
            .addIntegerOption(option =>
                option.setName('start_price')
                    .setDescription('New starting price (only if no bids yet).')
                    .setRequired(false)
                    .setMinValue(1)
            )
            .addIntegerOption(option =>
                option.setName('collateral_ratio')
                    .setDescription('New collateral ratio 1-100 (only if no bids yet).')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(100)
            )
            .addBooleanOption(option =>
                option.setName('vickrey_notify')
                    .setDescription('Vickrey only: toggle anonymous bid notifications for this auction.')
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
    } else if (subcommand === 'edit') {
        await handleEditAuction(interaction);
    }
}

async function handleCreateAuction(interaction: CommandInteraction) {
    await interaction.deferReply();

    try {
        const lang = getInteractionLanguage(interaction);
        const title = interaction.options.getString('title', true);
        const startPrice = interaction.options.getInteger('start_price', true);
        const endTimeStr = interaction.options.getString('end_time') ?? '3h';
        const defaultCollateralRatio = resolveDefaultCollateralRatio();
        const collateralRatio = interaction.options.getInteger('collateral_ratio') ?? defaultCollateralRatio;
        const isPrivacyMode = interaction.options.getBoolean('privacy_mode') ?? false;
        const rawMode = (interaction.options.getString('mode') as 'ENGLISH' | 'VICKREY' | 'VICKREY_NOTIFY' | null) ?? 'ENGLISH';
        const auctionMode = rawMode === 'VICKREY' || rawMode === 'VICKREY_NOTIFY' ? 'VICKREY' : 'ENGLISH';
        const notifyOption = interaction.options.getBoolean('vickrey_notify');
        const notifyRequest = rawMode === 'VICKREY_NOTIFY' ? true : (notifyOption ?? false);
        const antiSnipeEnabled = interaction.options.getBoolean('anti_snipe_enabled') ?? true;
        const antiSnipeTrigger = interaction.options.getInteger('anti_snipe_trigger') ?? 60;
        const antiSnipeExtension = interaction.options.getInteger('anti_snipe_extension') ?? 60;

        const sellerId = interaction.user.id;
        const guildId = interaction.guildId ?? 'GLOBAL';
        const notifyNewBids = auctionMode === 'VICKREY' ? notifyRequest : false;
        const notifyChannelId = interaction.channelId ?? null;

        // Ensure user exists
        const user = await db.query.users.findFirst({ where: eq(users.id, sellerId) });
        if (!user) {
            await db.insert(users).values({ id: sellerId });
        }
        
        const endTime = computeEndTime(endTimeStr, lang);

        const [newAuction] = await db.insert(auctions).values({
            sellerId,
            guildId,
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
            notifyNewBids,
            notifyChannelId,
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

            if (auction.auctionMode === 'VICKREY') {
                return t('auction.list.vickreyEntry', lang, {
                    id: auction.id.toString(),
                    title: auction.title,
                    endLabel,
                });
            }

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

            if (!canManageAuction(interaction.user, auction.sellerId)) {
                throw new AppError(t('auction.cancel.noPermission', lang), 'VALIDATION');
            }

            const topBid = await tx.query.bids.findFirst({
                where: eq(bids.auctionId, auction.id),
                orderBy: [desc(bids.amount), desc(bids.timestamp)],
            });

            if (topBid) {
                const bidder = await tx.query.users.findFirst({
                    where: eq(users.id, topBid.bidderId),
                    for: 'update',
                });

                if (bidder) {
                    const cappedCollateral = computeCollateral(topBid.amount, auction.collateralRatio);
                    const releaseAmount = bidder.lockedBalance < cappedCollateral ? bidder.lockedBalance : cappedCollateral;
                    if (releaseAmount > 0n) {
                        await tx.update(users)
                            .set({
                                lockedBalance: bidder.lockedBalance - releaseAmount,
                                balance: bidder.balance + releaseAmount,
                            })
                            .where(eq(users.id, bidder.id));
                    }
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

        const broadcastMessage = t('auction.cancel.broadcast', lang, {
            id: result.auction.id.toString(),
            title: result.auction.title,
        });
        await interaction.followUp({ content: broadcastMessage, ephemeral: false });
    } catch (error) {
        console.error('Error cancelling auction:', error);
        const lang = getInteractionLanguage(interaction);
        const message = isAppError(error) ? error.message : t('errors.generic', lang);
        await interaction.editReply(message);
    }
}

async function handleEditAuction(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);
    const auctionId = interaction.options.getInteger('auction_id', true);
    const newTitleRaw = interaction.options.getString('title');
    const newStartPrice = interaction.options.getInteger('start_price');
    const newCollateral = interaction.options.getInteger('collateral_ratio');
    const newVickreyNotify = interaction.options.getBoolean('vickrey_notify');

    if (!newTitleRaw && newStartPrice === null && newCollateral === null) {
        await interaction.editReply(t('auction.edit.noChanges', lang));
        return;
    }

    try {
        const result = await db.transaction(async (tx) => {
            const auction = await tx.query.auctions.findFirst({
                where: eq(auctions.id, auctionId),
                for: 'update',
            });

            if (!auction) {
                throw new AppError(t('bid.error.notFound', lang), 'AUCTION_NOT_FOUND');
            }
            if (!canManageAuction(interaction.user, auction.sellerId)) {
                throw new AppError(t('auction.cancel.noPermission', lang), 'VALIDATION');
            }
            if (auction.status !== 'ACTIVE') {
                throw new AppError(t('auction.cancel.inactive', lang), 'VALIDATION');
            }

            const updates: Partial<typeof auction> = {};
            let changed = false;

            if (newTitleRaw) {
                const title = newTitleRaw.trim();
                if (!title) {
                    throw new AppError(t('auction.edit.invalidTitle', lang), 'VALIDATION');
                }
                updates.title = title;
                changed = true;
            }

            const hasBids = await tx.query.bids.findFirst({
                where: eq(bids.auctionId, auctionId),
                columns: { id: true },
            });

            if (newStartPrice !== null) {
                if (hasBids) {
                    throw new AppError(t('auction.edit.hasBids', lang), 'VALIDATION');
                }
                updates.startPrice = BigInt(newStartPrice);
                updates.currentPrice = BigInt(newStartPrice);
                changed = true;
            }

            if (newCollateral !== null) {
                if (hasBids) {
                    throw new AppError(t('auction.edit.hasBids', lang), 'VALIDATION');
                }
                updates.collateralRatio = newCollateral;
                changed = true;
            }

            if (newVickreyNotify !== null) {
                if (auction.auctionMode !== 'VICKREY') {
                    throw new AppError(t('auction.edit.vickreyOnly', lang), 'VALIDATION');
                }
                updates.notifyNewBids = newVickreyNotify;
                if (newVickreyNotify) {
                    updates.notifyChannelId = interaction.channelId ?? auction.notifyChannelId ?? null;
                }
                changed = true;
            }

            if (!changed) {
                throw new AppError(t('auction.edit.noChanges', lang), 'VALIDATION');
            }

            const [updated] = await tx
                .update(auctions)
                .set(updates)
                .where(eq(auctions.id, auction.id))
                .returning();

            return updated;
        });

        await interaction.editReply(
            t('auction.edit.success', lang, {
                id: result.id.toString(),
                title: result.title,
            }),
        );
    } catch (error) {
        console.error('Error editing auction:', error);
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
