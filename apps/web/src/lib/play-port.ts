import type {
  ActInput, AdventureActInput, AdventureView, GameRevision, SessionView, WorldRevision,
} from '@novel-game/contracts';
import type { SaveSlot } from '../components/player/SaveSlotList';

/**
 * Where play runs, as seen by the player pages (slice §5.6). M1 `/play` uses HTTP;
 * the export package uses the same @novel-game/play-runtime engine in the browser.
 * Pages never branch on the transport — only on `context` for chrome (links, labels).
 */
export interface PlayPagePort<R, V, A> {
  readonly context: 'web' | 'package';
  revision(revisionId: string): Promise<R | null>;
  /** Playable saves for this revision, newest first. */
  list(revisionId: string): Promise<V[]>;
  /** Package only: every row incl. greyed (old / corrupt) ones, already labelled. */
  rows?(t: Translate): SaveSlot[];
  get(id: string): Promise<V>;
  start(revisionId: string): Promise<V>;
  act(id: string, input: A): Promise<V>;
  message(error: unknown): string;
  /** True when the outcome is unknown (retry the same request). Local play is never uncertain. */
  uncertain(error: unknown): boolean;
  /** Pending-request memory (sessionStorage on web; null when the browser refuses storage). */
  pendingStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  pendingKey(kind: 'story' | 'world'): string;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type StoryPagePort = PlayPagePort<GameRevision, SessionView, ActInput>;
export type WorldPagePort = PlayPagePort<WorldRevision, AdventureView, AdventureActInput>;
