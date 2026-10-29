/**
 * @novel-game/play-runtime — the ONE play engine (story sessions + open adventures).
 * Server services and the offline export package both call this code; no copies.
 * Pure: depends only on @novel-game/contracts + @novel-game/rules (no Node/DOM/SQL/React).
 */
export { AppError } from './errors.js';
export { RUNTIME_VERSION } from './version.js';

// Story (branching) engine
export type { SessionState } from './story/session-state.js';
export { choiceAvailable, choiceAllowed, applyChoiceEffects } from './story/story-variables.js';
export { findScene, projectSession } from './story/project-session.js';
export { advanceSession } from './story/advance-session.js';
export { createSessionState } from './story/start-session.js';

// Open-world adventure engine
export type { AdventureState } from './adventure/adventure-state.js';
export { matches, effectiveLocationMap, applyEffects, visible, blockedReason, applyWorldbookSpends, recordActionTags, settle } from './adventure/rules.js';
export { systemWait } from './adventure/system-actions.js';
export { projectAdventureMap } from './adventure/map-view.js';
export { projectAdventure, type ProjectAdventureOptions } from './adventure/project-adventure.js';
export { advanceAdventure, type AdvanceAdventureOptions } from './adventure/advance-adventure.js';
export { createAdventureState } from './adventure/start-adventure.js';
export type { AdventureHandCard, AdventureLastResult } from './adventure/adventure-state.js';
export { describeCondition, requiresBlock, resolveEnding, fireThresholds, type BlockedReasonKind } from './adventure/rules.js';
export { isS1World, rngNext, seedFromString, timeLimitOf, computeChance, formatCalendar, formatMonths, type ChanceBreakdown } from './adventure/s1-core.js';
export { STORYLET_CHOICE_PREFIX, storyletChoiceId, refreshHand, runClock, locationText, storyletText } from './adventure/storylets.js';

// Offline package: format, saves, local port (slice §5.3–5.6)
export { sha256Hex } from './package/sha256.js';
export {
  PACKAGE_FORMAT_VERSION, MANIFEST_SCRIPT_ID, CONTENT_SCRIPT_ID,
  scriptSafeJson, contentHashOf, catalogHashOf, loadPackage,
  type PackageManifest, type PackageMode, type PackageDegraded, type PackageContent,
  type StoryPackageContent, type OpenPackageContent, type PackageCatalogSnapshot, type PackageLoadResult,
} from './package/format.js';
export {
  MemorySaveStore, GuardedSaveStore,
  type SaveStore, type SaveStoreStatus, type SaveLocation, type SaveFallbackReason, type SaveTier, type GuardedOptions,
} from './local/save-store.js';
export {
  HOST_API_VERSION, SUPPORTED_HOST_API_VERSIONS, EXE_TRAILER_MAGIC, EXE_TRAILER_LENGTH, SIDECAR_PACKAGE_FILE,
  HOST_SAVES_DIR_DISPLAY, HOST_INDEX_ID, HOST_ID_PATTERN,
  encodeExeTrailer, decodeExeTrailer, hasExeTrailer, detectHost,
  type BtgHost, type ExeTrailer,
} from './package/host-api.js';
export {
  SAVE_FORMAT_VERSION, SAVE_EVENT_LIMIT, classifySave,
  type SaveRecord, type SaveEvent, type SaveSlot, type SaveBlockedReason, type SaveExpectation,
} from './local/save-record.js';
export {
  createLocalStoryPort, createLocalAdventurePort,
  type PlayPort, type LocalPlayPort, type LocalStoryPort, type LocalAdventurePort, type LocalPortDeps,
} from './local/local-play-port.js';
