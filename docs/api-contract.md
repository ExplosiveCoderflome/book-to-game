# 内部集成合同：分支故事与开放冒险

全部接口 JSON，成功直接返回 DTO，失败 `{error:{code,message,details?,requestId?}}`。每个 HTTP 响应带 `X-Request-ID`；请求异常时也会在错误体返回同一 requestId，便于在 `data/logs/api-YYYY-MM-DD.jsonl` 中定位。本机 Web API 通过 Host/Origin 校验访问，不要求工作台访问码；MCP 端点仍需要 `Authorization: Bearer <本地 token>`。网页开发端口 5173（备用 5174），经 Vite 代理到 API 4317。生产 API 提供 apps/web/dist 静态页。

| 方法 | 路径 | 输入 / 输出 |
|---|---|---|
| GET | /api/runtime | RuntimeInfo |
| GET | /api/settings/model | ModelSettingsView（不含 API Key） |
| PUT | /api/settings/model | ModelSettingsInput → ModelSettingsView |
| POST | /api/settings/model/models | ModelListInput → ModelListResult（不保存） |
| POST | /api/settings/model/test | ModelSettingsInput → ModelConnectionResult（不保存） |
| POST | /api/sources | {title,filename,contentBase64,encoding?:utf8/utf16le/utf16be/gb18030} → SourceDocument |
| GET | /api/sources | SourceSummary[] |
| GET | /api/sources/:id | SourceDocument |
| POST | /api/jobs | GenerationInput → GenerationJob |
| GET | /api/jobs | GenerationJob[] |
| GET | /api/jobs/:id | GenerationJob |
| POST | /api/jobs/:id/read | {path?:string[],offset?:number,limit?:number} → 任务摘要或带updatedAt的数据页 |
| POST | /api/jobs/:id/plan-check | {} → {id,updatedAt,report:PlanCheckReport}，检查已存规划 |
| POST | /api/jobs/:id/approve-saved-plan | {expectedUpdatedAt:string} → GenerationJob，确认已存规划并排队正文 |
| POST | /api/jobs/:id/retry | {} → GenerationJob |
| POST | /api/jobs/:id/cancel | {} → GenerationJob |
| GET | /api/drafts | Draft[] |
| POST | /api/drafts | {sourceId,content:GameContent} → Draft |
| GET | /api/drafts/:id | Draft |
| PUT | /api/drafts/:id | {version,content:GameContent} → Draft |
| POST | /api/drafts/:id/validate | {} → ValidationResult |
| POST | /api/drafts/:id/publish | {version} → GameRevision |
| POST | /api/drafts/:id/extend-scene | ExtendDraftSceneInput → Draft |
| POST | /api/drafts/:id/fill-scene-text | FillSceneTextInput → FillSceneTextResult（作者态补全文；不自动存草稿） |
| GET | /api/games | GameRevision[] |
| POST | /api/sessions | {gameRevisionId} → SessionView |
| GET | /api/sessions | SessionView[] |
| GET | /api/sessions/:id | SessionView |
| POST | /api/sessions/:id/actions | ActInput → SessionView |
| POST | /api/sessions/:id/propose-act | ProposeActInput → ProposeActResult（L2；不发明边；可选 `tiandaoCorrect`） |
| POST | /api/sessions/:id/narrate | NarrateInput → NarrateResult（L1 旁白；不改状态；可 soft-fail；可选 `tiandaoCorrect` 注入天道提示词） |
| GET | /api/worlds/drafts | WorldDraft[] |
| POST | /api/worlds/drafts | {sourceId,content:WorldContent} → WorldDraft |
| GET | /api/worlds/drafts/:id | WorldDraft |
| POST | /api/worlds/drafts/:id/read | {path?:string[],offset?:number,limit?:number} → 世界摘要或带version的数据页（path相对content） |
| PUT | /api/worlds/drafts/:id | {version,content:WorldContent} → WorldDraft |
| POST | /api/worlds/drafts/:id/validate | {} → ValidationResult |
| POST | /api/worlds/drafts/:id/publish | {version} → WorldRevision |
| GET | /api/worlds/revisions | WorldRevision[] |
| POST | /api/adventures | {worldRevisionId} → AdventureView |
| GET | /api/adventures | AdventureView[] |
| GET | /api/adventures/:id | AdventureView |
| POST | /api/adventures/:id/actions | AdventureActInput → AdventureView |
| POST | /api/adventures/:id/propose-act | ProposeAdventureActInput → ProposeAdventureActResult（L2；可选 `tiandaoCorrect`） |
| POST | /api/adventures/:id/narrate | NarrateInput → NarrateResult（L1 旁白；sceneId=locationId；不改状态；可选 `tiandaoCorrect`） |

