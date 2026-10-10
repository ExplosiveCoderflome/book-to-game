import type { AdventureActInput, AdventureView, WorldRevision } from '@novel-game/contracts';
import type { AdventureState } from '../domain/adventure-state.js';
export interface RevisionReader {getRevision(id: string): WorldRevision}
export interface AdventureRepository {
  insert(state: AdventureState): void;
  get(id: string): AdventureState | undefined;
  list(): AdventureState[];
  act(id: string, input: AdventureActInput, transition: (state: AdventureState) => {state: AdventureState; response: AdventureView}): AdventureView;
}
