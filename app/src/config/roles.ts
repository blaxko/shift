// PRD F2 role table. Square counts are tunable (Q-8). Pure data.
import type { Role } from '@shift/codec';

export interface RoleDef {
  id: Role;
  label: string;
  squares: number;
  /** 25-bit mask for the Preferred strategy: the first `squares` squares. The squares are interchangeable (the winning square is random), so which ones is arbitrary but fixed. */
  mask: bigint;
  blurb: string;
}

const firstN = (n: number) => (1n << BigInt(n)) - 1n;

export const ROLES: Record<Role, RoleDef> = {
  safe: { id: 'safe', label: 'Safe', squares: 20, mask: firstN(20), blurb: 'Wins most rounds, small payouts' },
  balanced: { id: 'balanced', label: 'Balanced', squares: 10, mask: firstN(10), blurb: 'Even mix' },
  sniper: { id: 'sniper', label: 'Sniper', squares: 3, mask: firstN(3), blurb: 'Rarely wins, bigger payouts' },
};

export const ROLE_ORDER: Role[] = ['safe', 'balanced', 'sniper'];
