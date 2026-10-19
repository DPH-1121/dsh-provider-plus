/**
 * dsh-provider-plus — host half.
 *
 * The shipped `@deepseek-ai/dsh-llm-pi-ai` adapter already knows how to talk to
 * every OpenAI-compatible gateway; what it cannot do is tell a human *why* a
 * hand-written provider profile misbehaves. Two concrete failures motivated this
 * package:
 *
 *  1. `input` defaults to `["text"]`, so a gateway model that does accept images
 *     never receives one: the runtime projects every image to a placeholder and
 *     the composer marks it unsupported. Nothing in the built-in form lets the
 *     user say "this model is vision-capable".
 *  2. Some gateways (OpenCode Go, for one) refuse requests that lack an
 *     `x-opencode-session` header. The built-in form has no header editor, so the
 *     route is unreachable even though its key and URL are correct.
 *
 * So this half stays out of the wire path entirely — no protocol code, no
 * adapter. It reads and writes the same `llm-pi-ai` settings section a
 * hand-edited `settings.yaml` would, and adds the four operations the built-in
 * page lacks:
 *
 *  - provider/model editing with an explicit image-input declaration;
 *  - a discovery call against `{baseURL}/models`, with per-model vision hints;
 *  - a connectivity probe that reports status, latency and the provider's own
 *    error text instead of an opaque failure;
 *  - a configurable usage/balance query, because a subscription gateway's
 *    allowance is not on its data plane (CommandCode answers 404 on every
 *    `/usage`, `/quota` and `/balance` path under `/provider/v1`).
 *
 * Everything is contained: a failed probe, a malformed usage template or a
 * closed settings service degrades to a JSON explanation and never takes down
 * the plugin tree.
 *
 * @module dsh-provider-plus
 */

import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-provider-plus'

/** This plugin's own settings namespace (usage templates live here). */
const NS = 'dsh-provider-plus'
/** The namespace the shipped pi-ai adapter owns. */
const PI_AI = 'llm-pi-ai'
/** Loopback-only HTTP surface. */
const BASE = '/plugins/dsh-provider-plus'
/** Upper bound for one probe or usage call. */
const TIMEOUT_MS = 15000
/** Bodies we are willing to parse (settings patches and usage drafts). */
const MAX_BODY = 512 * 1024

const MODALITY = ['text', 'image']

/** One usage query, per provider. Stored in this plugin's own section. */
const UsageEntry = z.object({
  mode: z.union([z.const('none'), z.const('http')]).default('none'),
  url: z.string().default(''),
  method: z.union([z.const('GET'), z.const('POST')]).default('GET'),
  headers: z.dict(z.string()).default({}),
  keyRef: z.string().default(''),
  body: z.string().default(''),
  extract: z
    .array(
      z.object({
        label: z.string().default(''),
        path: z.string().default(''),
      }),
    )
    .default([]),
})

const Config = z.object({
  usage: z.dict(UsageEntry).default({}),
})

/**
 * Provider presets offered by the add form. They are suggestions only: saving
 * writes a normal `llm-pi-ai` profile, so nothing here is special at runtime.
 */
const PRESETS = [
  {
    id: 'commandcode',
    displayName: 'CommandCode',
    api: 'openai-completions',
    baseURL: 'https://api.commandcode.ai/provider/v1',
    apiKeyEnv: 'COMMANDCODE_API_KEY',
    headers: {},
    note: 'GOAT 订阅网关；模型 id 形如 deepseek/deepseek-v4.1-flash。该网关不提供公开的用量接口。',
    models: [
      {
        id: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash (latest)',
        contextWindow: 1000000,
        input: ['text', 'image'],
      },
    ],
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/zen/go/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
    headers: { 'x-opencode-session': '{uuid}' },
    note: '该网关要求 x-opencode-session 请求头；保存时会把 {uuid} 换成一个固定 UUID。协议与模型清单请按官方文档核对。',
    models: [],
  },
  {
    id: 'custom',
    displayName: '',
    api: 'openai-completions',
    baseURL: '',
    apiKeyEnv: '',
    headers: {},
    note: '任意 OpenAI 兼容 / Anthropic Messages 网关。',
    models: [],
  },
]

