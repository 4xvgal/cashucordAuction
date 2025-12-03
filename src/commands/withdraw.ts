import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { walletService } from '../services/WalletService';
import { getDecodedToken } from '@cashu/cashu-ts';
import { isAppError } from '../utils/errors';

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

    if (subcommand === 'token') {
        const amount = interaction.options.getInteger('amount', true);
        try {
            const { token, finalAmount } = await walletService.createWithdrawalToken(interaction.user.id, amount);
            
            await interaction.user.send({
                content: `Here is your Cashu token for ${finalAmount} sats:\n\
\
${token}\
\
`
            });

            await interaction.editReply(`✅ Withdrawal successful! I have sent you a DM with the Cashu token for ${finalAmount} sats.`);

        } catch (error: any) {
            console.error('Error creating withdrawal token:', error);
            const message = isAppError(error) ? error.message : `Could not process your withdrawal. **Error:** ${error.message}`;
            await interaction.editReply(message);
        }
    } else if (subcommand === 'invoice') {
        const invoice = interaction.options.getString('invoice', true);
        try {
            const { amount } = getDecodedToken(invoice);
            if (!amount) {
                await interaction.editReply('Invalid invoice. Could not decode amount.');
                return;
            }

            const { isPaid, preimage } = await walletService.payLightningInvoice(interaction.user.id, invoice);

            if (isPaid) {
                await interaction.user.send(
                    `✅ Invoice for ${amount} sats paid successfully!\
` +
                    `**Preimage:** 
${preimage}
`
                );
                await interaction.editReply('Invoice paid! I have sent you a confirmation via DM.');
            } else {
                await interaction.editReply('Failed to pay the invoice. The funds have been returned to your balance.');
            }
        } catch (error: any) {
            console.error('Error paying Lightning invoice:', error);
            const message = isAppError(error) ? error.message : `Could not process your withdrawal. **Error:** ${error.message}`;
            await interaction.editReply(message);
        }
    }
}
