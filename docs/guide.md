# 使用说明

**[← 回到首页](../README.md)**

安装步骤见 [DSH 插件安装教程](https://github.com/DPH-1121/dsh-plugins/blob/main/docs/install.md)。本页保留工作台入口、用量模板、边界与自检。

## 三个入口分别干什么

| 位置 | 用途 |
|---|---|
| 设置 → 提供商增强 | 增删改 provider、勾图片、写请求头、填 API Key、拉模型、测连通、配用量模板 |
| 设置 → 模型 → 每张卡片下方 | 一条只读摘要：`N/M 支持图片` + 一键测连通 |
| 设置 → 模型 | 官方原样：填 API Key、启用/停用行、登录 |

API Key 现在两处都能填，写的是同一个地方（`$DSH_HOME/.credentials.yaml` 的 `refs:`）：在工作台的「凭据与请求头」里粘贴 Key，保存时插件调用凭据服务写进 `<凭据引用>` 名下；留空则只改 provider、不动已有凭据。插件只报告「已配置 / 未配置」，从不回显已存的值，也不把 Key 写进 profile 配置。

手写路由的模型表可以留空：保存时会自动向端点要一次模型列表并整份采用（端点没返回模型时才要求手动勾选）。

## 用量查询怎么配

数据面通常没有额度接口。以 CommandCode 为例，实测 `GET /provider/v1/{me,usage,quota,balance,credits,subscription}` **全部 404**，只有 `/provider/v1/models` 是 200。所以用量做成模板，存在本插件自己的文件里：

```text
$DSH_HOME/storages/dsh-provider-plus/usage.json
```

```json
{
  "version": 1,
  "usages": {
    "my-gateway": {
      "mode": "http",
      "url": "https://gateway.example.com/api/usage",
      "method": "GET",
      "keyRef": "MY_GATEWAY_KEY",
      "headers": { "Authorization": "Bearer {key}" },
      "body": "",
      "extract": [
        { "label": "已用", "path": "data.used" },
        { "label": "额度", "path": "data.limit" },
        { "label": "百分比", "path": "usage[0].percent" }
      ]
    }
  }
}
```

- **为什么不用 settings.yaml**：这个运行时的 settings 服务只编辑带 `volatile` 标记的配置字段，而模板是持久用户数据，不是运行时旋钮；写进配置段会被 `Plugin entry has no volatile fields` 拒掉。文件是原子写（临时文件 + rename），按请求读，改完即生效。
- `{key}` 在 URL/头/请求体里都会替换成 `keyRef` 解析到的值。
- `path` 支持 `a.b[0].c`。
- 一条取值可以带 `of`：`{"label":"周已用%","path":"weekly.used","of":"weekly.cap","unit":"%"}` 会输出 `used/cap*100` 的百分比；`unit` 取 `%` / `$` 决定这行怎么显示（不带 `unit` 的旧模板仍按标签里的 `%` 判断）。
- 取到的值是数组时，这一行显示数组长度（`{"label":"可用模型数","path":"data"}` → `2`）。
- `facts` 是**不依赖接口返回**的固定行：`{"label":"默认限速","value":5,"unit":"req/s","note":"官方文档"}`。接口 200、4xx、超时都会照样带上它们，所以官方只公布在文档里的限速/单价也能显示出来。页面上有「官方文档固定值」编辑区。
- 页面上的「保存并测试」会立刻打一次并把原始报错显示出来。
- **CommandCode GOAT**：`/provider/v1/*` 全部 404，但 `/alpha/billing/credits` 可用（2026-10-24 实测）：返回 `windowLimits.fiveHour|weekly {used, cap}` 与 `credits.monthlyCredits`。内置预设「CommandCode GOAT」已经按 5 小时%、周%、月额度剩余（$）配好，模板里用 `of` 把 used/cap 换算成百分比。
- **Deploy 限额**：Deploy 有数据面（`https://api-cdn.deploy.com/api/v1`，需 `Authorization: Bearer <key>`），但**没有** API Key 能读的账户额度接口。2026-11-05 实测：`/models` 200；`/chat/completions` 200 且在响应体里给 `usage.prompt_tokens/completion_tokens/total_tokens`，但**响应头没有任何 `x-ratelimit-*`**；`/usage`、`/billing/usage` 等只有 POST 且一律 `400 {"status_code":400,"message":"Invalid payload"}`（`/zzz/qqq` 这种假路由是 `Bad Request`，所以这几条路由确实存在，只是要门户会话）；`/limits`、`/quota`、`/credits`、`/balance`、`/rate-limits` 全部 404。剩余的额度/已用量在门户站点（cookie 鉴权），API Key 拿不到。所以内置预设「Deploy 限额」把官方文档里的固定值放进 `facts`（默认 5 请求/秒；`429` = 超限、`405` = 组织欠费暂停；DeepSeek-V4.1-Flash-1017 单价 输入 $0.10 / 输出 $0.35 / 缓存读 $0.003 每 100 万 token），实时那一行只打 `/models` 证明 key 与地址可用。
- 你给的那个页面 `https://deploy.com/models/deepseek-ai/deepseek-v4.1-flash-1017/rate-limits` 是**登录后**才渲染的说明页（未登录会跳回 Playground），内容就是上面的 5 请求/秒与 429/405，没有账户用量数据。

实测：把模板指向 `https://api.commandcode.ai/provider/v1/models`、取 `data[0].id` 与 `data.length`，返回 `claude-sonnet-5-5` 与 `94` —— 请求、鉴权、点路径、持久化、删除清理都走通了。

## 实测记录（2026-10-20）

| 项 | 结果 |
|---|---|
| `GET https://api.commandcode.ai/provider/v1/models` | `200`，95 个模型，字段 `id / name / context_length / supported_endpoints` |
| `deepseek/deepseek-v4.1-flash` | 在列表里，`context_length: 1000000`，**没有任何模态字段** |
| `deepseek/deepseek-v4-flash-vision-exp` | 单独一条，说明视觉是另一个 id，不能靠名字猜 |
| `/provider/v1/usage` 等 7 条路径 | 全 `404` |
| OpenCode Go | 必须带 `x-opencode-session`，否则 400 `MissingSessionID` |

因为没有模态字段，「图片」只能由人显式勾：内置预设把 `deepseek-v4.1-flash` 勾上了（网关接受 image part 的话就能用；不接受会在请求阶段报错，而不是静默降级）。

## 边界

1. **不写协议代码**。所有请求仍由官方 `@deepseek-ai/dsh-llm-pi-ai` 发出，图片/工具/重试/replay 的行为与官方一致。
2. **不改内置页**。两个 Slot 都是追加：`settings.section`（新页面）和 `settings.models.provider-card`（卡片下方的小条）。卸载本插件，内置页恢复原样。
3. **provider 删除**走 `settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', '<id>'] }])`：`update` + `null` 会被配置校验拒掉（“resolves no models”），只有路径 unset 才能把键删掉。删完再按**实际效果**复查一次 —— 组合层（`cordis.patch.yml`）声明的 provider 删不掉，会返回 409 并说明原因。删除成功时同时释放它独占的**凭据引用**（`credentials.unset`，只删插件托管的那份，环境变量回退仍然有效）；若另一个 provider 还引用同一个名字，则保留。
4. **请求头是静态的**。`{uuid}` 在保存时展开，所以同一 provider 的所有会话共用一个 session id。OpenCode Go 官方建议按会话区分；要做到逐请求变化，得像 `dsh-opencode-go-plus` 那样自带适配器，不在本插件范围内。
5. **不猜模型清单**：手写路由的 `models` 必须非空，和 pi-ai 对手写路由的要求一致；`pi-ai` 内置目录路由则允许留空（= 用目录全部模型），此时 `api`/`baseURL` 也不能写，否则会被降级成手写路由。工作台在保存空模型表时会先向端点要一次列表并整份写入，所以不用手动凑一条。**目录路由的保存不再回传 `api`/`baseURL`**（界面显示「沿用内置目录」），服务端也会忽略这两个字段，避免把 OpenAI OAuth、Copilot、Anthropic 这类内置 provider 改成手写路由。
6. **新版字段按运行时能力显示**。dsh `0.2.2` 给 `llm-pi-ai` 的路由加了 `maxRequestImages` / `imageOffloadCountQuantum`，内置「模型」页不提供这两个输入，本插件补上（「密钥与请求头」下方）。显示与否不靠版本号猜，而是读 `settings.describe()` 返回的 `llm-pi-ai` 真实 schema：字段在 schema 里才显示、才写入；旧运行时隐藏，即使硬提交也会被宿主拒写并回一条「当前 dsh 的 llm-pi-ai 不支持…」。所以同一份代码在新旧运行时上都不会写出对方读不懂的值，也不会覆盖别人已有的其它路由选项。
7. **写接口只接受同源 JSON**：`/provider`、`/models`、`/discover`、`/probe`、`/usage` 除了 loopback 来源，还要求 `Origin` 为空（非浏览器调用）或与本机同源，且 POST 必须是 `application/json`。这是防 CSRF 的两道闸：任意网页都能访问 127.0.0.1，但伪造不了 `Origin`，也发不出免预检的 JSON 请求。
8. **端点白名单**：`/discover`、`/probe` 与用量查询会拒绝云元数据/链路本地地址（`169.254.0.0/16`、`100.100.100.200`、`metadata.google.internal` 等），本机回环网关（LM Studio、Ollama）仍然可用。

## 自检

```bash
npm run check   # node scripts/smoke.mjs
```

覆盖：state 汇总 / 非 loopback 拒绝 / provider 写入（含 `{uuid}` 展开）/ 内联 API Key 写入凭据存储且不进配置 / 缺引用名时拒绝 / 模型发现归一化与视觉预勾 / 连通性探测 / 用量模板取值 / used+cap 换算成百分比并保留单位 / 数组取值输出长度 / `facts` 固定行随成功与失败结果一起返回 / 仅门户可用路由的 400 会自我解释 / 用量配置持久化 / 删除 / 非法输入 / 跨源写入拒绝 / 非 JSON 写入拒绝 / 目录路由不回写协议与端点 / 删除释放凭据（共享引用保留）/ 400·413·404 语义 / 非法用量模板拒绝 / 元数据端点拒绝 / client 半真的注册了两个 Slot / 新版图片上限字段在新运行时写入、旧运行时拒写并提示。

## 版本适配记录

| dsh 版本 | 结果 |
|---|---|
| `0.2.2-rc.1` | 六条路由全通过；`routeFields` 认出 24 个路由字段（含 `maxRequestImages`、`imageOffloadCountQuantum`）；真实浏览器里两个输入显示为已保存值，改 40→25 后写回 `cordis.patch.yml` |
| `0.2.1-rc.5` | 装好的桌面运行时上 smoke 通过 |
| `0.2.1-rc.2` | `routeFields` 22 个字段、无图片上限；UI 隐藏这两个输入，硬提交返回不支持提示且不落盘 |
