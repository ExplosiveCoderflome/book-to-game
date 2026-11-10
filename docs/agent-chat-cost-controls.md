# Pi 会话成本防护

## 根因与边界

此前只设 384 KiB 工作消息 / 768 KiB 请求硬上限；同一用户意图之后的全部工具回执都被固定保留，单个意图持续越久，请求越大。它能避免服务端拒收，不能限制运行成本。旧会话不会被删除，本次也不修改数据库中的历史、草稿或确认记录。

现在默认目标为 **完整常规请求 96 KiB、最近 4 个 assistant/tool 轮次**：给系统规则、恢复索引、精确工具定义留空间，通常仍可容纳数页草稿正文。每次请求都重新选窗口，**同一长意图也滚动**。最新实质意图和确认消息必留，工具批次及其回执整体选择，不拼接 JSON、不伪造正文摘要。

旧正文不重复发送；恢复索引仅含有界的 ID/版本/状态/最近错误和 `currentDraftReference`（历史只读引用，写前重读）。待确认、uncertain 等证据不当作新授权。需要正文时按 ID/path 分页重读。

### 兼容性例外（不是隐形放宽）

96 KiB 是常规目标，不是所有请求的强制上限。已显式选中的**精确工具定义**可能单独超过目标；当前意图读取的 **完整世界 schema（206773 字符）** 也必须原样保留，不能为省钱改成残缺 schema。这些固定/不可分割内容可超过目标；其余历史仍受小窗口限制，并记录 `targetExceeded`。384 KiB 工作消息与 **768 KiB 实际请求绝对上限**继续兜底，每次仍要通过 token 总预算，不能无限重复发送大 schema。两个完整 schema 超过工作硬上限时仍拒绝。

## 按运行 token 预算

| 配置 / 环境变量 | 默认 | 有效范围 |
| --- | ---: | ---: |
| `CHAT_CONTEXT_TARGET_BYTES` | 98304 | 16384–393216 |
| `CHAT_RECENT_TURNS` | 4 | 1–16 |
| `CHAT_RUN_TOKEN_BUDGET` | 256000 | 1000–10000000 |
| `CHAT_MAX_OUTPUT_TOKENS` | 8192 | 256–32768 |

ModelConfig 对应 `chatContextTargetBytes/chatRecentTurns/chatRunTokenBudget/chatMaxOutputTokens`。保存过工作区模型设置时，仍继承服务器设定的成本限制，不会绕过环境预算。

每次请求（包含工具回合）先对系统、schema、回执等所有序列化内容按 UTF-8 bytes / 2 向上取整估算输入，并预留完整输出上限；SDK 生成实际请求体后再检查。返回 usage 时累计其全部 input/output/cache token；请求 streaming usage，不支持返回 usage 的通道按估算输入和实际输出大小累计，不能因 usage 缺失当成免费。预算每个用户触发的 run 新建，不带入旧会话 usage，也不在工具回合重置。

不足即抛 `CHAT_RUN_TOKEN_BUDGET`，无新请求/后续工具执行；若 usage 意外超额，在最终工具调用持久化/执行前停止。聊天服务保存已有成对回执并恢复 idle，提示预算用完，**不自动续跑/重试**。日志 `agent.chat.request` / `agent.chat.request_usage` 只记数值和固定事件/来源，不含 key、提示词或正文。

这是 token 防护，不是美元结算或精确 tokenizer；价格、隐藏通道注入和 provider 错报无法由本地保证。缺失 usage 的估算宁可保守；高价 provider 仍应在服务商侧设金额硬限。完整 schema 等离线兼容性压力测试显式提高测试配置预算，生产默认不提高。

## Provider 规定

**kuaipao 仅用于开发 / OpenCode，不用于项目 Pi 或项目实测。** `KUAIPAO_API_KEY` 单独存在时不选通道、不解析信封、不注入产品请求；也不会覆盖已配置的讯飞等默认通道。即便设置 opt-in，仍不会自动选中 kuaipao。

配置层对显式 kuaipao 地址默认拒绝；仅保留受控例外：明确设置 `LLM_BASE_URL` 及 `LLM_ALLOW_KUAIPAO_RUNTIME=true` 才能使用，不能在测试脚本或常规项目环境启用。所有本次回归为 localhost 或 mock fetch，无付费模型调用，无新增 UI，HTML/exe 代码不变。
