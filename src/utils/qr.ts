import QRCode from 'qrcode';
import { AttachmentBuilder } from 'discord.js';

export async function buildInvoiceQrAttachment(invoice: string): Promise<AttachmentBuilder | undefined> {
  try {
    const dataUrl = await QRCode.toDataURL(invoice, {
      errorCorrectionLevel: 'M',
      scale: 6,
      margin: 1,
    });
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    return new AttachmentBuilder(buffer, { name: 'invoice-qr.png' });
  } catch (error) {
    console.error('Failed to generate invoice QR code:', error);
    return undefined;
  }
}
