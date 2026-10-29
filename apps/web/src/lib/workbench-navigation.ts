import type { StudioIconName } from '../components/studio/StudioIcon';

export type WorkspaceTab = 'sources' | 'agent' | 'generation' | 'worlds' | 'buildings' | 'items' | 'adventures' | 'drafts' | 'play' | 'settings';
export const workspacePages: {id: WorkspaceTab; label: string; icon: StudioIconName; group: 'main' | 'tools' | 'settings'}[] = [
  {id: 'agent', label: 'Agent 工作区', icon: 'chat', group: 'main'},
  {id: 'sources', label: '原作书架', icon: 'book', group: 'main'},
  {id: 'generation', label: '制作任务', icon: 'tasks', group: 'main'},
  {id: 'worlds', label: '世界草稿', icon: 'world', group: 'main'},
  {id: 'buildings', label: '建筑库', icon: 'grid', group: 'tools'},
  {id: 'items', label: '物品目录', icon: 'grid', group: 'tools'},
  {id: 'drafts', label: '分支草稿', icon: 'branch', group: 'tools'},
  {id: 'adventures', label: '开放冒险', icon: 'play', group: 'tools'},
  {id: 'play', label: '分支试玩', icon: 'play', group: 'tools'},
  {id: 'settings', label: '模型设置', icon: 'settings', group: 'settings'},
];
export function workbenchTabFromHash(hash: string): WorkspaceTab {
  const tab = hash.replace(/^#/, '');
  return workspacePages.find(page => page.id === tab)?.id ?? 'agent';
}
