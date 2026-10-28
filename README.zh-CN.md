# OpenCodex Quota MCP

[English](README.md) | [简体中文](README.zh-CN.md)

一个小型只读 MCP 服务，让 Codex 中支持工具调用的模型直接查询本机 **[OpenCodex](https://github.com/lidge-jun/opencodex)** 仪表盘里的提供商额度、余额和重置时间。

本项目是独立第三方集成，并非 OpenCodex 或 OpenAI 官方插件。**提供商连接、认证、额度采集和仪表盘均由 OpenCodex 提供。** 本项目将这些已有数据封装为一个 MCP 工具，不自行实现各提供商的计费接口。详见[致谢与来源](#致谢与来源)。

## 功能

- 列出所有已配置提供商，或按配置名称、页面显示名称精确查询，不区分大小写。
- 返回可获取的已用比例、剩余比例、余额文本、重置时间及数据更新时间。
- 分开呈现 OpenAI 账户池汇总与当前账户额度。
- 缺失数据标注为 `unavailable_or_unsupported`，不视为零消耗。
- 不向模型返回仪表盘会话令牌、CSRF、API 密钥或提供商请求头。

## 环境要求

- Node.js **22 或更新版本**、npm；使用克隆安装时需要 Git。
- 已安装并配置提供商的 [OpenCodex](https://github.com/lidge-jun/opencodex#readme)，仪表盘地址为 **`http://localhost:10100`**。
- Codex 或其他支持本地 stdio MCP 的客户端，以及支持工具调用的模型。
- MCP 进程与 OpenCodex 必须运行在同一台机器；本版本固定使用上述地址。

本地已验证环境为 **OpenCodex 2.93.0、Node.js 24、Windows**。CI 配置包含 Ubuntu/Windows 和 Node.js 22/24 的离线测试。仪表盘接口属于 OpenCodex 内部 API，版本升级可能影响兼容性。当前不支持远程仪表盘，也不支持无法签发本地仪表盘会话的认证配置。

## 在 Codex 中安装

### 1. 下载并安装依赖

```sh
git clone https://github.com/wujiseclusion/opencodex-quota-mcp.git
cd opencodex-quota-mcp
npm ci
```

也可以下载并解压 [Release](https://github.com/wujiseclusion/opencodex-quota-mcp/releases)，在解压目录执行 `npm ci`。请将项目保存在固定位置，Codex 后续会从该目录启动服务。

### 2. 注册 MCP 服务

在项目目录执行。**Windows PowerShell：**

```powershell
$nodePath = (Get-Command node).Source
$serverPath = (Resolve-Path ./server.mjs).Path
codex mcp add opencodex-quota -- $nodePath $serverPath
codex mcp get opencodex-quota
```

**macOS / Linux：**

```sh
codex mcp add opencodex-quota -- "$(command -v node)" "$(pwd)/server.mjs"
codex mcp get opencodex-quota
```

如果已经注册同名服务并希望替换，先执行 `codex mcp remove opencodex-quota`。也可以手动编辑 `~/.codex/config.toml`，将示例替换为自己的绝对路径：

```toml
[mcp_servers.opencodex-quota]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/opencodex-quota-mcp/server.mjs"]
tool_timeout_sec = 150
```

Windows 的 TOML 路径可以使用正斜杠，例如 `C:/tools/opencodex-quota-mcp/server.mjs`。可选的 150 秒超时用于容纳较慢的仪表盘查询及一次认证重试。客户端配置方法见 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)。

### 3. 新建 Codex 聊天

确保 OpenCodex 正在运行，然后新建聊天。如果工具未出现，检查 MCP 设置，必要时重启 Codex。直接输入：

> 调用 get_provider_quotas，查询所有提供商的额度、余额和重置时间，并说明数据更新时间。

或者：

> 调用 get_provider_quotas，查询 anthropic 的剩余额度。

## 工具参数与返回值

工具名为 **`get_provider_quotas`**，仅有一个可选参数：

```json
{}
```

```json
{ "provider": "anthropic" }
```

名称必须与配置名称或页面显示名称对应。例如配置中存在时，可使用 `anthropic`、`openai`、`deepseek` 或 `kimi`。不传参数即可查看可用名称。工具不接受任意网址、凭据或写入操作参数。

| 字段 | 含义 |
| --- | --- |
| `queriedAt` | 工具组装响应的时间，不代表实际测量时间。 |
| `generatedAt` | 仪表盘额度响应提供的时间。 |
| `quota.updatedAt`、`ageSeconds` | 数据测量时间及距今秒数，取决于上游是否提供。 |
| `windows[].usedPercent`、`remainingPercent` | 已用比例与 `max(0, 100 - usedPercent)`。 |
| `windows[].resetsAt` | 重置时间；未知时为 `null`。 |
| `windows[].balanceDisplay` | OpenCodex 显示的余额文本，不虚构百分比或换算币种。 |
| `creditsUsd` | OpenCodex 提供时返回的结构化美元额度。 |
| `pool`、`currentAccount` | 分开返回的账户池汇总与当前账户额度。 |
| `observed` | OpenCodex 是否将该记录标记为被动观测数据。 |
| `status` | `available` 或 `unavailable_or_unsupported`；可用数据仍可能较旧。 |

时间统一采用 UTC ISO 8601 格式，展示时应换算为用户时区。账户池的 `nextRecoveryAt` 表示下一次容量恢复时间，不等同于整个账户池完全重置。

## 数据访问与限制

程序先获取本地仪表盘 HTML 中的会话，再以认证 **GET** 请求访问 `/api/providers` 与 `/api/provider-quotas`。认证信息仅保存在进程内存中，不写入文件。拒绝 HTTP 重定向；每个请求遇到 401/403 时，仅重新获取会话并重试一次。返回值只投影额度所需字段，不转发完整提供商配置。

工具遵循 OpenCodex 原有缓存策略，不添加 `refresh=1`，不主动发送模型补全请求，不改变路由或提供商设置。OpenCodex 在处理额度接口时，仍可能自行访问提供商或更新缓存。本工具为按需查询，不是后台监控服务。

能否查询额度取决于 OpenCodex 与上游提供商。已配置的提供商可能没有受支持的额度接口，或暂时没有读数；本工具无法补足上游缺失的额度能力。余额类型只返回余额文本，不解释仪表盘占位百分比。不同模型的工具调用能力也需分别确认，尚未逐一测试所有路由模型。

## 测试

```sh
npm test
```

执行离线用例，以及真实 stdio MCP 握手、工具发现测试。不需要运行 OpenCodex，不读取提供商凭据，也不查询真实额度；默认跳过实机测试。

本机 OpenCodex 已运行并至少配置一家提供商后，执行：

```sh
npm run test:live
```

在上述测试基础上，增加真实额度查询、提供商筛选和未知名称处理。控制台可能显示实际提供商名称和状态，如名称涉及隐私请勿公开日志。`live-test.env` 仅启用实机测试，不含凭据。

## 常见问题

| 问题 | 处理方法 |
| --- | --- |
| 找不到工具 | 检查 `codex mcp get opencodex-quota`、绝对路径及 `npm ci`，新建聊天或重启 Codex。 |
| 连接失败或超时 | 在同一台机器打开 `http://localhost:10100`，检查 OpenCodex 服务。 |
| 没有本地会话，或 HTTP 401/403 | 检查仪表盘认证及本地访问设置；不要向聊天粘贴令牌。本集成需要本地会话签发能力。 |
| 提供商没有额度 | 对照 OpenCodex 页面检查；没有读数不代表零消耗。 |
| 提供商名称未知 | 先不传参数查询，再使用返回的名称或显示名称。 |
| 返回结构变化 | 检查 OpenCodex 版本；仪表盘 API 更新可能需要同步修改本集成。 |

## 更新与卸载

Git 克隆安装的用户可执行 `git pull --ff-only` 和 `npm ci`，再重启 MCP 客户端。目录变更后，需要移除旧 MCP 配置并重新注册。

```sh
codex mcp remove opencodex-quota
```

确认不再需要后可删除项目目录。此操作不会卸载 OpenCodex。

## 致谢与来源

- **[OpenCodex — lidge-jun/opencodex](https://github.com/lidge-jun/opencodex)**：本集成依赖的上游代理与仪表盘，负责提供商认证、额度测量及显示标签。上游采用 [MIT 许可证](https://github.com/lidge-jun/opencodex/blob/main/LICENSE)。
- **[Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)**：提供 stdio MCP 服务端及客户端实现。

本仓库为独立编写的适配器，不捆绑 OpenCodex。项目名称归各自所有者所有。本适配器采用 [MIT 许可证](LICENSE)。
