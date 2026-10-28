# M1b · 导出包 / 能发给别人玩的最小交付切片

> **状态：定稿 · 2026-10-28**（Q1–Q4 全部由用户拍板；本轮交 UI 只规划 **M1b-1**，见 §11.1）  
> **用户已定：** Q1 = A 静态包；Q2 = 单文件 HTML + Windows exe（Tauri 包同一份 HTML）；Q3 = A story 与 open 都做；Q4 = A 拆两步（M1b-1 引擎搬家 + 网页版 → 验收后 M1b-2 exe）；同意 manifest 预留 AI 接口位  
> UI 规划经策划确认后才交 Coder；默认不 git commit/push  
> 落实：[`roadmap-maker-next.md`](./roadmap-maker-next.md) **M1 · Q2=C**（同宿主 `/play` 与导出包都做，A 先；本期 = 导出包 **M1b**）  
> 前序：[`m1-player-shell-playable-slice.md`](./m1-player-shell-playable-slice.md)（纯玩家壳 · 有条件通过；本文复用其壳与路由，其 §3.2 Out 的「导出包」在此接手）  
> 玩法底座：[`player-loop.md`](./player-loop.md) · [`p1-open-fill-playable-slice.md`](./p1-open-fill-playable-slice.md) · [`p2-encounter-playable-slice.md`](./p2-encounter-playable-slice.md)（本期**不**加深玩法）  
> 五层纪律：[`extensibility.md`](./extensibility.md) · [`architecture.md`](./architecture.md) · [`api-contract.md`](./api-contract.md)

相关术语：**导出包（Play Package）** · **manifest** · **PlayPort（玩家端口：HTTP / 本地）** · **SaveStore（存档存储：localStorage / 文件）** · **play-runtime（共享推进引擎）** · **Catalog 快照** · **通用播放器 exe（Player Host）** · **内容注入** · **GameRevision / WorldRevision**。

---

## 0. 为何是这一刀

| 背景 | 说明 |
|---|---|
| 产品定位 | 文字版 RPG Maker：目的是**交出可玩游戏**，编辑只是手段 |
| M1 已有 | `#/play`、`#/play/story|world/:id`、PlayerShellLayout、ReaderPlaySurface / AdventurePlaySurface、revision 只读、`?session=` / `?adventure=` 续档、壳内不挂 AI |
| M1 局限 | 服务端 `localBoundary` 只放行 `localhost / 127.0.0.1 / [::1]`，act 要本机 token → **只有能连到这台机器的人能玩** |
| 本期 | 作者点一下得到一个**文件**——网页版 `.html` 或 Windows `.exe`——发给任何人，对方**不连作者电脑**就能玩完一局 |

本期证明：**游戏可以离开作者的电脑。**

---

## 1. 一句话目标与单局成功

### 1.1 一句话目标

> 作者对一份已发布 `GameRevision` / `WorldRevision` 点「导出」，得到 **单文件 HTML** 或 **Windows exe**；两者装的是**同一份**内容 + 同一份推进引擎；别人断网、无作者服务也能开档、续档、走完 Perceive → Decide → Act → Feedback，手感与 M1 玩家壳一致。

### 1.2 单局成功定义（本切片）

| # | 角色能说出的话 | 系统可见证据 |
|---|---|---|
| 1 | 作者：「我点了导出，拿到一个网页文件 / 一个 exe」 | 作者壳已发布版本上有「导出网页版」「导出 Windows 版」；产出文件 + 导出报告 |
| 2 | 玩家：「我双击就能玩，没连谁」 | 包内无 `/api` 请求；断网可开局；exe 不需要装 Node / Rust |
| 3 | 玩家：「和作者那边试玩一样」 | 同一套 P0–P2 界面组件；同一份推进引擎代码（不是复制品） |
| 4 | 玩家：「关掉再打开，存档还在」 | HTML：浏览器 localStorage；exe：应用数据目录里的存档文件 |
| 5 | 作者：「我改了草稿，已发出去的包不会变」 | 包内容 = 导出那一刻的 revision + Catalog 快照；manifest 记版本与哈希 |
| 6 | 玩家：「没有 AI 也完整可玩」 | manifest `ai.mode = 'none'`；壳内无 AI 入口 |

**不要求**：公网托管、账号、云存档、商店上架、包内 AI、反作弊/加密、mac / Linux 桌面版。

---

## 2. 代码现状与导出形态

### 2.1 代码现状盘点（决定离线包是否可行）

> 2026-10-28 读代码结论（HEAD cb5cfe7 + 未提交 M1 改动）。

| # | 问题 | 现状（代码依据） | 对导出的含义 |
|---|---|---|---|
| C1 | 发布数据是什么 | `GameRevision {id, draftId, sourceId, version, content: GameContent, createdAt}`（`packages/contracts/src/index.ts`）；`WorldRevision {…, content: WorldContent, version}`（`contracts/src/world.ts`）；SQLite 里存纯 JSON | ✅ 可整体序列化进包 |
| C2 | 推进引擎在哪 | **只在服务端**：`apps/server/src/modules/sessions/domain/*`（`advanceSession` / `projectSession` / `story-variables`）与 `adventure-sessions/domain/*`（`advanceAdventure` / `projectAdventure` / `rules` / `map-view` / `system-actions`）。前端只渲染 View | ⚠️ 现在包里没有引擎，**需要搬** |
| C3 | 引擎能不能在浏览器跑 | domain 层是**纯函数**：只依赖 `@novel-game/contracts`、`@novel-game/rules` 和一个 `AppError` 类；无 SQL、fs、网络。`check-architecture` 已强制 domain 不碰 infrastructure、packages 不碰 node/express/react；`rules` 前端已在用 | ✅ **能在前端跑**（含 exe 内的 WebView），前提是把 domain 挪到共享包（架构规则禁止 web 引 `apps/server/*`） |
| C4 | conditions / effects 在哪求值 | `@novel-game/rules`（`reachChoiceAvailable` / `reachApplyEffects` / `worldbook*` / `matchesWorldConditions` / `applySetTerritory` …） | ✅ 已是共享纯包 |
| C5 | fill / encounter stub 是否确定 | `rules/src/fill-actions.ts`；掉落 `lootChancePasses` 用 `placementId:itemId` 字符串哈希，**无 `Math.random`**；时间由调用方传入 | ✅ 浏览器 / exe / 服务端可逐字节一致，可做对拍 |
| C6 | 存档存在哪 | SQLite：`sessions`+`session_events`、`adventure_sessions`+`adventure_events`；状态整块 JSON；`requestId` 幂等 + `expectedTurn` 冲突在 **repository**；`AdventureState.schemaVersion = 1` | ✅ 换实现即可，沿用 `SessionRepository` / `AdventureRepository` 端口；幂等/冲突要保留 |
| C7 | 开放世界额外依赖 | ⚠️ `AdventureService` 每次 start/get/act 读**实时** `BuildingLibrary` + `ItemCatalog`（`app/workbench.ts` 注入），**不在 revision 里** | ⚠️ 包必须带 **Catalog 快照**；M1 现网世界存档会随作者改目录漂移（R2） |
| C8 | id / 时间 | service 层用 `node:crypto.randomUUID` 与 `new Date()` | 本地端口改用 `crypto.randomUUID`（带兜底） |
| C9 | 前端怎么调后端 | `PlayerStoryPage` / `PlayerWorldPage` / `PlayRouteGate` 直接 `request(token, '/sessions'…)` | ⚠️ 要抽 **PlayPort** |
| C10 | 图片 | `imageUrl`（data URL）或 `imagePath`（`/media/…`），仅展示 | 导出时内联；缺图降级 |
| C11 | 构建 | Vite（`base` 默认 `/`）；服务端 esbuild；`file://` 下浏览器不加载外链 module 脚本 | 需玩家专用入口 + 单文件内联 |
| C12 | Rust / Tauri | 仓库里**没有** Rust / Tauri 代码。本 box 有发行版自带 `rustc/cargo 1.85.1`，**无 rustup**、未装 Windows 目标库 | exe 需要新建一个小 Rust 工程；**作者导出时**不应依赖 Rust（见 §2.4.2） |

