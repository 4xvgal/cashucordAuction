import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getInteractionLanguage, t } from '../utils/i18n';

export const data = new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Shows your current balance.');

export async function execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);
    
    const userId = interaction.user.id;

    try {
        let user = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!user) {
            // If user doesn't exist, create one
            await db.insert(users).values({ id: userId, balance: 0n, lockedBalance: 0n });
            user = { id: userId, balance: 0n, lockedBalance: 0n, createdAt: new Date() };
        }

        const balance = user.balance ?? 0n;
        const lockedBalance = user.lockedBalance ?? 0n;
        const totalBalance = balance + lockedBalance;
        
        await interaction.editReply(
            t('balance.display', lang, {
                available: balance.toString(),
                locked: lockedBalance.toString(),
                total: totalBalance.toString(),
            }),
        );
    } catch (error) {
        console.error('Error fetching balance:', error);
        await interaction.editReply(t('errors.generic', lang));
    }
}
