/**
 * dsh-provider-plus — client half.
 *
 * Two seats, both additive:
 *
 *  1. `settings.section` — the 提供商增强 workbench: create, edit and delete
 *     `llm-pi-ai` provider profiles, declare per-model image input, pull the
 *     gateway's model list, probe connectivity, and configure a usage query.
 *  2. `settings.models.provider-card` — a strip appended to every built-in
 *     Models card (including the add-provider draft card), so the image switch
 *     and the connectivity probe are where the user already is. Nothing in the
 *     shipped page is replaced; if this package disappears the built-in page is
 *     exactly as it was.
 *
 * Reading order matters here: a card shows its own state, edits open *inside*
 * that card, and a probe result sits under the button that produced it — the
 * page never scrolls you somewhere else to answer a click.
 *
 * Every request goes to this plugin's own loopback routes; the client never
 * touches settings files or credentials directly.
 */

window.__ModuleLoader__.load({
  id: 'dsh-provider-plus',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const BASE = '/plugins/dsh-provider-plus'
    const inject = ['slots']

    const API_OPTIONS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    const API_LABEL = {
      'openai-completions': 'OpenAI 兼容 (chat/completions)',
      'openai-responses': 'OpenAI Responses',
      'anthropic-messages': 'Anthropic Messages',
    }

    async function call(path, init) {
      const options = {
        headers: { accept: 'application/json', ...(init && init.body ? { 'content-type': 'application/json' } : {}) },
        ...init,
      }
      const response = await fetch(`${BASE}${path}`, options)
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}：响应不是 JSON`)
      }
      if (!response.ok) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      return body
    }

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 0 18px' },
      head: { display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between' },
      title: { fontSize: '15px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)' },
      hint: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #666)' },
      card: {
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: 'var(--dsw-specific-input-major, transparent)',
      },
      editor: {
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        borderRadius: '10px',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: 'var(--dsw-specific-input-minor, rgba(0,0,0,0.02))',
      },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      headerRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', minWidth: 0 },
      nameShrink: {
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, #111)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: '0 1 auto',
        minWidth: 0,
      },
      actions: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', justifyContent: 'flex-end', flex: '0 0 auto' },
      grow: { flex: '1 1 auto', minWidth: 0 },
      name: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)' },
      mono: { fontFamily: 'var(--dsw-font-markdown-code-block, ui-monospace, monospace)', fontSize: '12px' },
      chip: {
        fontSize: '11px',
        lineHeight: '18px',
        padding: '0 8px',
        borderRadius: '999px',
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        color: 'var(--dsw-alias-label-secondary, #555)',
        whiteSpace: 'nowrap',
      },
      okChip: { color: 'var(--dsw-alias-state-success-primary, #0a7)', borderColor: 'currentColor' },
      badChip: { color: 'var(--dsw-alias-state-error-primary, #c33)', borderColor: 'currentColor' },
      button: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '3px 10px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #111)',
        whiteSpace: 'nowrap',
      },
      primary: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '3px 12px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: 'none',
        background: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
        color: '#fff',
        whiteSpace: 'nowrap',
      },
      danger: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '3px 10px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: '0.5px solid currentColor',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary, #c33)',
        whiteSpace: 'nowrap',
      },
      input: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        padding: '5px 8px',
        borderRadius: '8px',
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        background: 'var(--dsw-alias-bg-base, transparent)',
        color: 'inherit',
        minWidth: 0,
        boxSizing: 'border-box',
      },
      grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
      stack: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
      label: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #666)' },
      table: { display: 'flex', flexDirection: 'column', gap: '6px' },
      th: { display: 'grid', gridTemplateColumns: '1.5fr 1.2fr 86px 52px 34px', gap: '8px', fontSize: '11px' },
      tr: { display: 'grid', gridTemplateColumns: '1.5fr 1.2fr 86px 52px 34px', gap: '8px', alignItems: 'center' },
      note: {
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'pre-wrap',
        color: 'var(--dsw-alias-label-secondary, #555)',
        background: 'var(--dsw-specific-input-minor, rgba(0,0,0,0.03))',
        borderRadius: '8px',
        padding: '8px 10px',
      },
      error: {
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'pre-wrap',
        color: 'var(--dsw-alias-state-error-primary, #c33)',
      },
      ok: {
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'pre-wrap',
        color: 'var(--dsw-alias-state-success-primary, #0a7)',
      },
      divider: { height: '0.5px', background: 'var(--dsw-alias-border-l1, #00000014)' },
      sectionHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      sectionTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #555)' },
      probeWrap: { display: 'flex', justifyContent: 'flex-end', marginTop: '-6px' },
      probeInline: {
        fontSize: '12px',
        lineHeight: '20px',
        maxWidth: '46%',
        textAlign: 'right',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      probe: { fontSize: '12px', lineHeight: '18px', textAlign: 'right', whiteSpace: 'pre-wrap' },
      modelLine: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px' },
    }

    /** One provider profile, as this page edits it. */
    function draftFrom(row) {
      return {
        provider: row.provider,
        displayName: row.displayName,
        api: row.api,
        baseURL: row.baseURL,
        apiKeyEnv: row.apiKeyEnv,
        headersText: Object.entries(row.headers ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
        models: (row.models ?? []).map((model) => ({
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow ?? 0,
          image: (model.input ?? ['text']).includes('image'),
        })),
        advancedOpen: false,
      }
    }

    function draftFromPreset(preset) {
      return {
        provider: preset.id === 'custom' ? '' : preset.id,
        displayName: preset.displayName ?? '',
        api: preset.api ?? 'openai-completions',
        baseURL: preset.baseURL ?? '',
        apiKeyEnv: preset.apiKeyEnv ?? '',
        headersText: Object.entries(preset.headers ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
        models: (preset.models ?? []).map((model) => ({
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow ?? 0,
          image: (model.input ?? []).includes('image'),
        })),
        advancedOpen: false,
      }
    }

    function parseHeaderLines(text) {
      const headers = {}
      for (const line of String(text ?? '').split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const index = trimmed.indexOf(':')
        if (index <= 0) continue
        const name = trimmed.slice(0, index).trim()
        const value = trimmed.slice(index + 1).trim()
        if (name.length > 0) headers[name] = value
      }
      return headers
    }

    function modelsForSave(draft) {
      return draft.models
        .filter((model) => String(model.id ?? '').trim().length > 0)
        .map((model) => {
          const id = String(model.id).trim()
          const entry = { id, name: String(model.name ?? id).trim() || id }
          const window = Number(model.contextWindow)
          if (Number.isInteger(window) && window > 0) entry.contextWindow = window
          entry.input = model.image ? ['text', 'image'] : ['text']
          return entry
        })
    }

    /** One-line probe summary; the full text still reaches the browser as a title. */
    function probeText(body) {
      if (body === null || body === undefined) return ''
      if (body.ok === true) return `连通：HTTP ${body.status} · ${body.elapsed}ms · ${body.modelCount} 个模型`
      const detail = body.message ?? body.reason ?? '连接失败'
      return body.keyConfigured === false ? `${detail}（凭据引用当前为空）` : detail
    }

    function Chip({ text, style }) {
      return h('span', { style: { ...S.chip, ...(style ?? {}) } }, text)
    }

    /** One labelled field: caption above the control, so the grid stays airy. */
    function Field({ label, children, span }) {
      return h(
        'label',
        { style: { ...S.stack, ...(span === true ? { gridColumn: '1 / -1' } : {}) } },
        h('span', { style: S.label }, label),
        children,
      )
    }

    /** Discovery panel: fetch the gateway list, tick vision-looking ids, import. */
    function DiscoveryPanel({ draft, onImport }) {
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [picked, setPicked] = React.useState({})
      const [open, setOpen] = React.useState(false)

      async function run() {
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const body = await call('/discover', {
            method: 'POST',
            body: JSON.stringify({
              provider: draft.provider,
              baseURL: draft.baseURL,
              apiKeyEnv: draft.apiKeyEnv,
              headers: parseHeaderLines(draft.headersText),
            }),
          })
          if (!body.ok) {
            setError(body.message ?? '拉取失败')
          } else {
            setResult(body.models ?? [])
            const next = {}
            for (const model of body.models ?? []) {
              const known = draft.models.some((entry) => entry.id === model.id)
              if (!known) next[model.id] = true
            }
            setPicked(next)
          }
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      function importPicked() {
        if (!result) return
        const chosen = result
          .filter((model) => picked[model.id])
          .map((model) => ({
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow ?? 0,
            image: (model.suggestedInput ?? ['text']).includes('image'),
          }))
        onImport(chosen)
        setResult(null)
        setPicked({})
        setOpen(false)
      }

      return h(
        'div',
        { style: S.stack },
        h(
          'div',
          { style: S.sectionHead },
          h('span', { style: S.sectionTitle }, '从端点拉取'),
          h('button', { style: S.button, onClick: () => (open ? setOpen(false) : setOpen(true)) }, open ? '收起' : '展开'),
          h('div', { style: S.grow }),
          h('button', { style: S.button, onClick: run, disabled: busy }, busy ? '请求中…' : '拉取模型'),
        ),
        open
          ? h(
              React.Fragment,
              null,
              h('div', { style: S.hint }, '用当前 baseURL 与凭据请求 {baseURL}/models，勾选后并入下面的模型表。'),
              error !== null ? h('div', { style: S.error }, error) : null,
              result !== null && result.length === 0 ? h('div', { style: S.note }, '端点没有返回可识别的模型列表。') : null,
              result !== null && result.length > 0
                ? h(
                    'div',
                    { style: S.table },
                    h(
                      'div',
                      { style: S.row },
                      h('span', { style: S.hint }, `端点返回 ${result.length} 个模型`),
                      h('div', { style: S.grow }),
                      h(
                        'button',
                        {
                          style: S.button,
                          onClick: () => {
                            const all = {}
                            for (const model of result) all[model.id] = true
                            setPicked(all)
                          },
                        },
                        '全选',
                      ),
                      h('button', { style: S.primary, onClick: importPicked }, `导入选中（${Object.values(picked).filter(Boolean).length}）`),
                    ),
                    ...result.map((model) =>
                      h(
                        'label',
                        { key: model.id, style: { ...S.tr, cursor: 'pointer' } },
                        h(
                          'span',
                          { style: { ...S.row, gap: '6px' } },
                          h('input', {
                            type: 'checkbox',
                            checked: picked[model.id] === true,
                            onChange: (event) => setPicked({ ...picked, [model.id]: event.target.checked }),
                          }),
                          h('span', { style: S.mono }, model.id),
                        ),
                        h('span', { style: { ...S.hint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, model.name ?? ''),
                        h('span', { style: S.hint }, model.contextWindow ? String(model.contextWindow) : '—'),
                        h('span', { style: S.hint }, (model.suggestedInput ?? []).includes('image') ? '图片' : '文本'),
                        h('span'),
                      ),
                    ),
                  )
                : null,
            )
          : null,
      )
    }

    /** Usage editor: a template plus a live "test now" that reports the raw error. */
    function UsagePanel({ provider, initial }) {
      const [config, setConfig] = React.useState({
        mode: initial && initial.mode ? initial.mode : 'none',
        url: (initial && initial.url) ?? '',
        method: (initial && initial.method) ?? 'GET',
        headersText: Object.entries((initial && initial.headers) ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
        keyRef: (initial && initial.keyRef) ?? '',
        body: (initial && initial.body) ?? '',
        extract: ((initial && initial.extract) ?? []).map((entry) => ({ label: entry.label ?? '', path: entry.path ?? '' })),
      })
      const [busy, setBusy] = React.useState(false)
      const [outcome, setOutcome] = React.useState(null)

      async function save(run) {
        setBusy(true)
        setOutcome(null)
        try {
          const body = await call('/usage', {
            method: 'POST',
            body: JSON.stringify({
              provider,
              run: run === true,
              mode: config.mode,
              url: config.url,
              method: config.method,
              headers: parseHeaderLines(config.headersText),
              keyRef: config.keyRef,
              body: config.body,
              extract: config.extract.filter((entry) => entry.label.length > 0 && entry.path.length > 0),
            }),
          })
          setOutcome(body)
        } catch (err) {
          setOutcome({ ok: false, message: String(err && err.message ? err.message : err) })
        } finally {
          setBusy(false)
        }
      }

      function setExtract(index, key, value) {
        const next = config.extract.map((entry, at) => (at === index ? { ...entry, [key]: value } : entry))
        setConfig({ ...config, extract: next })
      }

      return h(
        'div',
        { style: S.editor },
        h(
          'div',
          { style: S.sectionHead },
          h('span', { style: S.sectionTitle }, '用量 / 余额查询'),
          h('div', { style: S.grow }),
          h(
            'select',
            {
              style: S.input,
              value: config.mode,
              onChange: (event) => setConfig({ ...config, mode: event.target.value }),
            },
            h('option', { value: 'none' }, '未配置'),
            h('option', { value: 'http' }, 'HTTP 模板'),
          ),
        ),
        h('div', { style: S.hint }, '订阅网关的额度通常不在数据面。填一个能返回 JSON 的只读接口，再把要显示的字段用点路径取出来；{key} 会被替换成该凭据。'),
        config.mode === 'http'
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { style: S.grid },
                h(Field, { label: 'URL', span: true }, h('input', { style: S.input, value: config.url, placeholder: 'https://example.com/api/usage', onChange: (event) => setConfig({ ...config, url: event.target.value }) })),
                h(Field, { label: '方法' }, h('select', { style: S.input, value: config.method, onChange: (event) => setConfig({ ...config, method: event.target.value }) }, h('option', { value: 'GET' }, 'GET'), h('option', { value: 'POST' }, 'POST'))),
                h(Field, { label: '凭据引用' }, h('input', { style: S.input, value: config.keyRef, placeholder: 'COMMANDCODE_API_KEY', onChange: (event) => setConfig({ ...config, keyRef: event.target.value }) })),
                h(Field, { label: '请求头（每行 名称: 值）', span: true }, h('textarea', { style: { ...S.input, minHeight: '52px' }, value: config.headersText, placeholder: 'Authorization: Bearer {key}', onChange: (event) => setConfig({ ...config, headersText: event.target.value }) })),
                config.method === 'POST'
                  ? h(Field, { label: '请求体', span: true }, h('textarea', { style: { ...S.input, minHeight: '52px' }, value: config.body, onChange: (event) => setConfig({ ...config, body: event.target.value }) }))
                  : null,
              ),
              h('div', { style: S.sectionHead }, h('span', { style: S.sectionTitle }, '取值字段'), h('span', { style: S.hint }, '显示名 + 点路径，例如 data.used / usage[0].percent')),
              ...config.extract.map((entry, index) =>
                h(
                  'div',
                  { key: index, style: S.row },
                  h('input', { style: { ...S.input, width: '120px' }, value: entry.label, placeholder: '已用', onChange: (event) => setExtract(index, 'label', event.target.value) }),
                  h('input', { style: { ...S.input, ...S.grow }, value: entry.path, placeholder: 'data.used', onChange: (event) => setExtract(index, 'path', event.target.value) }),
                  h('button', { style: S.button, onClick: () => setConfig({ ...config, extract: config.extract.filter((_, at) => at !== index) }) }, '删除'),
                ),
              ),
              h('button', { style: S.button, onClick: () => setConfig({ ...config, extract: [...config.extract, { label: '', path: '' }] }) }, '+ 增加字段'),
            )
          : null,
        h(
          'div',
          { style: S.actions },
          h('button', { style: S.button, onClick: () => save(false), disabled: busy }, '保存'),
          config.mode === 'http' ? h('button', { style: S.primary, onClick: () => save(true), disabled: busy }, busy ? '查询中…' : '保存并测试') : null,
        ),
        outcome !== null
          ? outcome.ok === true && Array.isArray(outcome.rows)
            ? h('div', { style: S.note }, outcome.rows.length === 0 ? '查询成功，但配置里没有取值字段。' : outcome.rows.map((row) => `${row.label}：${row.value === undefined ? '—' : JSON.stringify(row.value)}`).join('\n'))
            : h('div', { style: S.error }, outcome.message ?? outcome.reason ?? '查询失败')
          : null,
      )
    }

    /**
     * The provider form, rendered *where the caller is*: inside the card being
     * edited, or as a card of its own while creating.
     *
     * Only the fields a hand-declared route cannot work without are open by
     * default; `凭据引用` and `请求头` — optional for a gateway like CommandCode —
     * live behind one disclosure so the form is not a wall of inputs.
     */
    function ProviderEditor({ draft, catalog, mode, onChange, onClose, onSaved, onError }) {
      const [busy, setBusy] = React.useState(false)
      const [importedNote, setImportedNote] = React.useState(null)
      const entry = (Array.isArray(catalog) ? catalog : []).find((item) => item.provider === draft.provider)
      const catalogRoute = entry !== undefined && entry.declared === false
      const creating = mode === 'create'

      async function save() {
        const models = modelsForSave(draft)
        if (!catalogRoute && String(draft.baseURL ?? '').trim().length === 0) {
          onError('手写路由必须填 baseURL（pi-ai 的目录里没有这条 provider）。')
          return
        }
        if (!catalogRoute && models.length === 0) {
          onError('手写路由至少需要一个模型。')
          return
        }
        setBusy(true)
        setImportedNote(null)
        try {
          const body = await call('/provider', {
            method: 'POST',
            body: JSON.stringify({
              provider: draft.provider,
              displayName: draft.displayName,
              api: draft.api,
              baseURL: draft.baseURL,
              apiKeyEnv: draft.apiKeyEnv,
              headers: parseHeaderLines(draft.headersText),
              models,
            }),
          })
          onSaved(body)
        } catch (err) {
          onError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: S.editor },
        h(
          'div',
          { style: S.sectionHead },
          h('span', { style: S.name }, creating ? (draft.provider || '新提供商') : `编辑 ${draft.provider}`),
          h('div', { style: S.grow }),
          h('button', { style: S.button, onClick: onClose }, '收起'),
          h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
        ),

        h(
          'div',
          { style: S.grid },
          h(
            Field,
            { label: 'ID（必填，小写字母/数字/连字符）' },
            h('input', {
              style: { ...S.input, ...S.mono },
              value: draft.provider,
              disabled: !creating,
              placeholder: 'commandcode',
              onChange: (event) => onChange({ ...draft, provider: event.target.value }),
            }),
          ),
          h(
            Field,
            { label: '显示名' },
            h('input', {
              style: S.input,
              value: draft.displayName,
              placeholder: draft.provider || 'CommandCode',
              onChange: (event) => onChange({ ...draft, displayName: event.target.value }),
            }),
          ),
          catalogRoute ? null : h(
            Field,
            { label: 'baseURL（必填）' },
            h('input', {
              style: S.input,
              value: draft.baseURL,
              placeholder: 'https://api.example.com/v1',
              onChange: (event) => onChange({ ...draft, baseURL: event.target.value }),
            }),
          ),
          h(
            Field,
            { label: '协议' },
            h(
              'select',
              { style: S.input, value: draft.api, onChange: (event) => onChange({ ...draft, api: event.target.value }) },
              ...(catalogRoute ? [h('option', { key: '', value: '' }, '沿用内置目录')] : []),
              ...API_OPTIONS.map((option) => h('option', { key: option, value: option }, API_LABEL[option])),
            ),
          ),
        ),

        catalogRoute
          ? h('div', { style: S.note }, `pi-ai 内置路由：baseURL 由目录提供（${entry.defaultBaseURL ?? '目录端点'}），不要填；模型留空 = 目录全部模型。`)
          : null,

        h(
          'div',
          { style: S.sectionHead },
          h('button', { style: S.button, onClick: () => onChange({ ...draft, advancedOpen: draft.advancedOpen !== true }) }, draft.advancedOpen === true ? '收起可选字段' : '展开可选字段（凭据引用 / 请求头）'),
        ),
        draft.advancedOpen === true
          ? h(
              'div',
              { style: S.grid },
              h(
                Field,
                { label: '凭据引用（可选）' },
                h('input', {
                  style: S.input,
                  value: draft.apiKeyEnv,
                  placeholder: 'COMMANDCODE_API_KEY',
                  onChange: (event) => onChange({ ...draft, apiKeyEnv: event.target.value }),
                }),
              ),
              h(Field, { label: '请求头（可选，每行 名称: 值）', span: true }, h('textarea', {
                style: { ...S.input, minHeight: '48px' },
                value: draft.headersText,
                placeholder: 'x-opencode-session: {uuid}',
                onChange: (event) => onChange({ ...draft, headersText: event.target.value }),
              })),
              h('div', { style: { ...S.hint, gridColumn: '1 / -1' } }, '{uuid} 会在保存时替换成一个固定 UUID（opencode go 这类网关需要 x-opencode-session）。'),
            )
          : null,

        h('div', { style: S.divider }),

        h(
          'div',
          { style: S.sectionHead },
          h('span', { style: S.sectionTitle }, catalogRoute ? '模型（留空 = 用目录全部）' : '模型（必填）'),
          h('span', { style: S.hint }, '勾“图片”写的是 input: [text, image]'),
          h('div', { style: S.grow }),
          h(
            'button',
            {
              style: S.button,
              onClick: () => onChange({ ...draft, models: [...draft.models, { id: '', name: '', contextWindow: 0, image: false }] }),
            },
            '+ 手填一行',
          ),
        ),

        draft.models.length === 0
          ? h('div', { style: S.hint }, '还没有模型：可以在下面“从端点拉取”，或手填一行。')
          : h(
              'div',
              { style: S.table },
              h(
                'div',
                { style: { ...S.th, color: 'var(--dsw-alias-label-tertiary, #666)' } },
                h('span', null, 'id'),
                h('span', null, '显示名'),
                h('span', null, '上下文'),
                h('span', null, '图片'),
                h('span', null, ''),
              ),
              ...draft.models.map((model, index) =>
                h(
                  'div',
                  { key: index, style: S.tr },
                  h('input', { style: { ...S.input, ...S.mono }, value: model.id, placeholder: 'deepseek/deepseek-v4.1-flash', onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, id: event.target.value } : item)) }) }),
                  h('input', { style: S.input, value: model.name, onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, name: event.target.value } : item)) }) }),
                  h('input', { style: S.input, value: String(model.contextWindow || ''), type: 'number', onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, contextWindow: Number(event.target.value) } : item)) }) }),
                  h('input', { type: 'checkbox', checked: model.image === true, onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, image: event.target.checked } : item)) }) }),
                  h('button', { style: S.button, onClick: () => onChange({ ...draft, models: draft.models.filter((_, at) => at !== index) }) }, '×'),
                ),
              ),
            ),

        importedNote !== null ? h('div', { style: S.ok }, importedNote) : null,
        h(DiscoveryPanel, {
          draft,
          onImport: (models) => {
            const merged = draft.models.filter((model) => String(model.id).trim().length > 0)
            for (const model of models) if (!merged.some((entry2) => entry2.id === model.id)) merged.push(model)
            onChange({ ...draft, models: merged })
            setImportedNote(`已导入 ${models.length} 个模型，记得保存。`)
          },
        }),
      )
    }

    function ProvidersPage() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [creating, setCreating] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [usageOpen, setUsageOpen] = React.useState(null)
      const [probe, setProbe] = React.useState(null)
      const rootRef = React.useRef(null)

      // Expanding an editor makes this page taller, the settings panel grows a
      // scrollbar, and the ~10px it takes re-wraps every line on the page. Ask
      // the panel's scroller to reserve that gutter for good, so open/close is
      // width-stable instead of a reflow.
      React.useLayoutEffect(() => {
        const node = rootRef.current
        if (!node || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return
        let el = node.parentElement
        while (el && el !== document.body) {
          const overflowY = window.getComputedStyle(el).overflowY
          if (overflowY === 'auto' || overflowY === 'scroll') {
            el.style.scrollbarGutter = 'stable'
            break
          }
          el = el.parentElement
        }
      }, [])

      async function reload() {
        setBusy(true)
        setError(null)
        try {
          setState(await call('/state'))
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      React.useEffect(() => {
        void reload()
      }, [])

      async function testProvider(row) {
        setProbe({ provider: row.provider, busy: true })
        try {
          const body = await call('/probe', { method: 'POST', body: JSON.stringify({ provider: row.provider }) })
          setProbe({ provider: row.provider, busy: false, body })
        } catch (err) {
          setProbe({ provider: row.provider, busy: false, body: { ok: false, message: String(err && err.message ? err.message : err) } })
        }
      }

      async function removeProvider(row) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(`删除 provider “${row.provider}”？（模型会立刻从选择器消失）`)) return
        setBusy(true)
        setError(null)
        try {
          setState(await call(`/provider?provider=${encodeURIComponent(row.provider)}`, { method: 'DELETE' }))
          setNotice(`已删除 ${row.provider}`)
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      function toggleEditor(row) {
        setCreating(null)
        setEditing((current) => (current !== null && current.provider === row.provider ? null : { provider: row.provider, draft: draftFrom(row) }))
      }

      const providers = state && Array.isArray(state.providers) ? state.providers : []
      const catalog = state && Array.isArray(state.catalog) ? state.catalog : []

      return h(
        'div',
        { style: S.root, ref: rootRef },
        h(
          'div',
          { style: S.head },
          h('span', { style: S.title }, '提供商增强'),
          h(
            'div',
            { style: S.row },
            h('button', { style: S.button, onClick: () => void reload(), disabled: busy }, '刷新'),
            h(
              'button',
              {
                style: S.primary,
                onClick: () => {
                  setEditing(null)
                  setCreating((current) => current ?? draftFromPreset(state && state.presets ? state.presets[0] : {}))
                },
              },
              '+ 新建提供商',
            ),
          ),
        ),
        h('div', { style: S.hint }, '这里写的就是 llm-pi-ai 的 providers 段：保存后立即生效，不用重启。内置的 设置 → 模型 页面照旧可用。'),
        error !== null ? h('div', { style: S.error }, error) : null,
        notice !== null ? h('div', { style: S.ok }, notice) : null,

        creating !== null
          ? h(ProviderEditor, {
              draft: creating,
              catalog,
              mode: 'create',
              onChange: setCreating,
              onClose: () => setCreating(null),
              onSaved: (body) => {
                setCreating(null)
                setNotice('已保存。若模型选择器没立刻出现新模型，切一次会话即可。')
                setState(body)
              },
              onError: (message) => setError(message),
            })
          : null,

        providers.length === 0 && creating === null
          ? h('div', { style: S.note }, '还没有任何 provider。点右上角“新建提供商”，或者用内置页面添加后回到这里补上图片/请求头。')
          : null,

        ...providers.map((row) => {
          const probing = probe !== null && probe.provider === row.provider && probe.busy === true
          const probeBody = probe !== null && probe.provider === row.provider && probe.busy !== true ? probe.body : null
          const editingThis = editing !== null && editing.provider === row.provider
          return h(
            'div',
            { key: row.provider, style: S.card },
            h(
              'div',
              { style: S.headerRow },
              h('span', { style: S.nameShrink, title: row.displayName }, row.displayName),
              h('span', { style: { ...S.mono, color: 'var(--dsw-alias-label-tertiary, #666)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 1 auto', minWidth: 0 } }, row.provider),
              h(
                'span',
                {
                  title: probeBody !== null ? probeText(probeBody) : undefined,
                  style: {
                    ...S.probeInline,
                    flex: '1 1 0',
                    minWidth: 0,
                    maxWidth: 'none',
                    ...(probeBody === null ? { visibility: 'hidden' } : {}),
                    ...(probeBody !== null && probeBody.ok === true ? S.ok : probeBody !== null ? S.error : {}),
                  },
                },
                probeBody !== null ? probeText(probeBody) : '连通状态占位',
              ),
              h(
                'div',
                { style: S.actions },
                h('button', { style: S.button, onClick: () => testProvider(row), disabled: probing }, probing ? '测试中…' : '测连通'),
                h('button', { style: S.button, onClick: () => toggleEditor(row) }, editingThis ? '收起' : '编辑'),
                h('button', { style: S.button, onClick: () => setUsageOpen(usageOpen === row.provider ? null : row.provider) }, usageOpen === row.provider ? '收起用量' : '用量'),
                row.deletable === true ? h('button', { style: S.danger, onClick: () => void removeProvider(row) }, '删除') : null,
              ),
            ),

            h(
              'div',
              { style: S.row },
              row.keyConfigured ? Chip({ text: 'Key 已配置', style: S.okChip }) : Chip({ text: row.keyReason === 'no-reference' ? '无凭据引用' : 'Key 未配置', style: S.badChip }),
              row.origin === 'composition' ? Chip({ text: '组合层声明' }) : null,
              row.declaredByCatalog === true ? Chip({ text: '内置目录' }) : null,
              Chip({ text: `${row.models.length} 个模型` }),
              Chip({ text: `${row.imageModels} 个支持图片`, style: row.imageModels > 0 ? S.okChip : undefined }),
            ),

            h('div', { style: { ...S.hint, ...S.mono } }, `${row.api} · ${row.baseURL || '未设置 baseURL'}`),
            Object.keys(row.headers ?? {}).length > 0 ? h('div', { style: { ...S.hint, ...S.mono } }, `请求头：${Object.keys(row.headers).join(', ')}`) : null,

            editingThis
              ? h(ProviderEditor, {
                  draft: editing.draft,
                  catalog,
                  mode: 'edit',
                  onChange: (next) => setEditing({ provider: row.provider, draft: next }),
                  onClose: () => setEditing(null),
                  onSaved: (body) => {
                    setEditing(null)
                    setNotice(`已保存 ${row.provider}`)
                    setState(body)
                  },
                  onError: (message) => setError(message),
                })
              : null,

            usageOpen === row.provider ? h(UsagePanel, { provider: row.provider, initial: row.usage }) : null,

            row.models.length > 0
              ? h(
                  'div',
                  { style: S.table },
                  ...row.models.map((model) =>
                    h(
                      'div',
                      { key: model.id, style: S.modelLine },
                      h('span', { style: S.mono }, model.id),
                      model.input.includes('image') ? Chip({ text: '图片', style: S.okChip }) : Chip({ text: '纯文本' }),
                      model.contextWindow ? h('span', { style: S.hint }, `${model.contextWindow} ctx`) : null,
                    ),
                  ),
                )
              : row.declaredByCatalog === true
                ? h('div', { style: S.hint }, '未列模型 = 使用内置目录的全部模型。')
                : null,
          )
        }),
      )
    }

    /**
     * The strip appended to every built-in Models card. It is intentionally
     * read-only about configuration: the workbench owns edits, while this seat
     * answers the two questions a user has right here — "does this provider see
     * images?" and "is it reachable?".
     */
    function ProviderCardStrip(props) {
      const provider = props && props.provider ? props.provider : {}
      const id = typeof provider.provider === 'string' ? provider.provider : ''
      const [row, setRow] = React.useState(null)
      const [probe, setProbe] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        call('/state')
          .then((body) => {
            if (!alive || !body || !Array.isArray(body.providers)) return
            setRow(body.providers.find((entry) => entry.provider === id) ?? null)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [id])

      async function test() {
        setProbe({ busy: true })
        try {
          const body = await call('/probe', { method: 'POST', body: JSON.stringify({ provider: id }) })
          setProbe({ busy: false, body })
        } catch (err) {
          setProbe({ busy: false, body: { ok: false, message: String(err && err.message ? err.message : err) } })
        }
      }

      if (id.length === 0) return null
      const imageCount = row ? row.imageModels : 0
      const total = row ? row.models.length : 0

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', marginTop: '6px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0 } },
          Chip({ text: total === 0 ? '无模型' : `${imageCount}/${total} 支持图片`, style: imageCount > 0 ? S.okChip : undefined }),
          probe !== null && probe.busy !== true && probe.body
            ? h(
                'span',
                {
                  title: probeText(probe.body),
                  style: { ...S.probeInline, maxWidth: '42%', ...(probe.body.ok === true ? S.ok : S.error) },
                },
                probe.body.ok === true
                  ? `HTTP ${probe.body.status} · ${probe.body.elapsed}ms · ${probe.body.modelCount} 个模型`
                  : probeText(probe.body),
              )
            : null,
          h(
            'button',
            { style: S.button, onClick: () => void test(), disabled: probe !== null && probe.busy === true },
            probe !== null && probe.busy === true ? '测试中…' : '测连通',
          ),
        ),
        h('span', { style: S.hint }, '图片开关与请求头在 设置 → 提供商增强'),
      )
    }

    function apply(ctx) {
      try {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'provider-plus', order: 11, label: () => '提供商增强' }, ProvidersPage),
        )
      } catch (error) {
        console.error('[dsh-provider-plus] workbench page failed to register:', error)
      }
      try {
        ctx.slots.inject('settings.models.provider-card', () =>
          ctx.slots.register({ name: 'settings.models.provider-card', key: 'llm-pi-ai' }, ProviderCardStrip),
        )
      } catch (error) {
        console.error('[dsh-provider-plus] provider-card strip failed to register:', error)
      }
    }

    return { name: 'dsh-provider-plus', inject, apply }
  },
})
