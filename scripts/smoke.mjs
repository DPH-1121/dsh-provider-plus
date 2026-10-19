/**
 * Smoke test for dsh-provider-plus.
 *
 * Runs both halves the way the harness does, without a harness:
 *  - the host half against a fake Cordis context, a fake settings service and a
 *    local HTTP server standing in for a gateway;
 *  - the client half through a fake `window.__ModuleLoader__` and a stub React,
 *    then asserts the two slot registrations it makes.
 *
 * Run: node scripts/smoke.mjs
 */

import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

/* ------------------------------------------------------------------ fixtures */

function deepMerge(target, patch) {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])) {
      next[key] = deepMerge(next[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

function makeHarness(initial, composition = {}, directory = []) {
  const store = { ...initial }
  const routes = new Map()
  const accesses = []
  const settings = {
    get: (ns) => store[ns],
    update: async (ns, patch) => {
      accesses.push({ ns, patch })
      store[ns] = deepMerge(store[ns] ?? {}, patch)
    },
    installSection: () => {},
  }
  const credentials = {
    resolve: async (ref) => (ref === 'DEMO_KEY' ? 'sk-demo' : undefined),
    describe: async () => ({ configured: true }),
  }
  const configEditor = {
    entries: () => [{ id: 'include:llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', patchId: 'llm-pi-ai' }],
    configuration: () => [
      {
        entry: { id: 'include:llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', patchId: 'llm-pi-ai' },
        inherited: { providers: composition },
        override: store['llm-pi-ai'] ?? {},
      },
    ],
  }
  const llm = {
    listConfigurableProviders: () => directory,
  }
  const webServer = {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  }
  const ctx = {
    inject: (services, callback) => {
      callback({ settings, webServer, effect: (fn) => fn() })
      void services
    },
    get: (name) => {
      if (name === 'credentials') return credentials
      if (name === 'configEditor') return configEditor
      if (name === 'llm') return llm
      return undefined
    },
    logger: { warn() {}, error() {} },
  }
  return { ctx, routes, store, accesses, configEditor, llm }
}

function fakeReq({ method = 'GET', url = '/', body, address = '127.0.0.1' }) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() {
      if (text.length > 0) yield Buffer.from(text, 'utf8')
    },
  }
}

function fakeRes() {
  return {
    status: 0,
    headers: {},
    text: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(text) {
      this.text = text ?? ''
    },
    json() {
      return JSON.parse(this.text)
    },
  }
}

async function callRoute(routes, path, init) {
  const route = routes.get(`/plugins/dsh-provider-plus${path.split('?')[0]}`)
  assert.ok(route, `route ${path} registered`)
  const res = fakeRes()
  await route.handler(fakeReq({ method: init?.method ?? 'GET', url: init?.url ?? path, body: init?.body, address: init?.address }), res)
  return res
}

/* ------------------------------------------------------------------ gateway  */

const gateway = http.createServer((req, res) => {
  if (req.url === '/v1/models' || req.url === '/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        data: [
          { id: 'vendor/vision-1', name: 'Vision One', context_length: 128000 },
          { id: 'vendor/plain-1', name: 'Plain One', context_length: 32000 },
        ],
      }),
    )
    return
  }
  if (req.url === '/usage' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: { used: 42, limit: 100, windows: [{ percent: 42 }] } }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))
const gatewayURL = `http://127.0.0.1:${gateway.address().port}`

/* ------------------------------------------------------------------ host     */

const { ctx, routes, store } = makeHarness(
  { 'dsh-provider-plus': { usage: {} } },
  {
    commandcode: {
      displayName: 'CommandCode',
      api: 'openai-completions',
      baseURL: 'https://api.commandcode.ai/provider/v1',
      apiKeyEnv: 'DEMO_KEY',
      models: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1000000, input: ['text', 'image'] }],
    },
  },
  [
    { provider: 'commandcode', displayName: 'CommandCode', declared: true },
    { provider: 'opencode-go', displayName: 'OpenCode Go', declared: false, defaultBaseURL: 'https://opencode.ai/zen/go/v1' },
  ],
)

apply(ctx)
assert.equal(routes.size, 6, 'six routes registered')

const state = await callRoute(routes, '/state')
assert.equal(state.status, 200)
const stateBody = state.json()
assert.equal(stateBody.ok, true)
assert.equal(stateBody.providers.length, 1)
assert.equal(stateBody.providers[0].keyConfigured, true)
assert.equal(stateBody.providers[0].imageModels, 1)
assert.equal(stateBody.providers[0].origin, 'composition')
assert.equal(stateBody.providers[0].deletable, false)
console.log('ok  state merges the composition layer and marks it non-deletable')

/* loopback guard */
const denied = await callRoute(routes, '/state', { address: '10.0.0.8' })
assert.equal(denied.status, 403)
console.log('ok  non-loopback callers are rejected')

/* create a provider with an image model and a {uuid} header */
const created = await callRoute(routes, '/provider', {
  method: 'POST',
  body: {
    provider: 'demo-gw',
    displayName: 'Demo Gateway',
    api: 'openai-completions',
    baseURL: gatewayURL,
    apiKeyEnv: 'DEMO_KEY',
    headers: { 'x-opencode-session': '{uuid}' },
    models: [{ id: 'vendor/vision-1', name: 'Vision One', contextWindow: 128000, input: ['text', 'image'] }],
  },
})
assert.equal(created.status, 200)
const createdBody = created.json()
const demo = createdBody.providers.find((entry) => entry.provider === 'demo-gw')
assert.ok(demo, 'new provider appears in state')
assert.deepEqual(demo.models[0].input, ['text', 'image'])
assert.match(demo.headers['x-opencode-session'], /^[0-9a-f-]{36}$/i, '{uuid} expanded at save time')
console.log('ok  provider upsert writes models + expanded headers')