/** Vision-looking model ids, used only to pre-tick the discovery list. */
const VISION_HINT =
  /(vision|omni|multimodal|llava|pixtral|(^|[-_/])vl([-_/]|$)|gpt-4o|gpt-4\.1|gpt-5|claude-(3|4|5)|claude-(sonnet|opus|haiku)|gemini|qwen.*vl|glm-4v|internvl)/i

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A loopback-only surface: these routes read account state and write settings. */
function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Read one JSON request body, refusing anything larger than {@link MAX_BODY}. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be a JSON object')
  return value
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeInput(input) {
  if (!Array.isArray(input)) return ['text']
  const kept = input.filter((entry) => MODALITY.includes(entry))
  return kept.length === 0 ? ['text'] : [...new Set(kept)]
}

/** One provider profile, as the Models page and this page both understand it. */
function normalizeProfile(provider, profile) {
  const models = Array.isArray(profile?.models) ? profile.models : []
  return {
    provider,
    displayName: asString(profile?.displayName, provider),
    api: asString(profile?.api, 'openai-completions'),
    baseURL: asString(profile?.baseURL, ''),
    apiKeyEnv: asString(profile?.apiKeyEnv, ''),
    headers: profile?.headers && typeof profile.headers === 'object' ? { ...profile.headers } : {},
    models: models
      .filter((model) => model && typeof model === 'object' && typeof model.id === 'string' && model.id.length > 0)
      .map((model) => ({
        id: model.id,
        name: asString(model.name, model.id),
        contextWindow: Number.isInteger(model.contextWindow) ? model.contextWindow : undefined,
        input: normalizeInput(model.input),
      })),
    raw: profile,
  }
}

/**
 * Every provider the current `llm-pi-ai` layer declares.
 *
 * The composition layer matters: a bundle patch (or the user's own
 * `cordis.patch.yml`) can declare providers that never appear in
 * `settings.get('llm-pi-ai')`. Reading only the settings layer would show an
 * empty workbench on a profile whose providers all come from the patch, and a
 * save would then look like it "created" a duplicate. `configEditor` exposes
 * both layers per entry, so this merges them the way the runtime does: settings
 * override per provider, models replace wholesale inside that provider.
 */
function layeredPiAi(ctx, settings) {
  const providers = {}
  const origins = {}
  let sawEditor = false
  try {
    const editor = ctx.get('configEditor')
    if (editor && typeof editor.configuration === 'function') {
      const rows = editor.configuration() ?? []
      const row = rows.find(
        (candidate) =>
          candidate?.entry?.name === '@deepseek-ai/dsh-llm-pi-ai' ||
          candidate?.entry?.patchId === 'llm-pi-ai' ||
          candidate?.entry?.id === 'include:llm-pi-ai',
      )
      if (row) {
        sawEditor = true
        const inherited = row.inherited?.providers
        const override = row.override?.providers
        if (inherited && typeof inherited === 'object') {
          for (const [provider, profile] of Object.entries(inherited)) {
            if (!profile || typeof profile !== 'object') continue
            providers[provider] = { ...profile }
            origins[provider] = 'composition'
          }
        }
        if (override && typeof override === 'object') {
          for (const [provider, profile] of Object.entries(override)) {
            if (profile === null || profile === undefined) {
              delete providers[provider]
              delete origins[provider]
              continue
            }
            if (typeof profile !== 'object') continue
            providers[provider] = origins[provider] === undefined ? { ...profile } : { ...providers[provider], ...profile }
            origins[provider] = origins[provider] === undefined ? 'settings' : 'settings+composition'
          }
        }
      }
    }
  } catch {
    /* fall through to the settings-only view */
  }
  if (!sawEditor) {
    const section = (() => {
      try {
        return settings?.get?.(PI_AI)
      } catch {
        return undefined
      }
    })()
    const declared = section?.providers
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
      for (const [provider, profile] of Object.entries(declared)) {
        if (!profile || typeof profile !== 'object') continue
        providers[provider] = { ...profile }
        origins[provider] = 'settings'
      }
    }
  }
  return { providers, origins }
}

/** Provider map only, for the routes that just need the effective profile. */
function piAiProviders(ctx, settings) {
  return layeredPiAi(ctx, settings).providers
}

function ownUsage(settings) {
  try {
    const section = settings?.get?.(NS)
    return section?.usage && typeof section.usage === 'object' ? section.usage : {}
  } catch {
    return {}
  }
}

