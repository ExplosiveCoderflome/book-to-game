import type { WorldEffect } from '@novel-game/contracts';
export interface SimOption {id: string; label: string; enabled: boolean; timeCost: number; effects: WorldEffect[]; fromHand: boolean; storyletId?: string; moves: boolean}
