import { z } from 'zod';
import {
  acceptBuildingDraftsInputSchema, buildingAssetSchema, buildingLibrarySaveInputSchema,
  generateBuildingImageInputSchema, generateBuildingImagePreviewInputSchema,
  mapFillKindSchema, proposeBuildingAssetsInputSchema,
  type BuildingAssetDraft, type LocalPlacementOverrides,
} from '@novel-game/contracts';
import { AppError } from '../../shared/errors.js';
import { acceptBuildingDrafts, proposeBuildingAssets } from '../../modules/building-library/index.js';
import type { Workbench } from '../workbench.js';
import { command, emptySchema } from './definition.js';

const draftSchema = z.object({
  kind: mapFillKindSchema,
  label: z.string().min(1).max(80),
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().min(1).max(40).optional(),
  blurb: z.string().max(500).optional(),
  defaultInteract: buildingAssetSchema.shape.defaultInteract,
  inventoryDraft: buildingAssetSchema.shape.inventoryDraft,
  lootDraft: buildingAssetSchema.shape.lootDraft,
  worldbookTags: buildingAssetSchema.shape.worldbookTags,
  worldbookEntryIds: buildingAssetSchema.shape.worldbookEntryIds,
  resourceCosts: buildingAssetSchema.shape.resourceCosts,
  shop: buildingAssetSchema.shape.shop,
  supply: buildingAssetSchema.shape.supply,
  quest: buildingAssetSchema.shape.quest,
  encounter: buildingAssetSchema.shape.encounter,
  preferredId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  provenance: buildingAssetSchema.shape.provenance,
  expectedRevision: z.number().int().nonnegative(),
});

const updateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  patch: buildingAssetSchema.partial().omit({ id: true }),
});

const deleteSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
});

const promoteSchema = z.object({
  baseId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  label: z.string().min(1).max(80).optional(),
  overrides: z.object({
    label: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    icon: z.string().min(1).max(40).optional(),
    blurb: z.string().max(500).optional(),
    tags: z.array(z.string().min(1).max(40)).max(16).optional(),
    inventoryDraft: buildingAssetSchema.shape.inventoryDraft,
    lootDraft: buildingAssetSchema.shape.lootDraft,
    worldbookTags: buildingAssetSchema.shape.worldbookTags,
    resourceCosts: buildingAssetSchema.shape.resourceCosts,
    shop: buildingAssetSchema.shape.shop,
    supply: buildingAssetSchema.shape.supply,
    quest: buildingAssetSchema.shape.quest,
    encounter: buildingAssetSchema.shape.encounter,
  }).optional(),
});

export function buildingLibraryCommands(w: Workbench) {
  return [
    command('get_building_library', '读取工作区建筑库编目（跨世界可复用资产）。', emptySchema, true, () => w.buildingLibrary.get()),
    command('save_building_library', '整库保存建筑库；expectedRevision 乐观锁，禁止静默覆盖。',
      buildingLibrarySaveInputSchema, false, input => w.buildingLibrary.save(input)),
    command('create_building_asset', '新建建筑资产并入库；同名自动加 · N 后缀，不覆盖已有条目。',
      draftSchema, false, input => {
        const { expectedRevision, ...draft } = input;
        return w.buildingLibrary.createAsset(draft as BuildingAssetDraft, expectedRevision);
      }),
    command('update_building_asset', '更新建筑库中已有资产（同 id）；改名时仍走唯一后缀。',
      updateSchema, false, input => w.buildingLibrary.updateAsset(input.id, input.patch, input.expectedRevision)),
    command('delete_building_asset', '从建筑库删除资产；地图上的引用由校验标错，不自动删除放置。',
      deleteSchema, false, input => w.buildingLibrary.deleteAsset(input.id, input.expectedRevision)),
    command('promote_building_variant', '将放置本地覆盖升格为库中新变体；绝不覆盖原 id/version。',
      promoteSchema, false, input => w.buildingLibrary.promoteVariant(
        input.baseId,
        (input.overrides ?? {}) as LocalPlacementOverrides,
        input.expectedRevision,
        input.label ? { label: input.label } : undefined,
      )),
    command('propose_building_assets', 'AI：按提示生成建筑库草案卡片，供作者审核；不写入库、不改玩法存档。',
      proposeBuildingAssetsInputSchema, true, async (input) => {
        if (!w.providerConfigured) {
          throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入「模型设置」后再生成建筑。', 503);
        }
        const provider = w.createPlayProvider();
        return proposeBuildingAssets(
          w.buildingLibrary, input, provider, AbortSignal.timeout(180_000), provider.modelName,
        );
      }),
    command('accept_building_drafts', '将审核通过的建筑草案写入建筑库；同名自动 · N，禁止静默覆盖。',
      acceptBuildingDraftsInputSchema, false, input => acceptBuildingDrafts(w.buildingLibrary, input)),
    command('generate_building_image', '为建筑库资产生成展示图（显示用）；优先图片 API，失败则确定性 SVG。不改玩法存档。',
      generateBuildingImageInputSchema, false, input => w.buildingImages.generateForAsset(input)),
    command('generate_building_image_preview', '按名称/种类生成建筑图预览（不入库）；草案审核时可选。',
      generateBuildingImagePreviewInputSchema, true, input => w.buildingImages.preview(input)),
  ];
}
