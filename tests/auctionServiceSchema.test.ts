import { describe, expect, test } from 'bun:test';
import { AuctionService } from '../src/services/AuctionService';

describe('AuctionService schema safeguards', () => {
  test('finalizeExpiredAuctions ignores missing table errors', async () => {
    const error = new Error('relation "auctions" does not exist');
    (error as any).cause = { code: '42P01', message: error.message };

    const fakeDb = {
      query: {
        auctions: {
          findMany: () => {
            throw error;
          },
        },
      },
    } as any;

    const service = new AuctionService(fakeDb);
    const result = await service.finalizeExpiredAuctions();
    expect(result).toEqual([]);
  });
});
