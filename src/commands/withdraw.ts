import { SlashCommandBuilder, CommandInteraction, AttachmentBuilder } from 'discord.js';
import { walletService } from '../services/WalletService';
import { isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';
import QRCode from 'qrcode';

const buildTokenQr = async (token: string) => {
    try {
        const dataUrl = await QRCode.toDataURL(token, { margin: 1, scale: 6 });
        const base64 = dataUrl.split(',')[1];
        return new AttachmentBuilder(Buffer.from(base64, 'base64'), { name: 'cashu-token.png' });
    } catch (error) {
        console.error('Failed to generate withdraw token QR code:', error);
        return null;
    }
};

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
                option
                    .setName('invoice')
                    .setDescription('Paste the Bolt11 Lightning invoice. Generate it with the amount you want the bot to pay.')
                    .setRequired(true),
            ),
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

            const qrAttachment = await buildTokenQr(token);
            const dm = await interaction.user.send({
                content: t('withdraw.token.dm', lang, { amount: finalAmount.toString() }),
                files: qrAttachment ? [qrAttachment] : undefined,
            });

            await interaction.user.send({
                content: token,
            });

            await interaction.editReply(t('withdraw.token.success', lang, { amount: finalAmount.toString() }));

        } catch (error: any) {
            console.error('Error creating withdrawal token:', error);
            const fallback = t('withdraw.token.failure', lang, { error: error.message });
            const message = isAppError(error) ? error.message : fallback;
            await interaction.editReply(message);
        }
    } else if (subcommand === 'invoice') {
        try {
            const invoice = interaction.options.getString('invoice', true).trim();
            if (/^\d+$/.test(invoice)) {
                await interaction.editReply(t('withdraw.invoice.numberInput', lang));
                return;
            }

            const { isPaid, preimage, feeReserve, amount } = await walletService.payLightningInvoice(interaction.user.id, invoice);

            if (isPaid) {
                await interaction.user.send(
                    t('withdraw.invoice.dm', lang, { amount: amount.toString(), preimage: preimage ?? '' }),
                );
                await interaction.editReply(
                    t('withdraw.invoice.success', lang, { fee: (feeReserve ?? 0).toString() }),
                );
            } else {
                await interaction.editReply(t('withdraw.invoice.failure', lang));
            }
        } catch (error: any) {
            console.error('Error paying Lightning invoice:', error);
            const rawMessage = error?.message ? String(error.message) : '';
            let response: string;
            if (!isAppError(error) && /token version is not supported|Failed to decode|bolt11/i.test(rawMessage)) {
                response = t('withdraw.invoice.decodeFailed', lang);
            } else {
                response = isAppError(error) ? error.message : t('errors.generic', lang);
            }
            await interaction.editReply(response);
        }
    }
}