**结论：离线包可行。** 引擎本来就是纯函数、结果确定；工作是 ①引擎搬共享包（搬家不复制）②PlayPort 本地实现 ③Catalog 快照 ④玩家专用单文件构建 ⑤（exe）一个只负责「开窗 + 读写存档文件」的薄壳。

### 2.2 导出形态候选（存档备查）

| 方案 | 是什么 | 取舍 |
|---|---|---|
| **(a) 静态包** ✅ 用户已选 | 玩家壳前端 + 共享引擎 + 内容 JSON，本地存档 | 断网能玩、可任意托管、不碰鉴权；要搬引擎 |
| (b) 带最小服务端的包 | Node 小服务 + 前端 | 引擎不动，但玩家要装 Node / 体积大 |
| (c) 本机开公网链接 | 放宽 `localBoundary` + 隧道 | 作者电脑要一直开；公网暴露写接口；安全面最大 |

### 2.3 已定：(a) 静态包，出两种产物

| 产物 | 形态 | 适合 |
|---|---|---|
| **网页版** | 单个 `.html`，JS/CSS/数据全内联；也能直接扔到 itch.io / GitHub Pages | 聊天里发文件、手机/任意系统浏览器 |
| **Windows 版** | 一个 `.exe`：Rust + **Tauri** 薄壳，里面装的就是**上面那份 HTML**，原样不改 | 想「像个正经游戏一样双击」的玩家 |

**一份包、两种外壳**：exe 不另写运行时、不另打一份前端，它的「内容」就是网页版那个 HTML 文件的字节。这样两边一致性只要验一次。

### 2.4 Windows exe 方案

#### 2.4.1 exe 里装什么

```text
通用播放器 btg-player.exe（Tauri，预编译，所有游戏共用）
  ├─ 职责 1：开一个窗口（系统 WebView2），把注入的 HTML 当页面显示
  ├─ 职责 2：给页面提供「存档文件读写」三四个接口（宿主 API）
  └─ 不含：任何规则、任何游戏内容、任何 AI、任何网络请求
+ 注入的内容：导出的那份单文件 HTML（含 manifest + 内容 + 引擎 + 玩家壳）
= <游戏名>.exe
```

#### 2.4.2 构建链路：推荐「预编译播放器 + 注入内容」

| 方案 | 做法 | 作者机器要什么 | 评估 |
|---|---|---|---|
| **A 预编译 + 注入（推荐）** | 播放器 exe 每个版本只编一次（Windows CI 或开发机），随工作台发布；作者导出时服务端把 HTML **追加到 exe 末尾**（尾部写魔数 + 长度 + 哈希），改名为 `<游戏名>.exe` | **不需要** Rust / 编译器；Linux / mac 上的工作台也能导出 Windows exe（只是拼字节） | 可行：Windows 加载 exe 不管文件末尾的附加数据；播放器启动时读自己（`current_exe`）尾部取出 HTML。导出秒级完成 |
| A′ 预编译 + 旁置文件 | exe 旁边放 `game.btgpkg.html`，发 zip | 同上 | 作为 A 的兜底：尾部找不到内容时去同目录找；也为将来签名留路（签名后不能再往尾部追加） |
| B 每次现场编译 | 导出时用 Tauri CLI 把 HTML 当前端资源编进去 | 作者机器要装 Rust、Tauri CLI、Windows SDK/MSVC 或交叉工具链；首次编译数分钟、几 GB 缓存 | **不推荐**：违背「一键导出」；在 Linux 上编 Windows 还是实验性路线（见下） |

**本机是否需要 Rust 工具链：**
- 作者导出：**不需要**（方案 A）。
- 开发者/CI 编通用播放器：需要。推荐在 **Windows CI runner** 上编（Tauri 官方主路径）。本 box 只有发行版 rustc 1.85.1，没有 rustup 和 Windows 目标，不建议在这里交叉编。

**播放器从哪来：** 构建脚本把 CI 产物放到 `dist/player/btg-player-windows-x64.exe`（默认不进 git，下载或 CI 拷入）；文件缺失时作者壳「导出 Windows 版」置灰并写明「Windows 播放器未就绪」，网页版照常可用。

#### 2.4.3 存档位置：推荐「应用数据目录里的文件」

| 选项 | 位置 | 好处 | 坏处 |
|---|---|---|---|
| WebView 的 localStorage | `%LOCALAPPDATA%\<播放器标识>\EBWebView\…` | 零额外代码，和网页版同一套 | 玩家看不见、没法备份；约 5MB 上限；WebView 数据被清就全没；多个游戏共用一个播放器标识，靠键名分区 |
| **应用数据目录文件（推荐）** | `%APPDATA%\BookToGame\Player\saves\<packageId>\<saveId>.json` | 看得见、能拷走备份、无 5MB 限制、和 WebView 缓存解耦 | 要写几个宿主接口；要做原子写（先写临时文件再改名） |

**端口不变**：引擎之上仍是 `SessionRepository` / `AdventureRepository` 的语义（含 `requestId` 幂等、`expectedTurn` 冲突）。本地实现下面再抽一层 **SaveStore**：
- 网页版 → `LocalStorageSaveStore`
- exe → `HostFileSaveStore`（调用宿主接口读写文件）
- exe 里宿主接口不可用时 → 退回 localStorage 并提示

