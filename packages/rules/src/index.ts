/** Pure rule engines — no React, Express, or SQL. Schema/DTO authority stays in @novel-game/contracts. */

export {
  analyzeReachability, choiceAvailable as reachChoiceAvailable, applyChoiceEffects as reachApplyEffects,
  type ReachabilityGraph, type ReachabilityReport, type ReachChoice, type ReachScene,
  type ReachCondition, type ReachEffect, type ReachVarValue,
} from './reachability.js';

export {
  assessPlayability, annotatePlayability, collectPlayabilityIssues, normalizeEndingText, endingTextSimilarity,
  type PlayabilityMode, type PlayabilityIssue, type PlayabilityAnnotation, type PlayabilityGraph, type PlayabilityResult,
} from './playability.js';

export {
  assessOpeningActions, initialWorldState, matchesWorldConditions, isWaitLikeAction,
  type OpeningActionReport, type OpeningEvalState, type WorldConditionState,
} from './world-opening.js';

export {
  entryAppliesToScene, entryAppliesToLocation, entriesForPlace, entriesForScene,
  worldbookBlockReason, worldbookIncrementCap, worldbookSpendsForChoice, mergeTakenTags,
} from './worldbook.js';

export {
  KindRegistry,
  type KindFamily,
  type KindMeta,
  type KindEntry,
} from './kind-registry.js';

export {
  storyConditionKinds,
  storyEffectKinds,
  worldConditionKinds,
  worldEffectKinds,
  evalStoryCondition,
  applyStoryEffect,
  evalWorldCondition,
  listAllKindMeta,
  resetBuiltinKinds,
  type StoryConditionEvaluator,
  type StoryEffectApplier,
  type WorldConditionEvaluator,
} from './kind-builtins.js';


export {
  cellKey, parseCellKey, offsetToAxial, axialToOffset, hexInBounds, listHexCells, hexToPixel, hexCorners, hexDistance,
  validateWorldMap, type Axial, type WorldMapIssue, type WorldMapIssueCode,
} from './world-map.js';
