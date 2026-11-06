# 投胎页（Opening Roll）· 界面规划 · 故事工坊
状态：**策划确认 · 已交 Coder**（2026-11-05） · 不改代码 · 不 commit
对照：`docs/opening-roll-slice.md`（草案 · K16）· `DESIGN_SYSTEM.md` §6「移动端（≤760px）」· `btg-e2e/ui-plan-s1-ending-page.md`（版式范本）· ui-ux-kit-2（Redesign → B3 App/Product）
用户已定：投胎页在**世界简介之后、正文之前**；标签只显示**名字 + 一句效果，不显示数字**；契约 K16。

设计一句话：**投胎页是一张「出生登记表」，不是抽卡机**——数值用现有 `PlayStatsBar` 的计量行呈现，判词一行衬线字收束，按钮写清次数；没有转盘、骰子动画、稀有度发光、彩色品质框。

---

## 0. 现状（读码，2026-11-05）
| 现在 | 和投胎页的关系 | 本期处理 |
|---|---|---|
| `PlayerWorldPage` 开始页：`section-heading`（eyebrow + 标题 + `hint clamp-2` 的 premise = 世界简介）+ 左栏 `player-open-actions`「开始新存档 / 开始新冒险」+ `SaveSlotList` | 「开始」直接调 `port.start(revisionId)` 进局 | 世界启用 `openingRoll` 时，「开始」先进入投胎态，确认后才进正文；未启用时**行为完全不变** |
| `PlayStatsBar` / `PlayStatsCompact`（`AdventureResourceMeta[]`，名 值/上限，`nowrap` 单元） | 已有的数值读数组件 | 投胎页的数值行**复用它的计量行样式**（`play-stats-*`），不另做属性卡 |
| `RollChanceNote` / `RollOutcomeLine`（S1 掷骰结果，`details.roll-breakdown`） | 已有的「掷骰」文案和样式语汇 | 判词行复用 `roll-outcome` 的排版层级（不复用成败色） |
| `SaveSlotList` | 存档列表 | 新增一种存档状态「投胎中」（已掷未确认，R6） |
| `PlayStatsBar` 里的空态「本局尚未声明状态…」 | — | 投胎页不出现该空态 |

## 1. 页面清单
| 页面 / 区块 | 动作 | 说明 |
|---|---|---|
| `PlayerWorldPage` 开始页 → **投胎态**（同一路由，`session.phase === 'opening'`） | **改** | 在 `.play-layout` 的阅读栏里渲染投胎面板；左栏（存档）不变 |
| `OpeningRollPanel`（新，**小**组件，<200 行，放 `components/play/`） | **新** | 只是一个 `<section>`：范围行 + 当前一套 + 判词 + 标签清单 + 已掷记录 + 操作行。数值行调用 `PlayStatsBar` 的行渲染（抽一个 `StatMeterRow` 导出，不复制） |
| `PlayStatsBar.tsx` | **改（抽出行）** | 把单行「名 值/上限 + 细条」抽成 `StatMeterRow` 导出；`PlayStatsBar` 内部改用它；外观零变化 |
| `AdventurePanel`（作者试玩） | **改（接线）** | 同一 `OpeningRollPanel`；作者试玩额外显示 `seedPolicy=fixed` 时的「固定种子 · 测试用」元信息一行 |
| HTML 包 / exe 包 | **不单独改** | 走同一 `PlayerWorldPage`（`pkg` 分支）；宿主存档接口存「投胎中」状态同现有存档 |
| `PlayerStoryPage`（分支故事） | **不动** | 故事模式没有 `openingRoll` |
| 作者端配置编辑器（`openingRoll` 积木） | **Out** | 本期不规划；作者先用 JSON / 数值模板 |
| 体检 / 模拟报告里的档位分布 | **Out（另期）** | 记在 A2-G9 |

## 2. IA 主路径
```
书目 / 包开始页
  └ 世界简介（section-heading，premise clamp-2；手机 clamp-1）
      └ [开始新存档]  ──(openingRoll.enabled=false)──▶ 正文（现状不变）
             │
             ▼ (enabled=true)  创建会话，phase=opening，尚未掷
        投胎面板
          ① 范围（每项 min–max，未掷）   [掷]   （可选 [用标准开局]）
          ② 掷出 → 当前一套：数值行 · 档位名 · 判词 · 已成立标签
             ├ [重掷（剩 N）]   N=0 → 按钮换成说明文字
             ├ 已掷记录（keepBest=true）：点一行 = 切回那一套（不耗次数）
             └ pickOf：一次出 N 套，竖排；点一套 = 选中（单选）
          ③ [就这样，开局] → 写初始状态（K16）→ 开局事件入队 → 正文（滚到地点标题）
读档：phase=opening 的存档 → 回到②，显示同一组已掷结果、同一剩余次数（不重掷）
      phase=play 的存档 → 直接进正文，投胎页不再出现（lockAfterStart）
```
- 一屏一个决定：投胎态时**不显示**正文、状态行、地图、手牌。
- 「确认」是唯一 primary（绿）；「掷 / 重掷」是普通按钮。掷之前 primary 是「掷」。

