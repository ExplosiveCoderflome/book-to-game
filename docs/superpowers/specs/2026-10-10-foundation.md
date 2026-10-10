# 小说转文字游戏：首期设计

用户已授权开发；技术选择为 TypeScript、Express、React、SQLite，不使用 NestJS。

本阶段交付：TXT/旧项目 JSON → 章节段落与证据 → 持久化模型分析任务 → 可编辑分支故事草稿 → 校验和不可变发布 → 可恢复文字试玩。外部 Agent 通过 MCP 使用相同应用服务，可以自行理解小说并提交草稿；Skill 只编排工具，不存储权威状态。网页模型生成需用户自行配置兼容的模型 API，未配置时明确提示，不伪造生成。

本阶段只启用 story 分支模式。自由行动、数值 RPG、完整长篇持续模拟、多人账户和冒险转小说属于后续迭代。单用户本地工作台；作者与试玩视图分开，尚不提供多租户权限隔离。

## 模块边界

- sources：字节解码、章节段落、不可变来源与原始文件保存。
- games：草稿、图校验、不可变版本。对 sources 只使用注入的 SourceReader。
- sessions：存档、选择结果、幂等事件；固定游戏版本，不调用 LLM 判定。
- generation：分块分析、持久化进度与恢复、模型编排；通过注入端口读来源和创建草稿。
- platform：SQLite、配置、模型 HTTP 等实现。composition root 组装全部端口。
- HTTP/MCP：仅输入校验、鉴权与转换。共用 Workbench 应用入口。
- contracts：跨入口 DTO 与 Zod 输入结构。各模块仅通过 index.ts 暴露公开 API。

领域和应用层不可依赖 SQL/Express/MCP；架构检查覆盖违规导入和模块循环。SQLite 使用 WAL、foreign_keys、busy_timeout；写事务短小，模型调用不占事务。

## 数据与可靠性

原始文件和解析结果保存；来源章节和段落有稳定 ID。证据必须指向真实段落，新增内容标记 adapted。生成任务逐块持久化，失败后显式重试；租约回收允许进程重启恢复。发布验证入口、连边、唯一 ID、可达结局与来源证据；发布后内容不可修改。试玩动作包含 expectedTurn 与 requestId，事件和状态同事务，重复请求返回原结果。

本地服务监听 127.0.0.1；API 和 MCP 使用本地 token；检查 Host/Origin。MCP 使用 SDK 的 Streamable HTTP 单端点 /mcp。长任务立即返回 ID，客户端断开不取消任务。小说内容作为不可信资料进入提示词，不能执行系统指令或工具。
