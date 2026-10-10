import type { Draft, GameContent, GameRevision, SourceSummary } from '@novel-game/contracts';
import { request } from './api';

export const demoTitle = '渡口的承诺';
export const demoSourceText = `第一章 封港前
你是护送证人的抄写员。渡口的小船漏了水，船夫蹲在船旁。北边的旧仓库里有木板、账册和准备启程的商队，东边的关卡正在检查通行证。天黑前，所有船只都将停止航行。

船夫需要材料修船，也愿意回报伸出援手的人。商队领队的货船还有空位，不过她希望有人答应下一次护送货物。

第二章 各自的秘密
证人知道幕后联系人是谁，但还没有告诉抄写员。守卫不断核对名单，时间正在流逝。你必须在渡口关闭前决定相信谁。`;

export const demoGame: GameContent = {
  title: demoTitle,
  mode: 'story',
  premise: '渡口封闭前，选择如何过河。一次帮助、一个承诺，都会改变你能走的路。',
  adaptationNotes: '内置可玩示例，不代表模型生成结果。用于体验导入、编辑、校验、发布和试玩闭环。',
  startSceneId: 'dock',
  variables: { trust: 0, promised: false, route: 'undecided' },
  scenes: [
    {
      id: 'dock', title: '暮色渡口',
      text: '船夫正在整理断裂的缆绳，商队在一旁等待。天色一点点暗下来。',
      origin: 'adapted', evidence: [],
      choices: [
        { id: 'help', label: '帮助船夫修好缆绳', targetSceneId: 'dock', conditions: [{ type: 'variable.equals', variable: 'trust', value: 0 }], effects: [{ type: 'variable.increment', variable: 'trust', value: 1 }] },
        { id: 'promise', label: '答应替船夫送信', targetSceneId: 'dock', conditions: [{ type: 'variable.equals', variable: 'promised', value: false }], effects: [{ type: 'variable.set', variable: 'promised', value: true }] },
        { id: 'boat', label: '请船夫带你过河', targetSceneId: 'friend', conditions: [{ type: 'variable.gte', variable: 'trust', value: 1 }, { type: 'variable.equals', variable: 'promised', value: true }], effects: [{ type: 'variable.set', variable: 'route', value: 'ferry' }] },
        { id: 'caravan', label: '跟随商队绕路', targetSceneId: 'caravan', effects: [{ type: 'variable.set', variable: 'route', value: 'caravan' }] },
      ],
    },
    { id: 'friend', title: '河对岸的灯火', text: '船夫送你过河。你怀里揣着替他送出的信，渡口的灯火留在身后。', origin: 'adapted', evidence: [], choices: [], ending: '朋友的渡船' },
    { id: 'caravan', title: '山路的火把', text: '你随商队走上山路。另一条路更慢，却让你避开了未知的盘查。', origin: 'adapted', evidence: [], choices: [], ending: '另一条路' },
  ],
};

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function seedDemo(token: string, sources: SourceSummary[], revisions: GameRevision[]): Promise<GameRevision> {
  const existing = revisions.find(revision => revision.content.title === demoTitle);
  if (existing) return existing;
  const source = sources.find(item => item.title === demoTitle) ?? await request<{ id: string }>(token, '/sources', 'POST', {
    title: demoTitle, filename: 'sealed-harbor-demo.txt', encoding: 'utf8', contentBase64: base64(demoSourceText),
  });
  const draft = await request<Draft>(token, '/drafts', 'POST', { sourceId: source.id, content: demoGame });
  const validation = await request<{ valid: boolean; errors: string[] }>(token, `/drafts/${draft.id}/validate`, 'POST', {});
  if (!validation.valid) throw new Error(`内置示例校验失败：${validation.errors.join('；')}`);
  return request<GameRevision>(token, `/drafts/${draft.id}/publish`, 'POST', { version: draft.version });
}
