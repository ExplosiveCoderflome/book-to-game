import { z } from 'zod';
import {
  acceptItemDraftsInputSchema, acceptLootRowsInputSchema, acceptShelfRowsInputSchema,
  itemAssetSchema, itemCatalogSaveInputSchema, itemCategorySchema,
  proposeItemAssetsInputSchema, proposeLootRowsInputSchema, proposeShelfRowsInputSchema,
  type ItemAssetDraft,
} from '@novel-game/contracts';
import {
  acceptItemDrafts, acceptLootRows, acceptShelfRows,
  proposeItemAssets, proposeLootRows, proposeShelfRows,
  type BuildingShelfWriter,
} from '../../modules/item-catalog/index.js';
import { AppError } from '../../shared/errors.js';
import type { Workbench } from '../workbench.js';
import { command, emptySchema } from './definition.js';

const draftSchema = z.object({
  category: itemCategorySchema,
  label: z.string().min(1).max(80),
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  stack: itemAssetSchema.shape.stack,
  defaultPriceHint: itemAssetSchema.shape.defaultPriceHint,
  resourceValue: itemAssetSchema.shape.resourceValue,
  blurb: z.string().max(500).optional(),
  generateHint: z.string().max(2000).optional(),
  preferredId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  provenance: itemAssetSchema.shape.provenance,
  imageUrl: itemAssetSchema.shape.imageUrl,
  imagePath: itemAssetSchema.shape.imagePath,
  imageProvider: itemAssetSchema.shape.imageProvider,
  imagePrompt: itemAssetSchema.shape.imagePrompt,
  expectedRevision: z.number().int().nonnegative(),
});

const updateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  patch: itemAssetSchema.partial().omit({ id: true }),
});

const deleteSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  force: z.boolean().optional(),
});

function buildingShelfWriter(w: Workbench): BuildingShelfWriter {
  return {
    getAsset(id) {
      return w.buildingLibrary.get().library.assets.find(a => a.id === id) as ReturnType<BuildingShelfWriter['getAsset']>;
    },
    updateAsset(id, patch, expectedRevision) {
      return w.buildingLibrary.updateAsset(id, patch as Parameters<Workbench['buildingLibrary']['updateAsset']>[1], expectedRevision);
    },
    getRevision() {
      return w.buildingLibrary.get().revision;
    },
  };
}

export function itemCatalogCommands(w: Workbench) {
  return [
    command('get_item_catalog', '读取工作区物品目录编目（跨世界可复用资产）。', emptySchema, true, () => w.itemCatalog.get()),
    command('save_item_catalog', '整库保存物品目录；expectedRevision 乐观锁，禁止静默覆盖。',
      itemCatalogSaveInputSchema, false, input => w.itemCatalog.save(input)),
    command('create_item_asset', '新建物品并入库；同名自动加 · N 后缀，不覆盖已有条目。',
      draftSchema, false, input => {
        const { expectedRevision, ...draft } = input;
        return w.itemCatalog.createAsset(draft as ItemAssetDraft, expectedRevision);
      }),
    command('update_item_asset', '更新物品目录中已有条目（同 id）；改名时仍走唯一后缀。',
      updateSchema, false, input => w.itemCatalog.updateAsset(input.id, input.patch, input.expectedRevision)),
    command('delete_item_asset', '从物品目录删除；若被建筑硬行引用则拒绝，除非 force。软草稿 inventoryDraft/lootDraft 不阻断。',
      deleteSchema, false, input => w.itemCatalog.deleteAsset(input.id, input.expectedRevision, { force: input.force })),
    command('propose_item_assets', 'AI：按提示生成物品目录草案卡片，供作者审核；不写入库、不改玩法存档。软价格提示，不强制世界 resourceId。',
      proposeItemAssetsInputSchema, true, async (input) => {
        if (!w.providerConfigured) {
          throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入「模型设置」后再生成物品。', 503);
        }
        const provider = w.createPlayProvider();
        return proposeItemAssets(
          w.itemCatalog, input, provider, AbortSignal.timeout(180_000), provider.modelName,
        );
      }),
    command('accept_item_drafts', '将审核通过的物品草案写入物品目录；同名自动 · N，禁止静默覆盖 id。',
      acceptItemDraftsInputSchema, false, input => acceptItemDrafts(w.itemCatalog, input)),
    command('propose_shelf_rows', 'AI：从已有物品目录提议商店货架行；未知名词挂起为物品草案，禁止直写货架。',
      proposeShelfRowsInputSchema, true, async (input) => {
        if (!w.providerConfigured) {
          throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入「模型设置」后再生成货架。', 503);
        }
        const provider = w.createPlayProvider();
        return proposeShelfRows(
          w.itemCatalog, input, provider, AbortSignal.timeout(180_000), provider.modelName,
        );
      }),
    command('accept_shelf_rows', '将审核通过的货架行写入建筑库商店模板；未知 itemId 拒绝。不改玩法存档/地图。',
      acceptShelfRowsInputSchema, false, input => acceptShelfRows(w.itemCatalog, buildingShelfWriter(w), input)),
    command('propose_loot_rows', 'AI：从已有物品目录提议遭遇掉落行；未知名词挂起为物品草案，禁止直写掉落。',
      proposeLootRowsInputSchema, true, async (input) => {
        if (!w.providerConfigured) {
          throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入「模型设置」后再生成掉落。', 503);
        }
        const provider = w.createPlayProvider();
        return proposeLootRows(
          w.itemCatalog, input, provider, AbortSignal.timeout(180_000), provider.modelName,
        );
      }),
    command('accept_loot_rows', '将审核通过的掉落行写入建筑库遭遇/Boss 模板；未知 itemId 拒绝。不改玩法存档/地图。',
      acceptLootRowsInputSchema, false, input => acceptLootRows(w.itemCatalog, buildingShelfWriter(w), input)),
  ];
}