页面靠 manifest 之外的运行时探测（宿主注入 `hostApiVersion`）决定用哪个；**同一份 HTML** 在浏览器和 exe 里都能跑。

#### 2.4.4 平台：本期只做 Windows x64

| 事项 | 说明 |
|---|---|
| **WebView2 依赖** | Tauri 在 Windows 上用系统 WebView2。Windows 11 自带；Windows 10 绝大多数已通过系统更新装上。**Windows 7 / 8 / 8.1 不支持**（WebView2 已停止支持，Tauri 2 也不支持）。缺 WebView2 时播放器弹窗说明并给微软下载页链接，不闪退。本期**不**内置 WebView2 离线安装包（会多 100MB+） |
| **交叉编译** | Linux 上编 Windows Tauri 属官方「实验性」：要 `cargo-xwin` + LLVM/lld + 下载 MSVC CRT/SDK，只能出 NSIS 安装器路线、MSI 不行；坑多。因为方案 A 只需「编一次播放器」，直接用 Windows CI，不在 Linux 上交叉编 |
| **未签名 → SmartScreen** | 玩家首次运行会看到「Windows 已保护你的电脑」，要点「更多信息 → 仍要运行」；部分杀软可能误报（未签名 + 尾部附加数据）。本期**不签名**，导出报告和包内说明写清楚；签名证书属远期 |
| **体积** | 播放器本体预计约 3–10MB + 内容 HTML（通常 1–5MB，图片多会更大）；不含 WebView2 |
| **形态** | 免安装单 exe（不出安装器）；双击即玩；不写注册表，只写存档目录 |
| **图标 / 名字** | 本期用通用播放器图标，窗口标题用游戏名；每游戏自定义图标需改 exe 资源，放远期 |
| **mac / Linux 桌面版** | **Out**，后续。（技术上同一套 Tauri 薄壳可编，但要各自签名/公证、各自 CI） |

#### 2.4.5 节奏：拆成 M1b-1 → M1b-2（Q4=A 用户已定）

| 子期 | 内容 | 为什么这样切 |
|---|---|---|
| **M1b-1** | 引擎搬家 + 对拍 + PlayPort/SaveStore + 单文件 HTML 导出 | 所有「一致性」风险都在这一步；HTML 是 exe 的内容本体 |
| **M1b-2** | Tauri 通用播放器 + 注入 + 文件存档 + Windows 导出入口 | 只加外壳，不碰引擎；HTML 验过了，exe 只需验「外壳行为」 |

exe 直接叠在 HTML 上，M1b-1 不过不开 M1b-2。

### 2.5 AI 接口位（只预留，不接线）

| 项 | M1b 做什么 |
|---|---|
| manifest | 预留可选字段 `ai: { mode: 'none', endpoint?: string }`；M1b 导出**永远**写 `mode: 'none'`，不写 endpoint |
| 玩家壳 | **不挂** narrate / propose-act；读到 `ai` 字段也忽略 |
| 密钥 | 包里**绝不**写入作者的模型 API Key 或任何密钥（导出时校验，发现即失败） |

**M4 的方向（写给后面，不在本期做）：**
- **联网增强**：`mode: 'remote'`，`endpoint` 指向作者或平台提供的服务，玩时调它要旁白/提案文字。
- **断网 / 服务不可用**：诚实显示「AI 不可用」，**照样完整可玩**。
- **玩家自带 Key**：`mode: 'byok'` 作为备选，玩家在本机填 API Key，只存玩家本机，不进存档、不进包。
- **本地小模型**：不考虑。
- **铁律不变**：AI 只出文字（旁白、建议），**不改存档**；任何状态变化只走规则端口（与 roadmap 原则 2、M4 验收一致）。

---

## 3. In / Out（硬边界）

### 3.1 In（本期必须）

| 项 | 子期 | 说明 |
|---|---|---|
| **共享推进引擎** | M1b-1 | `sessions/domain` 与 `adventure-sessions/domain` 迁到共享包（建议 `packages/play-runtime`，Coder 定）；服务端改为调用；**不复制、不重写、不改 Substrate 语义** |
| **PlayPort + SaveStore** | M1b-1 | 组件只调 `start / list / get / act`；Http / Local 两种 PlayPort；Local 下保留 `expectedTurn` 冲突与 `requestId` 幂等；SaveStore 抽象（localStorage 先实现） |
| **story 与 open 覆盖** | M1b-1 | 两种都导出（**Q3=A 用户已定**）；open 带 Catalog 快照，P1 买/补/接、P2 交锋/撤离与掉落可玩 |
| **与 revision 一致** | M1b-1 | 包 = 导出时 revision 原文 + Catalog 快照（只含该世界引用到的）；manifest 记哈希；对拍证明同输入同输出 |
| **单文件 HTML 导出** | M1b-1 | 玩家专用构建入口，只打 PlayerShellLayout + 局内组件；JS/CSS/数据内联；无作者壳、无「返回工作台」 |
| **包内不含 AI** | M1b-1 | 无 narrate / propose-act；manifest `ai.mode='none'`；包内无密钥 |
| **作者导出入口** | M1b-1 / -2 | 已发布版本旁「导出网页版」（-1）、「导出 Windows 版」（-2）；导出走共享命令表（HTTP + MCP 同一命令） |
| **版本与兼容** | M1b-1 | manifest `formatVersion` / `runtimeVersion` / `revision.version`；存档记 `packageId + revisionId + runtimeVersion`；不匹配诚实提示，不静默迁移 |
| **图片** | M1b-1 | `/media/…` 内联为 data URL；缺图降级并写入报告 |
| **Windows 通用播放器** | M1b-2 | Tauri 薄壳：开窗显示注入的 HTML + 存档文件读写接口；不含规则/内容/AI/网络；Windows CI 预编译 |
| **exe 导出 = 注入** | M1b-2 | 服务端把同一份 HTML 追加到播放器尾部生成 `<游戏名>.exe`；作者机器不需要 Rust；尾部缺失时读同目录旁置文件 |
| **exe 文件存档** | M1b-2 | `HostFileSaveStore`：`%APPDATA%\BookToGame\Player\saves\<packageId>\`；原子写；宿主不可用时退回 localStorage 并提示 |
| **WebView2 缺失提示** | M1b-2 | 不闪退；说明 + 下载链接 |

### 3.2 Out（明确不做）

| 项 | 归属 |
|---|---|
| 公网账号、登录、云存档、跨设备同步 | 路线图非目标 |
| 商店分发、上架、付费、DRM / 加密防剧透 | 非目标；包内容明文，作者知情 |
| 成品内 AI（远程增强、玩家自带 Key） | **M4**；本期只预留 manifest 字段 |
| 本地小模型 | 不考虑 |
| 新玩法、改 Substrate、合并 sessions 与 adventure-sessions | 禁止 / M5 |
| 方案 (b) 最小服务端包、(c) 公网隧道 | 不做；(c) 远期可选 |
| **mac / Linux 桌面版**、Windows ARM、Windows 7/8 | 后续 |
| exe 代码签名、安装器（MSI/NSIS）、内置 WebView2 离线包、每游戏自定义图标 | 远期 |
| 作者导出时现场编译 exe | 不做（选预编译 + 注入） |
| 托管一键发布（itch / Pages） | 远期；本期只给文件 |
| 存档导入导出、跨版本存档迁移 | 远期 |
| 修 M1 现网「世界存档随实时 Catalog 漂移」 | backlog（R2）；本期只保证**包内**冻结 |
| 包内编辑、Mod | 非目标 |

---

## 4. 可感闭环

### 4.1 作者路径

```text
工作台发布草稿 → 得到 Revision
  → 在该版本上点「导出网页版」或「导出 Windows 版」
  → 导出中（校验 revision → Catalog 快照 → 内联图片 → 拼 HTML →（exe）注入播放器）
  → 成功：下载文件 + 导出报告（大小、模式、降级项；exe 附「首次运行可能出现 SmartScreen」说明）
     或 失败：说清原因
  → 把文件发给别人
