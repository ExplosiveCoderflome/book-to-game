# M1 · 纯玩家壳 / 可分享最小交付切片

> **状态：定稿 · 已交 UI 规划 · 2026-10-28**  
> 确认前不叫 Coder；默认不 git commit/push  
> 落实：[`roadmap-maker-next.md`](./roadmap-maker-next.md) **M1**（可分享 / 纯玩家最小交付；Q1=A · Q2=C · Q3=A 已锁定）  
> 玩法底座：[`player-loop.md`](./player-loop.md)（P0–P2 已落地；本期**不**加深玩法）  
> 产品原则：[`playtest-rubric.md`](./playtest-rubric.md)（先合格可玩；交付可感）  
> 五层纪律：[`extensibility.md`](./extensibility.md) · [`architecture.md`](./architecture.md) · [`api-contract.md`](./api-contract.md)  
> 前序：[`p1-open-fill-playable-slice.md`](./p1-open-fill-playable-slice.md) · [`p2-encounter-playable-slice.md`](./p2-encounter-playable-slice.md)

相关术语：**Player Shell（纯玩家壳）** · **`/play` 路由** · **GameRevision / WorldRevision** · **sessions / adventure-sessions** · **Perceive→Decide→Act→Feedback** · **M1b（导出包 · 本期 Out）**。

---

## 0. 为何是这一刀

| 背景 | 说明 |
|---|---|
| 产品定位 | 文字版 RPG Maker：想法/小说 → 搭建 → **交得出可玩游戏**；编辑是手段 |
| P0–P2 | 工作台内已证明局里好玩（反馈壳 · 买/补/接 · 遭遇交锋/撤离） |
| 缺口 | 试玩仍嵌在作者 Workbench 标签里；外人（或第二个浏览器配置）**打不开一局成品** |
| 路线图 | Q1=A 先交付壳；Q2=C 同宿主 `/play` **与** 导出都做，但 **A 先** → 本期只做 A；导出 = **M1b** |

本期证明：**发布之后，不必进完整作者工作台，也能打完一局。**

---

## 1. 一句话目标与单局成功

### 1.1 一句话目标

> **不进完整作者工作台**，也能打开一份已发布 `GameRevision` / `WorldRevision`，走完一圈 **Perceive → Decide → Act → Feedback**（HUD / 代价 / delta / 锁定仍在）——并让作者能把这个入口**交给别人同宿主打开**。

### 1.2 单局成功定义（本切片）

| # | 角色能说出的话 | 系统可见证据 |
|---|---|---|
| 1 | 「我打开的是玩家页，不是编辑器那一堆标签」 | 纯玩家路由（如 `/play/...`）；无原作书架 / 草稿 / 建筑库 / 模型设置主导航 |
| 2 | 「我选了已发布版本并开了新档 / 续了旧档」 | `POST sessions` 或 `POST adventures`（及 list/get）；存档列表可见 |
| 3 | 「局里和以前试玩一样：有选择、有代价、有 HUD/delta」 | 复用 P0–P2 反馈壳与行动；写操作只经 session 端口 |
| 4 | 「作者点了发布/分享后，我用链接就能进」 | 可复制的同宿主 URL；或作者壳「打开玩家试玩」跳进同一壳 |
| 5 | 「打到结局 / 可中途离开再回来」 | `ended` 或开放冒险可感终局/暂停；续档不丢 revision 钉死 |

**不要求**导出 zip、公网账号、新玩法系统、或把 Workbench 拆成独立桌面应用。

---

## 2. 与路线图 / player-loop / 发布·存档的关系

| 文档 / 能力 | 本期关系 |
|---|---|
| [`roadmap-maker-next.md`](./roadmap-maker-next.md) **M1** | 本文即 M1 切片；成功标准「玩得出 / 交得出」的最小落地 |
| [`player-loop.md`](./player-loop.md) | 循环形状不变；shell 换壳不换引擎 |
| P0 / P1 / P2 | **只接**既有 PlayPanel / AdventurePanel 反馈与互动进玩家壳；不重做商店/遭遇 |
| `publish` → `GameRevision` / `WorldRevision` | 玩家壳**只读**已发布 revision；不写草稿 |
| `sessions` / `adventure-sessions` | 开档 / 续档 / act 的唯一写路径；存档钉死 revision id |
| 现 Workbench `play` / `adventures` 标签 | 可保留为作者向入口，但须能**跳进**玩家壳；玩家壳不得依赖整套作者导航才能玩 |

```text
作者：草稿 → publish → Revision
         ↓
玩家壳 /play/...  ──只读──► Revision
         ↓
      start / list / get / act ──► sessions 或 adventure-sessions
         ↓
      Perceive→Decide→Act→Feedback（P0–P2 组件）
```

