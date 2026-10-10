import type { SessionView } from '@novel-game/contracts';

export interface SessionState {
  id: string;
  gameRevisionId: string;
  sceneId: string;
  turn: number;
  ended: boolean;
  history: SessionView['history'];
  createdAt: string;
  updatedAt: string;
}
