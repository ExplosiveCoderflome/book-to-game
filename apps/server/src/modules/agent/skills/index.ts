export interface GameDevSkill {
  id: string;
  version: string;
  title: string;
  summary: string;
  whenToUse: string;
  relatedToolNames: readonly string[];
  body: string;
}

const skills = [
  {
    id: 'project-brief', version: '1.0.0', title: '立项',
    summary: '把用户想法整理为可验证的玩家目标与核心循环。',
    whenToUse: '用户提出新游戏想法、目标或体验方向时；小说与设定素材可选。',
    relatedToolNames: ['list_sources', 'read_source', 'list_blocks', 'get_block', 'list_fun_profiles', 'list_genre_recipes',
      'validate_world_draft', 'validate_draft', 'create_world_from_idea', 'validate_world_composition', 'apply_world_composition', 'create_production_job'],
    body: `## 步骤
1. 先调用 list_sources 查看可选素材；只有与目标相关时才调用 read_source。把用户想法当作一等输入，不要求先导入小说。
2. 明确玩家身份、可观察目标、核心循环、关键取舍和预期局长；不确定处标为待讨论，不替作者定案。
3. 调用 list_blocks、list_fun_profiles、list_genre_recipes，按需调用 get_block 读取目录条目；新世界使用 create_world_from_idea 提交想法与完整小版本 WorldContent，不先创建 production job。
4. 调用 validate_world_draft 或 validate_draft 检查第一版，再按已有工具反馈局部修复。

## 边界
create_world_from_idea 会将想法登记为来源并直接创建草稿，不调用 worker；来源、草稿与 requestId 映射在同一事务中提交。所有写操作照旧由作者确认。账本、因果和内容保留没有独立检查工具时，明确标记尚未验证，不得自报通过。`,
  },
  {
    id: 'world-building', version: '1.0.0', title: '搭世界',
    summary: '用现有 WorldContent 和积木目录逐步搭建可运行世界。',
    whenToUse: '需要创建或扩展地点、行动、剧情卡、条件、效果、资源或结局时。',
    relatedToolNames: ['read_world_draft', 'list_blocks', 'get_block', 'list_genre_recipes', 'list_fun_profiles',
      'add_world_location', 'update_world_location', 'add_world_storylet', 'update_world_storylet',
      'add_storylet_condition', 'remove_storylet_condition', 'add_storylet_effect', 'remove_storylet_effect',
      'add_world_resource_def', 'update_world_resource_def', 'apply_world_patch', 'apply_end_conditions',
      'validate_world_draft', 'lint_world_draft', 'playtest_world_draft', 'validate_world_composition', 'apply_world_composition', 'check_world_ledger', 'check_world_causality', 'check_world_preservation', 'propose_world_reshape', 'confirm_world_reshape'],
    body: `## 步骤
1. 先调用 read_world_draft 并查看 list_blocks；按需调用 get_block、list_genre_recipes 与 list_fun_profiles。组合工具会检查所选积木版本、参数、依赖、冲突及 requires；这里只验证声明式契约，不是通用代码生成器。
2. 先搭一条小而完整的可玩循环，再按需要扩展地点、剧情卡和规则。避免以模块数量衡量完成度。
3. 多实体组合先调用 validate_world_composition 只读预演，核对返回候选与积木回执，再调用 apply_world_composition 并由作者确认；单项编辑仍可使用 add_world_location、update_world_location、add_world_storylet、update_world_storylet、add_storylet_condition、remove_storylet_condition、add_storylet_effect、remove_storylet_effect、add_world_resource_def、update_world_resource_def、apply_world_patch 或 apply_end_conditions。
4. 根据工具反馈定位到相关对象，小步修改并重新调用相应检查命令；不把失败时的大范围重写当作默认修复。

## 边界
每项写入仍需作者确认并遵守版本守卫。现有 patch 仅支持声明的有限路径，不是任意 WorldContent 编辑器。使用 check_world_ledger 检查账本断言、check_world_causality 检查有限结构化因果见证；使用 check_world_preservation 查看服务器基线与结构化正文差异。内容保留检查不证明自然语言剧情语义。必要重塑先 propose_world_reshape({worldId, expectedVersion, content}) 获取服务器精确差异和 diffHash，再 confirm_world_reshape 使用同一候选、版本及 diffHash 生成专门作者确认项；只有作者确认后保存并建立新基线。不能用普通confirm、allowDestructive或模型提供的凭据绕过保护；过大差异须拆分。`,
  },
  {
    id: 'pacing-balance', version: '1.0.0', title: '数值节奏',
    summary: '结合确定性试玩反馈调整资源、局长、路线与选择节奏。',
    whenToUse: '规则已经可以运行，需要评估资源变化、选择节奏或流程长度时。',
    relatedToolNames: ['read_world_draft', 'playtest_world_draft', 'get_world_preflight', 'add_storylet_condition',
      'remove_storylet_condition', 'add_storylet_effect', 'remove_storylet_effect', 'add_world_resource_def',
      'update_world_resource_def', 'validate_world_draft', 'lint_world_draft', 'check_world_causality'],
    body: `## 步骤
1. 调用 read_world_draft 读取最新世界草稿和版本，确认当前资源定义、剧情卡条件/效果、终局条件与作者期望。
2. 调用 playtest_world_draft 及 get_world_preflight 查看真实引擎重放证据；检查 contentHash、策略/种子/actionIds witness、raw/effective steps、dead end 与预算截断。有限抽样未命中只表示 sampled-not-hit，不是不可达证明。
3. 对照路线、结局、dead end 和资源曲线定位具体反例；区分机械规则反馈与主观体验。
4. 只修改与反例相关的条件、效果、资源或节奏，再调用 validate_world_draft、lint_world_draft 和 playtest_world_draft 复测。

## 边界
不能把原始步数当作有效选择，也不能通过空转或末尾全结局菜单刷指标。证据 hash 由服务端生成并绑定规则、正文、积木与规格；unsupported 不得当作通过。check_world_causality 只对已声明资源尝试有限配对见证，不验证关键选择/承诺成对后果或自由文本语义。`,
  },
  {
    id: 'quality-review', version: '1.0.0', title: '质检',
    summary: '用现有校验、lint、预检和试玩检查并按反例局部修复。',
    whenToUse: '构建或修改后需要检查结构、规则、结局和有限试玩表现时。',
    relatedToolNames: ['read_world_draft', 'validate_world_draft', 'validate_draft', 'lint_world_draft', 'lint_draft',
      'get_world_preflight', 'playtest_world_draft', 'check_world_ledger', 'check_world_causality'],
    body: `## 步骤
1. 调用 read_world_draft 读取草稿最新版本；按草稿类型调用 validate_world_draft 或 validate_draft、lint_world_draft 或 lint_draft，以及 get_world_preflight。
2. 对可试玩世界调用 playtest_world_draft，检查报告指出的路线、结局和死路问题；用同一策略与种子复放 actionIds witness。抽样未命中不是不可达证明。
3. 对已声明结构化账本断言调用 check_world_ledger({worldId, expectedVersion})；对资源、关键选择与结局依赖调用 check_world_causality({worldId, expectedVersion})，核对合法路径见证及 hash。
4. 将每条发现归类为阻断、警告、有限抽样未覆盖或当前工具不支持；不得将抽样未命中写成不可达证明。
5. 将失败映射到具体地点、剧情卡、条件、效果或资源，仅局部修复并复测。

## 边界
账本工具只校验 typed ledgerAssertions 与有限引擎重放；因果工具只检查声明式结构与已观察合法路径，关键选择/承诺的成对后果仍不支持，不理解自由文本或证明全状态空间。状态 unsupported/inconclusive 必须保留；正文保留仍未检查，真人体验仍需作者判断。不得绕过发布门禁或作者确认。`,
  },
  {
    id: 'standard-production', version: '1.0.0', title: '标准制作（可选）',
    summary: '显式选择完整 production 规划、审阅与分段正文流程时使用。',
    whenToUse: '作者明确要求标准制作流程，或完整规划和分段正文适合当前任务时；它不是默认前置步骤。',
    relatedToolNames: ['list_sources', 'read_source', 'create_production_job', 'read_job', 'check_job_plan',
      'approve_saved_production_plan', 'rewrite_production_unit', 'retry_job', 'cancel_job'],
    body: `## 步骤
1. 按需调用 list_sources、read_source 查看素材并明确 brief；调用 create_production_job 后用 read_job 跟进状态。
2. 到 awaiting_review 后调用 read_job 读取 productionState.plan，再调用 check_job_plan，向作者说明结构与阻断问题。
3. 仅在检查结果允许时提议调用 approve_saved_production_plan；作者确认后等待 worker 完成，再用 read_job 分段读取正文与检查结果。
4. 根据反馈调用 rewrite_production_unit 局部修复；需要恢复时使用 retry_job，需要取消时使用 cancel_job。确认任务最终状态，不把排队当完成。

## 边界
create_production_job、check_job_plan、approve_saved_production_plan、worker 和修订工具均为现有能力；审批、重试、取消及写入仍保留现有作者确认和版本语义。流程不会自动证明账本、因果或内容保留；没有独立工具时明确未验证，不得自报通过。`,
  },
] satisfies readonly GameDevSkill[];

export const GAME_DEV_SKILLS: readonly GameDevSkill[] = Object.freeze(skills.map(skill => Object.freeze(skill)));
const byId = new Map(GAME_DEV_SKILLS.map(skill => [skill.id, skill]));

export function listGameDevSkills() {
  return GAME_DEV_SKILLS.map(({id, version, title, summary, whenToUse}) => ({id, version, title, summary, whenToUse}));
}

export function loadGameDevSkill(id: string): GameDevSkill | undefined {
  return byId.get(id);
}

export function gameDevSkillPromptIndex(): string {
  return GAME_DEV_SKILLS.filter(skill => skill.id !== 'standard-production')
    .map(skill => `- ${skill.id}: ${skill.whenToUse}`).join('\n');
}
