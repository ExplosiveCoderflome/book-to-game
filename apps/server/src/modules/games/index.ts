export { GameService } from './application/game-service.js';
export { SqliteGameRepository } from './infrastructure/sqlite-game-repository.js';
export type { GameRepository, SourceReader } from './application/ports.js';
export type { Draft, GameRevision, GameContent, ValidationResult } from '@novel-game/contracts';

export { assessPlayability, annotatePlayability, assertPlayableSkeleton, assertExpandedHonorsSkeleton } from './domain/playability.js';