DTO 来自 packages/contracts/src/index.ts。客户端请求超时或失败不自动创建新 requestId，动作确认完成后才生成下一个 ID。草稿版本冲突由用户刷新后重新编辑，不能静默覆盖。

分支故事的 `GameContent.variables` 可选，值为有限数值、字符串或布尔值；缺省相当于没有变量。每个 choice 可选 `conditions` 和 `effects`，缺省为空：

- 条件：`{type:"variable.equals",variable,value}` 或 `{type:"variable.gte",variable,value:number}`。全部条件满足才显示该选项。
- 效果：`{type:"variable.set",variable,value}` 或 `{type:"variable.increment",variable,value:number}`。负 increment 表示减少。
- 发布时要求变量已声明，equals/set 的值类型与初值一致，gte/increment 仅用于数值变量。
- `SessionView.variables` 返回当前变量值；历史记录中的旧动作响应可没有这个字段。选项投影不返回条件、效果或目标场景。伪造锁定选项返回 `CHOICE_LOCKED`，不推进回合，不保留失败请求 ID。
- 变量效果与状态、动作响应同事务提交。重复 requestId 返回最初响应，数值增量不重复执行；陈旧回合和数值溢出均拒绝。

旧草稿、固定发布版本与存档不重写；缺少变量状态的旧存档按空变量处理。网页语言选择仅影响界面，HTTP/MCP 游戏合同和作者内容不随 locale 改变。

GenerationJob.progress 的范围为 0..1。任务失败或取消后均可 retry；get_job 的 analysis.coverage 明确记录实际有正文被分析的章节。失败时 `error` 是给作者看的说明，`failure` 为 `{code,message,path?,step,attempt,requestId}`，路径指向未通过校验的字段；日志与该对象都不包含小说正文或模型密钥。MCP 工具返回成功结构 `{result: DTO}`，失败返回 `{error:{code,message,...}}` 并标记 isError。

GenerationInput 为 `{sourceId,direction,requestId,mode?,chapterIds?,playerRole?,canonPolicy?}`。mode 为 story/open，省略时保留旧接口 story 行为；网页默认 open。chapterIds 省略则选择全部，显式传入必须非空、不重复且属于来源，服务按原文顺序归一化。canonPolicy 为 faithful/divergent。返回任务保留改编计划，open 成功后的 draftId 指向 `/api/worlds/drafts/:id`，story 指向 `/api/drafts/:id`，客户端必须按 mode 分流。相同 requestId 改变计划返回冲突。

WorldContent 的完整定义见 `packages/contracts/src/world.ts`：schemaVersion=1、mode=open，包含开局、3–12 个地点、布尔事实、NPC、行动、一次性事件和条件结局。来源证据限定于 sourceChapterIds；生成结果范围须与任务选择一致。条件数组全部满足才通过；效果只允许 set/reveal/npc_learn/move/npc_move。`__wait__` 是系统保留行动 ID，草稿不可声明同名行动。

AdventureActInput 为 `{actionId,expectedTurn,requestId}`，requestId 必须 UUID。turn 表示成功行动数，elapsed 表示累计耗时。无效、陈旧或条件不满足的行动不消耗时间。每次成功行动按“效果→一次性事件→首个匹配结局→超时结局”结算，初始状态也结算事件与结局。系统等待耗时 1，在非结束状态可用；查看和刷新不推进时间。

AdventureView 仅包含当前位置、玩家已知事实、当地 NPC 公开描述、可见行动及风险/耗时/禁用原因、已发生历史和结局，不返回规则、隐藏事实或 NPC 私有知识。作者与试玩仍共用同一令牌，不能将此投影当作账户权限隔离。重试同一行动返回最初记录的结果，即使当前存档已推进；读取最新状态需单独 GET。