/** Whether a credential reference currently resolves, without ever exposing it. */
async function credentialState(ctx, ref) {
  if (!ref) return { configured: false, reason: 'no-reference' }
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return { configured: false, reason: 'no-credential-service' }
  try {
    const resolved = await credentials.resolve(ref)
    const value = typeof resolved === 'string' ? resolved : resolved?.value
    return { configured: typeof value === 'string' && value.length > 0, reason: undefined }
  } catch (error) {
    return { configured: false, reason: String(error?.message ?? error) }
  }
}

async function resolveKey(ctx, ref) {
  if (!ref) return undefined
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  try {
    const resolved = await credentials.resolve(ref)
    const value = typeof resolved === 'string' ? resolved : resolved?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** Expand `{uuid}` in header values at save time, so the value is stable after. */
function expandHeaders(headers) {
  const result = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof key !== 'string' || key.length === 0) continue
    result[key] = asString(value).replace(/\{uuid\}/gi, randomUUID())
  }
  return result
}

/** Read `a.b[0].c` out of a JSON value. */
function readPath(value, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0)
  let current = value
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

/** Ask one endpoint for its model list; the single network call both routes use. */
async function fetchCatalog({ baseURL, api, apiKey, headers, signal }) {
  const root = asString(baseURL).replace(/\/+$/, '')
  if (root.length === 0) throw new Error('baseURL 为空')
  const url = `${root}/models`
  const requestHeaders = { accept: 'application/json', ...(headers ?? {}) }
  if (typeof apiKey === 'string' && apiKey.length > 0) requestHeaders.authorization = `Bearer ${apiKey}`
  const started = Date.now()
  const response = await fetch(url, { method: 'GET', headers: requestHeaders, signal })
  const elapsed = Date.now() - started
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  return { url, ok: response.ok, status: response.status, elapsed, text, parsed, api }
}

/** Normalize `data[]` / `models{}` listings into one model shape. */
function normalizeListing(parsed) {
  const rows = []
  if (parsed && Array.isArray(parsed.data)) {
    for (const entry of parsed.data) {
      if (!entry || typeof entry !== 'object') continue
      const id = asString(entry.id)
      if (id.length === 0) continue
      rows.push({
        id,
        name: asString(entry.name, id),
        contextWindow: Number.isInteger(entry.context_length)
          ? entry.context_length
          : Number.isInteger(entry.contextWindow)
            ? entry.contextWindow
            : undefined,
      })
    }
  } else if (parsed && parsed.models && typeof parsed.models === 'object' && !Array.isArray(parsed.models)) {
    for (const [key, entry] of Object.entries(parsed.models)) {
      if (!entry || typeof entry !== 'object') continue
      const id = key.length > 0 ? key : asString(entry.id)
      if (id.length === 0) continue
      rows.push({
        id,
        name: asString(entry.name, id),
        contextWindow: Number.isInteger(entry.context_length) ? entry.context_length : undefined,
      })
    }
  }
  return rows
}

/** Build the state document both the page and the card strip render. */
async function buildState(ctx, settings) {
  const { providers, origins } = layeredPiAi(ctx, settings)
  const usage = ownUsage(settings)
  const rows = []
  for (const [provider, profile] of Object.entries(providers)) {
    if (!profile || typeof profile !== 'object') continue
    const normalized = normalizeProfile(provider, profile)
    const credential = await credentialState(ctx, normalized.apiKeyEnv)
    rows.push({
      ...normalized,
      raw: undefined,
      origin: origins[provider] ?? 'settings',
      editable: origins[provider] !== 'composition',
      deletable: origins[provider] === 'settings',
      keyConfigured: credential.configured,
      keyReason: credential.reason,
      imageModels: normalized.models.filter((model) => model.input.includes('image')).length,
      usage: usage[provider] ?? { mode: 'none' },
    })
  }
  rows.sort((left, right) => left.provider.localeCompare(right.provider))
  return {
    ok: true,
    writable: settings !== undefined && typeof settings.update === 'function',
    providers: rows,
    presets: PRESETS,
    revision: Date.now(),
  }
}

/** Merge one provider profile into the `llm-pi-ai` user layer. */
async function writeProvider(settings, provider, profile) {
  await settings.update(PI_AI, { providers: { [provider]: profile } })
}

