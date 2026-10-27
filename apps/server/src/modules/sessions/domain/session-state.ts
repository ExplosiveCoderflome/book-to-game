import type { SessionView, VariableValue } from '@novel-game/contracts';

export interface SessionState {
  id: string;
  gameRevisionId: string;
  sceneId: string;
  turn: number;
  ended: boolean;
  variables?: Record<string, VariableValue>;
  /** Tags from choices already taken — drives worldbook one_path_lock. */
  takenTags?: string[];
  history: SessionView['history'];
  createdAt: string;
  updatedAt: string;
}