---

## 3. In / Out（硬边界）

### 3.1 In（本期必须）

| 项 | 说明 |
|---|---|
| **同宿主纯玩家路由** | 如 `/play/story/:revisionId`、`/play/world/:revisionId`，及可选落地页 `/play`（列出本机已发布）；**先做 A**（路线图 Q2） |
| **只读已发布版本** | 消费 `GameRevision` / `WorldRevision`；禁止在玩家壳编辑草稿或改 Catalog |
| **复用 P0–P2 玩法与反馈壳** | story：分支选项 + HUD/代价/delta/结局；open：跑图 + 买/补/接/遭遇；同一套组件优先抽取复用，禁止平行「玩家专用 runtime」 |
| **开档 / 续档最小** | 新存档、存档列表、继续；存档与 revision 绑定（既有纪律） |
| **作者壳 → 玩家壳** | 发布后或「试玩」可一键打开对应 `/play/...`（同 tab 或新路径）；作者主导航在玩家壳内**隐藏** |
| **分享形态（A）** | 同宿主可复制 URL；第二个浏览器配置 / 无作者导航状态下能开局（本机 token 策略沿用现网，见 §6） |
| **端口纪律** | 读 revision；写只经 `sessions` / `adventure-sessions`；AI 旁白/提案若未接线则本期可不露入口（属 M4） |

### 3.2 Out（明确不做）

| 项 | 归属 |
|---|---|
| **导出 zip / 静态离线包 / 单文件包** | **M1b**（Q2 的 B）；另文；**不挡**本期 `/play` 验收 |
| 公网多租户 · 完整账号 · 权限隔离产品化 · 应用商店上架 | 路线图非目标；远期 |
| 新玩法系统（任务图、交涉、血条战斗、idle） | M5 / 另立项；本期零玩法扩容 |
| 改写 Substrate / 合并 sessions 与 adventure-sessions | 禁止 |
| 无人审直发、玩家壳改草稿、AI mutate session | 禁止 |
| Maker 主线路生成（想法→主脊） | **M2**（story 优先） |
| 作者放置 UX / 真价绑定表单（G1/G2） | 作者工具；不进玩家壳 In |
| 玩时 AI 入口打磨（旁白开关产品化） | **M4**；端口可保留不露 |
| 把现有 Workbench 物理拆成两个应用仓库 | 非目标；路由/壳分层即可 |

---

## 4. 可感闭环

### 4.1 玩家路径

```text
打开 /play 或深链 /play/story|world/:revisionId
    →（若落地页）选已发布书目 / 世界
    → 开新档 或 点续档
    → Perceive：场景/地点 + HUD
    → Decide：选项 / 行动（代价·锁定可见）
    → Act：只打 session 端口
    → Feedback：结果 + delta + 开闭
    → 未终局回到 Perceive；终局见结局/可感结束态
```

| 节拍 | 本切片要求 |
|---|---|
| **Perceive** | 与 P0–P2 同质；无作者检查器默认展开（Inspector 可藏或极简） |
| **Decide** | 不出现「回编辑器改稿」主按钮；锁定原因仍可读（D7） |
| **Act** | 禁止 UI 本地改存档当真值 |
| **Feedback** | 复用 PlayStatsBar / delta / Ending；中文 `t()` |

### 4.2 作者「一键给别人玩」路径

```text
工作台内发布草稿
    → 得到 Revision
    → 「打开玩家试玩 / 复制玩家链接」
    → 进入 /play/...（隐藏作者主导航）
    → 把同宿主 URL 发给本机其他配置或协作者
```

验收时至少一条路径可演示：**作者发布 → 复制链接 → 玩家壳开局打完关键闭环**（演示内容可用既有 P0–P2 夹具世界/故事）。

---

## 5. 数据 / 端口契约摘要（给 UI / Coder）

### 5.1 UI 只消费

| 消费 | 来源 | 禁止 |
|---|---|---|
| 已发布列表 / 单条 revision | `GET /api/games` · `GET /api/games/:id` · `GET /api/worlds/revisions` · getRevision | 玩家壳 `PATCH` 草稿 |
| Session / Adventure 视图 | `start` / `list` / `get` / `act` | 自造平行存档表 |
| HUD / 选项 / 行动 / blockedReason | SessionView / AdventureView（既有投影） | UI `eval`；伪造填充入口 |
| delta | act 前后 snapshot diff（P0 路径） | 旁白冒充数值 |

### 5.2 写路径

```text
玩家点「新开档」
  → POST /api/sessions { gameRevisionId }    或  POST /api/adventures { worldRevisionId }
  → 返回 View；路由可带 session/adventure id（实现自定，须可续档）

玩家点选项 / 行动
  → POST .../act（既有幂等 requestId 纪律）
  → 返回新 View → 渲 HUD + delta
```

