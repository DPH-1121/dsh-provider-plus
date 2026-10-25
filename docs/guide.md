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
- 页面上的「保存并测试」会立刻打一次并把原始报错显示出来。
- **CommandCode GOAT**：`/provider/v1/*` 全部 404，但 `/alpha/billing/credits` 可用（2026-10-24 实测）：返回 `windowLimits.fiveHour|weekly {used, cap}` 与 `credits.monthlyCredits`。内置预设「CommandCode GOAT」已经按 5 小时%、周%、月额度剩余（$）配好，模板里用 `of` 把 used/cap 换算成百分比。

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
5. **不猜模型清单**：手写路由的 `models` 必须非空，和 pi-ai 对手写路由的要求一致；`pi-ai` 内置目录路由则允许留空（= 用目录全部模型），此时 `api`/`baseURL` 也不能写，否则会被降级成手写路由。工作台在保存空模型表时会先向端点要一次列表并整份写入，所以不用手动凑一条。

## 自检

```bash
npm run check   # node scripts/smoke.mjs
```

覆盖：state 汇总 / 非 loopback 拒绝 / provider 写入（含 `{uuid}` 展开）/ 内联 API Key 写入凭据存储且不进配置 / 缺引用名时拒绝 / 模型发现归一化与视觉预勾 / 连通性探测 / 用量模板取值 / used+cap 换算成百分比并保留单位 / 用量配置持久化 / 删除 / 非法输入 / client 半真的注册了两个 Slot。