/* discovery over a real socket */
const discovered = await callRoute(routes, '/discover', {
  method: 'POST',
  body: { provider: 'demo-gw' },
})
const discoverBody = discovered.json()
assert.equal(discoverBody.ok, true)
assert.equal(discoverBody.models.length, 2)
assert.deepEqual(discoverBody.models[0].suggestedInput, ['text', 'image'])
assert.deepEqual(discoverBody.models[1].suggestedInput, ['text'])
console.log('ok  discovery normalizes data[] and hints vision ids')

/* connectivity probe */
const probed = await callRoute(routes, '/probe', { method: 'POST', body: { provider: 'demo-gw' } })
const probeBody = probed.json()
assert.equal(probeBody.ok, true)
assert.equal(probeBody.status, 200)
assert.equal(probeBody.modelCount, 2)
console.log('ok  probe reports status, latency and model count')

/* usage template */
const usageSaved = await callRoute(routes, '/usage', {
  method: 'POST',
  body: {
    provider: 'demo-gw',
    run: true,
    mode: 'http',
    url: `${gatewayURL}/usage`,
    method: 'GET',
    keyRef: 'DEMO_KEY',
    headers: { authorization: 'Bearer {key}' },
    extract: [
      { label: '已用', path: 'data.used' },
      { label: '额度', path: 'data.limit' },
      { label: '百分比', path: 'data.windows[0].percent' },
    ],
  },
})
const usageBody = usageSaved.json()
assert.equal(usageBody.ok, true)
assert.deepEqual(
  usageBody.rows.map((row) => [row.label, row.value]),
  [
    ['已用', 42],
    ['额度', 100],
    ['百分比', 42],
  ],
)
console.log('ok  usage template expands {key}, reads dot/bracket paths')

/* usage config persisted in this plugin's own namespace */
const savedState = (await callRoute(routes, '/state')).json()
assert.equal(savedState.providers.find((entry) => entry.provider === 'demo-gw').usage.mode, 'http')
assert.ok(savedState.providers.find((entry) => entry.provider === 'demo-gw').usage.url.startsWith(gatewayURL))
console.log('ok  usage template persisted in the plugin namespace')

/* delete */
const deleted = await callRoute(routes, '/provider?provider=demo-gw', { method: 'DELETE', url: '/provider?provider=demo-gw' })
assert.equal(deleted.status, 200)
assert.equal(deleted.json().providers.some((entry) => entry.provider === 'demo-gw'), false)
console.log('ok  delete removes the provider from state')

/* a composition provider can be overridden, never deleted from settings */
const overridden = await callRoute(routes, '/provider', {
  method: 'POST',
  body: {
    provider: 'commandcode',
    displayName: 'CommandCode',
    api: 'openai-completions',
    baseURL: 'https://api.commandcode.ai/provider/v1',
    apiKeyEnv: 'DEMO_KEY',
    models: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1000000, input: ['text', 'image'] }],
  },
})
const cc = overridden.json().providers.find((entry) => entry.provider === 'commandcode')
assert.equal(cc.origin, 'composition')
assert.equal(cc.deletable, false)
const refused = await callRoute(routes, '/provider?provider=commandcode', { method: 'DELETE', url: '/provider?provider=commandcode' })
assert.equal(refused.status, 409)
console.log('ok  composition providers are overridable but not deletable')

/* a catalog route accepts an empty endpoint and empty model list */
const catalogSave = await callRoute(routes, '/provider', {
  method: 'POST',
  body: { provider: 'opencode-go', displayName: 'OpenCode Go', api: '', baseURL: '', apiKeyEnv: 'DEMO_KEY', headers: {}, models: [] },
})
assert.equal(catalogSave.status, 200)
const catalogRow = catalogSave.json().providers.find((entry) => entry.provider === 'opencode-go')
assert.equal(catalogRow.declaredByCatalog, true)
assert.equal(catalogRow.baseURL, 'https://opencode.ai/zen/go/v1')
const catalogOverride = store['llm-pi-ai'].providers['opencode-go']
assert.equal(catalogOverride.api, undefined)
assert.equal(catalogOverride.baseURL, undefined)
assert.equal(catalogOverride.models, undefined)
console.log('ok  catalog routes keep the catalog endpoint instead of copying it into settings')

/* invalid input */
const bad = await callRoute(routes, '/provider', { method: 'POST', body: { provider: 'Bad Name', baseURL: 'https://x', models: [] } })
assert.equal(bad.status, 400)
console.log('ok  invalid provider ids are refused')

/* ------------------------------------------------------------------ client   */

const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8')
let loaded
const fakeWindow = {
  __ModuleLoader__: {
    load: (definition) => {
      loaded = definition
    },
  },
}
const fn = new Function('window', 'console', `${clientSource}\n`)
fn(fakeWindow, { error() {}, log() {} })
assert.ok(loaded, 'client bundle registered with the module loader')
assert.equal(loaded.id, 'dsh-provider-plus')

const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  Fragment: 'fragment',
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  memo: (fn) => fn,
}
const registrations = []
const fakeClientCtx = {
  slots: {
    inject: (name, callback) => callback(),
    register: (definition) => registrations.push(definition),
  },
}
const plugin = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.equal(plugin.name, 'dsh-provider-plus')
assert.deepEqual(plugin.inject, ['slots'])
plugin.apply(fakeClientCtx)
assert.deepEqual(
  registrations.map((entry) => [entry.name, entry.id ?? entry.key]),
  [
    ['settings.section', 'provider-plus'],
    ['settings.models.provider-card', 'llm-pi-ai'],
  ],
)
console.log('ok  client registers the workbench page and the provider-card strip')

gateway.close()
console.log('\nall smoke checks passed')
