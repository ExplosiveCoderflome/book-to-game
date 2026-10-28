import {
  buildingDraftModelOutputSchema,
  draftCardToAssetDraft,
  modelItemToDraftCard,
  proposeBuildingAssetsInputSchema,
  type AcceptBuildingDraftsInput,
  type BuildingAsset,
  type BuildingDraftProposal,
  type ProposeBuildingAssetsInput,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { BuildingLibraryService } from './library-service.js';

/** AI adapter seam for building proposals. Implementations only propose; nothing here writes the library. */
export interface BuildingDraftModel {
  proposeBuildings(
    input: {
      prompt: string;
      kinds?: string[];
      genre?: string;
      context?: string;
      count: number;
      existingLabels: string[];
    },
    signal: AbortSignal,
  ): Promise<unknown>;
}

export const BUILDING_DRAFT_CONTEXT_LIMIT = 6_000;

/**
 * Read-only: returns draft cards for author review. Does not mutate the building library or play state.
 */
export async function proposeBuildingAssets(
  library: BuildingLibraryService,
  input: ProposeBuildingAssetsInput,
  model: BuildingDraftModel,
  signal: AbortSignal = AbortSignal.timeout(120_000),
  modelName?: string,
): Promise<BuildingDraftProposal> {
  const parsed = proposeBuildingAssetsInputSchema.parse(input);
  const existingLabels = library.get().library.assets.map(a => a.label);
  const count = parsed.count ?? 6;
  const raw = await model.proposeBuildings({
    prompt: parsed.prompt,
    kinds: parsed.kinds,
    genre: parsed.genre,
    context: parsed.context?.slice(0, BUILDING_DRAFT_CONTEXT_LIMIT),
    count,
    existingLabels,
  }, signal);

  const output = buildingDraftModelOutputSchema.safeParse(raw);
  const warnings: string[] = [];
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的建筑草案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  let items = output.data.buildings;
  if (parsed.kinds?.length) {
    const allow = new Set(parsed.kinds);
    const filtered = items.filter(b => allow.has(b.kind));
    if (filtered.length < items.length) {
      warnings.push(`已过滤 ${items.length - filtered.length} 条不在所选种类内的草案`);
      items = filtered;
    }
  }
  if (items.length === 0) warnings.push('模型未返回可用建筑草案');

  const drafts = items.slice(0, 16).map((item, i) => modelItemToDraftCard(item, i));
  return {
    drafts,
    warnings,
    ...(modelName ? { model: modelName } : {}),
  };
}

/**
 * Accept reviewed drafts into the catalog via createBuildingAsset (unique label · N, never overwrite).
 * Does not touch sessions / play state.
 */
export function acceptBuildingDrafts(
  library: BuildingLibraryService,
  input: AcceptBuildingDraftsInput,
): { library: ReturnType<BuildingLibraryService['get']>['library']; revision: number; assets: BuildingAsset[] } {
  let revision = input.expectedRevision;
  const assets: BuildingAsset[] = [];
  for (const card of input.drafts) {
    const created = library.createAsset(draftCardToAssetDraft(card), revision);
    revision = created.revision;
    assets.push(created.asset);
  }
  const view = library.get();
  return { library: view.library, revision: view.revision, assets };
}