- **读**：revision 只读端口；玩家壳不得调用 draft update/publish。  
- **鉴权**：沿用本机既有 token / 单用户假设；**不**借本期做多租户。若无 token 则无法 act——须有诚实错误态，不静默写本地假进度。  
- **AI**：`narrate` / `propose-act` 本期可不挂入口；若挂须 prompt-only。

### 5.3 路由约定（可定默认 · 实现可微调 path 字面量）

| 路径（建议） | 含义 |
|---|---|
| `/play` | 落地：本机已发布 story + world 列表；空态诚实 |
| `/play/story/:revisionId` | 分支故事玩家壳；可带 `?session=` |
| `/play/world/:revisionId` | 开放冒险玩家壳；可带 `?adventure=` |
| Workbench 原 `/` 或现 hash/tab | 作者壳保留；试玩按钮 `navigate` 到上表 |

无前端路由器时：允许以 **hash 路由**或等价最小方案落地，但须满足「可复制 URL、刷新可回到同 revision/存档意图」。

### 5.4 与现实现缺口（策划知悉）

| # | 现状 | 本期期望 |
|---|---|---|
| S1 | `App.tsx` 单 Workbench + tab（`play` / `adventures` 嵌在作者壳） | 增加纯玩家路由/壳；作者 tab 可保留并深链跳转 |
| S2 | 无独立 `/play` 分享 URL | 可复制深链；落地列表可选但建议做 |
| S3 | PlayPanel / AdventurePanel 含作者向选择器与刷新整舱数据 | 抽「读者席」内容区进玩家壳；作者专用控件隐藏 |
| S4 | 导出包不存在 | **Out → M1b** |

**禁止**平行 `PlayerRuntime` / 复制 rules 进 web。

---

## 6. 关键状态露脸（壳层 · 非玩法扩容）

| 事件 | 玩家壳 | 文案 / 空态 |
|---|---|---|
| 进入 `/play` 无发布 | 空落地 | 「还没有已发布的游戏」；可链回作者壳（次要） |
| 深链 revision 不存在 | 错误态 | 诚实「版本不存在或未发布」 |
| 开档成功 | 进入局内 | 无整页作者导航 |
| 续档 | 列表选中 → 局内 | 显示标题 · 回合/地点摘要 |
| act 失败 / 无鉴权 | 不丢局 | 可读错误；不假 delta |
| 终局 | Ending / 可感结束 | 可「返回书目」；不自动进编辑器 |
| 作者点「玩家试玩」 | 跳 `/play/...` | 作者导航隐藏 |

视觉：继续 P0–P2 仪器感；**禁止**新品牌启动海报、商店橱窗式「游戏商城」。中文 `t()`。

---

## 7. 验收条（可勾选）

> 勾选以**同宿主纯玩家路由**为准；作者 tab 内旧试玩仍可用不算替代本切片成功。

### 7.1 壳与导航

- [ ] 存在纯玩家入口（`/play` 或深链）；页内**无**原作书架 / 生成 / 草稿 / 建筑库 / 物品 / 设置等作者主导航
- [ ] 作者壳「打开玩家试玩 / 复制链接」能进入同一玩家壳
- [ ] 刷新深链后仍指向同一 revision（及若 URL 含存档 id 则续得上）

### 7.2 开档 / 续档

- [ ] 可对已发布 **story** revision 开新档并出现在列表
- [ ] 可对已发布 **world** revision 开新档并出现在列表
- [ ] 可续档回到上一局 Perceive 状态（与端口 get 一致）

### 7.3 玩法复用（不回退）

- [ ] story：至少一次选择 → Feedback（代价或 delta 或结局之一可见）
- [ ] open：至少一次行动（移动或 P1/P2 填充/遭遇之一）→ HUD/delta 或诚实空态
- [ ] 写操作只经 sessions / adventures；重读存档与端口一致
- [ ] 无投影 / 条件锁仍诚实（不因换壳伪造可点项）

### 7.4 分享（形态 A）

- [ ] 可复制同宿主玩家 URL
- [ ] 在隐藏作者导航的前提下，用该 URL 能开局并完成 §7.3 之一

### 7.5 明确不测本期

- [ ] ~~导出 zip~~（M1b）
- [ ] ~~公网账号~~
- [ ] ~~新玩法~~

---

## 8. 给 UI 的七件套交接要点

确认本文后，UI 出界面规划（确认前不叫 Coder）。七件套对齐 P1/P2：

