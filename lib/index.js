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
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-provider-plus'

/**
 * This plugin's own settings namespace: the Loader entry id from this bundle's
 * `cordis.patch.yml`. The settings service addresses sections by entry id, not
 * by package name, so `provider-plus` — not `dsh-provider-plus` — is what opens
 * this plugin's own section.
 */
const NS = 'provider-plus'
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
  interval: z.natural().max(1440).default(0),
  extract: z
    .array(
      z.object({
        label: z.string().default(''),
        path: z.string().default(''),
        // Optional second path: the row becomes `path / of` as a percentage,
        // which is how a gateway that reports used+cap (rather than a percent)
        // still lands on the same bar.
        of: z.string().default(''),
        unit: z.string().default(''),
      }),
    )
    .default([]),
})

/**
 * Where usage templates live.
 *
 * They are this package's own data, not a Config field: the settings service on
 * this runtime only edits *volatile* config fields, and a template is durable
 * user data rather than a runtime knob. So the store is a small JSON file under
 * the harness home, written atomically (temp file + rename) and read per
 * request, which is the same "no restart" behaviour the rest of this page has.
 */
function usageStorePath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-provider-plus', 'usage.json')
}

async function readUsageStore() {
  try {
    const raw = await readFile(usageStorePath(), 'utf8')
    const parsed = JSON.parse(raw)
    const usages = parsed?.usages
    return usages && typeof usages === 'object' && !Array.isArray(usages) ? usages : {}
  } catch {
    return {}
  }
}

async function writeUsageStore(usages) {
  const file = usageStorePath()
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: 1, usages }, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return usages
}

/** Last successful/failed usage query per provider, so the panel can show it later. */
function usageResultsPath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-provider-plus', 'usage-results.json')
}

async function readUsageResults() {
  try {
    const raw = await readFile(usageResultsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    const results = parsed?.results
    return results && typeof results === 'object' && !Array.isArray(results) ? results : {}
  } catch {
    return {}
  }
}

async function writeUsageResults(results) {
  const file = usageResultsPath()
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: 1, results }, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return results
}

/** Drop one provider's template from the file store; absent files are not an error. */
async function forgetUsage(provider) {
  const usages = { ...(await readUsageStore()) }
  delete usages[provider]
  try {
    await writeUsageStore(usages)
  } catch {
    /* A missing template is already the desired state. */
  }
  try {
    const results = await readUsageResults()
    if (results[provider] !== undefined) {
      delete results[provider]
      await writeUsageResults(results)
    }
  } catch {
    /* A stale cached result is harmless. */
  }
}

/** Coerce one posted template through the schema, so defaults are applied once. */
function normalizeUsageConfig(value) {
  try {
    return UsageEntry(value ?? {})
  } catch {
    return value
  }
}

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
 * The effective `llm-pi-ai` provider map, plus where each provider came from.
 *
 * `settings.get('llm-pi-ai')` returns the merged layer (composition + user), so
 * it is the authoritative view of what the runtime will serve. What it cannot
 * say is *which* layer declared a provider, and that matters for deletion: a
 * route declared by a bundle patch or the profile's own `cordis.patch.yml` is
 * not the user's to delete from the settings layer. `configEditor` answers that
 * second question, best-effort; when it is absent every provider is treated as
 * user-owned.
 */
function layeredPiAi(ctx, settings) {
  const providers = {}
  const origins = {}
  let merged = false
  try {
    const editor = ctx.get('configEditor')
    const rows = typeof editor?.configuration === 'function' ? editor.configuration() ?? [] : []
    const row = rows.find(
      (candidate) =>
        candidate?.entry?.name === '@deepseek-ai/dsh-llm-pi-ai' ||
        candidate?.entry?.patchId === 'llm-pi-ai' ||
        candidate?.entry?.id === 'include:llm-pi-ai',
    )
    if (row !== undefined) {
      merged = true
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
          providers[provider] = { ...(providers[provider] ?? {}), ...profile }
          origins[provider] ??= 'settings'
        }
      }
    }
  } catch {
    /* fall through to the settings-only view */
  }
  if (!merged) {
    try {
      const declared = settings?.get?.(PI_AI)?.providers
      if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
        for (const [provider, profile] of Object.entries(declared)) {
          if (!profile || typeof profile !== 'object') continue
          providers[provider] = { ...profile }
          origins[provider] = 'settings'
        }
      }
    } catch {
      /* empty view */
    }
  }
  return { providers, origins }
}

/** Provider map only, for the routes that just need the effective profile. */
function piAiProviders(ctx, settings) {
  return layeredPiAi(ctx, settings).providers
}

