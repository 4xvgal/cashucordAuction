import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { isRootAdmin } from '../utils/permissions';
import { getInteractionLanguage, t } from '../utils/i18n';

export const data = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administrative tooling for the Cashu auction bot.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('balance')
            .setDescription('View a user balance (admins only).')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User whose balance you want to inspect.')
                    .setRequired(true)
            )
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    const lang = getInteractionLanguage(interaction);

    if (!isRootAdmin(interaction.user)) {
        await interaction.reply({ content: t('auction.cancel.noPermission', lang), ephemeral: true });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'balance') {
        await handleBalanceLookup(interaction);
    }
}

async function handleBalanceLookup(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);
    const targetUser = interaction.options.getUser('user', true);

    const userRecord = await db.query.users.findFirst({
        where: eq(users.id, targetUser.id),
    });

    if (!userRecord) {
        await interaction.editReply(t('admin.balance.missing', lang, { userId: targetUser.id }));
        return;
    }

    const balance = userRecord.balance ?? 0n;
    const lockedBalance = userRecord.lockedBalance ?? 0n;
    const total = balance + lockedBalance;

    await interaction.editReply(
        t('admin.balance.result', lang, {
            userId: targetUser.id,
            available: balance.toString(),
            locked: lockedBalance.toString(),
            total: total.toString(),
        }),
    );
}