## 3. 文字线框
样例：《寿灯》§6.1（perStat，重掷 2，single，keepBest）。**注意：现有 `shoudeng.batch*.world.json` 没有根骨/悟性/心性资源（A2-G1），以下数值只为示意版式，Coder 截图须用契约实际返回的值。**

### 3.1 手机 390 · 掷之前
```
开放世界 · v3                                  ← eyebrow 12px
寿灯                                           ← h2
灯油有尽，人有尽……（clamp-1）                   ← 世界简介 14px
───────────────────────────────
投胎                                           ← h3 16px/600
掷一次定下你的起点。起点不决定结局。              ← hint 14px
根骨      1–10                                 ← StatMeterRow，空条，值位写范围
悟性      1–10
心性      1–10
寿元      35–45
可重掷 2 次 · 掷过的可以切回                     ← 元信息 12px
[ 掷 ]                       ← primary，满宽，44px
[ 用标准开局 ]               ← quiet，仅作者提供时出现（R5）
───────────────────────────────
我的存档 ▸（收起，order:2）
```
### 3.2 手机 390 · 掷出后（第 1 次）
```
投胎 · 第 1 次
根骨   7 /10  ███████░░░
悟性   4 /10  ████░░░░░░
心性   9 /10  █████████░
寿元  36 /45  ████████░░   ← 倒计时资源：不显示「已封顶」
中人                                     ← 档位名 16px/600，中性墨色
「三灵根，平平无奇，灯油四十年。」          ← 判词：衬线 16px，与 .reader-text 同族，无底色
命里带着                                 ← 小标题 14px（仅有标签时出现）
· 短命相 — 照晚会来得早一些。              ← 名字 600 + 「 — 」+ 一句效果；无数字，无彩色 chip
[ 就这样，开局 ]             ← primary 绿，满宽 44px
[ 重掷（剩 2）]              ← 普通按钮，满宽 44px，间距 8px
掷过的 ▸                     ← details/summary 44px，默认收起（只有 1 套时不出现）
```
### 3.3 keepBest 记录（第 3 次后，展开）
```
掷过的 ▾
○ 第 1 次 · 中人 · 短命相          ← 行 44px；只写档位名 + 标签名，不写数值
○ 第 2 次 · 凡骨
● 第 3 次 · 奇才 · 天灵根 · 当前    ← 当前行：左 2px 绿线 + 「当前」字样（不靠颜色单独表意）
重掷次数已用完。可以从掷过的里选一套，或就这样开局。   ← 替代重掷按钮的说明 14px
```
### 3.4 pickOf 3（《万宝楼》示意，不能重掷）
```
投胎 · 三选一
这一次出三套，选一套开局。
┌ 第一套 ─ 富商之子 ──────────┐   ← 单层：白底 + 1px 线，**内部不再套框**
│ 口才 5/8 · 眼力 3/8 · 本钱 7/8 · 人脉 4/8 │  ← nowrap 单元间换行
│ 「……」（判词，若契约给出）             │
│ · 富商之子 — 开局手头宽裕，也背着一笔债。│
└────────────────────────────┘
（第二套、第三套竖排；选中 = 2px 绿边 + 「已选」文字；radio 语义）
[ 就这样，开局 ]（未选时 disabled，下方写「先选一套」）
```
### 3.5 桌面 ≥980
- 左栏存档不变；投胎面板放在阅读栏，宽度 `--prose-max`，不拉满。
- pickOf 3 套在桌面**仍竖排**（R3：横排三卡像抽卡结果页；竖排便于逐项比较且与手机一致）。
- 「就这样，开局」与「重掷」同一行左对齐（primary 在前），不再满宽。
- 「掷过的」在桌面默认展开。

