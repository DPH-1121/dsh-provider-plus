# dsh-provider-plus

给 DeepSeek Harness 的「自定义模型提供商」补上它缺的那几件事：

- **图片输入**：内置表单里没有 `input` 字段，模型永远被当成纯文本 —— 图被投影成占位符，输入框还标「不支持」。这里对每个模型给一个「图片」勾，勾上就是 `input: [text, image]`。
- **网关要求的额外请求头**：OpenCode Go 这类网关没有 `x-opencode-session` 就直接 400（`MissingSessionID`）。这里每个 provider 可以写任意请求头，`{uuid}` 在保存时展开成固定 UUID。
- **拉取模型列表**：直接打 `{baseURL}/models`，归一化 `data[]` / `models{}`，并按 id/名字给「看起来支持视觉」的模型预勾图片。
- **连通性测试**：返回状态码、耗时、模型数；401/403 会明说「端点通、凭据被拒」，而不是抛一个看不懂的错。
- **用量 / 余额查询**：可配置的 HTTP 模板（URL、方法、请求头、`{key}` 占位、点路径取值），因为订阅网关的额度通常不在数据面。

它**不改协议、不接管内置页面**：写的就是 `llm-pi-ai.providers` 那一段，内置的 设置 → 模型 照旧可用；只是多了一个工作台（设置 → 提供商增强），以及每张内置提供商卡片下面的一条「图片/连通」小条。

- 适配 dsh 运行时：`0.2.1-rc.2`（保留 `0.1.6` 起的范围）
- 形态：bundle（`cordis.patch.yml` 一行）+ host 半（`lib/index.js`，loopback HTTP 路由）+ client 半（`lib/client.js`，两个 Slot）
- 许可：MIT

---

## 安装

```bash
dsh plugin --profile desktop add github:DPH-1121/dsh-provider-plus
# 重启该 profile
```

装好之后：**设置 → 提供商增强**。已有的 provider 会自动出现在列表里（读的是 `llm-pi-ai` 段，不是另存一份）。

## 三个入口分别干什么

| 位置 | 用途 |
|---|---|
| 设置 → 提供商增强 | 增删改 provider、勾图片、写请求头、拉模型、测连通、配用量模板 |
| 设置 → 模型 → 每张卡片下方 | 一条只读摘要：`N/M 支持图片` + 一键测连通 |
| 设置 → 模型 | 官方原样：填 API Key、启用/停用行、登录 |

API Key 仍然只在官方页填（`$DSH_HOME/.credentials.yaml` 的 `refs:`），本插件只报告「已配置 / 未配置」，不读也不写密钥。

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
- 页面上的「保存并测试」会立刻打一次并把原始报错显示出来。
- CommandCode 当前**没有**可用的额度接口，配了也只会显示原因；这不是插件的问题，是厂商没提供。

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
3. **provider 删除**走 `settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', '<id>'] }])`：`update` + `null` 会被配置校验拒掉（“resolves no models”），只有路径 unset 才能把键删掉。删完再按**实际效果**复查一次 —— 组合层（`cordis.patch.yml`）声明的 provider 删不掉，会返回 409 并说明原因。
4. **请求头是静态的**。`{uuid}` 在保存时展开，所以同一 provider 的所有会话共用一个 session id。OpenCode Go 官方建议按会话区分；要做到逐请求变化，得像 `dsh-opencode-go-plus` 那样自带适配器，不在本插件范围内。
5. **不猜模型清单**：手写路由的 `models` 必须非空，和 pi-ai 对手写路由的要求一致；`pi-ai` 内置目录路由则允许留空（= 用目录全部模型），此时 `api`/`baseURL` 也不能写，否则会被降级成手写路由。

## 自检

```bash
npm run check   # node scripts/smoke.mjs
```

覆盖：state 汇总 / 非 loopback 拒绝 / provider 写入（含 `{uuid}` 展开）/ 模型发现归一化与视觉预勾 / 连通性探测 / 用量模板取值 / 用量配置持久化 / 删除 / 非法输入 / client 半真的注册了两个 Slot。
