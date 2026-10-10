import { Router } from 'express';
import type { Command } from '../../app/commands/index.js';

const routes = [
  ['get', '/runtime', 'runtime_info'], ['post', '/sources', 'import_source'],
  ['get', '/settings/model', 'get_model_settings'], ['put', '/settings/model', 'save_model_settings'],
  ['post', '/settings/model/test', 'test_model_connection'],
  ['get', '/sources', 'list_sources'], ['get', '/sources/:id', 'get_source'],
  ['post', '/jobs', 'create_generation_job'], ['get', '/jobs', 'list_jobs'], ['get', '/jobs/:id', 'get_job'],
  ['post', '/jobs/:id/retry', 'retry_job'], ['post', '/jobs/:id/cancel', 'cancel_job'],
  ['get', '/drafts', 'list_drafts'], ['post', '/drafts', 'create_draft'], ['get', '/drafts/:id', 'get_draft'],
  ['put', '/drafts/:id', 'update_draft'], ['post', '/drafts/:id/validate', 'validate_draft'], ['post', '/drafts/:id/publish', 'publish_draft'],
  ['get', '/games', 'list_games'], ['get', '/sessions', 'list_sessions'], ['post', '/sessions', 'start_session'],
  ['get', '/sessions/:id', 'get_session'], ['post', '/sessions/:id/actions', 'act_session'],
  ['get', '/worlds/drafts', 'list_world_drafts'], ['post', '/worlds/drafts', 'create_world_draft'],
  ['get', '/worlds/drafts/:id', 'get_world_draft'], ['put', '/worlds/drafts/:id', 'update_world_draft'],
  ['post', '/worlds/drafts/:id/validate', 'validate_world_draft'], ['post', '/worlds/drafts/:id/publish', 'publish_world_draft'],
  ['get', '/worlds/revisions', 'list_world_revisions'], ['get', '/adventures', 'list_adventures'], ['post', '/adventures', 'start_adventure'],
  ['get', '/adventures/:id', 'get_adventure'], ['post', '/adventures/:id/actions', 'act_adventure'],
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