模型设置输入为 `{baseUrl,model,timeoutMs,expectedRevision,apiKey?,clearApiKey?}`；超时范围 1000–300000 毫秒，expectedRevision 从 GET 读取。首次保存版本为 0，保存后递增，陈旧版本返回 409。apiKey 省略或空白保留现有值，clearApiKey=true 明确清除；二者不能同时提供非空密钥和清除指令。更换 URL origin 时必须重新填写或清除密钥。基础地址只允许无内嵌凭据、查询参数和片段的 HTTP(S)，不能以 /models 或 /chat/completions 结尾。
获取模型列表输入为 `{baseUrl,timeoutMs,expectedRevision,apiKey?,clearApiKey?}`，不要求先填写 model；成功返回 `{models,message}`，使用已有密钥时不会把密钥返回给网页。网页优先用这些 ID 选择模型，但保留手动输入以兼容不提供完整 `/models` 列表的服务。

模型设置输出为 `{baseUrl,model,timeoutMs,hasApiKey,configured,revision,source}`，source 是 environment 或 workspace；不返回加密值或明文 Key。configured 表示必要字段已具备，不保证连接或生成成功。获取模型列表与连接测试使用当前输入及已有密钥，只请求 /models，不保存配置、发送正文或验证 JSON 生成能力；连接测试额外返回 `models` 与 `modelAvailable`。

## 服务端公开接口

`sources/index.ts` 导出 `SourceService`, `SqliteSourceRepository`, `SourceReader`。`new SourceService(repository)`；方法 `importFile({title,filename,bytes:Uint8Array,encoding?}): SourceDocument`, `list():SourceSummary[]`, `get(id):SourceDocument`。SqliteSourceRepository 构造参数为 platform 提供的 Node SQLite 连接，构造时创建自己的表；保存原始 bytes 与文档。SourceReader 为 `{get(id):SourceDocument}`。

`games/index.ts` 导出 `GameService`, `SqliteGameRepository`。`new GameService(repository, sourceReader)`；`create({sourceId,content}):Draft`, `update(id,{version,content}):Draft`, `get(id):Draft`, `list():Draft[]`, `validate(id):ValidationResult`, `publish(id,{version}):GameRevision`, `listRevisions():GameRevision[]`, `getRevision(id):GameRevision`。create/update 允许图关系不完整但必须结构合法；publish 必须完整通过图校验。重复发布相同草稿版本返回同一发布记录。

`sessions/index.ts` 导出 `SessionService`, `SqliteSessionRepository`。`new SessionService(repository, revisionReader)`；revisionReader 为 `{getRevision(id):GameRevision}`；`start({gameRevisionId}):SessionView`, `get(id):SessionView`, `list():SessionView[]`, `act(id,input:ActInput):SessionView`。仓储在一个短事务内比较版本、插入事件与更新状态；重试相同 requestId 且同输入返回原返回值；异输入重用 requestId 抛409。构造仓储自动建表，游戏表先于存档表创建。

模块抛 `shared/errors.ts` 的 AppError；ZodError 由适配器统一转400。公开服务均同步；根任务服务可异步编排。禁止 import 其他模块内部；Sqlite 仓储放在各模块 infrastructure 中，domain/application 只依赖纯端口。

`worlds/index.ts` 导出 `WorldService`, `SqliteWorldRepository`，方法与 GameService 对应，返回 WorldDraft/WorldRevision；依赖只读 SourceReader。草稿允许引用尚不完整，发布必须通过语义与来源校验；潜在地点连通性只是警告，不能代替可解性证明。

`adventure-sessions/index.ts` 导出 `AdventureService`, `SqliteAdventureRepository`。`new AdventureService(repository, revisionReader)`，revisionReader 提供 `getRevision(id):WorldRevision`；`start({worldRevisionId})/list/get/act` 返回 AdventureView。持久化状态有 schemaVersion，仓储用同一短事务保存状态及动作结果，存档固定不可变世界版本。
