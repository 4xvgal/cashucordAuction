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
      '**시작가:** {startPrice} sats\n' +
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
      '현재가: {price} sats • 담보: {collateral}%\n' +
      '{topBid}',
  },
  'auction.list.vickreyEntry': {
    en:
      '**#{id} • {title}**\n' +
      '{endLabel}\n' +
      '🔏 Vickrey auction — price and bidders stay hidden until it ends.',
    ko:
      '**#{id} • {title}**\n' +
      '{endLabel}\n' +
      '🔏 비크리 경매 — 종료 전까지 가격과 입찰자는 비공개입니다.',
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
    ko: '최고 입찰: {amount} sats (입찰자 {bidder})',
  },
  'auction.list.noBids': {
    en: 'No bids yet',
    ko: '아직 입찰 없음',
  },
  'auction.cancel.success': {
    en: '🛑 Auction #{id} ({title}) has been cancelled.',
    ko: '🛑 #{id} ({title}) 경매가 취소되었습니다.',
  },
  'auction.cancel.broadcast': {
    en: '🛑 Auction #{id} ({title}) has been cancelled.',
    ko: '🛑 #{id} ({title}) 경매가 취소되었습니다.',
  },
  'auction.edit.noChanges': {
    en: 'Nothing to update. Provide at least one field.',
    ko: '변경할 항목이 없습니다. 최소 한 가지 값을 입력하세요.',
  },
  'auction.edit.invalidTitle': {
    en: 'Title cannot be empty.',
    ko: '제목은 비워둘 수 없습니다.',
  },
  'auction.edit.hasBids': {
    en: 'Start price and collateral ratio can only be changed before any bids are placed.',
    ko: '입찰이 없는 경우에만 시작가와 담보율을 수정할 수 있습니다.',
  },
  'auction.edit.vickreyOnly': {
    en: 'Vickrey notifications can only be toggled on Vickrey-mode auctions.',
    ko: '비크리 경매에서만 익명 입찰 알림을 설정할 수 있습니다.',
  },
  'auction.edit.success': {
    en: '✅ Auction #{id} updated (current title: {title}).',
    ko: '✅ 경매 #{id}가 수정되었습니다 (현재 제목: {title}).',
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
      '**새 금액:** {amount} sats\n' +
      '**입찰자:** {bidderDisplay}\n\n' +
      '{endNote}',
  },
  'bid.success.vickreyNotify': {
    en: '✅ Bid accepted. Posting an anonymous update in the channel.',
    ko: '✅ 입찰이 접수되었습니다. 채널에 익명 안내를 올립니다.',
  },
  'bid.success.vickreySilent': {
    en: '✅ Bid accepted. This sealed auction stays silent until it closes.',
    ko: '✅ 입찰이 접수되었습니다. 이 비크리 경매는 종료 전까지 비공개로 유지됩니다.',
  },
  'bid.privacyNotice': {
    en: 'Your bid has been recorded anonymously. Good luck!',
    ko: '입찰이 익명으로 기록되었습니다. 행운을 빕니다!',
  },
  'bid.success.ephemeral': {
    en: '✅ Bid accepted. Posting the update in the channel.',
    ko: '✅ 입찰이 접수되었습니다. 채널에 안내를 올립니다.',
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
    ko: '입찰 금액은 현재가 {price} sats보다 높아야 합니다.',
  },
  'bid.error.selfBid': {
    en: 'You cannot bid on your own auction.',
    ko: '자신의 경매에는 입찰할 수 없습니다.',
  },
  'bid.error.collateral': {
    en: 'Insufficient collateral. You need at least {required} sats available (Balance - Locked).',
    ko: '담보가 부족합니다. (잔액 - 잠금)이 최소 {required} sats 이상이어야 합니다.',
  },
  'balance.display': {
    en:
      'Your Balance:\n----------------\n' +
      '**Available:** {available} sats\n' +
      '**Locked in Bids:** {locked} sats\n' +
      '**Total:** {total} sats',
    ko:
      '현재 잔액:\n----------------\n' +
      '**사용 가능:** {available} sats\n' +
      '**입찰 잠금:** {locked} sats\n' +
      '**총합:** {total} sats',
  },
  'auction.vickrey.newBid': {
    en: '🔏 A new anonymous bid was placed on auction #{id} ({title}).',
    ko: '🔏 경매 #{id} ({title})에 새로운 익명 입찰이 들어왔습니다.',
  },
  'auction.result.privacy': {
    en: 'Auction ended. Sold to an anonymous buyer for {amount} sats.',
    ko: '경매가 종료되었습니다. 익명의 구매자에게 {amount} sats에 판매되었습니다.',
  },
  'auction.result.public': {
    en: 'Auction ended. Sold to {winner} for {amount} sats.',
    ko: '경매가 종료되었습니다. {winner} 님이 {amount} sats에 낙찰되었습니다.',
  },
  'auction.vickrey.result.public': {
    en:
      '🔏 Vickrey auction #{id} "{title}" ended.\n' +
      'Winner: {alias}\n' +
      'Highest bid: {highest} sats\n' +
      'Price to settle (second-highest): {second} sats.',
    ko:
      '🔏 비크리 경매 #{id} "{title}"가 종료되었습니다.\n' +
      '우승자: {alias}\n' +
      '최고 입찰가: {highest} sats\n' +
      '정산 금액(2등 입찰가): {second} sats.',
  },
  'auction.result.noBids': {
    en: 'Auction ended without any bids.',
    ko: '입찰 없이 경매가 종료되었습니다.',
  },
  'auction.dm.seller': {
    en: '✅ Auction "{title}" sold to {winner} for {amount} sats.\nDeposit credited now: {deposit} sats.\nRemaining to settle: {remaining} sats.\nYour new balance: {balance} sats.',
    ko: '✅ "{title}" 경매가 {winner} 님에게 {amount} sats에 판매되었습니다.\n지금 입금된 보증금: {deposit} sats\n추가 정산 금액: {remaining} sats\n현재 잔액: {balance} sats',
  },
  'auction.dm.winner': {
    en: '🎉 You won "{title}" for {amount} sats.\nDeposit deducted now: {deposit} sats.\nRemaining to pay seller: {remaining} sats.\nYour new balance: {balance} sats.',
    ko: '🎉 "{title}" 경매를 {amount} sats에 낙찰 받았습니다.\n이번에 차감된 보증금: {deposit} sats\n판매자에게 전달할 나머지 금액: {remaining} sats\n현재 잔액: {balance} sats',
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
      '**사용 가능:** {available} sats\n' +
      '**잠금:** {locked} sats\n' +
      '**총합:** {total} sats',
  },
  'deposit.invoice.prompt': {
    en: 'Here is your Lightning invoice for {amount} sats. Scan or copy the invoice shown below, then press the button to confirm once it is paid.',
    ko: '{amount} sats 라이트닝 청구서입니다. 아래 표시된 인보이스를 스캔하거나 복사한 뒤, 결제가 완료되면 버튼을 눌러 확인하세요.',
  },
  'deposit.invoice.success': {
    en: '✅ Deposit successful! {amount} sats have been added to your balance.',
    ko: '✅ 입금 완료! {amount} sats가 잔액에 추가되었습니다.',
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
    ko: '✅ 입금 완료! {amount} sats 토큰을 교환했습니다.',
  },
  'deposit.token.failure': {
    en: 'Could not redeem the provided token. It might be invalid, expired, or already spent.',
    ko: '토큰을 교환할 수 없습니다. 토큰이 잘못되었거나 만료/사용되었을 수 있습니다.',
  },
  'withdraw.token.dm': {
    en: 'Here is your Cashu token for {amount} sats. Scan the QR or copy the token below.',
    ko: '{amount} sats Cashu 토큰입니다. QR을 스캔하거나 아래 토큰을 복사하세요.',
  },
  'withdraw.token.success': {
    en: '✅ Withdrawal successful! I have sent you a DM with the Cashu token for {amount} sats.',
    ko: '✅ 출금 완료! DM으로 {amount} sats 토큰을 전송했습니다.',
  },
  'withdraw.token.failure': {
    en: 'Could not process your withdrawal. {error}',
    ko: '출금을 처리할 수 없습니다. {error}',
  },
  'withdraw.invoice.invalid': {
    en: 'Invalid invoice. Could not decode amount.',
    ko: '잘못된 청구서입니다. 금액을 확인할 수 없습니다.',
  },
  'withdraw.invoice.numberInput': {
    en: 'Please paste a Lightning invoice. Entering a plain number will not work; generate an invoice for the desired amount and try again.',
    ko: '숫자 입력이 아닌, 결제하고자 하는 금액으로 생성한 라이트닝 인보이스를 붙여넣어 주세요.',
  },
  'withdraw.invoice.decodeFailed': {
    en: 'Failed to read that Lightning invoice. Double-check the text and make sure it is a valid Bolt11 string.',
    ko: '라이트닝 인보이스를 읽을 수 없습니다. 올바른 Bolt11 문자열인지 다시 확인해 주세요.',
  },
  'withdraw.invoice.dm': {
    en:
      '✅ Invoice for {amount} sats paid successfully!\n' +
      '**Preimage:**\n{preimage}',
    ko:
      '✅ {amount} sats 청구서를 성공적으로 지불했습니다!\n' +
      '**프리이미지:**\n{preimage}',
  },
  'withdraw.invoice.success': {
    en: 'Invoice paid! I have sent you a confirmation via DM.\n(Network fee reserve: {fee} sats were held to cover Lightning fees. Keep some extra balance available for future withdrawals.)',
    ko: '청구서를 지불했습니다! DM으로 확인 메시지를 보냈습니다.\n(라이트닝 수수료를 위해 {fee} sats를 예약했습니다. 다음 출금 시에도 수수료만큼 여유 잔액을 남겨주세요.)',
  },
  'withdraw.invoice.failure': {
    en: 'Failed to pay the invoice. The funds have been returned to your balance.',
    ko: '청구서를 지불하지 못했습니다. 금액은 잔액으로 반환되었습니다.',
  },
  'withdraw.lnurl.invalid': {
    en: 'That LNURL could not be decoded. Please double-check the lnurl1... string.',
    ko: '해당 LNURL을 해독할 수 없습니다. lnurl1 로 시작하는 문자열을 다시 확인해주세요.',
  },
  'withdraw.lnurl.fetchFailed': {
    en: 'Could not fetch LNURL metadata. The receiver may be offline.',
    ko: 'LNURL 정보를 가져올 수 없습니다. 상대 노드가 오프라인일 수 있습니다.',
  },
  'withdraw.lnurl.unsupported': {
    en: 'The LNURL response is not a payRequest link or is missing callback details.',
    ko: '해당 LNURL이 payRequest 형식이 아니거나 callback 정보가 없습니다.',
  },
  'withdraw.lnurl.insecure': {
    en: 'LNURL callback must use HTTPS (localhost allowed for testing only).',
    ko: 'LNURL callback 은 HTTPS 여야 합니다 (테스트용 localhost 제외).',
  },
  'withdraw.lnurl.invalidRange': {
    en: 'The LNURL sendable range is invalid.',
    ko: 'LNURL에서 제공한 전송 가능 범위가 잘못되었습니다.',
  },
  'withdraw.lnurl.amountRequired': {
    en: 'This LNURL accepts {min}–{max} sats. Please specify an amount within that range.',
    ko: '이 LNURL은 {min}–{max} sats 범위만 허용합니다. 해당 범위 내 금액을 입력해주세요.',
  },
  'withdraw.lnurl.amountRange': {
    en: 'Amount must be between {min} and {max} sats for this LNURL.',
    ko: '이 LNURL은 {min}–{max} sats 사이만 허용합니다.',
  },
  'withdraw.lnurl.callbackFailed': {
    en: 'The LNURL callback failed to return an invoice.',
    ko: 'LNURL callback 에서 인보이스를 반환하지 못했습니다.',
  },
  'withdraw.lnurl.invoiceMissing': {
    en: 'LNURL callback response did not include an invoice (pr).',
    ko: 'LNURL callback 응답에 인보이스(pr)가 없습니다.',
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