```

### 4.2 玩家路径

```text
网页版：双击 .html 或打开托管链接      Windows 版：双击 .exe（首次可能要点「仍要运行」）
                    ↘                      ↙
           落地：游戏标题 + 「开始新存档 / 继续」（包里只有这一个游戏）
  → Perceive → Decide → Act（本地 PlayPort → 共享引擎 → SaveStore）→ Feedback
  → 终局：Ending；「再来一局 / 回到开始页」
```

| 节拍 | 本切片要求 |
|---|---|
| Perceive / Decide / Feedback | 与 M1 玩家壳同一组件，视觉不变；网页版与 exe 画面一致 |
| Act | 只经 PlayPort；UI 不自己改状态当真值 |
| 离开再回 | 刷新 / 重开文件 / 重开 exe，续档回到同一 Perceive |

---

## 5. 数据契约摘要（给 UI / Coder）

### 5.1 网页版：单文件 HTML

```text
<游戏名>-v<revision.version>.html
  ├─ <script id="btg-manifest" type="application/json">   manifest
  ├─ <script id="btg-content"  type="application/json">   revision + catalogSnapshot
  └─ 玩家壳 bundle（PlayerShellLayout + ReaderPlaySurface / AdventurePlaySurface + play-runtime + LocalPlayPort + SaveStore）
```

### 5.2 Windows 版：播放器 + 注入

```text
<游戏名>-v<revision.version>.exe
  ├─ [btg-player.exe 原始字节]          预编译通用播放器（Tauri）
  ├─ [payload]                         = 5.1 那份 HTML 的原始字节，一字不改
  └─ [footer 固定长度]                  magic "BTGPKG01" · payloadLength(u64) · payloadSha256 · hostApiVersion

兜底（尾部无 payload 时）：exe 同目录的 game.btgpkg.html
```

宿主接口（页面可调用，`hostApiVersion = 1`）：

| 接口 | 作用 |
|---|---|
| `save_list(packageId)` | 列存档 |
| `save_read(packageId, saveId)` | 读一个存档 |
| `save_write(packageId, saveId, json)` | 原子写（临时文件 → 改名） |
| `save_delete(packageId, saveId)` | 删除（UI 本期可不露） |

宿主**不**提供网络、shell、任意文件访问；页面内容安全策略禁止外部请求。

**M1b-2 实现补充（2026-10-28）**

- footer 精确布局（52 字节，小端）：`"BTGPKG01"`(8) · `payloadLength` u64 LE(8) · `sha256(payload)` 原始 32 字节 · `hostApiVersion` u32 LE(4)。
  长度为 0 或大于文件 ⇒ 视为无 footer ⇒ 走旁置 `game.btgpkg.html`。TS：`packages/play-runtime/src/package/host-api.ts`（编解码）+
  `apps/server/src/modules/exports/domain/exe-trailer.ts`（拼装）；Rust：`apps/player-host/src/payload.rs`；跨语言测试 `apps/player-host/scripts/core-tests.sh`。
- sha 不符：播放器照常开窗，注入 `payloadIntact:false` ⇒ 页面走 M1b-1「这个游戏文件已损坏」页（不弹原生框）。
- 页面侧宿主对象：`window.__BTG_HOST__ = { hostApiVersion, payloadIntact?, payloadSource?, saveList, saveRead, saveWrite, saveDelete }`（Promise）；
  保留 id `index` = `index.json`（存档顺序，X14）；id 只许 `[A-Za-z0-9_-]{1,128}`（Rust 侧另拒 DOS 设备名）。
- 「禁止外部请求」在 exe 里由播放器的响应头 CSP（`connect-src` 只放 Tauri IPC）+ 禁止导航出 payload 实现；**payload 字节不改**。
- 播放器构建：只在 Windows 机（`apps/player-host/README.md`，`scripts/build-windows.ps1`，纯 `cargo build --release`，无 tauri-cli、无安装器）；
  产物 `dist/player/btg-player-windows-x64.exe` + `.json`（git 忽略），服务端默认读这里，`BTG_WINDOWS_PLAYER` 可覆盖。

### 5.3 manifest 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `formatVersion` | `1` | 包格式版本；不认识就报「需要更新版本的播放器」 |
| `packageId` | string | 导出时生成；存档分区键；同一次导出的 HTML 与 exe 共用（exe 由该 HTML 注入而来） |
| `mode` | `'story' \| 'open'` | 走哪个 surface |
| `title` | string | 游戏名 |
| `revision` | `{ id, version, createdAt, kind: 'game' \| 'world' }` | 钉住的发布版本 |
| `contentHash` | string | 内容 JSON 的 SHA-256；打开时校验 |
| `catalogSnapshot` | `{ buildingAssets, items, hash } \| null` | open 必填；story 为 null |
| `runtimeVersion` | string | 共享引擎版本 |
| `exportedAt` | ISO 时间 | |
| `exporter` | `{ app: 'book-to-game', appVersion }` | |
| `locale` | `'zh-CN' \| 'en-US'` | 默认界面语言 |
| `degraded` | `{ kind, detail }[]` | 导出降级项 |
| `ai` | `{ mode: 'none', endpoint?: string }` | **预留**；M1b 固定 `mode:'none'`、无 endpoint；M4 再扩 `'remote' \| 'byok'`。禁止任何密钥字段 |

（exe 特有信息 `hostApiVersion` / 播放器版本写在 exe footer，不进 manifest，保证 HTML 两边一字不差。）

### 5.4 content 结构

```text
{
  revision: GameRevision | WorldRevision,        // 原样
  catalogSnapshot?: { buildingLibrary: BuildingLibrary(子集), itemCatalog: ItemCatalog(子集) }
}
```

### 5.5 存档：同一端口，两种存储

```text
play-runtime（纯函数）
   ↑
