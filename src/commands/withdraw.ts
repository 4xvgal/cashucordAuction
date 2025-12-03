import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { walletService } from '../services/WalletService';
import { getDecodedToken } from '@cashu/cashu-ts';
import { isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';

export const data = new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw satoshis from your account.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('token')
            .setDescription('Withdraw to a Cashu token.')
            .addIntegerOption(option =>
                option.setName('amount')
                    .setDescription('The amount in satoshis to withdraw.')
                    .setRequired(true)
                    .setMinValue(1)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('invoice')
            .setDescription('Withdraw by paying a Lightning invoice.')
            .addStringOption(option =>
                option.setName('invoice')
                    .setDescription('The Lightning invoice to pay.')
                    .setRequired(true)
            )
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });
    const lang = getInteractionLanguage(interaction);

    if (subcommand === 'token') {
        const amount = interaction.options.getInteger('amount', true);
        try {
            const { token, finalAmount } = await walletService.createWithdrawalToken(interaction.user.id, amount);
            
            await interaction.user.send({
                content: t('withdraw.token.dm', lang, { amount: finalAmount.toString(), token }),
            });

            await interaction.editReply(t('withdraw.token.success', lang, { amount: finalAmount.toString() }));

        } catch (error: any) {
            console.error('Error creating withdrawal token:', error);
            const fallback = t('withdraw.token.failure', lang, { error: error.message });
            const message = isAppError(error) ? error.message : fallback;
            await interaction.editReply(message);
        }
    } else if (subcommand === 'invoice') {
        const invoice = interaction.options.getString('invoice', true);
        try {
            const { amount } = getDecodedToken(invoice);
            if (!amount) {
                await interaction.editReply(t('withdraw.invoice.invalid', lang));
                return;
            }

            const { isPaid, preimage } = await walletService.payLightningInvoice(interaction.user.id, invoice);

            if (isPaid) {
                await interaction.user.send(
                    t('withdraw.invoice.dm', lang, { amount: amount.toString(), preimage: preimage ?? '' }),
                );
                await interaction.editReply(t('withdraw.invoice.success', lang));
            } else {
                await interaction.editReply(t('withdraw.invoice.failure', lang));
            }
        } catch (error: any) {
            console.error('Error paying Lightning invoice:', error);
            const message = isAppError(error) ? error.message : t('errors.generic', lang);
            await interaction.editReply(message);
        }
    }
}
