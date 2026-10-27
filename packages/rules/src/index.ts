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
