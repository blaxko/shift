// F6 (PRD v1.1): "after clock-out, the ORE claimed is read from the OUT transaction". The ORE ATA's balance change in that
// transaction (post - pre) for the wallet is what ClaimORE delivered to the user, net of ORE's refining fee on the unrefined part.
// Pure over the RPC transaction-meta shape.

interface TokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
export interface TxMetaLike {
  err?: unknown;
  preTokenBalances?: TokenBalance[] | null;
  postTokenBalances?: TokenBalance[] | null;
}

/** null = cannot tell (no meta / failed tx). 0n = the transaction delivered no ORE. */
export function oreReceivedFromMeta(meta: TxMetaLike | null | undefined, wallet: string, oreMint: string): bigint | null {
  if (!meta || meta.err) return null;
  if (!meta.postTokenBalances) return null;
  const sum = (list: TokenBalance[] | null | undefined) =>
    (list ?? []).filter((b) => b.mint === oreMint && b.owner === wallet).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const delta = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
  return delta < 0n ? 0n : delta;
}
