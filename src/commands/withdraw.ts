import { SlashCommandBuilder, CommandInteraction, AttachmentBuilder } from 'discord.js';
import { walletService } from '../services/WalletService';
import { AppError, isAppError } from '../utils/errors';
import { getInteractionLanguage, t } from '../utils/i18n';
import QRCode from 'qrcode';
import { computeLnurlRange, decodeLnurl, resolveLightningAddress } from '../utils/lnurl';

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
            .setName('lnurl')
            .setDescription('Withdraw by paying an LNURL-pay link.')
            .addStringOption(option =>
                option
                    .setName('lnurl')
                    .setDescription('Paste the LNURL (lnurl1...) string provided by the receiver.')
                    .setRequired(true),
            )
            .addIntegerOption(option =>
                option
                    .setName('amount')
                    .setDescription('Amount to send in sats (required when LNURL specifies a range).')
                    .setMinValue(1),
            ),
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
    } else if (subcommand === 'lnurl') {
        try {
            const lnurlInput = interaction.options.getString('lnurl', true).trim();
            const requestedAmount = interaction.options.getInteger('amount');

            let decoded: string;
            const lowered = lnurlInput.toLowerCase();
            try {
                if (lowered.startsWith('lnurl')) {
                    decoded = decodeLnurl(lnurlInput);
                } else if (lnurlInput.includes('@')) {
                    decoded = resolveLightningAddress(lnurlInput);
                } else {
                    throw new Error('unsupported format');
                }
            } catch (error) {
                console.error('LNURL decode failed:', error);
                throw new AppError(t('withdraw.lnurl.invalid', lang), 'LNURL_FORMAT');
            }
            let metadata: any;
            try {
                const resp = await fetch(decoded, { headers: { accept: 'application/json' } });
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}`);
                }
                metadata = await resp.json();
            } catch (error) {
                console.error('LNURL metadata fetch failed:', error);
                throw new AppError(t('withdraw.lnurl.fetchFailed', lang), 'LNURL_FETCH');
            }

            if (!metadata || metadata.tag !== 'payRequest' || !metadata.callback) {
                throw new AppError(t('withdraw.lnurl.unsupported', lang), 'LNURL_UNSUPPORTED');
            }

            const callbackUrl = new URL(metadata.callback);
            const insecureHostAllowed = ['localhost', '127.0.0.1'].includes(callbackUrl.hostname);
            if (callbackUrl.protocol !== 'https:' && !insecureHostAllowed) {
                throw new AppError(t('withdraw.lnurl.insecure', lang), 'LNURL_VALIDATION');
            }

            let minSats: number;
            let maxSats: number;
            try {
                const range = computeLnurlRange(metadata.minSendable, metadata.maxSendable);
                minSats = range.minSats;
                maxSats = range.maxSats;
            } catch (error) {
                console.error('LNURL invalid range:', error);
                throw new AppError(t('withdraw.lnurl.invalidRange', lang), 'LNURL_VALIDATION');
            }

            let amountSats: number | null = requestedAmount;
            if (amountSats === null) {
                if (minSats === maxSats) {
                    amountSats = minSats;
                } else {
                    throw new AppError(
                        t('withdraw.lnurl.amountRequired', lang, { min: minSats.toString(), max: maxSats.toString() }),
                        'LNURL_VALIDATION',
                    );
                }
            }
            if (amountSats < minSats || amountSats > maxSats) {
                throw new AppError(
                    t('withdraw.lnurl.amountRange', lang, { min: minSats.toString(), max: maxSats.toString() }),
                    'LNURL_VALIDATION',
                );
            }
            const amountMsats = amountSats * 1000;
            callbackUrl.searchParams.set('amount', amountMsats.toString());

            let callbackData: any;
            try {
                const resp = await fetch(callbackUrl, { headers: { accept: 'application/json' } });
                callbackData = await resp.json();
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}`);
                }
            } catch (error) {
                console.error('LNURL callback failed:', error);
                throw new AppError(t('withdraw.lnurl.callbackFailed', lang), 'LNURL_FETCH');
            }

            const invoice = callbackData?.pr;
            if (typeof invoice !== 'string' || invoice.length === 0) {
                throw new AppError(t('withdraw.lnurl.invoiceMissing', lang), 'LNURL_FETCH');
            }

            const { isPaid, preimage, feeReserve, amount } = await walletService.payLightningInvoice(
                interaction.user.id,
                invoice,
            );

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
            console.error('Error processing LNURL withdraw:', error);
            const message = isAppError(error) ? error.message : t('errors.generic', lang);
            await interaction.editReply(message);
        }
    }
}
