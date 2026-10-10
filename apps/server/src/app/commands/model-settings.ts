import { modelSettingsInputSchema } from '@novel-game/contracts';
import type { Workbench } from '../workbench.js';
import { command, emptySchema } from './definition.js';

export function modelSettingsCommands(w: Workbench) {
  return [
    command('get_model_settings', '读取模型地址、名称和是否已保存 API Key，不返回密钥。', emptySchema, true, () => w.modelSettings.get()),
    command('save_model_settings', '保存模型配置；新执行的任务生效。apiKey留空保留现有密钥，clearApiKey明确清除；更换服务来源必须重新填写或清除。',
      modelSettingsInputSchema, false, input => w.modelSettings.save(input)),
    command('test_model_connection', '使用当前表单检查模型服务的/models接口；不保存配置，不调用生成接口，不验证JSON生成能力。',
      modelSettingsInputSchema, false, input => w.testModelConnection(input)),
  ];
}
