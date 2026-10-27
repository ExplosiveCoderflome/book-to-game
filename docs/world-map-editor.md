# 世界地图编辑器：调研与设计（地图 · 地形 · 势力分布）

> 状态：设计稿（2026-10-27），**本轮不含功能代码**。  
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
