# OpenCodex Quota MCP

[English](README.md) | [简体中文](README.zh-CN.md)

A small, read-only MCP server that lets tool-capable models in Codex query provider quotas, balances and reset times from the local **[OpenCodex](https://github.com/lidge-jun/opencodex)** dashboard.

This is an independent third-party integration, not an official OpenCodex or OpenAI plugin. **OpenCodex supplies the provider connections, authentication, quota collection and dashboard.** This project exposes that existing data as one MCP tool; it does not implement its own provider billing integrations. See [Acknowledgements](#acknowledgements).

## What it does

- Lists configured providers or filters by an exact provider name or dashboard label, case-insensitively.
- Returns used and remaining percentages, balance text, reset times and measurement timestamps when available.
- Keeps OpenAI account-pool aggregates separate from the current account's quota.
- Marks missing readings as `unavailable_or_unsupported`, rather than treating them as zero usage.
- Keeps dashboard session tokens, CSRF tokens, API keys and provider request headers out of tool results.

## Requirements

- Node.js **22 or newer**, npm, and Git if cloning.
- A working [OpenCodex installation](https://github.com/lidge-jun/opencodex#readme), with configured providers and a dashboard accessible at **`http://localhost:10100`**.
- Codex or another client supporting local stdio MCP servers, and a model that supports tool calls.
- The MCP process and OpenCodex must run on the same machine. The dashboard address is fixed in this version.

Validated locally with OpenCodex **2.93.0**, Node.js **24**, and Windows. Ubuntu/Windows with Node.js 22/24 are included in CI for the offline tests. OpenCodex's dashboard interfaces are internal APIs and may change between versions. Remote dashboards and authentication setups that do not issue a local dashboard session are not supported.

## Install in Codex

### 1. Download and install dependencies

```sh
git clone https://github.com/wujiseclusion/opencodex-quota-mcp.git
cd opencodex-quota-mcp
npm ci
```

Alternatively, download and extract a [release](https://github.com/wujiseclusion/opencodex-quota-mcp/releases), then run `npm ci` inside the extracted directory. Keep this directory in a permanent location: Codex will launch the server from it.

### 2. Register the local MCP server

**Windows PowerShell**, from the project directory:

```powershell
$nodePath = (Get-Command node).Source
$serverPath = (Resolve-Path ./server.mjs).Path
codex mcp add opencodex-quota -- $nodePath $serverPath
codex mcp get opencodex-quota
```

**macOS / Linux**, from the project directory:

```sh
codex mcp add opencodex-quota -- "$(command -v node)" "$(pwd)/server.mjs"
codex mcp get opencodex-quota
```

If `opencodex-quota` is already registered and you want to replace it, run `codex mcp remove opencodex-quota` first. You can also configure it manually in `~/.codex/config.toml`, using your own absolute paths:

```toml
[mcp_servers.opencodex-quota]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/opencodex-quota-mcp/server.mjs"]
tool_timeout_sec = 150
```

On Windows, forward slashes work in TOML paths, for example `C:/tools/opencodex-quota-mcp/server.mjs`. The optional 150-second timeout allows for slow dashboard queries and a single authentication retry. See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) for client configuration.

### 3. Start a new Codex chat

Make sure OpenCodex is running, then start a new chat. If the tool is missing, check MCP settings and restart Codex if necessary. Ask:

> Use get_provider_quotas to show all provider quotas, balances and reset times. Include the measurement time.

Or:

> Check the remaining Anthropic quota with get_provider_quotas.

## Tool reference

**`get_provider_quotas`** accepts one optional argument:

```json
{}
```

```json
{ "provider": "anthropic" }
```

Use the exact configured provider name or dashboard label. For example, `anthropic`, `openai`, `deepseek` or `kimi`, if configured. Omit the argument to discover names. No arbitrary URL, credential or write-operation parameters are exposed.

| Field | Meaning |
| --- | --- |
| `queriedAt` | When this tool assembled its response; not the measurement time. |
| `generatedAt` | Timestamp supplied by the dashboard quota response. |
| `quota.updatedAt`, `ageSeconds` | Measurement timestamp and age, when supplied. |
| `windows[].usedPercent`, `remainingPercent` | Used percentage and `max(0, 100 - usedPercent)`. |
| `windows[].resetsAt` | Reset time, or `null` if unknown. |
| `windows[].balanceDisplay` | Balance as displayed by OpenCodex; no invented percentage or currency conversion. |
| `creditsUsd` | Structured USD credit data when supplied by OpenCodex. |
| `pool`, `currentAccount` | Account-pool summary and current-account quota, separately. |
| `observed` | Whether OpenCodex reports a passive observation instead of an active measurement. |
| `status` | `available` or `unavailable_or_unsupported`; an available reading may still be old. |

All output timestamps use UTC ISO 8601. Convert them to the user's timezone when presenting them. For a pool, `nextRecoveryAt` describes the next capacity recovery, which is different from a full pool reset.

## Data access and limitations

The server fetches the local dashboard HTML to obtain its session, then sends authenticated **GET** requests to `/api/providers` and `/api/provider-quotas`. Authentication is held in process memory and is not written to files. HTTP redirects are rejected. A 401/403 response triggers one session renewal and retry per request. Responses are projected to quota-related fields rather than forwarding provider configurations.

The tool uses OpenCodex's existing cache policy. It does not pass `refresh=1`, send model completions, change routing or modify provider settings. OpenCodex may itself contact providers or update its own caches while serving its quota endpoint. This is an on-demand query tool, not a background monitor.

Quota availability depends on OpenCodex and the upstream provider. A configured provider can have no supported quota interface or no current reading. This server cannot add missing upstream quota support. Balance-only readings are returned as balance text, without interpreting the dashboard's placeholder percentage. Model tool-call support must be checked separately; not every routed model has been tested.

## Test

```sh
npm test
```

Runs offline fixtures and a real stdio MCP handshake/tool-discovery test. It does not require OpenCodex, provider credentials or live quota queries. The live test is skipped by default.

With a running local OpenCodex dashboard and at least one configured provider:

```sh
npm run test:live
```

Runs the same suite plus real quota queries, provider filtering and unknown-provider handling. Live provider names/statuses may appear in the console; avoid sharing logs if those names are private. `live-test.env` only enables this test and contains no credentials.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Tool not listed | Check `codex mcp get opencodex-quota`, absolute paths and `npm ci`; start a new chat or restart Codex. |
| Unreachable or timed out | Open `http://localhost:10100` on the same machine and check the OpenCodex service. |
| No local session / HTTP 401 or 403 | Check dashboard authentication and local access. Do not paste tokens into chat. This integration requires local session bootstrap. |
| Missing provider quota | Check the same provider in the OpenCodex dashboard; missing data is not zero usage. |
| Unknown provider | Query without arguments, then use the returned name or label exactly. |
| Response structure changed | Check OpenCodex version compatibility; dashboard API changes may require an integration update. |

## Update / uninstall

Update from a Git checkout with `git pull --ff-only` followed by `npm ci`, then restart the MCP client. If the installation path changes, remove and register the MCP entry again.

```sh
codex mcp remove opencodex-quota
```

Then remove the project directory if no longer needed. This does not uninstall OpenCodex.

## Acknowledgements

- **[OpenCodex — lidge-jun/opencodex](https://github.com/lidge-jun/opencodex)**: the upstream proxy and dashboard this integration depends on; provider authentication, quota measurements and labels come from OpenCodex. Its code is licensed under [MIT](https://github.com/lidge-jun/opencodex/blob/main/LICENSE).
- **[Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)**: stdio MCP server and client implementation.

This repository contains an independently written adapter; it does not bundle OpenCodex. Project names belong to their respective owners. This adapter is licensed under [MIT](LICENSE).
