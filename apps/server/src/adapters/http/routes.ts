import { Router } from 'express';
import type { Command } from '../../app/commands/index.js';

const routes = [
  ['get', '/runtime', 'runtime_info'], ['post', '/sources', 'import_source'],
  ['get', '/settings/model', 'get_model_settings'], ['put', '/settings/model', 'save_model_settings'],
  ['post', '/settings/model/test', 'test_model_connection'], ['post', '/settings/model/models', 'list_model_names'],
  ['get', '/settings/building-library', 'get_building_library'],
  ['put', '/settings/building-library', 'save_building_library'],
  ['post', '/settings/building-library/assets', 'create_building_asset'],
  ['put', '/settings/building-library/assets/:id', 'update_building_asset'],
  ['delete', '/settings/building-library/assets/:id', 'delete_building_asset'],
  ['post', '/settings/building-library/promote', 'promote_building_variant'],
  ['post', '/settings/building-library/propose', 'propose_building_assets'],
  ['post', '/settings/building-library/accept', 'accept_building_drafts'],
  ['post', '/settings/building-library/assets/:assetId/generate-image', 'generate_building_image'],
  ['post', '/settings/building-library/generate-image-preview', 'generate_building_image_preview'],
  ['get', '/settings/item-catalog', 'get_item_catalog'],
  ['put', '/settings/item-catalog', 'save_item_catalog'],
  ['post', '/settings/item-catalog/assets', 'create_item_asset'],
  ['put', '/settings/item-catalog/assets/:id', 'update_item_asset'],
  ['delete', '/settings/item-catalog/assets/:id', 'delete_item_asset'],
  ['post', '/settings/item-catalog/propose', 'propose_item_assets'],
  ['post', '/settings/item-catalog/accept', 'accept_item_drafts'],
  ['post', '/settings/item-catalog/propose-shelf', 'propose_shelf_rows'],
  ['post', '/settings/item-catalog/accept-shelf', 'accept_shelf_rows'],
  ['post', '/settings/item-catalog/propose-loot', 'propose_loot_rows'],
  ['post', '/settings/item-catalog/accept-loot', 'accept_loot_rows'],
  ['get', '/sources', 'list_sources'], ['get', '/sources/:id', 'get_source'],
  ['post', '/jobs', 'create_generation_job'], ['get', '/jobs', 'list_jobs'], ['get', '/jobs/:id', 'get_job'],
  ['post', '/production/jobs', 'create_production_job'], ['post', '/jobs/:id/approve-plan', 'approve_production_plan'], ['post', '/production/plan-check', 'check_production_plan'],
  ['post', '/jobs/:id/rewrite-unit', 'rewrite_production_unit'],
  ['post', '/jobs/:id/retry', 'retry_job'], ['post', '/jobs/:id/cancel', 'cancel_job'],
  ['get', '/agent/decisions', 'list_agent_decisions'], ['get', '/agent/status', 'agent_status'],
  ['get', '/worlds/drafts/:id/agent-repairs', 'list_agent_repairs'], ['post', '/worlds/drafts/:id/agent-repairs', 'create_agent_repair'],
  ['post', '/agent/repairs/:id/apply', 'apply_agent_repair'], ['post', '/agent/repairs/:id/reject', 'reject_agent_repair'],
  ['get', '/agent/chats', 'list_agent_chats'], ['post', '/agent/chats', 'create_agent_chat'], ['get', '/agent/chats/:id', 'get_agent_chat'],
  ['post', '/agent/chats/:id/messages', 'send_agent_message'], ['post', '/agent/chats/:id/actions/:actionId', 'decide_agent_action'],
  ['patch', '/worlds/drafts/:id/summary', 'edit_world_summary'],
  ['get', '/drafts', 'list_drafts'], ['post', '/drafts', 'create_draft'], ['get', '/drafts/:id', 'get_draft'],
  ['put', '/drafts/:id', 'update_draft'], ['post', '/drafts/:id/extend-scene', 'extend_draft_scene'], ['post', '/drafts/:id/fill-scene-text', 'fill_draft_scene_text'], ['post', '/drafts/:id/validate', 'validate_draft'], ['post', '/drafts/:id/publish', 'publish_draft'], ['post', '/drafts/:id/lint', 'lint_draft'],
  ['get', '/games', 'list_games'], ['get', '/sessions', 'list_sessions'], ['post', '/sessions', 'start_session'],
  ['get', '/sessions/:id', 'get_session'], ['post', '/sessions/:id/actions', 'act_session'],
  ['post', '/sessions/:id/propose-act', 'propose_act_session'],
  ['post', '/sessions/:id/narrate', 'narrate_session'],
  ['get', '/worlds/drafts', 'list_world_drafts'], ['post', '/worlds/drafts', 'create_world_draft'],
  ['get', '/worlds/drafts/:id', 'get_world_draft'], ['put', '/worlds/drafts/:id', 'update_world_draft'],
  ['post', '/worlds/drafts/:id/archive', 'archive_world_draft'], ['post', '/worlds/drafts/:id/validate', 'validate_world_draft'], ['post', '/worlds/drafts/:id/publish', 'publish_world_draft'], ['post', '/worlds/drafts/:id/map-draft', 'extract_map_draft'],
  ['post', '/worlds/drafts/:id/lint', 'lint_world_draft'], ['post', '/worlds/drafts/:id/playtest', 'playtest_world_draft'], ['get', '/worlds/drafts/:id/preflight', 'get_world_preflight'],
  ['get', '/worlds/revisions', 'list_world_revisions'], ['get', '/adventures', 'list_adventures'], ['post', '/adventures', 'start_adventure'],
  ['get', '/adventures/:id', 'get_adventure'], ['post', '/adventures/:id/actions', 'act_adventure'],
  ['post', '/adventures/:id/propose-act', 'propose_act_adventure'],
  ['post', '/adventures/:id/narrate', 'narrate_adventure'],
  ['post', '/exports/play-package', 'export_play_package'], ['get', '/exports/targets', 'export_targets'],
] as const;
export function apiRouter(commands: Command[]) {
  const router = Router();
  const byName = new Map(commands.map(c => [c.name, c]));
  for (const [method, path, name] of routes) {
    const command = byName.get(name)!;
    router[method](path, async (req, res) => {
      const result = await command.execute({...req.body, ...req.params});
      res.json(result);
    });
  }
  return router;
}
