import type { SessionView, VariableValue } from '@novel-game/contracts';

export interface SessionState {
  id: string;
  gameRevisionId: string;
  sceneId: string;
  turn: number;
  ended: boolean;
  variables?: Record<string, VariableValue>;
  history: SessionView['history'];
  createdAt: string;
  updatedAt: string;
}