## 4. 组件与状态表
| 状态 | 触发 | 显示 | 操作 |
|---|---|---|---|
| 未启用 | `openingRoll` 缺失或 `enabled=false` | 不出现投胎态 | 现状 |
| 加载中 | 创建会话 / 掷请求未返回 | 按钮文字「正在掷…」并 disabled；数值行保留上一套（或范围）；`role=status` | 禁止重复点 |
| 未掷 | phase=opening，无结果 | §3.1 | 掷 / 标准开局 |
| 已掷 · 有重掷 | rerollsLeft>0 | §3.2 | 确认 / 重掷 / 切回 |
| 重掷用尽 | rerollsLeft=0 | 重掷按钮换成说明文字（§3.3） | 确认 / 切回 |
| 不可重掷（rerolls=0） | 配置 | 不出现重掷按钮，也不出现「剩 0」；元信息写「这个世界不能重掷」 | 确认 |
| 保底自动重掷 | floor 不满足 | **不展示**被丢弃的结果；元信息不提（不耗次数，不剧透机制） | — |
| keepBest=false | 配置 | 无「掷过的」；重掷按钮下写「重掷后这一套不能找回」 | — |
| pickOf 未选 | 刚出 N 套 | 确认 disabled +「先选一套」 | 选一套 |
| 无标签 | 无标签成立 | 不显示「命里带着」小标题（不写「无」） | — |
| 无档位 | `tiers[]` 为空 / 无匹配 | 不显示档位名和判词 | — |
| 标准开局 | 作者提供 | quiet 按钮；选中后直接确认流程，显示该套数值，标题「标准开局」 | 确认 / 返回掷 |
| 确认中 | 提交 | 「正在开局…」disabled | — |
| 错误 · 掷失败 | 请求失败 | `Notice`：「这次没掷成，次数没有扣。请再试一次。」 | 重试 |
| 错误 · 确认失败 | 请求失败 | 「没能开局，选好的这一套还在。请再点一次。」 | 重试（同请求标识） |
| 结果未确认 | 现有 `uncertain` | 沿用现有「上一步的结果尚未确认…」文案 | 重试原请求 |
| 读档 · 投胎中 | phase=opening 存档 | 回到同一结果和次数；`SaveSlotList` 行副标题「投胎中」 | 继续 |
| 旧存档 | 存档无 K16 字段 / 世界后加 openingRoll | 直接进正文，不补投胎；不提示（行为不变） | — |
| 锁定 | 已开局 | 投胎态不再可达；状态栏里无「重掷」入口 | — |
| 作者试玩 · 固定种子 | `seedPolicy=fixed` | 元信息「固定种子 · 测试用，每次掷出一样」 | — |

## 5. 中文文案草案（全部经 `t()`；en-US 同列）
| key 场景 | zh-CN | en-US |
|---|---|---|
| 标题 | 投胎 | Your start |
| 说明 | 掷一次定下你的起点。起点不决定结局。 | Roll once to set where you begin. It does not decide how you end. |
| 掷 | 掷 | Roll |
| 掷中 | 正在掷… | Rolling… |
| 第 N 次 | 投胎 · 第 {n} 次 | Start · roll {n} |
| 重掷 | 重掷（剩 {n}） | Reroll ({n} left) |
| 用尽 | 重掷次数已用完。可以从掷过的里选一套，或就这样开局。 | No rerolls left. Pick one you rolled before, or start with this. |
| 不可重掷 | 这个世界不能重掷。 | This world has no rerolls. |
| 不可找回 | 重掷后这一套不能找回。 | Rerolling discards this set. |
| 预告 | 可重掷 {n} 次 · 掷过的可以切回 | {n} rerolls · you can switch back |
| 记录 | 掷过的 | Rolled so far |
| 当前 | 当前 | Current |
| 标签小标题 | 命里带着 | Born with |
| 三选一 | 投胎 · 三选一 / 这一次出 {n} 套，选一套开局。 | Choose one of {n} / Pick one set to begin. |
| 已选 | 已选 | Selected |
| 未选 | 先选一套 | Pick a set first |
| 确认 | 就这样，开局 | Start with this |
| 确认中 | 正在开局… | Starting… |
| 标准开局 | 用标准开局 / 标准开局 | Use the standard start / Standard start |
| 返回 | 回去掷 | Back to rolling |
| 掷失败 | 这次没掷成，次数没有扣。请再试一次。 | That roll didn't go through. No reroll was used. Try again. |
| 确认失败 | 没能开局，选好的这一套还在。请再点一次。 | Couldn't start. Your chosen set is kept. Try again. |
| 存档副标题 | 投胎中 | Choosing start |
| 固定种子 | 固定种子 · 测试用，每次掷出一样 | Fixed seed · test only, same result every time |
| 标签行 | {label} — {effect} | {label} — {effect} |
- 档位名、判词、标签名与效果句**全部来自契约**（`tiers[].label/verdict`、`tags[].label/effect`），UI 不拼、不补数字。
- 禁用词：「SSR」「欧皇」「稀有」「恭喜」「！」叠用。

