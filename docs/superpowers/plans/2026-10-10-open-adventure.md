# 小范围开放冒险 Implementation Plan

**Goal:** 实现从选定小说章节到可编辑、可发布、可恢复的有限开放冒险。
**Architecture:** 新增worlds与adventure-sessions两个模块，通过发布只读端口连接；generation按mode输出不同游戏类型；网页和MCP共用应用操作。
**Tech Stack:** Node24、TypeScript、Express、React、SQLite、现有Zod/MCP。
**Spec:** ../specs/2026-10-10-open-adventure.md

## Global Constraints

不修改D:/code/ai。不引入NestJS和新运行依赖。保持domain/application端口隔离，跨模块仅index.ts。老分支游戏和任务保持兼容。运行时无模型调用，无自由脚本，发布不可变。用户已经批准开发及本轮两名6.1 Sol分工，不再次请求同一授权。

## 1. 公共合同与原创样例（root）
- [x] packages/contracts/src/world.ts定义WorldContent/WorldDraft/WorldRevision/AdventureView/AdventureActInput，index.ts导出并给generation增加可选范围。
- [x] examples/ferry-world.ts和原创小说sealed-harbor.txt包含三种过河策略、隐藏知识和时间事件。样例供运行时测试与浏览器验收，不作为生产回退。

## 2. 世界与存档规则（runtime代理）
- [x] 先写apps/server/test/worlds.test.ts、adventure-sessions.test.ts失败行为，再实现modules/worlds及adventure-sessions。
- [x] WorldService(repository,sourceReader)：create({sourceId,content})/update(id,{version,content})/get/list/validate/publish(id,{version})/listRevisions/getRevision；仓储构造收SQLiteDatabase。
- [x] AdventureService(repository,revisionReader)：start({worldRevisionId})/list/get/act(id,AdventureActInput)，返回AdventureView。
- [x] 证明持久化、固定版本、重复动作精确重放、隐藏知识、条件拒绝、事件一次、三种策略、时限顺序、事务回滚。

## 3. 小说生成与传输（root）
- [x] 测试选择章节过滤及老任务兼容，修改generation/domain/selection.ts、ports、runner、job-service和sqlite-job-repository指纹。
- [x] 在GenerationProvider增加可选generateWorld端口及模型提示，复用JSON HTTP调用。世界草稿范围须等于选择范围，证据来源有效。
- [x] app/workbench.ts组合新模块，新增app/commands/worlds.ts、adventures.ts和HTTP路由；MCP自动继承。
- [x] HTTP/MCP真实客户端验收同一世界/存档；本地模型替身验收导入到开放草稿的任务链与恢复。

## 4. 作者与玩家页面（frontend代理）
- [x] 在apps/web/src/components下分离开放世界列表/编辑/规则阅读与开放冒险试玩，App.tsx组合。
- [x] 改编生成页选择模式、章节范围、角色及改编政策，open结果进入世界草稿。
- [x] 前台可编辑开局与世界JSON、阅读结构化地点/人物/行动、保存校验发布；未保存刷新保护。
- [x] 试玩显示地点、已知事实、当地人物、行动风险/耗时/禁用原因、事件历史与结局。pending请求持久化，重试复用requestId。

## 5. 集成验收与记录（root）
- [x] npm run verify；行为失败先定位再修复。
- [x] 本地浏览器导入样例、编辑发布、两条策略、刷新恢复；停用临时服务。
- [x] 更新README、API/MCP/架构/验收文档和中央记录，清楚标注自由文本与真实模型质量尚未验收。当前未提交基线不擅自创建提交或发布。
