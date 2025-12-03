import type { CommandInteraction, Interaction } from 'discord.js';
import './env';

const supportedLanguages = ['en', 'ko'] as const;
export type BotLanguage = (typeof supportedLanguages)[number];

const baseFallback: BotLanguage = 'en';

function normalizeLanguage(input?: string | null, fallback: BotLanguage = baseFallback): BotLanguage {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  return (supportedLanguages as readonly string[]).includes(normalized)
    ? (normalized as BotLanguage)
    : fallback;
}

const defaultLanguage = normalizeLanguage(process.env.BOT_DEFAULT_LANGUAGE);

export const translations = {
  'errors.generic': {
    en: 'Something went wrong. Please try again later.',
    ko: '문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
  },
  'errors.invalidEndTime': {
    en: 'Invalid end time format. Use numbers followed by s/m/h/d/w, e.g. "30m" or "3d".',
    ko: '마감 시간 형식이 잘못되었습니다. "30m", "12h", "3d"처럼 숫자 뒤에 s/m/h/d/w 를 붙여주세요.',
  },
  'auction.create.success': {
    en:
      '🎉 **Auction Created!** 🎉\n\n' +
      '**Item:** {title}\n' +
      '**Starting Price:** {startPrice} sats\n' +
      '**Ends:** <t:{endTimestamp}:R>\n' +
      '**Collateral:** {collateral}%\n\n' +
      'Use `/bid {id} <amount>` to place a bid!',
    ko:
      '🎉 **경매가 생성되었습니다!** 🎉\n\n' +
      '**상품:** {title}\n' +
      '**시작가:** {startPrice} 사토시\n' +
      '**종료:** <t:{endTimestamp}:R>\n' +
      '**담보 비율:** {collateral}%\n\n' +
      '`/bid {id} <금액>` 으로 입찰하세요!',
  },
  'auction.list.empty': {
    en: 'No auctions found for the selected filter.',
    ko: '해당 조건에 맞는 경매가 없습니다.',
  },
  'auction.list.entry': {
    en:
      '**#{id} • {title}**\n' +
      'Seller: <@{seller}> • {endLabel}\n' +
      'Current Price: {price} sats • Collateral: {collateral}%\n' +
      '{topBid}',
    ko:
      '**#{id} • {title}**\n' +
      '판매자: <@{seller}> • {endLabel}\n' +
      '현재가: {price} 사토시 • 담보: {collateral}%\n' +
      '{topBid}',
  },
  'auction.list.end.active': {
    en: 'Ends <t:{timestamp}:R>',
    ko: '<t:{timestamp}:R> 에 종료',
  },
  'auction.list.end.ended': {
    en: 'Ended <t:{timestamp}:R>',
    ko: '<t:{timestamp}:R> 에 종료됨',
  },
  'auction.list.topBid': {
    en: 'Top Bid: {amount} sats by {bidder}',
    ko: '최고 입찰: {amount} 사토시 (입찰자 {bidder})',
  },
  'auction.list.noBids': {
    en: 'No bids yet',
    ko: '아직 입찰 없음',
  },
  'auction.cancel.success': {
    en: '🛑 Auction #{id} ({title}) has been cancelled.',
    ko: '🛑 #{id} ({title}) 경매가 취소되었습니다.',
  },
  'auction.cancel.noPermission': {
    en: 'You do not have permission to cancel this auction.',
    ko: '이 경매를 취소할 권한이 없습니다.',
  },
  'auction.cancel.inactive': {
    en: 'Only active auctions can be cancelled.',
    ko: '진행 중인 경매만 취소할 수 있습니다.',
  },
  'bid.success': {
    en:
      '🚀 **New Highest Bid!**\n\n' +
      '**Auction:** {title} (#{id})\n' +
      '**New Price:** {amount} sats\n' +
      '**Bidder:** {bidderDisplay}\n\n' +
      '{endNote}',
    ko:
      '🚀 **최고 입찰가 갱신!**\n\n' +
      '**경매:** {title} (#{id})\n' +
      '**새 금액:** {amount} 사토시\n' +
      '**입찰자:** {bidderDisplay}\n\n' +
      '{endNote}',
  },
  'bid.privacyNotice': {
    en: 'Your bid has been recorded anonymously. Good luck!',
    ko: '입찰이 익명으로 기록되었습니다. 행운을 빕니다!',
  },
  'bid.endNote.extended': {
    en: '**ANTI-SNIPE!** Auction extended! New end time: <t:{timestamp}:R>',
    ko: '**스나이프 방지!** 경매가 연장되었습니다. 새 종료 시각: <t:{timestamp}:R>',
  },
  'bid.endNote.normal': {
    en: '**Ends:** <t:{timestamp}:R>',
    ko: '**종료:** <t:{timestamp}:R>',
  },
  'bid.error.notFound': {
    en: 'Auction not found.',
    ko: '해당 경매를 찾을 수 없습니다.',
  },
  'bid.error.inactive': {
    en: 'This auction is not active.',
    ko: '이 경매는 활성 상태가 아닙니다.',
  },
  'bid.error.ended': {
    en: 'This auction has already ended.',
    ko: '이미 종료된 경매입니다.',
  },
  'bid.error.lowAmount': {
    en: 'Your bid must be higher than the current price of {price} sats.',
    ko: '입찰 금액은 현재가 {price} 사토시보다 높아야 합니다.',
  },
  'bid.error.selfBid': {
    en: 'You cannot bid on your own auction.',
    ko: '자신의 경매에는 입찰할 수 없습니다.',
  },
  'bid.error.collateral': {
    en: 'Insufficient collateral. You need at least {required} sats available (Balance - Locked).',
    ko: '담보가 부족합니다. (잔액 - 잠금)이 최소 {required} 사토시 이상이어야 합니다.',
  },
  'balance.display': {
    en:
      'Your Balance:\n----------------\n' +
      '**Available:** {available} sats\n' +
      '**Locked in Bids:** {locked} sats\n' +
      '**Total:** {total} sats',
    ko:
      '현재 잔액:\n----------------\n' +
      '**사용 가능:** {available} 사토시\n' +
      '**입찰 잠금:** {locked} 사토시\n' +
      '**총합:** {total} 사토시',
  },
  'auction.result.privacy': {
    en: 'Auction ended. Sold to an anonymous buyer for {amount} sats.',
    ko: '경매가 종료되었습니다. 익명의 구매자에게 {amount} 사토시에 판매되었습니다.',
  },
  'auction.result.public': {
    en: 'Auction ended. Sold to {winner} for {amount} sats.',
    ko: '경매가 종료되었습니다. {winner} 님이 {amount} 사토시에 낙찰되었습니다.',
  },
  'auction.result.noBids': {
    en: 'Auction ended without any bids.',
    ko: '입찰 없이 경매가 종료되었습니다.',
  },
  'auction.dm.seller': {
    en: '✅ Auction "{title}" sold to {winner} for {amount} sats.\nDeposit credited now: {deposit} sats.\nRemaining to settle: {remaining} sats.\nYour new balance: {balance} sats.',
    ko: '✅ "{title}" 경매가 {winner} 님에게 {amount} 사토시에 판매되었습니다.\n지금 입금된 보증금: {deposit} 사토시\n추가 정산 금액: {remaining} 사토시\n현재 잔액: {balance} 사토시',
  },
  'auction.dm.winner': {
    en: '🎉 You won "{title}" for {amount} sats.\nDeposit deducted now: {deposit} sats.\nRemaining to pay seller: {remaining} sats.\nYour new balance: {balance} sats.',
    ko: '🎉 "{title}" 경매를 {amount} 사토시에 낙찰 받았습니다.\n이번에 차감된 보증금: {deposit} 사토시\n판매자에게 전달할 나머지 금액: {remaining} 사토시\n현재 잔액: {balance} 사토시',
  },
  'admin.balance.missing': {
    en: 'User <@{userId}> does not have a wallet record yet.',
    ko: '<@{userId}> 님의 지갑 정보가 아직 없습니다.',
  },
  'admin.balance.result': {
    en:
      '**User:** <@{userId}>\n' +
      '**Available:** {available} sats\n' +
      '**Locked:** {locked} sats\n' +
      '**Total:** {total} sats',
    ko:
      '**사용자:** <@{userId}>\n' +
      '**사용 가능:** {available} 사토시\n' +
      '**잠금:** {locked} 사토시\n' +
      '**총합:** {total} 사토시',
  },
  'deposit.invoice.prompt': {
    en:
      'Here is your Lightning invoice for {amount} sats. After paying, press the button below to confirm.\n\n' +
      '**Invoice:** ```{invoice}```',
    ko:
      '{amount} 사토시 라이트닝 청구서입니다. 결제 후 아래 버튼으로 입금을 확인하세요.\n\n' +
      '**청구서:** ```{invoice}```',
  },
  'deposit.invoice.success': {
    en: '✅ Deposit successful! {amount} sats have been added to your balance.',
    ko: '✅ 입금 완료! {amount} 사토시가 잔액에 추가되었습니다.',
  },
  'deposit.invoice.pending': {
    en: 'Payment not detected yet. Please try again in a few moments.',
    ko: '결제 내역이 아직 확인되지 않았습니다. 잠시 후 다시 시도하세요.',
  },
  'deposit.invoice.expired': {
    en: 'This deposit confirmation has expired.',
    ko: '입금 확인 시간이 만료되었습니다.',
  },
  'deposit.invoice.error': {
    en: 'Could not create a deposit invoice at this time.',
    ko: '청구서를 생성할 수 없습니다. 잠시 후 다시 시도해주세요.',
  },
  'deposit.token.success': {
    en: '✅ Deposit successful! Redeemed a token for {amount} sats.',
    ko: '✅ 입금 완료! {amount} 사토시 토큰을 교환했습니다.',
  },
  'deposit.token.failure': {
    en: 'Could not redeem the provided token. It might be invalid, expired, or already spent.',
    ko: '토큰을 교환할 수 없습니다. 토큰이 잘못되었거나 만료/사용되었을 수 있습니다.',
  },
  'withdraw.token.dm': {
    en: 'Here is your Cashu token for {amount} sats:\n\n{token}',
    ko: '{amount} 사토시 Cashu 토큰입니다:\n\n{token}',
  },
  'withdraw.token.success': {
    en: '✅ Withdrawal successful! I have sent you a DM with the Cashu token for {amount} sats.',
    ko: '✅ 출금 완료! DM으로 {amount} 사토시 토큰을 전송했습니다.',
  },
  'withdraw.token.failure': {
    en: 'Could not process your withdrawal. {error}',
    ko: '출금을 처리할 수 없습니다. {error}',
  },
  'withdraw.invoice.invalid': {
    en: 'Invalid invoice. Could not decode amount.',
    ko: '잘못된 청구서입니다. 금액을 확인할 수 없습니다.',
  },
  'withdraw.invoice.dm': {
    en:
      '✅ Invoice for {amount} sats paid successfully!\n' +
      '**Preimage:**\n{preimage}',
    ko:
      '✅ {amount} 사토시 청구서를 성공적으로 지불했습니다!\n' +
      '**프리이미지:**\n{preimage}',
  },
  'withdraw.invoice.success': {
    en: 'Invoice paid! I have sent you a confirmation via DM.',
    ko: '청구서를 지불했습니다! DM으로 확인 메시지를 보냈습니다.',
  },
  'withdraw.invoice.failure': {
    en: 'Failed to pay the invoice. The funds have been returned to your balance.',
    ko: '청구서를 지불하지 못했습니다. 금액은 잔액으로 반환되었습니다.',
  },
  'deposit.invoice.button': {
    en: 'Confirm Payment',
    ko: '결제 확인',
  },
  'help.content': {
    en:
      '**Cashu Auction Bot Help**\n' +
      '- `/deposit invoice|token` — add funds by Lightning invoice or Cashu token.\n' +
      '- `/balance` — view available and locked balances.\n' +
      '- `/auction create` — list an item with price, duration, collateral, anti-snipe options, and the auction `mode` (English/Vickrey).\n' +
      '- `/auction list` — browse active or past auctions.\n' +
      '- `/auction cancel` — cancel your auction (admins can cancel any).\n' +
      '- `/bid` — place a bid (collateral locked automatically). Use the `anonymous` flag per bid if you want to hide your Discord ID.\n' +
      '- `/offer create|accept|decline` — propose direct purchase offers or manage incoming ones as a seller/admin.\n' +
      '- `/withdraw token|invoice` — withdraw via Cashu token or pay a Lightning invoice.\n' +
      '- `/admin balance` — admins can inspect any user balance.\n\n' +
      'Default language: {lang}. Use `/help <language>` to switch between `en` or `ko`.',
    ko:
      '**Cashu 경매 봇 도움말**\n' +
      '- `/deposit invoice|token` — 라이트닝 청구서나 Cashu 토큰으로 충전합니다.\n' +
      '- `/balance` — 사용 가능/잠금 잔액을 확인합니다.\n' +
      '- `/auction create` — 경매를 생성합니다 (가격, 기간, 담보 비율, 스나이핑 방지 옵션, `mode` 설정: English/Vickrey).\n' +
      '- `/auction list` — 진행 중/종료된 경매를 확인합니다.\n' +
      '- `/auction cancel` — 자신의 경매를 취소합니다 (관리자는 전체 취소 가능).\n' +
      '- `/bid` — 입찰합니다 (담보 자동 잠금). 익명 입찰 시 `anonymous` 옵션을 true 로 설정하세요.\n' +
      '- `/offer create|accept|decline` — 직접 구매 제안을 보내거나 판매자/관리자가 이를 수락/거절합니다.\n' +
      '- `/withdraw token|invoice` — Cashu 토큰 발급 또는 라이트닝 청구서 지불로 출금합니다.\n' +
      '- `/admin balance` — 관리자가 특정 유저 잔액을 조회합니다.\n\n' +
      '기본 언어: {lang}. `/help <language>` 명령으로 `en` 또는 `ko`를 선택할 수 있습니다.',
  },
} satisfies Record<string, Record<BotLanguage, string>>;

export function resolveLanguageFromInput(input?: string | null): BotLanguage {
  return normalizeLanguage(input, defaultLanguage);
}

export function getDefaultLanguage(): BotLanguage {
  return defaultLanguage;
}

export function getInteractionLanguage(interaction: Interaction): BotLanguage {
  const locale =
    (interaction as CommandInteraction).locale ??
    (interaction as CommandInteraction).guildLocale ??
    (interaction as any)?.user?.locale;
  return resolveLanguageFromInput(locale) || defaultLanguage;
}

export function t(
  key: keyof typeof translations,
  lang: BotLanguage,
  vars: Record<string, string | number> = {},
) {
  const template = translations[key]?.[lang] ?? translations[key]?.en ?? key;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    const value = vars[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}