## 6. DESIGN_SYSTEM 增量（确认后写入 §6 新小节「投胎页（K16）」）
1. 数值行只用 `StatMeterRow`（= `PlayStatsBar` 行）；未掷时值位写「min–max」，条为空。
2. 档位名中性墨色；**不按档位换颜色**（无金/紫/彩虹），好坏由判词文字表达。
3. 判词用 `.reader-text` 衬线族 16px，无引号外框、无底色。
4. 标签 = 文字清单「名 — 一句效果」，**不做 chip、不配色、不出现数字**；只显示已成立的。
5. 唯一绿色：primary「就这样，开局」+ 当前/已选的 2px 绿线（同时配文字）。
6. 动效：结果出现只做 ≤150ms 淡入（`prefers-reduced-motion` 时为 0）；禁止滚数字、骰子、转盘、闪光。草案「动画 ≤1 秒」按此收紧（R2）。
7. 手机：沿用 §6 移动端全部规则；投胎态不出 sticky 状态行；pickOf 卡单层、竖排。
8. 断点：新增样式遵守 §6 断点顺序 4 条，`.opening-roll` 选择器下按 基础 → ≤980 → ≤760 排列。

## 7. Coder 验收清单（截图前缀 `roll-*`，390×844 与 1280×800 各一张，除非注明）
- [ ] `roll-off`：未启用世界开始页与现状逐像素一致（回归）。
- [ ] `roll-before`：§3.1；世界简介 clamp-1；「掷」在第一屏；无 sticky 状态行。
- [ ] `roll-after-1`：数值来自契约返回；寿元不显示「已封顶」；标签行无数字、无 chip。
- [ ] `roll-exhausted`：重掷按钮消失、换成说明；切回旧套不改剩余次数。
- [ ] `roll-history`：keepBest 记录行 ≥44px；当前行有文字「当前」。
- [ ] `roll-pick3`：三套竖排（桌面也竖排）；未选时确认 disabled；单层无套框。
- [ ] `roll-norerolls`：rerolls=0 时无「剩 0」。
- [ ] `roll-error`：掷失败文案；剩余次数未变。
- [ ] `roll-reload`：投胎中存档读档后结果、次数、序列完全一致（不重掷）；存档行写「投胎中」。
- [ ] `roll-confirm`：确认后进入正文，滚到地点标题；回不到投胎态。
- [ ] `roll-oldsave`：旧存档直接进正文。
- [ ] `roll-author-fixed`：作者试玩固定种子元信息行。
- [ ] 四处一致：`/play`、作者试玩、HTML 包、exe 包同一结果（同种子）。
- [ ] 手机：所有文字 ≥14px（元信息 ≥12px）；点击区 ≥44px、间距 ≥8px；`scrollWidth ≤ innerWidth`；网格单轨断言。
- [ ] 无动画元素超过 150ms；reduced-motion 下为 0。
- [ ] 包体：`btg-player-template.html` 增量 ≤10KB（gzip 前），记录实测值。
- [ ] en-US 截图一张 `roll-after-1-en`。

---

## 附录 A · 歧义与默认（待策划拍板）
| # | 问题 | 默认 |
|---|---|---|
| R1 | 「掷」前是否自动掷一次？ | 不自动；先看范围，玩家点「掷」（草案 §3.2 的「掷前能看到可能抽到什么」） |
| R2 | 草案「动画 ≤1 秒」 | 收紧为 ≤150ms 淡入，无骰子/滚数字 |
| R3 | pickOf 桌面横排还是竖排 | 两端都竖排 |
| R4 | 已掷记录显示数值吗 | 只写档位名 + 标签名；点开切回后在主区看数值 |
| R5 | 「标准开局」位置 | 掷之前作为 quiet 按钮；掷过之后折进「掷过的」末行「标准开局」 |
| R6 | 掷了没确认就离开 | 存成 phase=opening 存档，「投胎中」；读档回原状态 |
| R7 | 出身 origin 是否单独一行显示 | 有出身时作为档位名下一行「出身：{label}」，同标签规则不带数字 |
| R8 | 补偿标签（废灵根→体修门路）是否特别标出 | 不特别标；与其他标签同格式，效果句说明路线 |
| R9 | preset 模式（《镖局》）标题 | 用预设名作档位名位置；±1 浮动后的值照常显示 |
| R10 | 范围条用 dist 画概率形状吗 | 不画；只写 min–max（避免伪精确） |
| R11 | pointBuy 是否允许玩家手动分点 | 不允许；草案为「随机分配」，UI 只展示结果 |

