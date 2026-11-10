# T9 编辑世界包与 K1–K16 积木

世界包只改变作者的编辑/编译格式；引擎和 HTML/exe 播放器仍读取单份 WorldContent，不增加 UI 或平行状态机。

## 离线命令

```sh
npm run world:pack -- split path/to/legacy.world.json /tmp/world-edit
# 编辑 /tmp/world-edit 内的文件，再编译到另一个不存在的目录：
npm run world:pack -- compile /tmp/world-edit /tmp/world-release
```

两个命令也接受旧 JSON 或编辑包目录作为输入。输出目录必须不存在；不覆盖原文件或已有编辑。发布产物为 `world.json` 和旁车 `manifest.json`。命令不调用模型，也不执行扩展 JS。编译只是结构转换，不能代替服务端的来源、内容、保留基线、扩展和真实模拟发布检查。

**寿灯样例只能读取，不能作为输出目录。** 自动化回归只调用 readdir/readFile，对全部原文件核对 SHA256；需要落盘的测试使用独立临时目录。

## 编辑格式

- 必需：`manifest.json`、`state.json`、至少一个 `content/*.json`。
- `state.json`：原有 resources/resourceDefs/facts/clock/storyletRules/openingRoll/ledgerVersion；仍是这些状态定义的唯一来源。
- `content/locations*.json`、`storylets*.json`、`endings*.json`、`recap*.json`：相应数组。文件名按 ASCII 字典序拼接，文件内顺序保留；同类 ID 冲突为 error，不按实体 ID 重排。
- `content/texts*.json`：其余原有字段的对象片段，包含标题、目标、行动、事件、NPC、地图、世界书和未知旧字段等纯 JSON。不能覆盖 state 或其他专属片段。
- `blocks/*.json`：显式 blockSelections 实例，保留顺序、版本和参数。
- `ext/*.ext.json` + 同名 `.js`：扩展声明及原样源代码，配对必需，仅当数据读写；不执行 JS。文件编号保留原数组顺序，不把扩展 ID 当文件路径。
- 可选 `checks.json`：格式转换层原样保留旧声明，**当前服务端尚未支持此文件作为阈值配置**，因此包导入时明确以 WORLD_PACKAGE_CHECKS_UNSUPPORTED 拒绝，不能静默忽略后发布。既有服务端验收阈值和 T7 门禁不变。

manifest specVersion 为 1，记录打包目标、每个源文件的 SHA256 和积木版本。旧世界未声明 blockSelections 时，selectionMode=inferred，仅在 manifest 记录已有 K 功能使用的内置积木；不向原世界注入字段。显式选择时 selectionMode=explicit，清单必须与 blocks 文件一致；空数组和缺省字段分别保留。

普通编辑不要求手算 hash：编译时重新生成 manifest 的 hash；`compileWorldPackage(packet, {verifyHashes:true})` 用于检查冻结/归档包的完整性。路径采用封闭的相对路径语法，拒绝穿越、符号链接和未知文件；最多 512 文件、16MiB、128 层 JSON。保留未知旧字段，不通过 WorldContent schema 补默认值或丢字段。规范化字节比较只排序对象键，不改数组、文案或扩展源码；连合法数值 -0 也保留，确保严格深度相等。

## 产品接线

- 原 `create_world_draft` / `update_world_draft` 的 content 同时接受 WorldContent 和编辑包；合并后仍走原 schema、版本 CAS 和保留基线，失败不写草稿。
- 原 `read_world_draft` 只有显式传 `format: "world-package"` 才返回 `{id, version, sourceId, package}`；省略时仍是原有有界分页，不自动向模型发送整包。
- 原发布入口重新拆合规范编辑包，保存一个 WorldContent 和可选 packageManifest；版本幂等性不变。显式积木选择在发布前使用当前服务端目录检查版本、依赖、互斥、参数和底座契约，不信模型自报。
- SQLite 草稿仍存规范 WorldContent；编辑文件可由 CLI 保存到作者指定的新目录，原目录不被自动重写。服务端返回的 manifest 对应其规范编辑投影，不承诺保留上传时的空白/分片命名。
- 旧样例的原始格式拆合与运行时格式适配是两件事；本模块保证深度相等/规范化字节相等，不擅自改变旧格式语义。

## K1–K16 迁移表

既有 21 个积木 ID/version 保留，给现有引擎能力补上 category、reads、带单次变动界限的 writes、hooks、compileTo、checks、已有 playerUi、示例片段、适用画像和注意点；新增只读 K14 积木，目录共 22 块。

| 功能 | 积木 | 落点（沿用现有运行时） |
|---|---|---|
| K1/K2/K5/K10 | stat-templates | 资源定义/条件、anyOf、resource_max |
| K3/K11 | clock | 时钟条件、时间推进 |
| K4/K6/K7/K8 | storylet-pool | seen 条件、卡池规则、剧情卡与选项 |
| K9 | encounters | 已有 seeded roll 效果，不声称新战斗引擎 |
| K10/K13/K15 | endings-recap | ending 效果、结局、附加段落及回顾快照 |
| K12 | world-map | 地点 textVariants |
| K14 | state-snapshot | 既有 RNG/手牌/卡池次数/资源上限/时钟存档字段；onLoad 只读 |
| K16 | opening-roll | 既有开局投掷 |

示例是各落点的 JSON 片段而非完整世界。参数边界与已有 schema 一致：hand_size 1–5、limit 1–2400、rerolls 0–20。修改引擎契约属于目录破坏性修改，需升版本；不增加运行时解释器、不生成新玩家组件。默认 list_blocks 保持紧凑索引，不展开新增 engine 契约/示例；get_block 按需返回完整详情，避免发现目录再次推高 Pi 上下文成本。
