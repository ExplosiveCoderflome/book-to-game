import { command, emptySchema } from './definition.js';
import { sourceCommands } from './sources.js';
import { gameCommands } from './games.js';
import { modelSettingsCommands } from './model-settings.js';
import { worldCommands } from './worlds.js';
import { adventureCommands } from './adventures.js';
import type { Workbench } from '../workbench.js';

export function createCommands(w: Workbench) {
  return [command('runtime_info', '查询支持的模式与模型是否已配置，不暴露凭据。', emptySchema, true,
    () => ({providerConfigured: w.providerConfigured, supportedModes: ['story', 'open'], version: '0.2.0', worldSchemaVersion: 1})),
  ...sourceCommands(w), ...gameCommands(w), ...modelSettingsCommands(w), ...worldCommands(w), ...adventureCommands(w)];
}
export type { Command } from './definition.js';
