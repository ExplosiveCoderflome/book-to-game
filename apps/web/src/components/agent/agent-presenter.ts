import type { AgentChatAction, AgentChatMessage } from '@novel-game/contracts';

const labels: Record<string, string> = {
  list_world_drafts: '查看世界草稿', read_world_draft: '读取草稿内容', list_jobs: '查看制作任务', read_job: '读取制作规划',
  check_job_plan: '检查玩法规则', approve_saved_production_plan: '确认规划并开始写作', read_source: '读取原作资料', list_sources: '查看原作书架',
  lint_world_draft: '检查内容质量', playtest_world_draft: '模拟试玩', validate_world_draft: '校验世界结构', get_world_preflight: '读取体检报告',
  create_production_job: '创建制作任务', create_generation_job: '创建改编任务', rewrite_production_unit: '重写正文单元',
  create_agent_repair: '生成修复候选', list_agent_repairs: '读取修复候选', apply_agent_repair: '应用修复候选', reject_agent_repair: '驳回修复候选',
  edit_world_summary: '修改世界摘要', publish_world_draft: '发布世界版本', retry_job: '恢复制作任务', cancel_job: '取消制作任务',
  runtime_info: '检查工作空间', agent_status: '查看 Agent 状态', list_agent_decisions: '查看监督记录',
};
export const toolLabel = (name: string) => labels[name] ?? name;
export function conversationLabel(title: string) {
  return title.startsWith('【当前世界草稿：') ? title.slice('【当前世界草稿：'.length).split('｜')[0]! : title;
}
export function splitUserContext(content: string) {
  const start = content.startsWith('【当前世界草稿：') ? content.indexOf('\n\n') : -1;
  if (start > -1) return {context: content.slice(0, start), text: content.slice(start + 2)};
  const end = content.lastIndexOf('\n\n【当前世界草稿：');
  return end > -1 && content.endsWith('】') ? {context: content.slice(end + 2), text: content.slice(0, end)} : {context: null, text: content};
}
export const actionStatusLabels: Record<AgentChatAction['status'], string> = {
  pending: '待你确认', executing: '正在执行', succeeded: '已执行', failed: '执行失败', rejected: '已拒绝', uncertain: '结果未确认',
};
export function toolReceipt(message: AgentChatMessage, format: (key: string, params?: Record<string, string | number>) => string = (key, params = {}) => key.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))) {
  let value: any;
  try {value = JSON.parse(message.content);} catch {return {status: 'complete', summary: message.content};}
  if (value?.error) return {status: 'failed', summary: `${format('请求未完成')} · ${value.error}`};
  if (value?.status === 'awaiting_author_confirmation') return {status: 'pending', summary: format('操作已准备，等待你确认')};
  if (value?.truncated) return {status: 'partial', summary: format('结果较长，已保存预览，需继续分段读取')};
  if (value?.status === 'rejected') return {status: 'rejected', summary: format('已拒绝，没有执行修改')};
  if (['not_executed', 'pending_action_exists'].includes(value?.status)) return {status: 'skipped', summary: format('未执行，先处理待确认操作')};
  if (Array.isArray(value)) return {status: 'complete', summary: format('已读取 {count} 项记录', {count: value.length})};
  if (value?.report && typeof value.report.errors === 'number') return {status: value.report.blocking ? 'failed' : 'complete', summary: format('{errors} 项问题，{warnings} 项提示', {errors: value.report.errors, warnings: value.report.warnings})};
  if (value?.data?.reference || value?.data?.entries) return {status: 'complete', summary: format('已读取 {count} 项内容', {count: value.data.entries?.length ?? 1}) + (value.data.nextOffset != null ? format('，可继续翻页') : '')};
  if (value?.title) return {status: 'complete', summary: `${value.title}${value.version ? ` · v${value.version}` : ''}`};
  return {status: 'complete', summary: format('结果已保存')};
}
