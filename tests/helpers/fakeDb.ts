import { proofs as proofsTable, users as usersTable } from '../../src/db/schema';

type UserState = { id: string; balance?: bigint; lockedBalance?: bigint };
type ProofState = {
  id?: number;
  amount: number;
  secret: string;
  rawProof: unknown;
  isReserved?: boolean;
  mint_url?: string;
};

const extractWhereValue = (expr: any) => {
  if (!expr?.queryChunks) return undefined;
  for (const chunk of expr.queryChunks) {
    if (Array.isArray(chunk)) {
      return chunk;
    }
    if (typeof chunk === 'string') {
      const trimmed = chunk.trim();
      if (trimmed && trimmed !== '=' && trimmed.toLowerCase() !== 'in') {
        return chunk;
      }
    }
    if (typeof chunk === 'number') {
      return chunk;
    }
  }
  return undefined;
};

export const createFakeDb = (state?: { users?: UserState[]; proofs?: ProofState[] }) => {
  const users = new Map<string, { id: string; balance: bigint; lockedBalance: bigint }>();
  for (const user of state?.users ?? []) {
    users.set(user.id, {
      id: user.id,
      balance: user.balance ?? 0n,
      lockedBalance: user.lockedBalance ?? 0n,
    });
  }

  let proofIdCounter = (state?.proofs ?? []).reduce((max, proof) => Math.max(max, proof.id ?? 0), 0) + 1;
  const proofs: any[] = (state?.proofs ?? []).map((proof) => ({
    ...proof,
    isReserved: proof.isReserved ?? false,
  }));

  return {
    getUser: (id: string) => users.get(id),
    getProofs: () => [...proofs],
    async transaction<T>(callback: (tx: any) => Promise<T>) {
      const tx = {
        query: {
          users: {
            async findFirst({ where }: { where: any }) {
              const id = extractWhereValue(where);
              if (id && users.has(String(id))) {
                return users.get(String(id)) ?? null;
              }
              const iterator = users.values().next();
              return iterator.value ?? null;
            },
          },
          proofs: {
            async findMany() {
              return proofs.filter((proof) => proof.isReserved === false).sort((a, b) => a.amount - b.amount);
            },
          },
        },
        insert(table: any) {
          return {
            values(payload: any) {
              const rows = Array.isArray(payload) ? payload : [payload];
              if (table === usersTable) {
                for (const row of rows) {
                  if (!users.has(row.id)) {
                    users.set(row.id, {
                      id: row.id,
                      balance: row.balance ?? 0n,
                      lockedBalance: row.lockedBalance ?? 0n,
                    });
                  }
                }
              } else if (table === proofsTable) {
                for (const row of rows) {
                  proofs.push({
                    ...row,
                    id: row.id ?? proofIdCounter++,
                    isReserved: row.isReserved ?? false,
                  });
                }
              }
              return {
                onConflictDoNothing() {
                  return undefined;
                },
              };
            },
          };
        },
        update(table: any) {
          return {
            set(values: any) {
              return {
                where(expr: any) {
                  const target = extractWhereValue(expr);
                  if (table === usersTable) {
                    if (typeof target === 'string' && users.has(target)) {
                      const existing = users.get(target)!;
                      users.set(target, { ...existing, ...values });
                    } else {
                      const iterator = users.entries().next();
                      if (!iterator.done) {
                        const [key, existing] = iterator.value;
                        users.set(key, { ...existing, ...values });
                      }
                    }
                  } else if (table === proofsTable) {
                    if (Array.isArray(target)) {
                      for (const id of target) {
                        const index = proofs.findIndex((proof) => proof.id === id);
                        if (index >= 0) {
                          proofs[index] = { ...proofs[index], ...values };
                        }
                      }
                    }
                  }
                },
              };
            },
          };
        },
        delete(table: any) {
          return {
            where(expr: any) {
              const targets = extractWhereValue(expr);
              if (table === proofsTable && Array.isArray(targets)) {
                for (const id of targets) {
                  const index = proofs.findIndex((proof) => proof.id === id);
                  if (index >= 0) {
                    proofs.splice(index, 1);
                  }
                }
              }
            },
          };
        },
      };
      return callback(tx);
    },
  };
};
