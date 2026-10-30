# 安装与运行

准备 Git、Node.js 24.x、npm、可连接的 PostgreSQL，以及自己的模型 API 凭据。模型需支持 Chat Completions 流式接口。

## 1. 安装依赖

```powershell
git clone https://github.com/ssamj/shopAppAgent.git
Set-Location shopAppAgent
npm ci
```

## 2. 首次配置

脚本会创建数据库 `qihe_commerce` 和运行角色 `qihe_business`、`qihe_agent`。使用独立开发 PostgreSQL 实例，提供有权创建数据库和角色的初始化账号。同名数据库或角色已存在时先核对所属项目，不要删除已有数据绕过错误。

在同一个 PowerShell 窗口输入自己的配置：

```powershell
$env:PGHOST = Read-Host 'PostgreSQL 主机，例如 127.0.0.1'
$env:PGPORT = '5432'
$env:PGUSER = Read-Host '首次初始化的数据库账号'
$env:WINCODE_BASE_URL = Read-Host '模型 API 基础地址，通常包含 /v1'
$env:WINCODE_MODEL = Read-Host '模型名称'
$dbCredential = Get-Credential -UserName $env:PGUSER -Message '输入开发数据库密码'
$modelCredential = Get-Credential -UserName 'model-api' -Message '密码栏填写自己的模型 API Key'
try {
    $env:PGPASSWORD = $dbCredential.GetNetworkCredential().Password
    $env:WINCODE_API_KEY = $modelCredential.GetNetworkCredential().Password
    node scripts/configure.mjs
    if ($LASTEXITCODE -ne 0) { throw '配置失败，请检查连接、权限和环境变量。' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:WINCODE_API_KEY -ErrorAction SilentlyContinue
    Remove-Variable dbCredential,modelCredential -ErrorAction SilentlyContinue
}
```

`WINCODE_*` 是配置脚本的变量名，不限定提供方。代码在基础地址后追加 `/chat/completions`，不要重复填写这一部分。

成功后生成被 Git 忽略的 `.local/config.json`，保存自己的连接、随机生成的运行角色密码和模型凭据。配置已经存在时不会重新创建，日常启动不用再执行配置脚本。

## 3. 初始化与启动

逐条执行，发生错误时先处理错误：

```powershell
npm run db:init
npm run check
npm run dev
```

空业务库初始化会创建表、演示资料及 `.local/登录账号.txt`。已有业务资料时不会再次写入整套种子数据。

- 商城：<http://127.0.0.1:5180/shop>
- 经营工作台：<http://127.0.0.1:5180/admin>

从自己生成的账号文件读取演示账号。前台进程用 `Ctrl+C` 停止。模型请求使用自己的额度；服务默认只监听回环地址。

Windows 可通过服务脚本管理后台开发进程，脚本使用 PATH 中的 Node.js：

```powershell
powershell -File scripts/services.ps1 -Action Start
powershell -File scripts/services.ps1 -Action Status
powershell -File scripts/services.ps1 -Action Restart
powershell -File scripts/services.ps1 -Action Stop
```

不要同时运行后台服务与 `npm run dev`。

## 4. 多轮选购练习

新建商城会话，逐条发送并等待回复：

1. “帮我找上班穿的裙子，500 元以内。”
2. “不要黑色，其他要求不变。”
3. “预算改成 800 元，其他要求不变。”
4. 实际列表至少两款时，问“第二款有哪些颜色和尺码？”；不足两款时使用真实商品名称。
5. “重新开始，这次给妈妈选针织衫，预算 600 元。”

观察未修改条件是否保留、新预算是否覆盖、重置后旧条件是否清除。数量、顺序和库存以实际查询为准。另建会话检查隔离；当前会话记忆不是长期用户偏好。

## 5. 升级与验证

较早的数据库缺少记忆表时，运行 `npm run db:migrate:memory` 后重启。旧商品目录可通过 `npm run catalog:upgrade` 增量导入，不要重建数据库来升级。

| 命令 | 环境与影响 |
|---|---|
| `npm run check` | 类型检查，不需要模型或数据库 |
| `npm run verify:memory:unit` | 记忆与上下文验证，不需要模型或数据库 |
| `npm run verify:stream:unit` | 流式协议验证，不调用外部模型 |
| `npm run verify:memory:storage` | 需要数据库，测试事务回滚 |
| `npm run verify:memory` | 需要完整服务和模型，消耗额度并保留会话 |
| `npm run build` | 类型检查与前端构建，输出到 `dist/` |

业务闭环和并发脚本可能创建单据，先阅读脚本并使用独立开发数据库。

## 常见问题

- 端口占用：检查 3181、3180、5180 是否已有开发服务，不要结束其他项目进程。
- 模型失败：核对 API 地址、模型名、凭据、权限和额度。
- 数据库失败：核对主机、端口、角色权限及 `.local/config.json`。
- 换电脑：代码、结构和种子数据随仓库提供；实际数据库和私有配置另行安全迁移。
- 不要提交 `.local`、密钥、登录账号文件或数据库备份。