## 附录 A2 · 契约缺口 / 草案不一致
- **G1** 《寿灯》现有 world.json（batch1–3）里没有根骨/悟性/心性资源，只有寿元等；§6.1 示例无法直接截图。需补资源或换示例。
- **G2** `tags[]` 只有 `label`，没有「一句效果」字段；用户已定显示效果句 → 需加 `effect`（玩家可见文案，作者写，禁止数字由 lint 检查）。草案例子「修为速率 +30%」本身含数字，需改写。
- **G3** `tiers[]` 有 `label/verdict`，但判词示例「灯油四十年」含与寿元相关的数字——是固定文本还是插值？默认：固定文本，不插值。
- **G4** 会话 phase 未定义：需要 `phase: 'opening' | 'play'`、`rollHistory[]`、`rerollsLeft`、`selectedIndex` 的视图字段，以及「掷 / 切回 / 选 / 确认」四个命令（走 sessions / adventure-sessions）。
- **G5** 「切回」是否消耗 RNG / 写序列？默认不消耗，只改 selectedIndex。
- **G6** pickOf + rerolls>0 时，重掷是否一次重出 N 套？草案未说。默认是。
- **G7** floor 自动重掷「不消耗次数」与「重掷只消耗 RNG 不可刷」需写清：自动重掷也推进序列。
- **G8** 「标准开局」字段名缺失（草案 §3 末尾提到，§2 参数表没有）。
- **G9** 档位分布、标签兑现率进体检/模拟报告的 UI 本期未规划。
- **G10** `lockAfterStart=false` 时开局后如何重掷？无入口设计；默认本期只支持 true。
- **G11** `displayLabel`：`stats[]` 只有 `resourceId`，显示名需从资源 meta 取；缺失时 UI 回退显示什么？默认显示 resourceId 并让 lint 报错。

## 附录 B · 文件级改动
| 文件 | 改动 |
|---|---|
| `apps/web/src/components/PlayStatsBar.tsx` | 抽出并导出 `StatMeterRow`；支持 `range` 模式（未掷） |
| `apps/web/src/components/play/OpeningRollPanel.tsx` | 新，小组件 |
| `apps/web/src/components/player/PlayerWorldPage.tsx` | phase=opening 时阅读栏渲染面板；`start()` 后不直接进正文 |
| `apps/web/src/components/AdventurePanel.tsx` | 作者试玩接入同组件 + 固定种子元信息 |
| `apps/web/src/components/player/SaveSlotList.tsx` | 「投胎中」副标题 |
| `apps/web/src/styles.css` | `.opening-roll*`，按断点顺序规则 |
| i18n 文案表 | §5 全部 key |
| `DESIGN_SYSTEM.md` | 确认后写 §6「投胎页（K16）」 |
| 测试 | `apps/web/test/opening-roll-mobile.test.ts`（单轨、字号、点击区） + e2e `roll-*` |

## 修订记录
| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-11-05 | v0.1 | 初稿，待策划确认；Coder 可先读 |

## 附录 C · 策划确认（2026-11-05）
- R1 采纳：先展示范围，玩家点了才掷。R2 采纳：≤150ms 淡入。R6 采纳：离开时存「投胎中」存档。R11 采纳：pointBuy 只显示随机结果，不让手动分点。其余 R 按 UI 默认。
- G2：标签加 `effect` 字段，内容是作者写的纯文本，玩家端显示它。lint 发现 effect 里有阿拉伯数字时给警告（因为用户定了不显示数字）。草案 §6.1 里的「+30%」只是作者侧的机制说明，不给玩家看。
- G3：判词按固定文字处理。
- G4：由 Coder 定义，按策划建议：存档里放 `openingRoll` 会话，字段为 seedCursor、history[]、selectedIndex、rerollsLeft、status（rolling/confirmed）；命令为 roll / reroll / select / confirm / useStandard。
- G5、G6、G7：按 UI 的默认。
- G8：参数表加可选字段 `standard: {values, tags}`。给了这个字段才显示「标准开局」。
- G10：这一轮只支持 lockAfterStart=true。
- G1：这一轮用测试用的小世界做验收，不改《寿灯》。《寿灯》接入根骨、悟性、心性放到下一轮内容修订，跟还魂灯的余量一起改。
- G9：这一轮不做档位分布报告，但 playtest 的 rollWorst 和 rollBest 门槛照做。
- 状态：策划确认。