| # | 件 | 本切片要点 |
|---|---|---|
| 1 | **页面 / 改点** | **玩家壳**整页；**开局/存档**（落地列表 + 新开/续档）；**隐藏作者导航**；作者壳增加「打开玩家试玩 / 复制链接」改点 |
| 2 | 线框 | `/play` 落地；`/play/story|world/:id` 局内（复用读者席，收起 Inspector） |
| 3 | 状态表 | 无发布 / 坏链 / 开档中 / 局内 / 终局 / 鉴权失败 |
| 4 | 中文文案 | 空态、错误、按钮（开始新存档 / 继续 / 返回书目 / 复制链接） |
| 5 | DESIGN 增量 | 壳层布局；不新开玩法视觉语言 |
| 6 | Coder 清单 | 路由、壳组件拆分、深链、作者入口接线；复用 Play/Adventure 内容区 |
| 7 | Out 再声明 | 无导出包 UI；无商城；无账号注册页 |

**交互已定默认（不重开路线图 Q）：** 同一壳按 mode 切 story/open；Sheet/混用等玩法交互沿用 P1/P2 已拍板。

---

## 9. 分期内实现建议顺序

| 序 | 步骤 | 产出 | 依赖提醒 |
|---|---|---|---|
| **0** | 用户确认本文 In/Out 与验收条 | 本文标「已确认」 | ✅ **已完成**（2026-10-28）· 已交 UI 规划；确认前不叫 Coder |
| **1** | **契约 / 路由** | 前端路由（或 hash）`/play...`；revision 只读装配；session 开续档接线 | 不改 Substrate；沿用 api-contract |
| **2** | **UI 七件套规划** | 玩家壳 · 开局/存档 · 隐藏作者导航 | 读本文 + P0 壳 |
| **3** | **策划确认 UI 规划** | 批注通过 | 确认前不叫 Coder 做 UI |
| **4** | **演示发布世界/故事** | 确保至少 1 story revision + 1 world revision 可发布可玩（P0–P2 夹具可） | 数据问题不扩玩法 In |
| **5** | **Coder** | 路由壳 → 复用局内组件 → 作者入口/复制链接 → 截图 | 默认不 commit/push |
| **6** | **策划验收** | 对照 §7；陌生人路径（第二配置）一句 | 通过后再开 M1b 或 M2 |

建议截图目录（落地时）：`/workspace/btg-e2e/screenshots/m1-play-landing-*.png`、`m1-play-story-*.png`、`m1-play-world-*.png`、`m1-play-no-author-nav-*.png`、`m1-author-open-player-*.png`。

---

## 10. 给 UI / Coder 的阅读指引

| 读者 | 先看 | 产出预期 |
|---|---|---|
| **策划** | §1–§3、§7、§9、§11 | 用户确认后交 UI；不重开 Q1–Q3 |
| **UI** | §4 闭环、§6 露脸、§8 七件套；P0–P2 规划（复用壳） | 界面规划；**确认前不叫 Coder** |
| **Coder** | §5 契约、§3 Out、§5.4 缺口、§7 勾选 | 路由+壳；只读 revision；写只经 session 端口；不新 runtime |

**默认流程：** 用户确认本文 → UI 出界面规划 → 策划确认 → 再交 Coder。**默认不 git commit/push。**

---

## 11. 开放问题

**无。** 路线图 Q1–Q3 已锁定且不重开。本切片内可定默认均已写入：

| 项 | 默认（已写入正文） |
|---|---|
| 分享形态 | 本期只做同宿主 `/play`（A）；导出 = M1b |
| 双模式 | story + world 都进玩家壳；同一壳按 mode 切 |
| 玩时 AI 入口 | 本期可不挂（M4） |
| 路由字面量 | §5.3 建议表；实现可微调，须可复制、可刷新 |

若用户确认时只改措辞/验收力度，不另开产品分叉。

---

## 12. 文档索引

| 文档 | 关系 |
|---|---|
| [`roadmap-maker-next.md`](./roadmap-maker-next.md) | 母路线；M1 必须期；Q2=C |
| [`player-loop.md`](./player-loop.md) | 循环；本切片换壳不换循环 |
| [`api-contract.md`](./api-contract.md) | publish / sessions / adventures |
| [`architecture.md`](./architecture.md) | 模块边界；revision 只读 |
| P0–P2 切片 | 局内玩法与反馈；本期只接壳 |
| M1b（未写） | 导出包；本期 Out |

---

## 13. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-10-28 | **初稿 · 待用户确认**：落实 roadmap M1；In=`/play` 纯玩家壳 + 开续档 + 复用 P0–P2；Out=导出包(M1b)/公网账号/新玩法/改 Substrate；验收条与七件套；开放问题 0；docs-only，未交 UI/Coder；未 commit/push |
| 2026-10-28 | **定稿 · 已交 UI 规划**：用户确认定稿，交 UI 做纯玩家壳界面规划；确认前不叫 Coder；默认不 git commit/push |
