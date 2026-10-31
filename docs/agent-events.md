# 智能体事件流协议

商城 H5 与经营工作台使用相同协议，通过 `x-client: shop` 或 `x-client: admin` 选择各自的登录会话。所有接口检查登录身份和会话归属。以下路径以智能体服务为基准；开发环境经前端同源 `/api` 代理访问。

## 提交消息

`POST /api/conversations/:id/messages`

请求：`{"message":"查看待发货订单，并找出需要补货的规格。"}`。

成功返回 HTTP 202 和运行编号。前端在提交前建立事件连接，使用返回的运行编号关联用户消息、分析过程和结果。业务执行不依赖浏览器连接存活；连接断开不会重新提交消息或重新执行业务。

## 订阅事件

`POST /api/conversations/:id/events/stream`

请求头包含 `Content-Type: application/json`、`Accept: text/event-stream`、`x-client` 和当前同源会话 Cookie。请求体为 `{"afterId":"0"}`；续接时传入最后已收到的事件编号。编号按十进制字符串传输，避免 JavaScript 大整数精度损失。

响应头：`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`。前端使用 `fetch` + ReadableStream 读取，以支持 POST 和身份请求头。

事件先持久化再发送。连接先订阅现场事件，再按编号回放已有记录，并对重叠事件去重，因此续接不会遗漏回放与实时推送交界处的事件。回放结束发送 `stream-ready` 帧；它没有持久化编号。每 15 秒发送 SSE 注释心跳。退出登录或会话失效会关闭连接。

业务事件格式示例（编号仅用于解释）：

```text
id: 128
event: analysis-summary
data: {"id":"128","conversationId":"…","runId":"…","type":"analysis-summary","title":"需求分析摘要","detail":"先核对待发货订单，再对照可售库存找出需要补货的规格。","occurredAt":"2026-10-28T13:00:00.000Z","step":1,"streaming":true}

```

事件字段：

| 字段                  | 含义                               |
| --------------------- | ---------------------------------- |
| `id`                  | 持久化编号；只比较顺序，不要求连续 |
| `conversationId`      | 所属会话                           |
| `runId`               | 所属运行，允许为空                 |
| `type`                | 下表中的事件类型                   |
| `title` / `detail`    | 面向用户的标题和说明               |
| `occurredAt`          | 服务端事件时间                     |
| `step`                | 模型交互轮次，可选                 |
| `toolId` / `actionId` | 关联能力调用、确认操作，可选       |
| `durationMs`          | 已完成阶段的实际耗时，可选         |
| `count`               | 查询返回数量，可选                 |
| `streaming`           | 摘要是否仍在生成，可选             |

| 类型                                                      | 展示含义                                                 |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `run-started`                                             | 已接收需求，开始处理                                     |
| `analysis-started`                                        | 开始本轮需求分析或结果分析                               |
| `analysis-summary`                                        | 当前摘要的完整已生成文本；更新当前轮次，而非追加重复卡片 |
| `tool-started`                                            | 开始执行某个业务能力                                     |
| `tool-completed` / `tool-failed`                          | 能力完成或失败及说明                                     |
| `confirmation-required`                                   | 操作已准备，等待用户确认；尚未提交业务变更               |
| `run-completed` / `run-failed`                            | 本轮编排完成或中止                                       |
| `action-started`                                          | 用户确认后开始办理                                       |
| `action-completed` / `action-failed` / `action-cancelled` | 确认操作的最终状态                                       |

`run-completed` 表示本轮分析编排结束；若包含待确认卡，业务变更仍需用户确认。确认后的动作继续在原过程卡片更新。

草稿修订成功后仍使用 `confirmation-required` 事件，关联新版 action ID。会话快照的 actions 包含 `revision`、`draft_id` 和 `supersedes_id`；前端显示旧版已替代、新版待确认。`revising` 与 `revision_failed` 均不可提交，失败不能展示成新版完成。界面在处理消息时暂停确认按钮，服务端独立检查运行与草稿状态，拒绝旧卡和并发的无效提交。

## 前端恢复与展示

前端按会话和事件编号合并，按 `step` 更新分析节点，按 `toolId` / `actionId` 更新执行节点。连接断开采用 1–15 秒退避重连；45 秒未收到任何数据时重建连接，带上已收到的最后编号。切换对话或退出页面会主动关闭旧连接，旧会话的迟到结果不会写入当前页面。

经营工作台在助手回复的名称旁展示「展开推理 / 收起推理」，执行中默认展开，回复完成后自动收起；打开历史回复也默认收起，用户可随时展开查看。商城 H5 继续使用事件流同步结果，但不渲染分析或执行详情，只在等待回复时显示「栖禾正在思考中…」及依次跳动的省略号，回复到达后移除提示。系统启用减少动态效果时省略号静态展示。

`GET /api/conversations/:id` 同时返回 `messages`、`events`、调用与确认卡状态，用于首次载入及事件触发的结果同步。用户消息和助手消息包含 `run_id`，与过程卡关联。历史运行没有事件记录时不伪造过程。

## 模型输出边界

模型请求使用 `stream: true`。编排协议要求首先输出 `analysisSummary`，执行器从内容流中增量解析这一字段。它只包含用户需求、已知事实、需要检查的条件以及本轮业务动作；不展示提供方的 `reasoning_content`、私有思维链、系统提示词、工具参数或凭据。

只有完整解析并校验通过的模型结果才能触发业务能力。模型输出中断或格式错误会中止本轮并推送失败事件，不自动纠正重试。模型分析摘要与真实能力开始、完成事件分开记录，不能将计划当作已执行结果。

## 验证

`npm run verify:stream:unit` 检查 SSE 分块、多字节中文、CRLF、多行数据、未完成帧、摘要转义、私有推理字段排除和模型流中断。

`npm run verify:stream` 通过 Vite 代理调用真实模型，检查两种身份的增量摘要与实际业务调用，管理端断线后的完整续接、其他客户禁止访问会话，以及准备取消订单后仍保持待付款、取消确认卡收到事件的边界。记录保存到 `output/event-stream-verification.json`。