LocalSessionRepository / LocalAdventureRepository   ← 与服务端 Repository 同语义（幂等、turn 冲突）
   ↑
SaveStore 接口 { list, read, write, delete }
   ├─ LocalStorageSaveStore   （网页版；exe 宿主不可用时兜底）
   └─ HostFileSaveStore       （exe）
```

存档记录（两种存储同一 JSON 形状）：

```text
{ saveFormatVersion: 1, packageId, revisionId, runtimeVersion,
  state: SessionState | AdventureState,            // 与服务端 data 列同形
  events: [{requestId, turn, input, response}]    // 最近 N 条，用于幂等重放 }
```

| 存储 | 位置 |
|---|---|
| 网页版 | localStorage 键 `btg:pkg:<packageId>:index`、`btg:pkg:<packageId>:save:<id>` |
| exe | `%APPDATA%\BookToGame\Player\saves\<packageId>\<saveId>.json` |

网页版与 exe 的存档**不互通**（本期不做导入导出）。

### 5.6 端口

```text
PlayPort { listRevisions(); start(revisionId); list(); get(id); act(id, {requestId, expectedTurn, choiceId|actionId}) }
HttpPlayPort  → 现有 /api/sessions | /api/adventures（工作台与 M1 /play 不变）
LocalPlayPort → play-runtime + Local*Repository + SaveStore
```

导出命令（服务端共享命令表，HTTP + MCP 同一命令）：

| 命令 | 输入 | 产出 |
|---|---|---|
| `export_play_package` | `{ kind: 'game'\|'world', revisionId, target: 'html'\|'windows-exe' }` | 文件 + 导出报告 JSON |

服务端只**拼装**（预构建玩家壳模板 + 数据；exe 再拼播放器字节），不在请求里跑 Vite 或 Rust。

### 5.7 M1b-2 契约决定（X5 / X7 / X11，2026-10-28 Coder 定，按 UI 规划默认）

**X5 · 作者页怎么知道 exe 能不能导出 → 能力查询 + 点击兜底**

- 只读命令 `export_targets`（HTTP `GET /api/exports/targets`，MCP 同名，readOnly）：
  `{ html: { available, unavailableReason?: 'template-missing' }, 'windows-exe': { available, unavailableReason?: 'player-missing' | 'player-invalid' | 'player-already-packaged' | 'player-host-api', playerPath, version?, hostApiVersion? } }`。
  `playerPath` 为相对工作目录的显示路径（不含用户主目录以外信息）；`version/hostApiVersion` 来自播放器旁置 `.json`。
- 作者页每次页面加载查一次；不可用 ⇒「导出 Windows 版」disabled + hint。加载后播放器才消失 ⇒ 点击时服务端回
  `501 EXPORT_TARGET_UNAVAILABLE`，`details = { target, playerPath, unavailableReason }` ⇒ muted 条（不是 rust）+ 本页此后 disabled。

**X7 · exe 怎么交给浏览器 → 与网页版同一个 JSON 报告通道**

- `export_play_package` 加 `target`；exe 报告：`target:'windows-exe'`、`fileName = <title>-v<N>.exe`、`size` = 整个 exe 字节数、
  `payloadSha256`、`player: { version?, hostApiVersion }`、`fileBase64`（整个 exe）、`html: ''`（不重复传 payload）。
  网页版报告同样新增 `target:'html'` 与 `payloadSha256`。前端把 base64 解成 Blob 下载（`application/vnd.microsoft.portable-executable`）。
- 体积上限按 **payload（HTML）** 计，与网页版同一阈值；exe 只多播放器的固定字节。
- 不新增二进制下载端点、不落服务端临时文件（本期体量 ≤ 数十 MB，base64 开销可接受；若日后超限再改流式端点）。

**X11 · 同步 SaveStore vs 异步宿主接口 → SaveStore 保持同步，宿主文件做「预载 + 写后刷盘」**

- 打开时：`save_list` → 读 `index.json` 定序（缺失的按文件名补在后）→ 逐个 `save_read` 预载进内存 → 回写 `index.json` 作探针。
  探针失败 ⇒ 降到 host-fallback（localStorage）。之后 `read/list` 走内存，`write/delete` 同步改内存并入串行刷盘队列（同 id 合并）。
- 同 `requestId` 重放：缓存里已有该事件 ⇒ 不会二次推进（与服务端幂等同义）。
- 刷盘失败：该条缓存回退到上次落盘值 ⇒ `GuardedSaveStore.reportAsyncWriteFailure` 把记录改存到下一层并切状态（Banner + 行标「临时位置」）。
  层级只降不升（本进程内）：host-file → host-fallback（localStorage）→ 内存（「无法保存」）。
- 读取同 id 多层都有时，取 (turn, updatedAt) 更新的那份 ⇒ 下次启动文件夹恢复可写时也不会丢掉临时位置里的新进度。
- `status.where ∈ browser | host-file | host-fallback`，`fallbackReason ∈ host-write-failed | host-unavailable | host-version`，文案按 `where` 取句（exe 里不出现「浏览器」）。

**Backlog（本期只记录，不修）**

- 服务端写文件 `0o600` 权限一致性（导出不落盘，与本期无关；留 backlog）。
- 媒体路径穿越校验（`FsMediaReader` 的 `../` / 绝对路径 / 符号链接边界）再审一次——本期**未改动**该校验。

---

## 6. 关键状态露脸

### 6.1 作者壳（导出）

| 状态 | 表现 | 文案方向 |
|---|---|---|
| 可导出 | 两个按钮可点 | 「导出网页版」「导出 Windows 版」 |
| 导出中 | 按钮转进度，禁止重复点 | 「正在打包…」 |
| 成功 | 下载 + 报告 | 「已导出 · xx MB · 故事/开放世界 · 按导出时目录冻结」 |
| 成功（exe） | 报告多一句 | 「未签名：对方首次运行可能看到 Windows 安全提示，点『更多信息→仍要运行』；需 Windows 10/11」 |
| 成功但有降级 | 报告列出降级项 | 「3 张图片未找到，包内不显示（不影响玩法）」 |
| 失败 | 可读原因，不留半个文件 | 「版本不存在或未发布」/「内容校验未通过」/「包体超过上限」/「检测到密钥，已中止」 |
| 不支持的内容 | 拒绝并指出哪项 | 「货架引用的 xx 已不存在，请修复后再发布」 |
| Windows 播放器缺失 | 「导出 Windows 版」置灰 | 「Windows 播放器未就绪，网页版可正常导出」 |
| 只有草稿没发布 | 按钮不出现或置灰 | 「先发布再导出」 |

### 6.2 包内（网页版与 exe 共用）

| 状态 | 表现 |
|---|---|
| 正常打开 | 标题 + 开始新存档 / 继续 |
| 无存档 | 只有「开始新存档」 |
| 局内 / 终局 | 同 M1 玩家壳；终局「再来一局 / 回到开始页」 |
| 包损坏（哈希不符 / JSON 坏） | 「这个游戏文件已损坏，请找作者重新导出」，不进局 |
| 包版本过新 | 「此文件需要更新版本的播放器」 |
| 存档版本不符 | 该存档标「来自旧版本，无法继续」，可新开档；不删、不偷偷迁移 |
| 存不了（localStorage 禁用 / 存档目录不可写） | 顶部提示「无法保存，本局关闭后不会保留」，仍可玩 |
| act 被拒（锁定 / 冲突） | 与 M1 同：可读原因，不假 delta |

### 6.3 exe 特有

| 状态 | 表现 |
|---|---|
| 缺 WebView2 / Windows 7·8 | 原生弹窗「需要 Microsoft Edge WebView2（Windows 10/11）」+ 下载链接；不闪退 |
| exe 尾部无内容且旁边无 `game.btgpkg.html` | 原生弹窗「找不到游戏内容」 |
| 内容哈希不符 | 进 6.2「包已损坏」 |
| 存档目录写失败 | 退回 localStorage 并提示「存档改存在临时位置」 |

视觉沿用 P0–P2 / M1 仪器感；不做启动海报、不做商城。中文 `t()`。

---

## 7. 验收条（可勾选）

> 勾选以**在没跑 book-to-game 的环境里打开导出文件**为准（新浏览器配置 / 干净 Windows + 断网 + 停本机服务模拟）。

### 7.1 导出入口（M1b-1）

- [ ] 已发布 **story** revision 「导出网页版」得到 HTML
- [ ] 已发布 **world** revision 同样得到 HTML（Q3=A）
- [ ] 未发布 / 不存在 / 校验不过时有可读失败原因，不产出文件
- [ ] 导出命令 HTTP 与 MCP 共用同一命令
- [ ] manifest 含 §5.3 全部字段，`contentHash` 与内容一致，`ai.mode === 'none'` 且无 endpoint
- [ ] 往模型设置里放一个测试密钥后导出，包内全文搜不到该密钥

### 7.2 离线与隔离（M1b-1）

- [ ] 停服务、断网、新浏览器配置双击 HTML 能开新档
- [ ] 游玩全程网络面板**零** `/api`、`/media` 及任何外部请求
- [ ] 包内无作者主导航、无「返回工作台」、无 narrate / propose-act 入口
- [ ] 构建检查脚本断言玩家包不含作者组件标识（如 `DraftPanel`、`WorldsPanel`、`ModelSettingsPanel`）

### 7.3 与 revision 一致（M1b-1）

- [ ] 对拍测试：同一 revision + 同一行动脚本，服务端 service 与 LocalPlayPort 每步 View **深相等**（story、open 各至少一条；open 覆盖一次 P1 填充 + 一次 P2 交锋或撤离 + 掉落）
- [ ] 导出后改草稿、改建筑库/物品目录并重新发布，旧包玩起来**不变**
- [ ] `npm run check:architecture` 通过；推进引擎只有一份源码（服务端改引用共享包，无复制文件）
- [ ] 既有服务端单测与 M1 play-route 单测全绿

### 7.4 局内玩法（M1b-1）

- [ ] story：至少一次选择 → 代价或 delta 或结局可见；能打到结局
- [ ] open：至少一次移动 + 一次填充或遭遇 → HUD/delta 或诚实空态；锁定原因可读

### 7.5 存档（M1b-1，网页版）

- [ ] 刷新 / 重开文件后续档回到同一 Perceive
- [ ] 多存档可区分；两个不同游戏的包在同一浏览器存档互不串
- [ ] 同一 `requestId` 重放不重复推进；两标签页抢推进给冲突提示
- [ ] 改坏存档版本号 → 「无法继续」而非崩溃
- [ ] 禁用 localStorage → 有提示且仍能玩

### 7.6 Windows exe（M1b-2）

> 2026-10-28 Coder 标注：✅ = 已在 Linux 作者机实测；**待 Windows 环境** = 需要真播放器（在用户 Windows 构建机 DESKTOP-BTSC7FP 上构建）与干净 Win10/11，**不计为通过**；括号里是已在本机完成的替身验证。

- [x] ✅「导出 Windows 版」得到 `.exe`；导出机器**未装** Rust 也能完成（Linux 工作台上导出亦可）——Linux + mock 播放器（MZ 头假二进制）实测，e2e `exe-shots.mjs` 25/25；真播放器只是换 `dist/player/` 里的文件
- [x] ✅ 从 exe 尾部取出的 payload 与同一次导出的 HTML **字节一致**（SHA-256 相同）——`export-exe.test.ts` 同一次导出逐字节比对；e2e footer sha == sha256(payload) == 报告 payloadSha256；Rust 解码器读 TS 生成的 exe 字节一致（`core-tests.sh`）
- [ ] **待 Windows 环境** 干净 Windows 10 与 Windows 11（x64）断网双击可开新档、玩到结局（story）/ 完成一次填充或遭遇（open）（Linux 仅模拟宿主跑包内页面）
- [ ] **待 Windows 环境** 存档写到 `%APPDATA%\BookToGame\Player\saves\<packageId>\`；关闭重开 exe 续档成功；把该目录拷到另一台机器同路径也能续（web 侧预载/续档单测 + Rust `saves.rs` std 单测已过）
- [ ] **待 Windows 环境** 两个不同游戏的 exe 存档互不串（Rust 单测：按 packageId 分目录 ✅）
- [ ] **待 Windows 环境** 存档写入中途强杀进程，重开后存档仍是完整的上一版（原子写：tmp → fsync → rename 已实现；残留 .tmp 被忽略的单测 ✅）
- [ ] **待 Windows 环境** 去掉尾部 payload、旁边放 `game.btgpkg.html` 也能玩；两者都没有时弹「找不到游戏内容」（Rust `payload::locate` 单测：尾部 → 旁置 → None ✅；N2 弹窗需真机）
- [ ] **待 Windows 环境** 卸载/缺 WebView2 的环境（或模拟）弹出说明，不闪退（N1/N1b 文案与退出码已实现）
- [ ] **待 Windows 环境** 进程监控 / 防火墙日志：游玩期间 exe 无任何网络连接（响应头 CSP + 禁止导航已实现）
- [ ] **待 Windows 环境** 记录：exe 体积、首次运行 SmartScreen 截图（作为已知现象，不算失败）（mock 下 exe = 64 KB 假播放器 + 1.35 MB payload + 52 B；真体积待真播放器）
- [x] ✅ 仓库里播放器 Rust 代码不含任何规则判断（代码审阅：`apps/player-host/src` 只有预检、读 payload、开窗/协议、4 个存档文件命令、原生弹窗文案；不解析存档 JSON）

### 7.7 AI 接口位

- [ ] manifest schema 有可选 `ai` 字段，M1b 导出恒为 `{ mode: 'none' }`
- [ ] 手工把 manifest 改成别的 `mode` 再打开，包仍正常可玩、壳内不出现 AI 入口（本期忽略该字段）

### 7.8 截图建议

`/workspace/btg-e2e/screenshots/m1b-export-buttons-*.png`、`m1b-export-report-*.png`、`m1b-html-landing-*.png`、`m1b-html-story-*.png`、`m1b-html-world-*.png`、`m1b-html-offline-network-*.png`、`m1b-html-corrupt-*.png`、`m1b-html-resume-*.png`；M1b-2：`m1b-exe-smartscreen-*.png`、`m1b-exe-landing-*.png`、`m1b-exe-play-*.png`、`m1b-exe-savedir-*.png`、`m1b-exe-no-webview2-*.png`。

### 7.9 明确不测本期

- [ ] ~~公网账号 / 云存档~~
- [ ] ~~上架 / 托管一键发布 / 签名~~
- [ ] ~~包内 AI~~（M4）
- [ ] ~~mac / Linux 桌面版~~
- [ ] ~~新玩法~~

---

## 8. 实现建议顺序

| 序 | 子期 | 步骤 | 产出 | 提醒 |
|---|---|---|---|---|
| 0 | — | 用户定 Q1–Q4，本文定稿 | 「定稿」 ✅ 已完成（2026-10-28） | 本轮交 UI 只规划 M1b-1（§11.1） |
| 1 | M1b-1 | **引擎搬家** | 共享包；服务端改引用；全量测试绿 | 纯重构，零行为变化 |
| 2 | M1b-1 | **对拍测试** | 服务端 vs 本地同脚本 View 深相等 | 后续每步都跑 |
| 3 | M1b-1 | **PlayPort + SaveStore** | Http / Local；localStorage 存储；M1 页面改走端口 | M1 `/play` 行为不变 |
| 4 | M1b-1 | **UI 规划** | 导出按钮/报告、包内落地/错误/存档提示 | 策划确认后才交 Coder |
| 5 | M1b-1 | **玩家专用单文件构建** + 导出命令 | HTML 导出；构建检查无作者组件；密钥扫描 | 不在请求里跑构建 |
| 6 | M1b-1 | **策划验收** §7.1–7.5、7.7 | | 通过才开 M1b-2 |
| 7 | M1b-2 | **Tauri 通用播放器** | 薄壳 + 存档接口 + WebView2 检查；Windows CI 编译 | 不碰引擎 |
| 8 | M1b-2 | **注入 + HostFileSaveStore + 导出入口** | `<游戏名>.exe` | 作者机器不需 Rust |
| 9 | M1b-2 | **策划验收** §7.6 | 干净 Win10 / Win11 实测 | 默认不 commit/push |

---

## 9. 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 引擎搬家碰 P0–P2 已验收逻辑 | 回归 | 纯重构 + 既有单测 + 对拍；不顺手改规则 |
| R2 | **Catalog 不在 revision 里**（§2.1 C7） | 服务端 `/play` 与包可能「同一 revision 两种结果」 | 包内冻结 + 快照哈希；「发布时钉 Catalog」**保持记在 backlog**（不进 M1b），建议 M3 前处理 |
| R3 | `file://` 下 module 脚本被拦 | 文件夹包双击打不开 | 网页版用单文件内联 |
| R4 | localStorage 被清 / 隐私模式 / 约 5MB | 网页版存档丢失 | 诚实提示；只存最近 N 条事件；exe 用文件存档 |
| R5 | 内容明文 | 可直接看剧情/结局 | 作者知情；不做 DRM |
| R6 | 包体积（图片叠加） | 不好发 | 报告显示体积；设上限（如 20MB） |
| R7 | M1 代码未 commit（HEAD cb5cfe7 + 大量改动） | M1b 叠在未入库代码上，难回滚 | **已定默认：不 commit**，是否先提交由用户另行决定；策划/Coder 不自作主张 |
| R8 | 浏览器 API 兼容（`crypto.randomUUID` 等） | 旧浏览器开不了档 | 兜底实现；验收列支持浏览器 |
| R9 | 运行时升级后旧存档不认 | 不能续旧档 | 本期诚实提示；迁移远期 |
| R10 | **未签名 exe → SmartScreen / 杀软误报** | 玩家被吓退或文件被删 | 报告与包内说明写清；每次导出 exe 哈希都不同，攒不了信誉；签名远期。注意：签名后不能再往尾部追加，届时改用旁置文件或导出时签名 |
| R11 | **WebView2 缺失 / Win7·8 不支持** | 少数玩家打不开 exe | 原生提示 + 下载链接；这些人用网页版 |
| R12 | **Rust 工具链 / CI** | 仓库首次引入 Rust，团队要维护 Windows CI；本 box 无 rustup、无 Windows 目标 | 只编一个播放器、改动频率低；不在 Linux 交叉编（官方实验性） |
| R13 | 尾部注入方案被某些安全软件当成可疑 | 误报 | 保留旁置文件兜底（A′） |
| R14 | 播放器与 HTML 的宿主接口版本错配 | 新 HTML 在旧播放器里存不了档 | `hostApiVersion` 写 footer；不匹配退回 localStorage 并提示 |
| R15 | AI 字段被误用塞密钥 | 作者 Key 泄露给所有玩家 | schema 禁止密钥字段 + 导出时扫描，命中即失败 |
| R16 | 播放器二进制放哪 | 进 git 会胀仓库 | 默认不进 git，CI 产物拷入 `dist/player/`；缺失时 Windows 导出置灰 |

---

## 10. 用户决策

### 10.1 已决（全部为用户 2026-10-28 定）

| # | 问题 | 用户拍板 | 落实 |
|---|---|---|---|
| **Q1** | 导出形态选哪个？ | **A 静态包**（前端 + 共享引擎 + 内容 JSON，本地存档，断网可玩） | §2.3；(b)(c) 不做 |
| **Q2** | 包的文件长什么样？ | **两种都要：** (a) 单文件 HTML 网页版；(b) Windows exe，用 Rust/Tauri 包住**同一份**静态包，不另写运行时 | §2.3、§2.4、§5.1–5.2；exe 推荐预编译播放器 + 注入、文件存档、先只做 Windows x64 |
| **Q3** | story 和开放世界都要能导出吗？ | **A 两种都做**（open 带 Catalog 快照，P1/P2 填充与遭遇在包里可玩） | §3.1、§7.1、§7.3–7.4 |
| **Q4** | 要不要拆成两步做？ | **A 拆**：先 **M1b-1** 引擎搬家 + 网页版 HTML，验收通过后再做 **M1b-2** Windows exe（exe 装 M1b-1 的 HTML） | §2.4.5、§3.1 子期列、§8；本轮交 UI 只做 M1b-1（§11.1） |
| — | AI 接口位 | 用户同意：manifest 预留 `ai` 字段，本期不挂 | §2.5 |

---

## 11. 给 UI / Coder 的阅读指引

| 读者 | 先看 | 产出预期 |
|---|---|---|
| 策划 | §1、§2.3–2.5、§3、§7、§10 | 已定稿；按 §11.1 交 UI（M1b-1） |
| UI | §11.1 范围；§4 闭环、§6.1–6.2 状态；M1 UI 规划 | 本轮只做 M1b-1：网页版导出入口/报告、包内差异；exe 留 M1b-2；确认前不叫 Coder |
| Coder | §2.1 现状、§2.4 exe、§5 契约、§8 顺序、§9 风险 | 先引擎搬家 + 对拍；exe 播放器只做薄壳；默认不 commit |

### 11.1 交 UI 的范围（本轮 · 仅 M1b-1）

本轮 UI 只规划 **M1b-1（网页版）** 的界面；exe 相关一律留到 M1b-2 再交。

| # | 规划对象 | 要画/要写的 | 对应锚点 |
|---|---|---|---|
| U1 | **作者壳 ·「导出可玩包（网页版）」入口** | 放在已发布 story / world 版本旁；未发布时不出现或置灰「先发布再导出」 | §3.1「作者导出入口」· §4.1 · §6.1 |
| U2 | **导出各状态** | 可导出 / 导出中（防重复点）/ 成功（下载 + 报告：大小、模式、「按导出时目录冻结」）/ 成功但有降级（缺图列表）/ 失败（未发布、校验不过、超体积、检测到密钥）/ 不支持的内容（指出哪项引用失效） | §6.1（不含「成功（exe）」「Windows 播放器缺失」两行）· §5.3 `degraded` |
| U3 | **包内落地页** | 只有一个游戏：标题 + 开始新存档 / 继续；无存档空态；终局「再来一局 / 回到开始页」 | §4.2 · §6.2 |
| U4 | **存档存在本地** | 存档列表（多档可区分）；说明存档只在这台设备的这个浏览器里 | §5.5 · §6.2 · §7.5 |
| U5 | **存不了时的提示** | localStorage 禁用 / 满额：顶部常驻「无法保存，本局关闭后不会保留」，仍可玩 | §6.2「存不了」· §7.5 |
| U6 | **版本不匹配 / 包损坏** | 存档「来自旧版本，无法继续」（可新开档、不删）；包「需要更新版本的播放器」；包损坏错误页 | §6.2 · §5.3 `formatVersion` / `contentHash` / `runtimeVersion` |
| U7 | **相对 M1 玩家壳的删减** | 无「返回工作台」；无书目落地列表；不挂 AI（无 narrate / propose-act 入口，`ai` 字段忽略） | §2.5 · §3.1「包内不含 AI」· §7.2 · §7.7 |
| U8 | **局内** | 沿用 M1 玩家壳与 P0–P2 组件，不重画；只确认锁定/冲突错误态文案一致 | §4.2 · §6.2 · M1 UI 规划 |

**本轮不规划（留 M1b-2）：** 「导出 Windows 版」按钮与「播放器未就绪」态、exe 成功报告里的 SmartScreen 说明、§6.3 全部 exe 原生弹窗、exe 存档目录说明。

**约束复述：** 视觉沿用 P0–P2 / M1 仪器感；不做启动海报、商城；中文 `t()`；UI 规划经策划确认后才交 Coder。

---

## 12. 文档索引

| 文档 | 关系 |
|---|---|
| [`roadmap-maker-next.md`](./roadmap-maker-next.md) | 母路线；M1 · Q2=C，导出包 = M1b；M4 成品 AI |
| [`m1-player-shell-playable-slice.md`](./m1-player-shell-playable-slice.md) | 前序；玩家壳、路由、开续档复用；其 §3.2 Out「导出包」由本文接手 |
| [`player-loop.md`](./player-loop.md) | 循环不变 |
| [`p1-open-fill-playable-slice.md`](./p1-open-fill-playable-slice.md) / [`p2-encounter-playable-slice.md`](./p2-encounter-playable-slice.md) | open 包内需覆盖的填充与遭遇 |
| [`architecture.md`](./architecture.md) / [`api-contract.md`](./api-contract.md) | 模块边界、命令表、session 端口 |

---

## 13. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-10-28 | **草案 · 待确认**：推荐静态包（引擎搬共享包 + LocalPlayPort + localStorage + Catalog 快照）；In/Out、manifest、状态、§7 验收、Q1–Q3；docs-only |
| 2026-10-28 | **草案第二版 · 待确认**：用户定 Q1=A 静态包、Q2=单文件 HTML + Windows exe（Tauri 包同一份 HTML）；新增 §2.4 exe 方案（预编译播放器 + 尾部注入、应用数据目录文件存档、先只做 Win x64、WebView2/交叉编译/SmartScreen/体积）、§2.5 AI 接口位（manifest `ai` 预留、M4 方向）、SaveStore 抽象、exe 状态与 §7.6/7.7 验收、R10–R16；Q3 仍待定，新增 Q4（拆 M1b-1/M1b-2）；docs-only，未交 UI/Coder；未 commit/push |
| 2026-10-28 | **定稿**：用户定 Q3=A（story + open 都做）、Q4=A（拆 M1b-1 / M1b-2）；R7 默认不 commit、由用户另定；R2 保持 backlog；新增 §11.1「交 UI 的范围」（仅 M1b-1）；docs-only，未 commit/push |
| 2026-10-28 | **M1b-2 实现**：新增 §5.7（X5 能力查询 `export_targets` / X7 同一 JSON 报告通道 + base64 / X11 同步 SaveStore + 预载写后刷盘 + 分层降级）与 backlog（0o600、媒体路径穿越）；§5.2 补 footer 精确布局与构建位置；§7.6 逐条标 ✅ / 待 Windows 环境；未 commit/push |
