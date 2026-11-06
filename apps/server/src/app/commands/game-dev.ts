import { z } from 'zod';
import { loadGameDevSkill, listGameDevSkills } from '../../modules/agent/index.js';
import { AppError } from '../../shared/errors.js';
import { command, emptySchema } from './definition.js';

const loadSkillSchema = z.object({skillId: z.enum([
  'project-brief', 'world-building', 'pacing-balance', 'quality-review', 'standard-production',
])}).strict();

export function gameDevCommands() {
  return [
    command('list_game_dev_skills', '列出内置游戏开发技能索引；只读，不扫描文件系统。', emptySchema.strict(), true,
      () => listGameDevSkills()),
    command('load_game_dev_skill', '按稳定 ID 加载一个内置游戏开发技能正文；只读，不接受路径或 URL。', loadSkillSchema, true,
      ({skillId}) => {
        const skill = loadGameDevSkill(skillId);
        if (!skill) throw new AppError('GAME_DEV_SKILL_NOT_FOUND', `技能不存在：${skillId}`, 404);
        return skill;
      }),
  ];
}