/**
 * The adapter's declared provider directory: which routes pi-ai ships itself
 * (`declared: false`, a catalog route where `api`/`baseURL`/`models` come from
 * the installed catalog) versus which are hand-declared (`declared: true`).
 * Writing `api`/`baseURL` onto a catalog route is what silently turns it into a
 * custom provider — the exact mistake that drops OpenCode Go's native
 * `x-opencode-session` header — so the editor must not do it.
 */
function providerDirectory(ctx) {
  try {
    const llm = ctx.get('llm')
    const entries = typeof llm?.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() : []
    return Array.isArray(entries)
      ? entries.map((entry) => ({
          provider: asString(entry?.provider),
          displayName: asString(entry?.displayName, asString(entry?.provider)),
          settingsNs: asString(entry?.settingsNs),
          declared: entry?.declared === true,
          ...(typeof entry?.defaultBaseURL === 'string' ? { defaultBaseURL: entry.defaultBaseURL } : {}),
          ...(entry?.nativeAuth ? { nativeAuth: true } : {}),
        }))
      : []
  } catch {
    return []
  }
}

/** One provider's directory entry, when the adapter knows it. */
function directoryEntry(ctx, provider) {
  return providerDirectory(ctx).find((entry) => entry.provider === provider)
}

/** Every stored template, keyed by provider route. */
async function ownUsage() {
  return readUsageStore()
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

/** Read `a.b[0].c` out of a JSON value; `[key=value]` picks the first match. */
function readPath(value, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  const normalized = path.replace(/\[([^\]]*)\]/g, (_, inner) => {
    const trimmed = inner.trim()
    if (/^\d+$/.test(trimmed)) return `.${trimmed}`
    const equals = trimmed.indexOf('=')
    if (equals > 0) return `.\u0000${trimmed.slice(0, equals).trim()}=${trimmed.slice(equals + 1).trim()}`
    return `[${inner}]`
  })
  let current = value
  for (const segment of normalized.split('.').filter((item) => item.length > 0)) {
    if (current === null || current === undefined) return undefined
    if (segment.startsWith('\u0000')) {
      const [key, ...rest] = segment.slice(1).split('=')
      if (!Array.isArray(current)) return undefined
      const expected = rest.join('=')
      current = current.find((item) => item !== null && item !== undefined && String(item[key]) === expected)
      continue
    }
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
  const usage = await ownUsage()
  const results = await readUsageResults()
  const catalog = providerDirectory(ctx)
  const rows = []
  for (const [provider, profile] of Object.entries(providers)) {
    if (!profile || typeof profile !== 'object') continue
    const normalized = normalizeProfile(provider, profile)
    const entry = catalog.find((candidate) => candidate.provider === provider)
    const credential = await credentialState(ctx, normalized.apiKeyEnv)
    rows.push({
      ...normalized,
      raw: undefined,
      baseURL: normalized.baseURL.length > 0 ? normalized.baseURL : (entry?.defaultBaseURL ?? ''),
      declaredByCatalog: entry !== undefined && entry.declared === false,
      origin: origins[provider] ?? 'settings',
      editable: true,
      deletable: origins[provider] === 'settings',
      keyConfigured: credential.configured,
      keyReason: credential.reason,
      imageModels: normalized.models.filter((model) => model.input.includes('image')).length,
      usage: usage[provider] ?? { mode: 'none' },
      usageResult: results[provider] ?? null,
    })
  }
  rows.sort((left, right) => left.provider.localeCompare(right.provider))
  return {
    ok: true,
    writable: settings !== undefined && typeof settings.update === 'function',
    providers: rows,
    presets: PRESETS,
    catalog,
    revision: Date.now(),
  }
}

/** Merge one provider profile into the `llm-pi-ai` user layer. */
async function writeProvider(settings, provider, profile) {
  await settings.update(PI_AI, { providers: { [provider]: profile } })
}

/**
 * Replace only the model list of an existing profile.
 *
 * Deliberately writes just `{ models }`: the settings service merges nested
 * objects, so a partial patch keeps the composition's `api`/`baseURL` intact.
 * Restating the whole profile here would copy a catalog route's endpoint into
 * the user layer and turn it into a hand-declared one.
 */
async function writeModels(ctx, settings, provider, models) {
  const current = piAiProviders(ctx, settings)[provider]
  if (!current || typeof current !== 'object') throw new Error(`provider "${provider}" 不存在`)
  await settings.update(PI_AI, { providers: { [provider]: { models } } })
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
    const rows = (Array.isArray(config.extract) ? config.extract : []).map((entry) => {
      const label = asString(entry.label)
      const unit = asString(entry.unit)
      const raw = readPath(parsed, asString(entry.path))
      const of = asString(entry.of)
      let value = raw
      if (of.length > 0) {
        // `of` turns two raw numbers into the one number the bar can draw.
        const cap = Number(readPath(parsed, of))
        const used = Number(raw)
        value = Number.isFinite(used) && Number.isFinite(cap) && cap > 0 ? Math.round((used / cap) * 1000) / 10 : undefined
      } else if (typeof raw === 'number' && Number.isFinite(raw)) {
        value = Math.round(raw * 100) / 100
      }
      return { label, value, ...(unit.length > 0 ? { unit } : {}) }
    })
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

/** Refresh providers whose auto-query interval has elapsed; one pass, no overlap. */
async function refreshDueUsage(ctx) {
  const configs = await ownUsage()
  const results = await readUsageResults()
  const now = Date.now()
  let changed = false
  for (const [provider, config] of Object.entries(configs)) {
    const interval = Number(config?.interval) || 0
    if (config?.mode !== 'http' || interval <= 0) continue
    const last = results[provider]?.at ? Date.parse(results[provider].at) : 0
    if (Number.isFinite(last) && last > 0 && now - last < interval * 60_000) continue
    const outcome = await runUsageQuery(ctx, provider, config)
    results[provider] = {
      at: new Date().toISOString(),
      ok: outcome.ok === true,
      rows: outcome.rows ?? null,
      message: outcome.message ?? '',
      status: outcome.status ?? null,
    }
    changed = true
  }
  if (changed) {
    try {
      await writeUsageResults(results)
    } catch {
      /* The next pass retries. */
    }
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
          try {
            // `update` validates the merged config, and a provider left with no
            // models is rejected before it could disappear — so removal has to be
            // a path unset (`mutate`), which deletes the key instead of nulling it.
            if (typeof settings.mutate === 'function') {
              await settings.mutate(PI_AI, [{ op: 'unset', path: ['providers', provider] }])
            } else {
              await settings.update(PI_AI, { providers: { [provider]: null } })
            }
          } catch (error) {
            return { ok: false, status: 500, body: { ok: false, error: `删除失败：${String(error?.message ?? error)}` } }
          }
          // A settings-layer `null` cannot remove a provider a composition layer
          // declares: the merge just falls back to the patch. Report by effect
          // instead of guessing which layer owned it.
          if (layeredPiAi(ctx, settings).providers[provider] !== undefined) {
            return {
              ok: false,
              status: 409,
              body: {
                ok: false,
                error: `provider "${provider}" 仍然生效：它由组合层（cordis.patch.yml / bundle patch）声明，设置层删不掉。请改对应 patch 行，或把它的 models 改成你实际要的那几个。`,
              },
            }
          }
          await forgetUsage(provider)
          return { ok: true, body: await buildState(ctx, getSettings()) }
        }
        const body = await readJson(req)
        const provider = asString(body.provider).trim()
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(provider)) {
          return { ok: false, status: 400, body: { ok: false, error: 'provider 只能用小写字母、数字和连字符（2–40 字符）。' } }
        }
        const baseURL = asString(body.baseURL).trim()
        if (baseURL.length > 0 && !/^https?:\/\//i.test(baseURL)) {
          return { ok: false, status: 400, body: { ok: false, error: 'baseURL 必须以 http(s):// 开头（留空表示沿用内置目录）。' } }
        }
        const entry = directoryEntry(ctx, provider)
        const catalogRoute = entry !== undefined && entry.declared === false
        const models = parseModels(body.models)
        if (!catalogRoute) {
          if (baseURL.length === 0) {
            return { ok: false, status: 400, body: { ok: false, error: '手写路由必须给 baseURL（pi-ai 的目录里没有这条 provider）。' } }
          }
          if (models.length === 0) {
            return { ok: false, status: 400, body: { ok: false, error: '手写路由至少需要一个模型（手填或先“拉取模型”）。' } }
          }
        }
        const api = asString(body.api).trim()
        // A Key typed in this form is written to the credential store under the
        // reference the provider names — the same place the official page writes
        // it — and never into the provider config itself.
        const apiKey = asString(body.apiKey).trim()
        const keyRef = asString(body.apiKeyEnv).trim()
        if (apiKey.length > 0 && keyRef.length === 0) {
          return {
            ok: false,
            status: 400,
            body: { ok: false, error: '填了 API Key，但没有「凭据引用」名：先填一个名字（例如 OPENCODE_API_KEY），Key 才会存到它名下。' },
          }
        }
        const profile = {
          displayName: asString(body.displayName).trim() || provider,
          // A catalog route must keep the catalog's protocol and endpoint: writing
          // them would replace a provider the adapter ships with a custom one, and
          // that is how OpenCode Go loses its native session header.
          ...(api.length > 0 && ['openai-completions', 'openai-responses', 'anthropic-messages'].includes(api) ? { api } : {}),
          ...(baseURL.length > 0 ? { baseURL } : {}),
          ...(asString(body.apiKeyEnv).trim().length > 0 ? { apiKeyEnv: asString(body.apiKeyEnv).trim() } : {}),
          ...(body.headers && typeof body.headers === 'object' && Object.keys(body.headers).length > 0
            ? { headers: expandHeaders(body.headers) }
            : {}),
          ...(models.length > 0 ? { models } : {}),
        }
        try {
          await writeProvider(settings, provider, profile)
        } catch (error) {
          return { ok: false, status: 500, body: { ok: false, error: `保存失败：${String(error?.message ?? error)}` } }
        }
        if (apiKey.length > 0) {
          const credentials = ctx.get('credentials')
          if (credentials === undefined || typeof credentials.set !== 'function') {
            return { ok: false, status: 503, body: { ok: false, error: 'provider 已保存，但凭据服务不可用，API Key 没有写入。' } }
          }
          try {
            await credentials.set(keyRef, apiKey)
          } catch (error) {
            return {
              ok: false,
              status: 500,
              body: { ok: false, error: `provider 已保存，但 API Key 写入「${keyRef}」失败：${String(error?.message ?? error)}` },
            }
          }
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
        const baseURL = (asString(body.baseURL) || asString(profile.baseURL) || directoryEntry(ctx, provider)?.defaultBaseURL || '').trim()
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
        const baseURL = (asString(body.baseURL) || asString(profile.baseURL) || directoryEntry(ctx, provider)?.defaultBaseURL || '').trim()
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
          const config = (await ownUsage())[provider]
          if (!config) return { ok: true, body: { ok: false, provider, reason: 'not-configured' } }
          return { ok: true, body: await runUsageQuery(ctx, provider, config) }
        }
        const body = await readJson(req)
        const provider = asString(body.provider).trim()
        if (provider.length === 0) return { ok: false, status: 400, body: { ok: false, error: 'provider 不能为空。' } }
        const config = normalizeUsageConfig(body.config && typeof body.config === 'object' ? body.config : body)
        const stored = { ...(await ownUsage()), [provider]: config }
        try {
          await writeUsageStore(stored)
        } catch (error) {
          return { ok: false, status: 500, body: { ok: false, error: `保存用量配置失败：${String(error?.message ?? error)}` } }
        }
        const run = body.run === true ? await runUsageQuery(ctx, provider, config) : undefined
        if (run !== undefined) {
          try {
            const results = await readUsageResults()
            results[provider] = {
              at: new Date().toISOString(),
              ok: run.ok === true,
              rows: run.rows ?? null,
              message: run.message ?? '',
              status: run.status ?? null,
            }
            await writeUsageResults(results)
          } catch {
            /* The fresh result below is still returned; a cache write failure is not fatal. */
          }
        }
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
 *
 * The settings service is needed only to write the *other* plugin's section
 * (`llm-pi-ai`); this package keeps its own usage templates in a file store, so
 * a runtime whose settings API has no section to install still works.
 */
export function apply(ctx) {
  let settings

  ctx.inject(['settings'], (settingsCtx) => {
    settings = settingsCtx.settings
    try {
      // This plugin ships its own page: tell the settings shell not to generate
      // one from a Config schema. Page policy only — no config is stored here.
      if (typeof settings.configure === 'function') {
        settingsCtx.effect(() => settings.configure({ auto: false }, ctx.fiber))
      }
    } catch (error) {
      ctx.logger?.warn?.(`dsh-provider-plus: could not register the settings page policy (${String(error)})`)
    }
  })

  const getSettings = () => settings

  // Auto-query: minute-resolution check, configured per provider in the panel.
  try {
    let running = false
    const timer = setInterval(() => {
      if (running) return
      running = true
      void refreshDueUsage(ctx)
        .catch(() => {})
        .finally(() => {
          running = false
        })
    }, 60_000)
    ctx.effect(() => () => clearInterval(timer))
  } catch (error) {
    ctx.logger?.warn?.(`dsh-provider-plus: usage scheduler unavailable (${String(error)})`)
  }

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
