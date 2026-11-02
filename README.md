# 电商智能体教学项目

以女装商城和经营工作台为业务场景，学习模型调用、工具执行、实时进度、会话记忆和业务校验怎样组成一个可运行的 Agent 应用。

项目采用 Vue 前端、Node.js 智能体服务、独立业务 API 和 PostgreSQL。模型理解需求并选择注册能力；业务服务处理价格、库存、权限、事务和幂等校验。下单等写操作先生成确认卡，经用户确认后执行。

## 学习主题

- Agent 循环与结构化决策协议。
- 工具参数、标准返回、权限及业务写入确认。
- SSE 实时进度与断线续接。
- 当前会话的需求记忆、条件修改、商品指代和上下文预算。
- 待确认任务的参数修订、草稿版本替代及确认边界，例如采购数量从 10 件改为 5 件后再提交。
- 可选的商品护理资料检索、分商品依据与可展开的原文引用；实时价格和库存继续通过业务接口查询。
- 可选的规则驱动智能补货单：先检索完整日常规则，再由模型提出计划，程序按依赖执行全量库存与在途查询、计算及复核，生成待审核建议。
- 用业务场景验证工具调用、状态变化及失败边界。

当前会话记忆支持多轮选购中的预算、用途、颜色、尺码、商品引用与重置。它不等于跨会话长期偏好，也不支持恢复服务重启前未完成的 Agent 运行。复杂条件及回答事实与具体查询结果的逐项绑定仍有完善空间。

## 环境依赖

- Node.js 24.x、npm 和 Git。
- PostgreSQL；首次初始化账号需具备创建数据库和角色的权限。
- 支持 Chat Completions 流式接口的模型服务，以及使用者自己的 API 凭据。

## 快速开始

```powershell
git clone https://github.com/ssamj/shopAppAgent.git
Set-Location shopAppAgent
npm ci
```

按 [安装与运行指引](docs/getting-started.md) 填写自己的数据库和模型连接，完成首次配置后逐条执行：

```powershell
npm run db:init
npm run dev
```

已有配置和业务数据时不要重复创建数据库；日常使用直接运行 `npm run dev`。

| 服务 | 默认入口 |
|---|---|
| 商城 | http://127.0.0.1:5180/shop |
| 经营工作台 | http://127.0.0.1:5180/admin |
| 智能体 API | http://127.0.0.1:3180 |
| 业务 API | http://127.0.0.1:3181 |

初始化生成 `.local/登录账号.txt`，从自己的账号文件读取演示账号。服务默认监听回环地址，用于本地学习开发。

## 工程结构

| 目录 | 用途 |
|---|---|
| `apps/web` | Vue 3、Vite、Tailwind CSS、shadcn-vue / Reka UI 前端 |
| `apps/agent` | 模型调用、决策循环、记忆、事件流和确认卡 |
| `apps/business` | 商品、客户、订单、采购、库存与账务能力 |
| `shared` | 配置、数据库连接、身份与事件协议 |
| `db` | 数据库结构与增量迁移 |
| `data` | 教学商品资料 |
| `scripts` | 配置、初始化、开发启动和验证脚本 |
| `docs` | 运行指引、技术设计和接口说明 |

## 示例数据与边界

空库初始化包含 32 款女装、232 个规格，以及演示客户、供应商和单据。图片为 AI 生成的款式示意，价格与库存为教学数据，见 [商品数据说明](docs/catalog-data.md)。

应用支持商品查询、客户与供应商资料、销售、采购、库存及收支查询。付款、退款和物流资料是系统内登记，尚未连接实际支付或物流平台。

前端只访问智能体服务；智能体通过业务 API 执行业务能力。客户只能访问自己的会话、地址、订单和售后资料。

## 检查与验证

| 命令 | 用途 |
|---|---|
| `npm run check` | TypeScript 与 Vue 类型检查 |
| `npm run build` | 类型检查与前端构建 |
| `npm run verify:memory:unit` | 需求更新、来源和裁剪，不连接模型或数据库 |
| `npm run verify:stream:unit` | 流式协议解析，不调用外部模型 |
| `npm run verify:memory:storage` | 记忆存储与隔离，需要数据库，测试事务回滚 |
| `npm run verify:memory` | 真实多轮选购，需要完整服务和模型，保留测试会话 |
| `npm run verify:stream` | 事件、续接和确认边界，需要实际模型 |

真实模型验证会消耗额度。`npm run verify` 等业务闭环脚本会创建单据，应在独立开发数据库执行；结果写入本地 `output/`。

## 技术文档

- [安装与运行](docs/getting-started.md)
- [上下文与会话记忆](docs/conversation-memory.md)
- [商品知识检索与来源核对](docs/product-knowledge.md)
- [智能补货单、任务计划与执行](docs/smart-replenishment.md)
- [智能体事件流协议](docs/agent-events.md)
- [商品数据与增量导入](docs/catalog-data.md)
- [业务 OpenAPI 合同](docs/business-openapi.json)

仓库不提供数据库账号、模型密钥或实际业务数据库。请自行配置连接，勿提交 `.local`、密钥文件、日志和数据库备份。
