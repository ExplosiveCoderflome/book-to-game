import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createWorkbench } from '../apps/server/src/app/workbench.js';
import { openDatabase } from '../apps/server/src/platform/database.js';
import { createModelSettings } from '../apps/server/src/platform/create-model-settings.js';

const apiKey = process.env.RELAY4_API_KEY?.trim();
if (!apiKey) throw new Error('RELAY4_API_KEY is required');
const dir = mkdtempSync('/tmp/opencode/pi-agent-smoke-');
const db = openDatabase(':memory:');
const started = Date.now();
try {
  const settings = createModelSettings(db, dir, {baseUrl: 'https://aihub.top/v1', model: 'gpt-6.1-sol', apiKey, timeoutMs: 90_000});
  const w = createWorkbench(db, settings, undefined, {dataDir: dir});
  const source = w.sources.importFile({title: 'Pi渡口冒烟', filename: 'pi-smoke.txt',
    bytes: Buffer.from(['第一章 渡口', '渡口管理员阿舟在仓库发现七袋蓝盐。货单编号为PI734。', '他决定先核对货单，再开放渡船。'].join(String.fromCharCode(10)), 'utf8')});
  const chat = w.agentChat.create();
  const result = await w.agentChat.send({id: chat.id, requestId: 'pi-real-smoke',
    text: `请调用read_source读取来源${source.id}的章节${source.chapters[0]!.id}正文，再调用list_blocks查询积木目录。只做这两个只读操作，不创建任务或确认卡。最后根据工具回执告诉我货单编号和一项适合渡口游戏的积木。`});
  const receipts = result.messages.filter(message => message.role === 'tool');
  const read = receipts.find(message => message.toolName === 'read_source' && message.content.includes('PI734'));
  const blocks = receipts.find(message => message.toolName === 'list_blocks' && !message.content.includes('CHAT_INVALID_ARGS'));
  assert.ok(read, 'chapter read receipt missing'); assert.ok(blocks, 'catalog tool receipt missing');
  assert.equal(result.status, 'idle'); assert.equal(result.actions.length, 0);
  assert.ok(result.messages.filter(message => message.role === 'assistant').some(message => message.content.includes('PI734')));
  console.log(JSON.stringify({ok: true, provider: 'aihub', model: 'gpt-6.1-sol', durationMs: Date.now() - started,
    sourceImported: true, chapterRead: true, tools: receipts.map(message => message.toolName), confirmationCount: result.actions.length}));
} catch {
  console.log(JSON.stringify({ok: false, provider: 'aihub', model: 'gpt-6.1-sol', durationMs: Date.now() - started,
    message: 'Real smoke did not complete; no credentials or upstream bodies logged.'}));
  process.exitCode = 1;
} finally {db.close(); rmSync(dir, {recursive: true, force: true});}
