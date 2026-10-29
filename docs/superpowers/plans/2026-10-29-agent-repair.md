# Agent Repair Implementation Plan

> 执行：root 在当前会话逐项完成，不委派；用户已授权继续此方向。

**Goal:** 将现有路线体检建议变为可审阅、可驳回、带版本保护和复验的持久候选。
**Architecture:** agent application ports → shared preflight inspection + world service；同一事务提交草稿、报告、候选状态。HTTP/MCP 共享命令。
**Tech Stack:** TypeScript / Express / React / SQLite；无新增依赖。
**Spec:** ../specs/2026-10-29-agent-repair-design.md

## 约束

40 相同种子比较；仅 gate-trap / weight；不自动增加占位卡；不调用模型；不发布；保留作者编辑和现有模块公共入口。

## 1. 候选服务与检查端口

- [x] 先写 `apps/server/test/agent-repair.test.ts`：生成只读、过期报告、白名单、验证退步、驳回、版本冲突、重复应用、事务回滚与持久恢复，观察失败。
- [x] 新增 `packages/contracts/src/agent-repair.ts`：`AgentRepairCandidate`、`AgentRepairVerification`、`AgentRepairChange`。
- [x] 新增 agent/application/repair-service.ts 和 repair-ports.ts、infrastructure/sqlite-repair-repository.ts；公共 index.ts 导出。
- [x] 服务接口：`create({draftId,version,endingId})`、`list(draftId)`、`apply(id)`、`reject(id)`；候选基础版本不可变。
- [x] preflight 公共方法 `inspectWorldDraft(draft,{seeds,guidance})` 只计算，`saveWorldInspection(id,reports)` 校验当前版本后保存，复用原检查代码。
- [x] 实现最少代码使行为测试通过；用真实路线 fixture 锁定效果变化。

## 2. 共用命令与事务接线

- [x] app/workbench.ts 注入 world/preflight/SQLite 事务端口。
- [x] commands/agent.ts 添加 create/list/apply/reject，routes.ts 映射；MCP 自动复用。
- [x] 真实临时数据库 HTTP/MCP 测试同一候选的创建、驳回和重复确认。

## 3. 作者页面

- [x] 新增 web/lib/agent-repair-api.ts 和 components/preflight/AgentRepairPanel.tsx。
- [x] PreflightPanel 接入并刷新新报告；WorldsPanel 在请求期间锁定编辑且应用后更新选中草稿。
- [x] 展示空、等待、失败、过期、阻断、已应用和已驳回状态，差异使用现有紧凑组件。
- [x] 关键按钮权限与有限验证说明写行为测试或使用真实浏览器验证，更新 DESIGN_SYSTEM。

## 4. 交付验证

- [x] 完整 `npm run verify`；检查 diff、模块边界和禁止入库路径。
- [x] 浏览器及 HTTP/MCP 使用隔离 fixture 验证闭环，不操作用户真实生成任务。
- [x] 更新 README、MCP 说明和中央现有功能记录，记录实际结果及范围限制。
