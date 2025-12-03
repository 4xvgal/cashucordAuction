export type AppErrorCode =
  | 'CONFIGURATION'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_FUNDS'
  | 'TREASURY_SHORTFALL'
  | 'AUCTION_ENDED'
  | 'AUCTION_INACTIVE'
  | 'AUCTION_NOT_FOUND'
  | 'MINT_ERROR';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode = 'VALIDATION',
    public readonly options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export const isAppError = (error: unknown): error is AppError =>
  error instanceof AppError;
