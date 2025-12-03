import { SlashCommandBuilder, CommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { walletService } from '../services/WalletService';
import { isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';

export const data = new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Deposit satoshis into your account.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('invoice')
            .setDescription('Deposit via a Lightning invoice.')
            .addIntegerOption(option =>
                option.setName('amount')
                    .setDescription('The amount in satoshis to deposit.')
                    .setRequired(true)
                    .setMinValue(1)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('token')
            .setDescription('Deposit via a Cashu token.')
            .addStringOption(option => 
                option.setName('encoded_token')
                    .setDescription('The cashu token string (cashuA...).')
                    .setRequired(true)
            )
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'invoice') {
        await handleInvoiceDeposit(interaction);
    } else if (subcommand === 'token') {
        await handleTokenDeposit(interaction);
    }
}

async function handleInvoiceDeposit(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    const amount = interaction.options.getInteger('amount', true);
    
    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);

    try {
        const { pr, hash } = await walletService.createDepositInvoice(amount);

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_deposit_${hash}_${amount}`)
            .setLabel(t('deposit.invoice.button', lang))
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton);

        const response = await interaction.editReply({
            content: t('deposit.invoice.prompt', lang, { amount: amount.toString(), invoice: pr }),
            components: [row],
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300_000, // 5 minutes
        });

        collector.on('collect', async i => {
            if (i.customId.startsWith('confirm_deposit_')) {
                await i.deferUpdate();
                const success = await walletService.confirmDeposit(i.user.id, amount, hash);
                if (success) {
                    await i.editReply({ content: t('deposit.invoice.success', lang, { amount: amount.toString() }), components: [] });
                    collector.stop();
                } else {
                    await i.followUp({ content: t('deposit.invoice.pending', lang), ephemeral: true });
                }
            }
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.editReply({ content: t('deposit.invoice.expired', lang), components: [] });
            }
        });

    } catch (error) {
        console.error('Error creating deposit invoice:', error);
        const message = isAppError(error) ? error.message : t('deposit.invoice.error', lang);
        await interaction.editReply({ content: message, components: [] });
    }
}

async function handleTokenDeposit(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    const token = interaction.options.getString('encoded_token', true);
    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);

    try {
        const { amount } = await walletService.redeemTokenForDeposit(interaction.user.id, token);
        await interaction.editReply(t('deposit.token.success', lang, { amount: amount.toString() }));
    } catch (error) {
        console.error('Error redeeming token:', error);
        const message = isAppError(error) ? error.message : t('deposit.token.failure', lang);
        await interaction.editReply(message);
    }
}
