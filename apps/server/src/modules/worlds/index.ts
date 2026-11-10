export { WorldService } from './application/world-service.js';
export { validateWorld } from './domain/validate-world.js';
export { SqliteWorldRepository } from './infrastructure/sqlite-world-repository.js';
export { StubMapImageProvider } from './infrastructure/stub-map-image-provider.js';
export { extractMapDraft, MAP_DRAFT_TEXT_LIMIT, type MapDraftModel } from './application/extract-map-draft.js';
export {
  placeMapFill, updateMapFillPlacement, acceptMapFill,
  type PlaceMapFillInput, type UpdateMapFillInput, type AcceptMapFillInput,
} from './application/map-fill.js';
export {
  proposeMapFill, mockMapFillModel, type MapFillModel, type MapFillModelInput,
} from './application/propose-map-fill.js';
export {
  proposeClockPatch, proposeStoryletPatch, mockWorldPatchModel,
  type WorldPatchModel, type WorldPatchModelInput,
} from './application/propose-world-patch.js';
export {applyWorldPatch} from './application/apply-world-patch.js';
export {validateWorldComposition, applyWorldComposition, validateSelectedBlocks} from './application/world-composition.js';
export {checkWorldLedger} from './application/check-world-ledger.js';
export {checkWorldCausality} from './application/check-world-causality.js';
export {checkWorldPreservation} from './application/check-world-preservation.js';
export {proposeWorldReshapeSchema, confirmWorldReshapeSchema} from './application/world-reshape.js';
export {assertWorldPublishQuality} from './application/publish-quality-gate.js';
export {
  proposeFunProfile, recommendBlocksForProfile, resolveProfileBlocks, mockFunProfileModel,
  type FunProfileModel, type FunProfileModelInput,
} from './application/propose-fun-profile.js';
export {
  applyEndConditions, proposeEndConditions, parseEndConditionsText, mockEndConditionsModel,
  END_CONDITIONS_SEVERITY_NOTE,
  type EndConditionsModel, type EndConditionsModelInput,
} from './application/end-conditions.js';
