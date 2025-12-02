import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export const data = new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Shows your current balance.');

export async function execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    
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
            `Your Balance:\n` +
            `----------------\n` +
            `**Available:** ${balance.toString()} sats\n` +
            `**Locked in Bids:** ${lockedBalance.toString()} sats\n` +
            `**Total:** ${totalBalance.toString()} sats`
        );
    } catch (error) {
        console.error('Error fetching balance:', error);
        await interaction.editReply('Could not fetch your balance at this time.');
    }
}
