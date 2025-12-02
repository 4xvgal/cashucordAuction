import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { auctions, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import moment from 'moment';

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
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand() || interaction.options.getSubcommand() !== 'create') return;

    await interaction.deferReply();

    try {
        const title = interaction.options.getString('title', true);
        const startPrice = interaction.options.getInteger('start_price', true);
        const endTimeStr = interaction.options.getString('end_time') ?? '24h';
        const collateralRatio = interaction.options.getInteger('collateral_ratio') ?? 20;

        const sellerId = interaction.user.id;

        // Ensure user exists
        const user = await db.query.users.findFirst({ where: eq(users.id, sellerId) });
        if (!user) {
            await db.insert(users).values({ id: sellerId });
        }
        
        // Parse end_time string (e.g., 1d, 12h, 30m)
        const duration = moment.duration(endTimeStr);
        if (duration.asMilliseconds() <= 0) {
            await interaction.editReply('Invalid end time format. Use formats like "24h", "3d", "1w".');
            return;
        }
        const endTime = moment().add(duration).toDate();

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
        await interaction.editReply('Could not create the auction. Please try again later.');
    }
}
