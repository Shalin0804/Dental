import type { Tx } from "../config/db.js";

/** Atomically increments a named counter (row lock via UPDATE) and returns the new value. */
export async function nextSeq(tx: Tx, key: string): Promise<number> {
  const c = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return c.value;
}

export const patientCode = (n: number) => `SDC-P${String(n).padStart(6, "0")}`;
