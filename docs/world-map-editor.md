# 世界地图编辑器：调研与设计（地图 · 地形 · 势力分布）

> 状态：M1+ 多期已落地（静态地图、地形/势力/区域、试玩迷雾、子地图、AI 结构草稿等）；§7 早期 M2–M4 表保留作历史对照。  
> **§9 地图确认 → 内容填充 → 建筑库：M-fill-1 已落地（结构锁 + 填充骨架，2026-10-28）；M-fill-2+ 未做。**  
> 约束来源：[`extensibility.md`](./extensibility.md)（五层分离）· [`architecture.md`](./architecture.md)。  
> 核心原则：**地图是共享基底上的一层可选数据，不是新运行时**。没有地图的世界照常可玩。

---

## 1. 开源参考调研

仓库信息于 2026-10-27 经 GitHub API 核实（最近活跃 = 最近 push）。

| 项目 | 许可 | 最近活跃 | 技术栈 | 数据模型 | 地形表示 | 势力/政治层 | 编辑 UX | 导出 | 我们借鉴 |
|---|---|---|---|---|---|---|---|---|---|
| [Azgaar Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) | MIT | 2026-10 活跃 | 原生 JS + D3 + SVG | Voronoi 格（packed cells，约 1 万），格→国家/省/文化/宗教/河流等**格属性数组** | 每格高度 + 生物群系 id | `cells.state[i]` = 国家 id；国家表含颜色/首都/扩张度；边界由格属性**派生**成 SVG 路径 | 图层开关面板、按格画刷（高度/生物群系/国家）、国家编辑表、burg（城市）编辑 | `.map`、JSON 全量导出、SVG/PNG | **最核心参考**：「格属性数组 + 派生边界」模型、图层面板、国家图例表；思路借鉴，不嵌入（单体全局状态难拆） |
| [Red Blob mapgen4](https://github.com/redblobgames/mapgen4) · [多边形地图文章](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/) · [六边形网格指南](https://www.redblobgames.com/grids/hexagons/) | Apache-2.0 | 2026-03 | TypeScript + WebGL | Delaunay/Voronoi 双网格（dual mesh） | 高程、降雨、河流从种子画笔派生 | 无（可叠） | 大笔刷「画山/画谷」实时重算 | 无标准格式 | 双网格算法、六边形坐标（轴坐标 q,r）与邻接/距离公式；文章是设计依据 |
| [Tiled](https://github.com/mapeditor/tiled) | 编辑器 GPL-2；libtiled/格式 BSD | 2026-10 活跃 | C++/Qt | 图层：瓦片层/对象层/图像层/分组；支持正交、等距、**六边形** | 瓦片 id + Terrain Sets（自动拼接 Wang） | 无专门层，用对象层多边形 + 自定义属性 | 图层面板、画刷/填充/选择、属性检查器 | TMX/TMJ (JSON) | **图层 + 自定义属性**的通用模型；TMJ 可作为可选导出格式 |
| [LDtk](https://github.com/deepnight/ldtk) | MIT | 2026-10 | Haxe/Electron | 世界→关卡→层（IntGrid / Tiles / Entities / AutoLayer） | IntGrid 整数格 + 规则自动铺瓦 | 可用 IntGrid 值表示归属 | 现代化 UI、Entity 带字段且可**引用其他实体** | 结构化 JSON（带 schema） | IntGrid（格值=枚举）思路、实体字段引用、JSON schema 版本化做法 |
| [Watabou 生成器](https://watabou.itch.io/)（[TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)） | 旧版开源 GPL-3.0；新版闭源 | 开源版 2021 停更 | Haxe | Voronoi 街区/病房 | — | 城区功能分区 | 一键生成 + 少量参数 | SVG/PNG/JSON | 只借**风格与生成思路**；GPL 不可嵌入 |
| [Dungeon Scrawl](https://www.dungeonscrawl.com/) | 免费 web，非开源 | 在线 | Web | 矢量形状 + 布尔合并 | 风格化填充 | — | 「画矩形自动挖房间」、手绘风 | PNG/SVG/项目文件 | 仅 UX 借鉴：形状布尔合并画区域 |
| [Leaflet](https://github.com/Leaflet/Leaflet) | BSD-2 | 2026-10 | JS | `CRS.Simple` 可承载任意图片坐标 + 矢量层 | 栅格底图 | GeoJSON 多边形 | 缩放平移、标记、绘制插件 | GeoJSON | 若作者上传手绘地图图片：Simple CRS + 标记即可（M1 备选） |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD-3 | 2026-10 | TS/WebGL | 矢量瓦片 + 样式规范 | 栅格/DEM | GeoJSON 填充层 | 数据驱动样式 | GeoJSON/MVT | 对虚构小地图过重；只借「数据驱动样式」概念 |
| [Honeycomb](https://github.com/flauwekeul/honeycomb) | MIT | 2026-02 | TypeScript | 六边形格库（坐标、遍历、邻居） | — | — | — | — | **可嵌入**的轻量六边形数学库（或按 Red Blob 自写 ~200 行） |
| [d3-delaunay](https://github.com/d3/d3-delaunay) / [Delaunator](https://github.com/mapbox/delaunator) | ISC | 2025/2026 | JS | Voronoi/Delaunay | — | — | — | — | Voronoi 模式（M2+）的可嵌入算法库 |
| [Armoria](https://github.com/Azgaar/Armoria) | 仓库未声明（作者 Azgaar） | 2026-10 | Svelte | 纹章生成 | — | 势力旗帜/纹章 | — | SVG | 势力徽记灵感；许可不明，不嵌入 |
| [Godot](https://github.com/godotengine/godot) TileMap | MIT | 2026-10 | C++ | TileMapLayer + TileSet（含六边形）+ terrain sets | 地形集自动拼接 | 自定义数据层 | 画刷/地形笔 | `.tscn` | 「TileSet 自定义数据层」= 格上挂任意字段 |
| [PixiJS](https://github.com/pixijs/pixijs) | MIT | 2026-10 | TS/WebGL | 渲染库 | — | — | — | — | 若格数 > 数千、SVG 卡顿时的渲染后备 |

**共同模式归纳**
1. **几何与语义分离**：几何（格/六边形/多边形）一次定义，地形、归属、文化等都是「按格 id 索引的属性层」（Azgaar、LDtk IntGrid、Godot 自定义数据层）。
2. **边界是派生物**：势力边界不存储，按格归属计算（Azgaar）。避免编辑不一致。
3. **图层面板 + 画刷 + 检查器**：所有编辑器同一套生产力 UX。
4. **实体引用**：点位/实体带字段，可引用其他对象（LDtk）——对应我们 POI ↔ 地点节点。

---

## 2. 与现有架构的契合

现有开放世界 = `locations`（地点图）+ `actions`（含 `move` 效果）+ `facts`/时间 + `worldbook`；已有 `canvasLayout` 作为**作者元数据、运行时忽略**的先例。地图沿用同一纪律：

| 层 | 地图内容 |
|---|---|
| Substrate | 可选 `map` 字段 schema（contracts）；地图条件/效果纯求值（rules，经 KindRegistry） |
| Catalog | 地形类型编目（平原/山/林/水…默认表 + 移动代价），像数值模板一样带 id+version |
| AI adapters | 从小说「提议」地图：势力表、地形草图、POI 绑定 → 生成**草稿修订**，经草稿写入端口 |
| Authoring UI | 地图模式画布、图层面板、画刷、势力图例 |
| Transport | 命令表新增 map 相关草稿命令，HTTP/MCP 共用 |

**图保持灵活**：地点图仍是玩法真相（移动仍由 action 的 `move` 定义）；地图只是空间解释与额外条件来源，**不自动生成边**（可选「按相邻建议边」作为作者辅助）。

---

## 3. 数据模型（提案，`packages/contracts/src/world-map.ts`）

```ts
// WorldContent 新增可选字段；缺省 = 无地图，一切照旧
map?: WorldMap

WorldMap = {
  mapSchemaVersion: 1,
  geometry:
    | { kind: 'hex'; orientation: 'pointy'|'flat'; cols: number; rows: number; size: number }   // v1
    | { kind: 'voronoi'; seed: number; points: [x,y][] }                                       // M2+
    | { kind: 'image'; assetId: string; width: number; height: number },                       // 手绘底图，仅点/多边形
  terrainCatalog: { id: 'jianghu-terrain'; version: 1 } | undefined, // 编目引用
  terrainTypes: { id; label; color; moveCost: int 1..5; tags?: string[] }[],  // 编目编译下来的快照，可覆写
  layers: {
    terrain?: { cells: Record<CellKey, terrainTypeId> } // CellKey: hex 为 "q,r"，voronoi 为索引
    factions?: { ownership: Record<CellKey, factionId> }
    custom?: { id; label; values: Record<CellKey, string> }[]  // 文化/宗教等，未来扩展
  },
  factions: { id; name; color; description; capitalLocationId?: locationId; npcIds?: npcId[]; ...provenance }[],
  pois: { locationId; anchor: { cell: CellKey } | { x; y } ; label?: string }[],  // ↔ locations[].id
  regions?: { id; label; cells: CellKey[] }[],   // 命名区域（州、山脉），可被条件引用
}
```

要点：
- **稀疏 Record**：未绘制格 = 默认地形/无主，体积可控（12 个地点量级的世界，几百格足够）。
- **边界、相邻、移动代价都派生**，不存储。
- 校验（rules 纯函数 `validateWorldMap`）：POI 必须指向存在的 location；ownership 引用存在的 faction；`capitalLocationId` 存在。
- 版本：`mapSchemaVersion` 独立于 `schemaVersion`，破坏性变更走迁移。
- 势力 vs 运行时状态：**v1 归属是静态内容**；若要「领土易手」，用 M3 的 `territory_set` 效果写入**会话状态的 overlay**（`ownershipOverrides`），而不是改内容。

---

## 4. 与规则绑定（经 KindRegistry，禁止 if/else）

新增种类先改 contracts 闭集 → rules 注册 evaluate → story/open 两运行时包装 → UI 从 `registry.list()` 读文案。

| 种类 | family | 语义 |
|---|---|---|
| `in_faction_territory` `{factionId}` | world.condition | 玩家当前 location 的 POI 格归属 == factionId（考虑会话 overlay） |
| `at_terrain` `{terrainId}` | world.condition | 当前 POI 格地形 |
| `in_region` `{regionId}` | world.condition | 当前 POI 落在命名区域 |
| `territory_set` `{cell|regionId, factionId}` | world.effect | 会话 overlay 改归属（受 worldbook 约束） |
| （可选）移动代价 | — | 不新增效果：作者辅助按目标地形 `moveCost` **建议** action.timeCost，写入仍是普通内容 |

求值上下文：rules 只接收 `{ map, overlay, locationId }` 纯数据；adventure-sessions 负责组装。无地图时这些条件 fail-closed（false）并在可玩性检查中警告。worldbook `scope` 可扩展为 `faction`/`region`。

---

## 5. 编辑器 UX

- **同一无限画布的「地图模式」**（顶栏切换 图 / 地图 / 分屏）；分屏时左地图右地点图，选中联动高亮。
- **左侧图层面板**：底图 · 地形 · 势力 · 自定义层 · POI · 地点连线叠加；每层显隐/锁定/透明度。
- **工具条（横向高密度）**：选择 · 地形画刷（半径 1–3）· 填充桶（同地形连通填充）· 势力领土笔 · 区域套索 · POI 放置 · 橡皮。快捷键 B/G/T/P/E。
- **右侧检查器**：选中格（地形/归属/所属区域）、选中势力（名称/颜色/首都/NPC）、选中 POI（绑定地点下拉、跳到地点节点）。
- **势力图例**：可排序列表，色块 + 格数统计；点击即设为当前笔刷势力。
- **POI ↔ 地点**：从地点图拖节点到地图即建立绑定；未绑定地点在图例里提示。
- **撤销**：编辑走草稿命令，复用后续领域 undo；画刷一笔合并为一次命令（批量 diff）。
- 试玩侧栏（`WorldPlayInspector`）在地图模式显示玩家位置与当前势力/地形。

---

## 6. v1 技术选型

- **几何：六边形格（pointy，轴坐标）**。理由：邻接/距离/填充公式简单确定、画刷直觉、序列化稳定（`"q,r"`）、可测试。Voronoi 更美观但编辑与键稳定性复杂，放 M2+ 作为另一种 `geometry.kind`。
- **渲染：SVG（或 Canvas2D）自研轻量层**，嵌在现有无限画布变换内；规模 ≤ 64×48 格 SVG 足够；超规模再换 PixiJS（MIT）。
- **库**：六边形数学按 Red Blob 指南自写（或用 Honeycomb，MIT）；Voronoi 用 d3-delaunay（ISC）。**不嵌入** Azgaar（单体全局状态）、Tiled（GPL 编辑器）、Watabou（GPL/闭源）；Leaflet（BSD）仅作为「上传底图」模式的备选。
- **导入/导出**：内部 JSON 为准；可选导出 Tiled TMJ（六边形图层）；Azgaar JSON 导入作为 M4+ 适配器（编目层翻译，不进运行时）。
- 许可结论：MIT/ISC/BSD/Apache 库均可安全使用；GPL 项目只借鉴思路。

---

## 7. 分阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1 静态地图 + POI 绑定** | contracts `WorldMap`（hex + pois + 空层）、`validateWorldMap`；地图模式画布、POI 拖放绑定、分屏联动 | 无地图世界零回归；有地图世界存取/发布/试玩一致；门禁通过 |
| **M2 地形绘制** | 地形编目 + 画刷/填充/橡皮、图层面板、`at_terrain` 条件、timeCost 建议；可选 Voronoi 几何 | 画刷一笔一命令可撤销；条件双运行时一致性测试 |
| **M3 势力与领土** | factions 表、领土笔、派生边界、图例；`in_faction_territory` / `in_region` / `territory_set` + 会话 overlay；worldbook scope 扩展 | 可达性/可玩性分析识别地图条件；overlay 可回放 |
| **M4 AI 辅助生成** | 从小说抽取势力/地理关系 → adapter 产出地图**提案**（草稿修订 diff，作者接受才写入）；可选 Azgaar 导入适配器 | AI 不直接写库；提案可审阅、可拒绝；证据 provenance 带章节段落 |

---

## 8. 风险

1. **双重真相**：地图相邻与地点图边不一致 → 坚持「地点图是移动真相」，地图只做提示与校验警告。
2. **内容体积膨胀**：格属性 Record 变大 → 稀疏存储 + 格数上限 + 草稿修订存 diff。
3. **运行时状态 vs 内容混淆**：领土易手若改内容会破坏回放 → 只经会话 overlay + 规则效果。
4. **几何迁移**：hex→voronoi 无法无损互转 → `geometry.kind` 判别联合，不做自动转换。
5. **UI 上帝组件复发**：地图模式独立组件/钩子（`useWorldMapEditor`），不塞进 WorldsPanel。
6. **AI 生成质量**：小说地理常模糊 → 只生成拓扑与势力表，几何由程序布局 + 作者微调。
7. **许可误用**：GPL 代码（Tiled 编辑器、Watabou）不得拷入；引入依赖前在 PR 记录许可。
8. **性能**：大地图 SVG 卡顿 → 视口裁剪，必要时切 PixiJS。

## 地形/势力图层与地图图片生成接缝（M2 前置）

- **Schema（向后兼容）**：`map.layers.terrain = { palette: [{id,label,color,tags?}], cells: {"q,r": terrainId} }`，`map.layers.factions = { factions: [{id,name,color,description?}], cells: {"q,r": factionId} }`。都可选；`layers: {}` 的旧数据不变。`validateMapLayers`（rules）检查未定义的地形/势力引用、重复 id、越界格，并并入 `validateWorldMap`。
- **渲染接缝（`packages/rules/src/map-render.ts`，纯函数、无 AI/IO）**：
  - `describeMapStructured` / `describeMapForImagePrompt(map, world)`：按 3×3 区域（north-west…center）汇总地形分布、势力领土（含边界色）、地点位置，输出确定性的英文图片提示词（默认羊皮纸手绘奇幻地图风格，默认 ≤900 字符，可传 `style`/`maxChars`）。
  - `renderMapSchematicSvg(map, opts)`：确定性示意图（地形填色、势力着色与边界线、地点标注、图例），作为 AI 出图的“真值参考”。
- **端口**：`MapImageProvider`（contracts）：`generate({prompt, schematicSvg?, width, height, seed?}) → {mimeType, data, provider}`。目前只有 `StubMapImageProvider`（worlds 模块 infrastructure，调用即报未接入），未接路由。真正的图片生成 API 作为适配器实现此接口；AI 产出的图片只是展示层，不回写地形/势力数据。
- **测试数据**：`fixtures/world-map/ember-reach.world.json`（24×16，8 地点、3 势力、8 种地形），由 `npx tsx scripts/gen-map-fixture.ts --out <dir>` 生成，同时输出 `map.json`、`prompt.txt`、`schematic.svg`。

## 城市地图方案与扩展口子（city-map step 1 已落地）

### 已落地的扩展口子
- **地图格子类型**：`WorldMap.geometry.kind`（判别联合，当前仅 `'hex'`，`WORLD_MAP_KINDS`）。`mapSchemaVersion` 保持 1；老地图无 `layers.regions` 照常解析。新增类型 = contracts 加一种 geometry schema + rules 注册 `GeometryAdapter` + web 注册编辑器。
- **可替换几何模块**：`packages/rules/src/map-geometry.ts` — `GeometryAdapter { inBounds, listCells, neighbors, distance }`，按 kind 注册（`registerGeometryKind` / `geometryFor`）。规则与世界书只调用 `locationSpatial(map, locationId) → { cell, terrainId, factionId, regionIds }` 与 `locationDistance`，不碰六边形数学。
- **地点绑定不变**：`pois[].locationId → anchor.cell`。
- **Web 编辑器按类型注册**：`apps/web/src/components/map-kinds/`（`registry.ts` + `HexMapEditor.tsx`）；`WorldMapCanvas` 只按 registry 分发，不按 kind 写分支。
- **图层访问表**：`world-map-edit.ts` 的 `ACCESS` 表让地形/势力/区域共用画笔、填充、橡皮、吸管、调色板、删除重指派与撤销。

### 区域（街区）
- `layers.regions = { regions: [{id, name, color, tags?}], cells: {cell → regionId} }`，每格至多一个区域；标签画在区域质心。
- 规则条件 `in_region { regionIds[] }`（KindRegistry），经 `locationSpatial` 求值；校验未知区域 id。
- 世界书作用范围新增 `{ type: 'regions', regionIds }`：玩家所在地点落在任一区域时生效，复用 `entriesForPlace(..., 'location', { regionIds })`，硬规则与 AI 旁白同一判定。

### 后续步骤（预想）
1. **子地图**：地图挂到地点上（`parentMapId + parentLocationId`），层级不设限；地点图同步分层，进/出城是普通移动行动；编辑器可下钻并显示层级路径。
2. **城市地形预设与场所类型**：住宅/商业/工业/码头/公园/水域/贫民窟等预设地形（数据而非代码）；POI 加 `venueType`（医院/警局/酒吧/安全屋…），新增 `at_venue` 条件。势力图层直接复用为帮派地盘/公司辖区/警力覆盖。
3. **简化道路**：只记录“两格之间有主干道/地铁”的边，用于通勤时间与费用，不画精确街道线；接现代题材数值模板。
4. **新地图类型**（按需）：vector / square / image，各自实现 `GeometryAdapter` + 编辑器，世界、规则、存档不变；OSM 导入作为 vector 类型的导入工具。

## 题材地图模板（与数值模板同构）

- 位置：`packages/contracts/src/map-templates.ts`（纯数据 + zod 校验，与 `stat-templates.ts` 同在 contracts 目录）。
- 模板 = 地形调色板、势力/区域预设、场所类型（venue）列表、默认尺寸（小/中/大）、建议层级、规则条件示例（`at_terrain` / `in_faction_territory` / `in_region`）。
- 首批：`fantasy_xianxia`（奇幻/仙侠）、`urban_modern`（都市/现代，城区：住宅/商业/工业/码头/公园/水域/贫民窟）、`post_apocalyptic`（末日/废土）。
- 新建地图时可选；对已有地图「套用」只补缺失 id，不改名不删除（`applyMapTemplate`）。不按小说自动判定题材。`map.mapTemplate` 仅为作者元数据，规则不读。
- POI 可选 `venueType`，须出现在 `map.venueTypes` 中，否则校验报 `poi_unknown_venue`。
- 尺寸：预设 + 按任一边扩缩；左/上扩缩会平移全部格子与 POI（`resizeMapEdge`/`shiftMap`），越界内容保留并报警，不静默删除。

---

## 9. 地图确认 → 内容填充 → 建筑库

> 状态：**M-fill-1 已落地**（`structureLocked`、填充 placement 骨架、确认/解锁 UX、校验；2026-10-28）。建筑库 / AI 填充 / 完整种类试玩图标仍按 §9.8 分期。  
> 与 §7 M1–M4、题材地图模板、城市子地图正交：本段管的是「结构定稿之后」往地图上挂遭遇 / 商店 / 补给 / 任务等内容，以及跨城镇复用的**建筑库（Building Library）**编目。  
> 纪律对齐 [`extensibility.md`](./extensibility.md)：Catalog 编译下行；AI 只出草稿；玩时只经 locations / conditions / effects。

### 9.1 约定流水线（Agreed pipeline）

| 步 | 名称 | 作者做什么 | 系统约束 |
|---|---|---|---|
| **1** | **建底图（Build base map）** | 空白或套用地图模板 → 调尺寸 → 画地形 / 区域 / 势力 → 放地点并绑定地点图；道路与路程消耗属**结构层**（见 §9.3） | 未确认前**不开放**遭遇 / 商店 / 任务等填充层；也**不**跑此类 AI |
| **2** | **确认 / 锁定结构（Confirm / lock）** | 作者显式「确认地图」或「锁定结构」 | **硬锁**结构字段（见 §9.3）；要改结构须先「解锁」 |
| **3** | **内容填充（Content fill）** | 确认后：手摆或生成野外遭遇 & Boss；城镇商店、补给点、任务点 | 填充层可编辑；默认挂在地点上；可选格 / 路段标记见 §9.3 |
| **4** | **AI 填充草稿（AI fill drafts）** | 仅确认后可用；审核面板逐条接受 / 拒绝 | AI **不得**改结构、**不得**写 session；只经草稿写入端口；与规则引擎外的状态突变一律禁止 |
| **5** | **建筑库复用（Building library）** | 首次生成默认入库；后续从库复用或派生改造；回写库须显式新变体 | 放置 = `libraryRef` + 本地覆盖；玩时仍走地点 / 条件 / 效果，库不进存档逻辑 |

```text
[底图结构] --确认锁定--> [填充层可编辑]
                              |-- 手摆
                              |-- AI 草稿（accept/reject）
                              '-- 建筑库：引用 / 派生 / 显式升格变体
```

### 9.2 建筑库（Building Library）— Catalog 资产

与数值模板（`STAT_TEMPLATES`）、题材地图模板（`map-templates`）**同层**：共享编目里的可复用资产，**不是**新运行时。

**一条建筑资产（BuildingAsset，示意）大致包含：**

| 字段组 | 内容 |
|---|---|
| 身份 | `id` · `version` · `label` · 可选 `tags`（杂货铺 / 铁匠 / 客栈…） |
| 种类 `kind` | `shop` · `supply` · `quest_board` · `encounter_entrance` · …（闭集，contracts 扩展） |
| 呈现 | 显示名、图标 / 标记样式、可选简介 |
| 默认互动 | 编译下行到条件 / 效果草稿（购买、补给、接任务、开战桩…） |
| 默认库存 / 掉落草稿 | 可选；须落在现有 variables / items 形状上 |
| 世界书 | 可选关联标签 / 条目 id |
| 出处 | provenance（首次从哪张地图 / 哪次 AI 草稿入库） |

**放置（Placement）** = `{ buildingAssetId, version?, localOverrides }`，挂在地点（主路径）或可选的格 / 路段标记上。覆写只影响这一次放置，**不**静默改库本体。

**库 vs 世界实例**

| | 建筑库 | 地图上的建筑 |
|---|---|---|
| 范围 | 编目（跨世界 / 跨城镇复用） | 某世界某地图上的一次放置 |
| 变更 | 显式新建变体 / bump version | 本地覆盖或换引用 |
| 玩时 | 不直接读 | 经地点行动 + 条件 / 效果求值 |

### 9.3 已拍板默认值（Decided defaults）

作者对「可以」未逐项细定处，文档**固定为下列默认**（实现时按此，变更须改本文）：

| 议题 | 默认 |
|---|---|
| **库范围 v1** | **当前项目 / 工作区编目**（workspace catalog）。schema 预留日后 import / export 资产包字段；**不做**跨项目市场或云端资产店。 |
| **入库时机** | **首次生成 / 创建默认写入建筑库**（UI 可取消勾选「加入库」）；另提供手动「加入库」。 |
| **同名冲突** | **自动后缀变体**（如 `杂货铺 · 2`），UI 明示；**禁止**静默覆盖或静默改名已有资产。 |
| **回写库** | 仅「升格为新变体 / 新版本」；禁止把本地覆盖悄悄写回原 `id`+`version`。 |
| **确认锁定** | **硬锁**结构字段：尺寸、地点绑定、地形 / 区域 / 势力格归属（及已纳入结构层的道路）。锁定后只允许编辑**填充层**；改结构必须先解锁。 |
| **填充挂点** | **以地点为主**；允许可选的**格 / 路段标记**（map-only），未绑定地点时校验**警告**（不为错误），结构预留给后续「路上遇怪」等。 |
| **道路 / 路程** | 属**结构层**，理想上在确认前完成；可排在实现分期稍后（不阻塞填充 MVP）。 |
| **战斗** | **桩效果**即可：如 `start_encounter` → 写 variables / flags；**不**新建战斗 runtime。完整战斗引擎另立项。 |

### 9.4 推荐但仍可调的边界（Open-but-recommended）

下列与 §9.3 一致，实现前若要改须显式改文档：

1. **解锁 UX**：解锁时提示「将暂停填充 AI；已放置内容保留，结构改动可能导致悬空引用 → 校验列出」。
2. **AI 填充范围**：默认一次按类生成（遭遇 / 城镇设施分轨），审核面板分类展示；可配置「全出后分类审」。
3. **与地图 AI 草稿（M4）分工**：M4 提结构（势力 / 地理 / POI）；本节 AI **只**在确认后提填充与建筑资产草稿，不改格子与绑定。
4. **迷雾与图标**：试玩中填充图标受既有迷雾约束；未探索不剧透 Boss / 商店（可作者开关）。

### 9.5 层归属（五层对照）

| 层 | 本功能落点 |
|---|---|
| Substrate | 地点、条件 / 效果种类（含 `start_encounter` 桩）、会话 overlay；地图结构字段与 `structureLocked` 元数据 |
| Catalog | **Building Library**、地图 / 数值模板；填充种类与默认互动的编目快照 |
| AI adapters | `propose-map-fill` / `propose-building` → **草稿 diff**；禁止直写 SQLite / session |
| Authoring UI | 确认 / 解锁、填充图层面板、建筑库浏览器、草稿审核（accept / reject） |
| Transport | 确认、放置、入库、升格变体、AI 提案等进入共用命令表 |

### 9.6 数据形状（提案，非实现）

```ts
// WorldMap 增补（示意）
structureLocked?: boolean          // 确认后 true；解锁清空或保留由命令显式处理
structureLockedAt?: string         // ISO，可选
fill?: {
  placements: MapFillPlacement[]   // 商店/补给/任务/遭遇等
  cellMarkers?: MapCellMarker[]    // 可选：未绑地点的格标记（警告级）
  routeMarkers?: MapRouteMarker[]  // 可选：路段遇怪等
}

MapFillPlacement = {
  id: string
  kind: 'shop' | 'supply' | 'quest' | 'encounter' | 'boss' | string // 闭集以 contracts 为准
  locationId: string               // 主路径：必须是已绑定 POI 的地点
  buildingAssetId?: string         // 建筑库引用；遭遇类可空
  buildingAssetVersion?: number
  localOverrides?: Record<string, unknown>  // 显示名/库存/条件效果覆写
  // 编译下行后的可玩切片：actions / conditions / effects 引用或内联草稿
}

// Catalog（工作区级，v1）
BuildingLibrary = {
  schemaVersion: 1
  assets: BuildingAsset[]
  // 预留：exportManifest? / packId? — 跨项目包，v1 不实现
}
```

校验要点（规划）：锁定后拒绝结构写命令；`buildingAssetId` 必须存在于库；本地覆盖不得暗含改库；未绑定地点的 cell/route 标记 → warning；悬空 `locationId` → error。

### 9.7 与现有能力的衔接

| 已有 | 衔接方式 |
|---|---|
| 地点图 + `move` | 仍为移动真相；填充不自动造边 |
| `venueType` / 地图模板 | 城镇填充可按场所类型过滤库资产；模板可带「推荐建筑标签」种子 |
| 世界书 regions / location scope | 商店 / 任务点可关联条目；Boss 区域可绑 `regions` |
| 势力关系 / 领土 overlay | 遭遇难度或商店库存可**读**势力关系条件；不新开状态机 |
| AI 地图草稿（已实现审阅面板） | 复用 accept / reject / 依赖序 / 可撤销导入 UX；命令与 prompt **分轨**（structure vs fill） |
| KindRegistry | 新 condition / effect（如 `start_encounter`）走 contracts → rules register → 双运行时包装清单 |

### 9.8 实现分期（outline only · M-fill-*）

| 阶段 | 内容 | 验收（规划） |
|---|---|---|
| **M-fill-1 确认锁 + 填充骨架** ✅ | `structureLocked`；结构写拒绝；填充 placement 挂地点；编辑器确认 / 解锁 UX；校验 warning/error | 未确认不能开填充层；锁定后改尺寸 / 绑定失败；无地图世界零回归 |
| **M-fill-2 建筑库 v1** | 工作区 `BuildingLibrary` CRUD；创建默认入库（可取消）；手动「加入库」；同名 → `· 2` 后缀；放置 = ref + overrides；显式「升格变体」 | 无静默覆盖；跨城镇引用同一资产；覆写不改库 |
| **M-fill-3 种类与桩效果** | shop / supply / quest / encounter / boss 闭集；`start_encounter` 等桩 effect；试玩图标 + 迷雾 | 互动只经规则引擎；无独立战斗 runtime |
| **M-fill-4 AI 填充草稿** | 确认后 `propose-map-fill`；分类审阅；默认入库勾选；不改结构 | AI 不写 session；拒绝后零残留；provenance 可追溯 |
| **M-fill-5 格/路段标记 + 道路结构（可选后置）** | cell/route markers（警告级）；道路 / 路程进结构层并纳入锁定 | 路上遇怪可无地点；路程消耗进数值模板 |

**刻意不做（本规划范围外）**：完整战斗 / 回合制；跨项目资产市场；确认前 AI 自动铺怪铺店；填充写进地图图片生成真值（出图仍只读结构 + 示意层）。

### 9.9 风险（本段追加）

1. **未确认就生成** → 产品上禁用入口；命令表双检。  
2. **库与放置双真相** → 放置只存 ref + overrides；展示合并；回写必须新变体。  
3. **结构解锁后悬空填充** → 校验列悬空 placement；不自动删除（作者决策）。  
4. **战斗范围蔓延** → 效果种类名与文档写明 stub；UI 文案避免暗示完整战斗。  
5. **Catalog 膨胀** → v1 仅工作区；资产包 / 市场另开章程条款。