/** Replace only the model list of an existing profile. */
async function writeModels(ctx, settings, provider, models) {
  const current = piAiProviders(ctx, settings)[provider]
  if (!current || typeof current !== 'object') throw new Error(`provider "${provider}" 不存在`)
  const next = { ...current, models }
  await writeProvider(settings, provider, next)
}

function parseModels(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const models = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const id = asString(entry.id).trim()
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const model = { id, name: asString(entry.name, id).trim() || id, input: normalizeInput(entry.input) }
    const window = Number(entry.contextWindow)
    if (Number.isInteger(window) && window > 0) model.contextWindow = window
    models.push(model)
  }
  return models
}

/** One usage query against a template, with `{key}` expanded from the credential. */
async function runUsageQuery(ctx, provider, config) {
  if (!config || config.mode !== 'http') {
    return { ok: false, provider, reason: 'not-configured', message: '该提供商未配置用量接口。' }
  }
  const key = config.keyRef ? await resolveKey(ctx, config.keyRef) : undefined
  if (config.keyRef && key === undefined) {
    return { ok: false, provider, reason: 'missing-credential', message: `凭据 ${config.keyRef} 未配置，无法查询用量。` }
  }
  const url = asString(config.url).replace(/\{key\}/g, key ?? '')
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, provider, reason: 'bad-url', message: '用量 URL 必须以 http(s):// 开头。' }
  }
  const headers = { accept: 'application/json' }
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (typeof name !== 'string' || name.length === 0) continue
    headers[name] = asString(value).replace(/\{key\}/g, key ?? '')
  }
  const init = { method: config.method === 'POST' ? 'POST' : 'GET', headers }
  if (init.method === 'POST') {
    headers['content-type'] = 'application/json'
    const body = asString(config.body).replace(/\{key\}/g, key ?? '')
    if (body.length > 0) init.body = body
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
    if (!response.ok) {
      return {
        ok: false,
        provider,
        reason: 'http-error',
        status: response.status,
        message: `用量接口返回 ${response.status}：${text.slice(0, 300)}`,
      }
    }
    const rows = (Array.isArray(config.extract) ? config.extract : []).map((entry) => ({
      label: asString(entry.label),
      value: readPath(parsed, asString(entry.path)),
    }))
    return {
      ok: true,
      provider,
      rows: rows.filter((row) => row.label.length > 0),
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      provider,
      reason: 'network',
      message: error?.name === 'AbortError' ? `用量接口超时（${TIMEOUT_MS}ms）。` : String(error?.message ?? error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Register every route; each one is contained by its own try/catch. */
function registerRoutes(ctx, getSettings) {
  const routes = [
    {
      path: '/state',
      methods: ['GET', 'HEAD'],
      handler: async () => buildState(ctx, getSettings()),
    },
    {
      path: '/provider',
      methods: ['POST', 'DELETE'],
      handler: async (req) => {
        const settings = getSettings()
        if (settings === undefined || typeof settings.update !== 'function') {
          return { ok: false, status: 503, body: { ok: false, error: 'settings 服务不可用，无法写入提供商。' } }
        }
        if (req.method === 'DELETE') {
          const url = new URL(req.url, 'http://localhost')
          const provider = asString(url.searchParams.get('provider')).trim()
          if (provider.length === 0) return { ok: false, status: 400, body: { ok: false, error: 'provider 不能为空。' } }
          const origin = layeredPiAi(ctx, settings).origins[provider]
          if (origin === 'composition' || origin === 'settings+composition') {
            return {
              ok: false,
              status: 409,
              body: {
                ok: false,
                error: `provider "${provider}" 由组合层（cordis.patch.yml）声明，设置层删不掉它。请在对应 patch 行里移除，或改写它的 models 把它收起来。`,
              },
            }
          }
          try {
            await settings.update(PI_AI, { providers: { [provider]: null } })
          } catch (error) {
            return { ok: false, status: 500, body: { ok: false, error: `删除失败：${String(error?.message ?? error)}` } }
          }
          try {
            const usage = { ...ownUsage(settings) }
            delete usage[provider]
            await settings.update(NS, { usage })
          } catch {
            /* usage 清理失败不影响删除本身 */
          }
          return { ok: true, body: await buildState(ctx, getSettings()) }
        }
        const body = await readJson(req)
        const provider = asString(body.provider).trim()
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(provider)) {
          return { ok: false, status: 400, body: { ok: false, error: 'provider 只能用小写字母、数字和连字符（2–40 字符）。' } }
        }
        const baseURL = asString(body.baseURL).trim()
        if (!/^https?:\/\//i.test(baseURL)) {
          return { ok: false, status: 400, body: { ok: false, error: 'baseURL 必须以 http(s):// 开头。' } }
        }
        const models = parseModels(body.models)
        if (models.length === 0) {
          return { ok: false, status: 400, body: { ok: false, error: '至少需要一个模型（手填或先“拉取模型”）。' } }
        }
        const profile = {
          displayName: asString(body.displayName).trim() || provider,
          api: ['openai-completions', 'openai-responses', 'anthropic-messages'].includes(body.api)
            ? body.api
            : 'openai-completions',
          baseURL,
          ...(asString(body.apiKeyEnv).trim().length > 0 ? { apiKeyEnv: asString(body.apiKeyEnv).trim() } : {}),
          ...(body.headers && typeof body.headers === 'object' && Object.keys(body.headers).length > 0
            ? { headers: expandHeaders(body.headers) }
            : {}),
          models,
        }
        try {
          await writeProvider(settings, provider, profile)
        } catch (error) {
          return { ok: false, status: 500, body: { ok: false, error: `保存失败：${String(error?.message ?? error)}` } }
        }
        return { ok: true, body: await buildState(ctx, getSettings()) }
      },
    },
    {
      path: '/models',
      methods: ['POST'],
      handler: async (req) => {
        const settings = getSettings()
        if (settings === undefined || typeof settings.update !== 'function') {
          return { ok: false, status: 503, body: { ok: false, error: 'settings 服务不可用。' } }
        }
        const body = await readJson(req)
        const provider = asString(body.provider).trim()
        const models = parseModels(body.models)
        if (provider.length === 0 || models.length === 0) {
          return { ok: false, status: 400, body: { ok: false, error: 'provider 与 models 都必须非空。' } }
        }
        try {
          await writeModels(ctx, settings, provider, models)
        } catch (error) {
          return { ok: false, status: 500, body: { ok: false, error: String(error?.message ?? error) } }
        }
        return { ok: true, body: await buildState(ctx, getSettings()) }
      },
    },
    {
      path: '/discover',
      methods: ['POST'],
      handler: async (req) => {
        const body = await readJson(req)
        const settings = getSettings()
        const provider = asString(body.provider).trim()
        const profile = piAiProviders(ctx, settings)[provider] ?? {}
        const baseURL = asString(body.baseURL, asString(profile.baseURL)).trim()
        const keyRef = asString(body.apiKeyEnv, asString(profile.apiKeyEnv)).trim()
        const apiKey = asString(body.apiKey).trim() || (await resolveKey(ctx, keyRef))
        const headers = body.headers && typeof body.headers === 'object' ? body.headers : profile.headers
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const result = await fetchCatalog({ baseURL, api: profile.api, apiKey, headers, signal: controller.signal })
          const models = normalizeListing(result.parsed)
          return {
            ok: true,
            body: {
              ok: true,
              status: result.status,
              elapsed: result.elapsed,
              models: models.map((model) => ({
                ...model,
                suggestedInput: VISION_HINT.test(model.id) || VISION_HINT.test(model.name) ? ['text', 'image'] : ['text'],
              })),
              ...(models.length === 0 ? { note: '端点没有返回可识别的模型列表（data[] 或 models{}）。' } : {}),
            },
          }
        } catch (error) {
          return {
            ok: true,
            body: {
              ok: false,
              reason: error?.name === 'AbortError' ? 'timeout' : 'network',
              message:
                error?.name === 'AbortError'
                  ? `连接超时（${TIMEOUT_MS}ms）。`
                  : `无法连接：${String(error?.message ?? error)}`,
            },
          }
        } finally {
          clearTimeout(timer)
        }
      },
    },
    {
      path: '/probe',
      methods: ['POST'],
      handler: async (req) => {
        const body = await readJson(req)
        const settings = getSettings()
        const provider = asString(body.provider).trim()
        const profile = piAiProviders(ctx, settings)[provider] ?? {}
        const baseURL = asString(body.baseURL, asString(profile.baseURL)).trim()
        const keyRef = asString(body.apiKeyEnv, asString(profile.apiKeyEnv)).trim()
        const key = await resolveKey(ctx, keyRef)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const result = await fetchCatalog({
            baseURL,
            api: profile.api,
            apiKey: key,
            headers: body.headers && typeof body.headers === 'object' ? body.headers : profile.headers,
            signal: controller.signal,
          })
          const models = normalizeListing(result.parsed)
          const unauthorized = result.status === 401 || result.status === 403
          return {
            ok: true,
            body: {
              ok: result.ok,
              status: result.status,
              elapsed: result.elapsed,
              modelCount: models.length,
              keyConfigured: key !== undefined,
              ...(result.ok
                ? {}
                : {
                    message: unauthorized
                      ? '端点可达，但凭据被拒绝（401/403）。检查 API Key 是否填在当前 provider 的引用下。'
                      : `端点返回 ${result.status}：${(result.text ?? '').slice(0, 240)}`,
                  }),
            },
          }
        } catch (error) {
          return {
            ok: true,
            body: {
              ok: false,
              reason: error?.name === 'AbortError' ? 'timeout' : 'network',
              keyConfigured: key !== undefined,
              message:
                error?.name === 'AbortError'
                  ? `连接超时（${TIMEOUT_MS}ms）。`
                  : `无法连接：${String(error?.message ?? error)}`,
            },
          }
        } finally {
          clearTimeout(timer)
        }
      },
    },
    {
      path: '/usage',
      methods: ['GET', 'POST'],
      handler: async (req) => {
        const settings = getSettings()
        if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          const provider = asString(url.searchParams.get('provider')).trim()
          const config = ownUsage(settings)[provider]
          if (!config) return { ok: true, body: { ok: false, provider, reason: 'not-configured' } }
          return { ok: true, body: await runUsageQuery(ctx, provider, config) }
        }
        const body = await readJson(req)
        const provider = asString(body.provider).trim()
        if (provider.length === 0) return { ok: false, status: 400, body: { ok: false, error: 'provider 不能为空。' } }
        const config = body.config && typeof body.config === 'object' ? body.config : body
        if (typeof settings?.update !== 'function') {
          return { ok: false, status: 503, body: { ok: false, error: 'settings 服务不可用。' } }
        }
        const stored = { ...ownUsage(settings), [provider]: config }
        try {
          await settings.update(NS, { usage: stored })
        } catch (error) {
          return { ok: false, status: 500, body: { ok: false, error: `保存用量配置失败：${String(error?.message ?? error)}` } }
        }
        const run = body.run === true ? await runUsageQuery(ctx, provider, config) : undefined
        return { ok: true, body: run === undefined ? { ok: true, provider } : run }
      },
    },
  ]

  return routes
}

