# 终局条件积木（`end-conditions`）与 Agent 确认门

## 定位

成败是**整局游戏的终局条件**，不是永久通用的空壳，也不绑死某一品类。
积木只提供「**判定槽位 + 运行时判定路径**」；具体胜负谓词按每个游戏、在生成或编辑时填入。

- 积木 id：`end-conditions`，货架：`foundation` + `world-content`（`packages/contracts/src/blocks.ts`）。
- `requires`：`world.endConditions` + `world.endings`；`composesWith.dependsOn`：`endings-recap`、`stat-templates`。
- `provides`：`endings`（不新增平行状态机，仍走既有 ending / resolveEnding）。
- 品类配方 `sim-commerce` / `combat-growth` 都在 `requiredBlocks` 里要求它；配方只要求「具备终局判定能力」，**具体谓词按局填写**。
- 配方 lint 规则：任何包含 `endings-recap` 的配方若缺少 `end-conditions`，报 `recipes.missing-end-conditions`。

## 世界形状（`WorldContent.endConditions`）

```ts
endConditions?: {
  source: 'agent-proposed' | 'author-custom' | 'author-edited';
  packageId?: string; packageLabel?: string;
  severity: 'reshapes-game';           // 固定标记：改胜负即重塑整局
  win:  { id; kind: 'win';  label; when: WorldCondition[]; endingId; note? }[];
  lose: { id; kind: 'lose'; label; when: WorldCondition[]; endingId; note? }[];
}
```

约束（schema + lint 双重把关）：

- 至少 1 条 win / 1 条 lose（lint：`end-conditions.no-win` / `end-conditions.no-lose`）。
- `endingId` 必须存在于 `world.endings`；win 只能指向普通结局，lose 只能指向失败结局。
- `when` 复用既有 `WorldCondition` 语法（facts / resource / clock / storylet_seen …），不引入新引擎。

## Agent 确认门

1. **提议（只读）** `propose_end_conditions`
   - 输入：`worldDraftId`（可选 `intent` / `summary`）。
   - 输出：2–4 套完整条件包（每套 ≥1 win + ≥1 lose），带中文摘要与 `severity: 'reshapes-game'`。
   - 实现：`apps/server/src/modules/worlds/application/end-conditions.ts`（`mockEndConditionsModel`，沿用 `propose_fun_profile` 的 mock-first 模式）。
   - 不改草稿。
2. **确认（写入）** `apply_end_conditions`
   - `selection.kind = 'package'`：**沿用作者挑中的那套**（含 id / label / when），映射到草稿里真实存在的结局 id。
   - `selection.kind = 'custom'`：作者自然语言按行解析（`胜利：… / 失败：…`），命中草稿资源名/事实名后生成同一结构。
   - 自定义文本必须同时含 win 与 lose，否则拒绝（`END_CONDITIONS_INCOMPLETE` / `END_CONDITIONS_PARSE_FAILED`）。
3. **改稿严重度**
   - 草稿已有 `endConditions` 时，再应用必须 `acknowledgeReshape: true`，否则 `END_CONDITIONS_RESHAPE_UNCONFIRMED`（409）。
   - 应用后 `source` 记为 `author-edited`，便于观测「这是一次重塑」。
   - Agent Chat 的确认摘要会写明「将重塑整局（原终局条件被覆盖）」。

Agent 工具元数据（`apps/server/src/app/agent-chat-tools.ts`）：
`propose_end_conditions` 自动执行（只读）；`apply_end_conditions` 需要作者确认（write + version guard）。

## 运行时判定

`packages/play-runtime/src/adventure/rules.ts`：

- `evaluateEndConditions(world, state)` 按 win → lose 顺序取**第一条**命中条件。
- `settle()` 在普通结局 `when` 之前先判终局条件；命中后仍用 `resolveEnding` 触发对应结局（lose 记 `kind: 'failure'`）。
- 无 `endConditions` 的旧世界行为完全不变（继续按结局 `when` + 时钟超时判定）。

## 契约与命令

- 契约：`packages/contracts/src/end-conditions.ts`（propose / apply / build 形状）。
- HTTP：
  - `POST /api/worlds/drafts/:worldDraftId/end-conditions/propose`
  - `POST /api/worlds/drafts/:worldDraftId/end-conditions/apply`
- 测试：`apps/server/test/end-conditions.test.ts`。

## 观测

`scripts/gen-block-shop.ts` 生成的 `book-to-game-block-shop.html` 会显示新积木、两条配方 v2 的必选清单，以及「终局条件 · Agent 确认门」说明区。

## 未做（后续）

- Agent Chat 之外的 UI 交互（选择卡片 / 自然语言输入）由并行 UI 任务承接，本切片只保证后端能力与工具。
- 生成流程中的自动提议（在 plan 阶段自动调用）尚未接线：目前由作者/Agent 显式调用 `propose_end_conditions`，再 `apply_end_conditions`。