/**
 * Mount the host half. Both services are optional so the package can sit in a
 * composition that has no settings page or no HTTP surface (headless, for one)
 * without failing the tree.
 */
export function apply(ctx) {
  let settings

  ctx.inject(['settings'], (settingsCtx) => {
    settings = settingsCtx.settings
    try {
      settings.installSection(ctx, NS, Config, { usage: {} }, {
        setSource: () => {},
        onChange: () => {},
      })
    } catch (error) {
      /* The workbench reports the missing section; the routes still work. */
      ctx.logger?.warn?.(`dsh-provider-plus: could not register the settings section (${String(error)})`)
    }
  })

  const getSettings = () => settings

  ctx.inject(['webServer'], (webCtx) => {
    let routes
    try {
      routes = registerRoutes(ctx, getSettings)
    } catch (error) {
      ctx.logger?.error?.(`dsh-provider-plus: could not build routes (${String(error)})`)
      return
    }
    for (const route of routes) {
      webCtx.effect(() =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${BASE}${route.path}`,
          handler: async (req, res) => {
            if (!isLoopback(req)) {
              sendJson(res, 403, { ok: false, error: 'request-not-trusted' })
              return
            }
            if (!route.methods.includes(req.method)) {
              sendJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            try {
              const outcome = await route.handler(req)
              sendJson(res, outcome.status ?? 200, outcome.body ?? outcome)
            } catch (error) {
              sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            }
          },
        }),
      )
    }
  })
}
