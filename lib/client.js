/**
 * dsh-provider-plus — client half.
 *
 * Two seats, both additive:
 *
 *  1. `settings.section` — the 模型增强 workbench: create, edit and delete
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

    /* Usage-query presets. Each one only fills the declarative request fields;
       the host still runs one GET and extracts dot paths, so nothing here is a
       provider-specific code path. Endpoints mirror the gateways' documented
       (or CLI-used) quota routes. */
    const USAGE_PRESET_TEMPLATES = [
      { id: 'custom', group: 'template', label: '自定义' },
      { id: 'generic', group: 'template', label: '通用余额' },
      { id: 'newapi', group: 'template', label: 'NewAPI' },
      { id: 'sub2api', group: 'template', label: 'Sub2API' },
      { id: 'kimi', group: 'plan', label: 'Kimi' },
      { id: 'zhipu', group: 'plan', label: '智谱 GLM' },
      { id: 'zhipu_team', group: 'plan', label: '智谱团队' },
      { id: 'minimax', group: 'plan', label: 'MiniMax' },
      { id: 'zenmux', group: 'plan', label: 'ZenMux' },
      { id: 'opencode_go', group: 'plan', label: 'OpenCode Go' },
      { id: 'commandcode', group: 'plan', label: 'CommandCode GOAT' },
    ]

    function trimBase(value) {
      return String(value ?? '').replace(/\/+$/, '')
    }

    /* A provider-specific preset names the credential its gateway expects; when
       the card already is that gateway, reuse the provider's own key instead. */
    const PRESET_KEY_REF = {
      kimi: { ref: 'KIMI_API_KEY', pattern: /api\.kimi\.com\/coding/i },
      zhipu: { ref: 'ZHIPU_API_KEY', pattern: /bigmodel\.cn|api\.z\.ai/i },
      zhipu_team: { ref: 'ZHIPU_API_KEY', pattern: /bigmodel\.cn|api\.z\.ai/i },
      minimax: { ref: 'MINIMAX_API_KEY', pattern: /minimax\.(io|cn)|minimaxi\.com/i },
      zenmux: { ref: 'ZENMUX_API_KEY', pattern: /zenmux\./i },
      opencode_go: { ref: 'OPENCODE_API_KEY', pattern: /opencode\.ai\/zen\/go/i },
    }

    function presetKeyRef(id, baseUrl, apiKeyEnv) {
      const entry = PRESET_KEY_REF[id]
      if (entry === undefined) return apiKeyEnv ?? ''
      return entry.pattern.test(String(baseUrl ?? '')) ? (apiKeyEnv ?? '') : entry.ref
    }

    /**
     * A display name is written to the profile config in clear text, so it must
     * never carry a credential. People reach for the only text box in the form
     * when the one they want is missing, so warn instead of silently saving it.
     */
    function looksLikeSecret(value) {
      const text = String(value ?? '').trim()
      if (text.length < 20) return false
      if (/^(sk-|oc_sk_|ak-|ark-|ghp_|gho_|xox[bap]-|AIza|eyJ)/.test(text)) return true
      if (/\s/.test(text)) return false
      return /^[A-Za-z0-9_\-.]{32,}$/.test(text) && /[0-9]/.test(text) && /[A-Za-z]/.test(text)
    }

    function usagePresetFields(id, baseUrl, apiKeyEnv) {
      const base = trimBase(baseUrl)
      const keyRef = presetKeyRef(id, base, apiKeyEnv)
      const bearer = 'Authorization: Bearer {key}'
      switch (id) {
        case 'generic':
          return {
            url: `${base}/user/balance`,
            method: 'GET',
            headersText: bearer,
            keyRef,
            extract: [
              { label: '余额', path: 'balance' },
              { label: '币种', path: 'currency' },
            ],
          }
        case 'newapi':
          return {
            url: `${base}/api/user/self`,
            method: 'GET',
            headersText: `${bearer}\nNew-Api-User: `,
            keyRef,
            extract: [
              { label: '剩余额度', path: 'data.quota' },
              { label: '已用额度', path: 'data.used_quota' },
              { label: '分组', path: 'data.group' },
            ],
          }
        case 'sub2api':
          return {
            url: `${base.replace(/\/v1$/, '')}/v1/usage`,
            method: 'GET',
            headersText: bearer,
            keyRef,
            extract: [
              { label: '剩余', path: 'remaining' },
              { label: '已用', path: 'quota.used' },
              { label: '总额', path: 'quota.limit' },
              { label: '单位', path: 'unit' },
            ],
          }
        case 'kimi':
          return {
            url: 'https://api.kimi.com/coding/v1/usages',
            method: 'GET',
            headersText: bearer,
            keyRef,
            extract: [
              { label: '5 小时剩余', path: 'limits[0].detail.remaining' },
              { label: '5 小时上限', path: 'limits[0].detail.limit' },
              { label: '周剩余', path: 'usage.remaining' },
              { label: '周上限', path: 'usage.limit' },
            ],
          }
        case 'zhipu':
        case 'zhipu_team': {
          const host = /bigmodel\.cn/i.test(base) ? 'https://open.bigmodel.cn' : 'https://api.z.ai'
          const team = id === 'zhipu_team'
          return {
            url: `${host}/api/monitor/usage/quota/limit${team ? '?type=2' : ''}`,
            method: 'GET',
            headersText: `Authorization: {key}\nContent-Type: application/json\nAccept-Language: en-US,en${team ? '\nbigmodel-organization: \nbigmodel-project: ' : ''}`,
            keyRef,
            extract: [
              { label: '5 小时已用%', path: 'data.limits[unit=3].percentage' },
              { label: '周已用%', path: 'data.limits[unit=6].percentage' },
              { label: '套餐', path: 'data.level' },
            ],
          }
        }
        case 'minimax': {
          const host = /minimax\.io/i.test(base) ? 'https://api.minimax.io' : 'https://api.minimaxi.com'
          return {
            url: `${host}/v1/api/openplatform/coding_plan/remains`,
            method: 'GET',
            headersText: bearer,
            keyRef,
            extract: [
              { label: '5 小时剩余%', path: 'model_remains[model_name=general].current_interval_remaining_percent' },
              { label: '周剩余%', path: 'model_remains[model_name=general].current_weekly_remaining_percent' },
            ],
          }
        }
        case 'zenmux':
          return {
            url: base,
            method: 'GET',
            headersText: `${bearer}\nAccept: application/json`,
            keyRef,
            extract: [
              { label: '5 小时已用%', path: 'data.quota_5_hour.usage_percentage' },
              { label: '7 天已用%', path: 'data.quota_7_day.usage_percentage' },
              { label: '套餐', path: 'data.plan.tier' },
            ],
          }
        case 'opencode_go':
          return {
            url: 'https://opencode.ai/zen/go/v1/usage',
            method: 'GET',
            headersText: bearer,
            keyRef,
            extract: [
              { label: '5 小时已用%', path: 'usage.rolling.percent' },
              { label: '周已用%', path: 'usage.weekly.percent' },
              { label: '月已用%', path: 'usage.monthly.percent' },
            ],
          }
        case 'commandcode':
          /* CommandCode reports used+cap, not a percentage. `/alpha/billing/credits`
             also carries the remaining monthly credits; the plan's own cap is not
             in the payload, so the monthly tile shows the balance instead. */
          return {
            url: 'https://api.commandcode.ai/alpha/billing/credits',
            method: 'GET',
            headersText: bearer,
            keyRef,
            extract: [
              { label: '5 小时已用%', path: 'windowLimits.fiveHour.used', of: 'windowLimits.fiveHour.cap', unit: '%' },
              { label: '周已用%', path: 'windowLimits.weekly.used', of: 'windowLimits.weekly.cap', unit: '%' },
              { label: '月额度剩余', path: 'credits.monthlyCredits', unit: '$' },
            ],
          }
        default:
          return { url: '', method: 'GET', headersText: bearer, keyRef, extract: [] }
      }
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
      root: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 16px 18px 0' },
      /* The whole page keeps the card's horizontal inset on the right: the card
         border, the header actions and the settings panel's own right margin
         all land on the same line instead of the cards overhanging. */
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
      /* The editor is a nested surface: one step darker than the card, with a
         titled head, so "edit" never reads as another row of the card. */
      editor: {
        border: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
        borderRadius: '10px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
      },
      editorHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        paddingBottom: '12px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
      },
      editorTitle: {
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, #111)',
        whiteSpace: 'nowrap',
      },
      editorSubject: {
        fontFamily: 'var(--dsw-font-markdown-code-block, ui-monospace, monospace)',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #555)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      },
      group: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
      groupHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 },
      groupTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)' },
      groupHint: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, #666)' },
      subgroup: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
      tableHead: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.8fr) 76px 44px 30px',
        gap: '8px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #666)',
        padding: '0 0 6px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
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
      okChip: { color: 'var(--dsw-alias-state-success-primary, #0a7)', border: '0.5px solid currentColor' },
      badChip: { color: 'var(--dsw-alias-state-error-primary, #c33)', border: '0.5px solid currentColor' },
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
        background: 'var(--dsw-alias-label-primary, #111)',
        color: 'var(--dsw-alias-bg-base, #fff)',
        whiteSpace: 'nowrap',
      },
      disclosure: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '4px 0',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-secondary, #68717b)',
      },
      chevron: {
        display: 'inline-block',
        fontSize: '12px',
        lineHeight: '12px',
        transition: 'transform .15s ease',
      },
      danger: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '3px 10px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary, #c33)',
        whiteSpace: 'nowrap',
      },
      presetRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      presetLabel: { fontSize: '11px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #666)', minWidth: '30px' },
      presetButton: {
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '18px',
        padding: '2px 9px',
        borderRadius: '999px',
        cursor: 'pointer',
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #555)',
        whiteSpace: 'nowrap',
      },
      presetActive: {
        border: '0.5px solid transparent',
        background: 'var(--dsw-alias-label-primary, #111)',
        color: 'var(--dsw-alias-bg-base, #fff)',
      },
      activityChip: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '3px 10px',
        borderRadius: '999px',
        cursor: 'pointer',
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #68717b)',
        whiteSpace: 'nowrap',
      },
      activityPanel: {
        position: 'absolute',
        right: 0,
        bottom: 'calc(100% + 6px)',
        minWidth: '280px',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '14px 16px',
        borderRadius: '10px',
        border: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
        background: 'var(--dsw-alias-bg-overlay, #fff)',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.14)',
        zIndex: 40,
      },
      activityRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-primary, #111)',
      },
      activityHead: {
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary, #89919a)',
        paddingBottom: '4px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
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
      tr: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.8fr) 76px 44px 30px', gap: '8px', alignItems: 'center', padding: '2px 0' },
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
      /* Inline variants: colour only, so they never override the one-line rule. */
      okText: { color: 'var(--dsw-alias-state-success-primary, #0a7)' },
      errText: { color: 'var(--dsw-alias-state-error-primary, #c33)' },
      divider: { height: '0.5px', background: 'var(--dsw-alias-border-l1, #00000014)' },
      sectionHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      sectionTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)' },
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
      modelLine: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        fontSize: '12px',
        padding: '4px 0',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
      },
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
        // Never carried over: the stored key is unreadable by design, so the
        // field starts blank and blank means "leave the credential alone".
        apiKey: '',
        advancedOpen: true,
      }
    }

    /** A new provider starts empty; presets are never written over a fresh form. */
    function emptyDraft() {
      return {
        provider: '',
        displayName: '',
        api: 'openai-completions',
        baseURL: '',
        apiKeyEnv: '',
        headersText: '',
        models: [],
        apiKey: '',
        advancedOpen: true,
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

    function replaceModelAt(models, index, discovered) {
      return models.map((model, at) => at === index ? {
        id: discovered.id,
        name: discovered.name ?? discovered.id,
        contextWindow: discovered.contextWindow ?? 0,
        image: (discovered.suggestedInput ?? ['text']).includes('image'),
      } : model)
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

    /**
     * A select that draws its own menu. The native popup is OS-styled — square
     * corners and a hard border — and clashes with the rounded, token-coloured
     * controls around it, so the list is rendered here instead.
     */
    function Select({ value, options, onChange, style, disabled, placeholder, onOpen, menuStyle, ariaLabel, title }) {
      const [open, setOpen] = React.useState(false)
      const [active, setActive] = React.useState(0)
      const [up, setUp] = React.useState(false)
      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const current = options.find((option) => option.value === value)

      React.useEffect(() => {
        if (!open) return undefined
        function onPointerDown(event) {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [open])

      function openMenu() {
        if (typeof onOpen === 'function') onOpen()
        const index = options.findIndex((option) => option.value === value)
        setActive(index < 0 ? 0 : index)
        const node = rootRef.current
        if (node !== null && typeof window !== 'undefined') {
          const rect = node.getBoundingClientRect()
          let clip = { top: 0, bottom: window.innerHeight }
          let parent = node.parentElement
          while (parent !== null && parent !== document.body) {
            const overflowY = window.getComputedStyle(parent).overflowY
            if (overflowY === 'auto' || overflowY === 'scroll') {
              clip = parent.getBoundingClientRect()
              break
            }
            parent = parent.parentElement
          }
          const below = clip.bottom - rect.bottom
          const above = rect.top - clip.top
          setUp(below < 260 && above > below)
        }
        setOpen(true)
      }

      function choose(index) {
        const option = options[index]
        if (option === undefined || option.disabled === true) return
        onChange(option.value)
        setOpen(false)
        if (triggerRef.current !== null) triggerRef.current.focus()
      }

      function onKeyDown(event) {
        if (!open) {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openMenu()
          }
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((index) => Math.min(options.length - 1, index + 1))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => Math.max(0, index - 1))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          choose(active)
        }
      }

      return h(
        'div',
        {
          ref: rootRef,
          style: { position: 'relative', width: '100%', minWidth: 0 },
          onKeyDown,
          onBlur: (event) => {
            if (rootRef.current !== null && !rootRef.current.contains(event.relatedTarget)) setOpen(false)
          },
        },
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            disabled: disabled === true,
            style: {
              ...S.input,
              ...(style ?? {}),
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              cursor: disabled === true ? 'default' : 'pointer',
              textAlign: 'left',
              opacity: disabled === true ? 0.6 : 1,
            },
            onClick: () => (open ? setOpen(false) : openMenu()),
            'aria-haspopup': 'listbox',
            'aria-expanded': open,
            'aria-label': ariaLabel,
            title,
          },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current === undefined ? (placeholder ?? '') : current.label),
          h(
            'svg',
            {
              width: 10,
              height: 10,
              viewBox: '0 0 10 10',
              'aria-hidden': 'true',
              style: {
                flex: '0 0 auto',
                color: 'var(--dsw-alias-label-tertiary, #666)',
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 120ms ease',
              },
            },
            h('path', { d: 'M2 3.5 L5 6.5 L8 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ),
        ),
        open
          ? h(
              'div',
              {
                role: 'listbox',
                style: {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  ...(up ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
                  zIndex: 30,
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  borderRadius: '10px',
                  border: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
                  background: 'var(--dsw-alias-bg-overlay, #fff)',
                  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.14)',
                  maxHeight: 'min(260px, 40vh)',
                  overflowY: 'auto',
                  ...(menuStyle ?? {}),
                },
              },
              ...options.map((option, index) =>
                h(
                  'button',
                  {
                    key: option.value,
                    type: 'button',
                    role: 'option',
                    'aria-selected': option.value === value,
                    'aria-disabled': option.disabled === true,
                    disabled: option.disabled === true,
                    style: {
                      ...S.button,
                      width: '100%',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      textAlign: 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      background: index === active ? 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.05))' : 'transparent',
                      color: option.value === value ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'var(--dsw-alias-label-primary, #111)',
                      opacity: option.disabled === true ? 0.6 : 1,
                    },
                    title: option.label,
                    onMouseEnter: () => setActive(index),
                    onClick: () => choose(index),
                  },
                  option.label,
                ),
              ),
            )
          : null,
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

      const allPicked = result !== null && result.length > 0 && result.every((model) => picked[model.id] === true)
      const knownIds = new Set(draft.models.map((model) => String(model.id ?? '').trim()).filter((id) => id.length > 0))
      const pickedCount =
        result === null ? 0 : result.filter((model) => picked[model.id] === true && !knownIds.has(model.id)).length

      return h(
        'div',
        {
          style: {
            ...S.subgroup,
            borderTop: '0.5px solid var(--dsw-alias-border-l1, #00000014)',
            paddingTop: '10px',
            marginTop: '2px',
          },
        },
        h(
          'div',
          { style: S.sectionHead },
          h('span', { style: S.groupTitle }, '从端点拉取模型'),
          h('div', { style: S.grow }),
          h('button', { style: S.button, onClick: () => (open ? setOpen(false) : setOpen(true)) }, open ? '收起' : '展开'),
          h('button', { style: S.button, onClick: run, disabled: busy }, busy ? '请求中…' : '拉取模型'),
        ),
        open
          ? h(
              React.Fragment,
              null,
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
                            const next = {}
                            if (!allPicked) for (const model of result) next[model.id] = true
                            setPicked(next)
                          },
                        },
                        allPicked ? '取消全选' : '全选',
                      ),
                      h('button', { style: S.primary, onClick: importPicked }, `导入选中（${pickedCount}）`),
                    ),
                    ...result.map((model) =>
                      h(
                        'label',
                        { key: model.id, style: { ...S.tr, cursor: 'pointer' } },
                        h(
                          'span',
                          { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
                          h('input', {
                            type: 'checkbox',
                            style: { flex: '0 0 auto', margin: 0 },
                            checked: picked[model.id] === true,
                            onChange: (event) => setPicked({ ...picked, [model.id]: event.target.checked }),
                          }),
                          h('span', { style: { ...S.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, model.id),
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

    /* ------------------------------------------------------------- workbench */
    /* One row per gateway when collapsed, two clearly separated panes when open.
       Every colour is a theme token, so light and dark both work without a
       second palette; the layout itself is the prototype's card-first shape. */
    const UI = {
      page: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '2px 16px 26px 0', fontFamily: 'inherit' },
      head: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '6px', minWidth: 0, paddingBottom: '18px' },
      headTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minWidth: 0, flexWrap: 'wrap' },
      headLeft: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '0 1 auto' },
      title: { margin: 0, fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--dsw-alias-label-primary, #20242a)', whiteSpace: 'nowrap' },
      badge: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8b929a)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      headActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' },
      ghost: { minHeight: '30px', padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', lineHeight: '1', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68717b)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      solid: { minHeight: '32px', padding: '0 13px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', lineHeight: '1', borderRadius: '8px', border: 'none', background: 'var(--dsw-alias-label-primary, #20242a)', color: 'var(--dsw-alias-bg-base, #fff)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      card: { border: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', borderRadius: '11px', background: 'var(--dsw-alias-bg-layer-1, #fff)', overflow: 'hidden', outline: 'none' },
      cardOpen: { border: '1px solid var(--dsw-alias-border-l2, #d7dce1)', overflow: 'visible' },
      cardHead: { minHeight: '54px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '9px', padding: '0 14px', minWidth: 0, cursor: 'pointer', outline: 'none' },
      dot: { width: '7px', height: '7px', borderRadius: '50%', flex: '0 0 auto', background: 'var(--dsw-alias-state-idle-primary, #c2c8d0)' },
      dotOn: { background: 'var(--dsw-alias-state-success-primary, #10b981)' },
      dotBusy: { background: 'var(--dsw-alias-state-warn-primary, #f59e0b)' },
      name: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' },
      pills: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8b929a)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      pillOk: { color: 'var(--dsw-alias-state-success-primary, #16835f)' },
      pillWarn: { color: 'var(--dsw-alias-state-warn-primary, #b45309)' },
      pillAccent: { color: 'var(--dsw-alias-brand-primary, #4d6bfe)', background: 'rgba(77, 107, 254, 0.10)' },
      actions: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto', marginLeft: 'auto' },
      iconBtn: { width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #929aa3)', cursor: 'pointer', flex: '0 0 auto' },
      tray: { margin: '0 14px 14px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-label-primary, #111) 3%, var(--dsw-alias-bg-layer-1, #fff))', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '22px' },
      trayHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0, borderBottom: '1px solid var(--dsw-alias-border-l1, #e1e4e8)' },
      seg: { display: 'inline-flex', gap: '22px', background: 'transparent', flex: '0 0 auto' },
      segBtn: { fontSize: '13px', lineHeight: '20px', padding: '0 0 11px', border: 'none', borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #89919a)', cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px' },
      segOn: { color: 'var(--dsw-alias-label-primary, #20242a)', borderBottom: '2px solid var(--dsw-alias-label-primary, #20242a)' },
      panel: { background: 'transparent', padding: '0', display: 'flex', flexDirection: 'column', gap: '20px' },
      panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', minWidth: 0, flexWrap: 'wrap' },
      sectionTitle: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #20242a)', minWidth: 0, flexWrap: 'wrap' },
      accent: { display: 'none' },
      count: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #89919a)' },
      grid2: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '18px' },
      field: { display: 'flex', flexDirection: 'column', gap: '7px', minWidth: 0 },
      label: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #68717b)' },
      req: { color: 'var(--dsw-alias-state-error-primary, #c33)' },
      input: { height: '36px', width: '100%', boxSizing: 'border-box', padding: '0 11px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #20242a)', fontSize: '13px', outline: 'none' },
      inputDisabled: { background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.03))', color: 'var(--dsw-alias-label-tertiary, #888)', cursor: 'not-allowed' },
      textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 11px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #20242a)', fontSize: '13px', outline: 'none', resize: 'vertical', minHeight: '72px' },
      mono: { fontFamily: 'var(--dsw-font-markdown-code-block, ui-monospace, monospace)', fontSize: '12px' },
      drawer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%', padding: '2px 0', border: 'none', background: 'transparent', cursor: 'pointer', minWidth: 0, textAlign: 'left' },
      drawerLeft: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #20242a)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      drawerRight: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0, justifyContent: 'flex-end', flex: '0 1 auto' },
      link: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary, #4d6bfe)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      outBtn: { minHeight: '30px', padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #20242a)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      outBtnAccent: { minHeight: '30px', padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #20242a)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      table: { border: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', borderRadius: '8px', overflow: 'visible', background: 'var(--dsw-alias-bg-layer-1, #fff)' },
      th: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1.15fr) minmax(90px, 1.4fr) 84px 54px 36px 30px', gap: '6px', alignItems: 'center', padding: '10px', minWidth: '440px', boxSizing: 'border-box', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #89919a)', background: 'var(--dsw-alias-bg-layer-1, #fff)', borderBottom: '1px solid var(--dsw-alias-border-l1, #e1e4e8)' },
      tr: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1.15fr) minmax(90px, 1.4fr) 84px 54px 36px 30px', gap: '6px', alignItems: 'center', padding: '9px 10px', minWidth: '440px', boxSizing: 'border-box', borderBottom: '1px solid var(--dsw-alias-border-l1, #edf0f2)' },
      modelPicker: { margin: '0 10px 10px', padding: '12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'var(--dsw-alias-bg-layer-2, #f7f8fa)', display: 'flex', flexDirection: 'column', gap: '10px' },
      modelPickerList: { maxHeight: '240px', overflowY: 'auto', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', background: 'var(--dsw-alias-bg-layer-1, #fff)' },
      modelOption: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', padding: '10px 12px', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #20242a)', cursor: 'pointer', font: 'inherit' },
      modelOptionName: { maxWidth: '100%', fontSize: '12px', fontWeight: 500, lineHeight: '18px', whiteSpace: 'normal', overflowWrap: 'anywhere' },
      modelOptionId: { maxWidth: '100%', fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, #89919a)', fontFamily: 'var(--dsw-font-markdown-code-block, ui-monospace, monospace)', whiteSpace: 'normal', overflowWrap: 'anywhere' },
      cellInput: { height: '34px', width: '100%', boxSizing: 'border-box', padding: '0 9px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #20242a)', fontSize: '12px', outline: 'none' },
      ctxWrap: { position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 },
      metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' },
      metric: { minHeight: '100px', padding: '14px', borderRadius: '9px', border: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', background: 'var(--dsw-alias-bg-layer-1, #fff)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0, boxSizing: 'border-box' },
      metricLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #68717b)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      metricRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
      metricValue: { fontSize: '20px', fontWeight: 700, lineHeight: '1', color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap' },
      metricTag: { fontSize: '12px', whiteSpace: 'nowrap' },
      barTrack: { height: '5px', borderRadius: '999px', background: 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.06))', overflow: 'hidden' },
      barFill: { height: '100%', borderRadius: '999px', background: 'var(--dsw-alias-brand-primary, #4d6bfe)', transition: 'width .4s ease' },
      muted: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #89919a)', whiteSpace: 'pre-wrap' },
      okText: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-success-primary, #16835f)', whiteSpace: 'pre-wrap' },
      errText: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #c33)', whiteSpace: 'pre-wrap' },
      presetRow: { display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0, flexWrap: 'wrap' },
      presetLabel: { width: '70px', flex: '0 0 70px', fontSize: '12px', lineHeight: '28px', color: 'var(--dsw-alias-label-secondary, #68717b)', whiteSpace: 'nowrap' },
      presetWrap: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0, flex: '1 1 240px' },
      chip: { fontSize: '12px', lineHeight: '28px', padding: '0 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, #d9dee4)', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68717b)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      chipOn: { background: 'var(--dsw-alias-label-primary, #111)', color: 'var(--dsw-alias-bg-base, #fff)' },
      empty: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary, #89919a)', padding: '8px 0' },
      divide: { borderTop: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', paddingTop: '18px' },
      addButton: { minHeight: '44px', width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '1px dashed var(--dsw-alias-border-l2, #d9dee4)', borderRadius: '10px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68717b)', fontSize: '13px', cursor: 'pointer', marginTop: '8px' },
      footer: { position: 'sticky', bottom: '-26px', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', margin: '0 -18px -20px', padding: '12px 18px', borderTop: '1px solid var(--dsw-alias-border-l1, #e1e4e8)', borderRadius: '0 0 10px 10px', background: 'color-mix(in srgb, var(--dsw-alias-label-primary, #111) 3%, var(--dsw-alias-bg-layer-1, #fff))', boxShadow: '0 -8px 16px -14px rgba(0, 0, 0, 0.28)' },
    }

    const ICON = {
      chevronRight: 'M9 5l7 7-7 7',
      chevronDown: 'M19 9l-7 7-7-7',
      plus: 'M12 4v16m8-8H4',
      x: 'M6 18L18 6M6 6l12 12',
      bolt: 'M13 10V3L4 14h7v7l9-11h-7z',
      chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
      trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
      image: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
      refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
      code: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      check: 'M5 13l4 4L19 7',
      gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
      key: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
      play: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    }

    function Icon({ name, size, style }) {
      return h(
        'svg',
        {
          width: size ?? 13,
          height: size ?? 13,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flex: '0 0 auto', ...(style ?? {}) },
        },
        h('path', { d: ICON[name] }),
      )
    }

    /** Caption above the control, with the required marker on the caption line. */
    function LField({ label, required, children, span }, control) {
      return h(
        'label',
        { style: { ...UI.field, ...(span === true ? { gridColumn: '1 / -1' } : {}) } },
        h('span', { style: UI.label }, label, required === true ? h('span', { style: UI.req }, ' *') : null),
        children ?? control,
      )
    }

    /** One quota tile: label, value, state word and a bar that always lines up. */
    function MetricCard({ label, value, unit }) {
      const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      const num = numeric ? Number(value) : null
      // A row is a percentage when the template says so, or when its label ends
      // in "%" (older templates did not carry a unit). Everything else is shown
      // as a plain number so a balance never gets a "%" glued to it.
      const percentStyle = unit === '%' || ((unit === undefined || unit === '') && /%\s*$/.test(String(label ?? '')))
      const percent = num === null || percentStyle !== true ? 0 : Math.max(0, Math.min(100, num))
      const tight = percentStyle === true && num !== null && num >= 85
      const text = label === undefined || label === null ? '—' : String(label).replace(/%\s*$/, '')
      const display =
        num === null
          ? value === undefined || value === null
            ? '—'
            : String(value)
          : unit === '$'
            ? `$${num}`
            : percentStyle === true
              ? `${num}%`
              : String(num)
      return h(
        'div',
        { style: UI.metric },
        h('div', { style: UI.metricLabel, title: text }, text || '—'),
        h(
          'div',
          { style: UI.metricRow },
          h('span', { style: UI.metricValue }, display),
          percentStyle === true && num !== null
            ? h('span', { style: { ...UI.metricTag, color: tight ? 'var(--dsw-alias-state-error-primary, #c33)' : 'var(--dsw-alias-state-success-primary, #0a7)' } }, tight ? '紧张' : '充裕')
            : null,
        ),
        percentStyle === true && num !== null
          ? h('div', { style: UI.barTrack }, h('div', { style: { ...UI.barFill, width: `${Math.max(percent, 3)}%` } }))
          : h('div', { style: { ...UI.barTrack, visibility: 'hidden' } }, h('div', { style: { ...UI.barFill, width: '0%' } })),
      )
    }

    /**
     * Usage pane: result, query basics, then the optional request mapping.
     * Save stays in the card footer, so the pane exposes its action via onApi.
     */
    function UsagePane({ provider, baseURL, apiKeyEnv, initial, initialResult, onApi, onRefresh, onError, onDirtyChange, onBusyChange }) {
      const [config, setConfig] = React.useState(() => ({
        mode: initial && initial.mode ? initial.mode : 'none',
        url: (initial && initial.url) ?? '',
        method: (initial && initial.method) ?? 'GET',
        headersText: Object.entries((initial && initial.headers) ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
        keyRef: (initial && initial.keyRef) ?? '',
        body: (initial && initial.body) ?? '',
        interval: Number(initial && initial.interval) || 0,
        extract: ((initial && initial.extract) ?? []).map((entry) => ({
          label: entry.label ?? '',
          path: entry.path ?? '',
          ...(entry.of ? { of: entry.of } : {}),
          ...(entry.unit ? { unit: entry.unit } : {}),
        })),
      }))
      const [preset, setPreset] = React.useState('custom')
      const [savedConfig, setSavedConfig] = React.useState(() => JSON.stringify(config))
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(initialResult ?? null)
      const [message, setMessage] = React.useState(null)
      const [rulesOpen, setRulesOpen] = React.useState(false)

      async function save(run) {
        setBusy(true)
        setMessage(null)
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
              interval: Math.max(0, Math.min(1440, Number(config.interval) || 0)),
              extract: config.extract.filter((entry) => entry.label.length > 0 && entry.path.length > 0),
            }),
          })
          if (run === true) {
            const rows = Array.isArray(body.rows) ? body.rows : []
            setResult({ at: new Date().toISOString(), ok: body.ok === true, rows, message: body.message ?? '', status: body.status ?? null })
            setMessage(body.ok === true ? { ok: true, text: '拉取成功' } : { ok: false, text: body.message ?? '查询失败' })
          } else {
            setMessage({ ok: true, text: '用量模板已保存。' })
          }
          setSavedConfig(JSON.stringify(config))
          if (typeof onRefresh === 'function') void onRefresh()
        } catch (err) {
          const text = String(err && err.message ? err.message : err)
          setMessage({ ok: false, text })
          if (typeof onError === 'function') onError(text)
        } finally {
          setBusy(false)
        }
      }

      React.useEffect(() => {
        if (typeof onApi === 'function') onApi({ save })
      })

      React.useEffect(() => {
        if (typeof onDirtyChange === 'function') onDirtyChange(JSON.stringify(config) !== savedConfig)
      }, [config, savedConfig, onDirtyChange])

      React.useEffect(() => {
        if (typeof onBusyChange === 'function') onBusyChange(busy)
      }, [busy, onBusyChange])

      function applyPreset(id) {
        setPreset(id)
        setMessage(null)
        if (id === 'custom') return
        const fields = usagePresetFields(id, baseURL, apiKeyEnv)
        setConfig((current) => ({ ...current, mode: 'http', url: fields.url, method: fields.method, headersText: fields.headersText, keyRef: fields.keyRef, extract: fields.extract }))
      }

      function setExtract(index, key, value) {
        setConfig((current) => ({ ...current, extract: current.extract.map((entry, at) => (at === index ? { ...entry, [key]: value } : entry)) }))
      }

      React.useEffect(() => {
        if (message === null || message.ok !== true) return undefined
        const timer = setTimeout(() => setMessage(null), 3000)
        return () => clearTimeout(timer)
      }, [message])

      const rows = result && Array.isArray(result.rows) ? result.rows : []
      const updated = result && result.at ? new Date(result.at).toLocaleString('zh-CN', { hour12: false }) : null
      const tiles = rows.length > 0 ? rows.slice(0, 3) : [null, null, null]
      const configured = config.mode === 'http' && String(config.url).trim().length > 0

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '26px' } },

        h(
          'div',
          { style: UI.panel },
          h(
            'div',
            { style: UI.panelHead },
            h(
              'div',
              { style: UI.sectionTitle },
              '用量概览',
              updated === null ? null : h('span', { style: UI.muted }, `更新于 ${updated}`),
              message !== null && message.ok === true ? h('span', { style: { ...UI.okText, whiteSpace: 'nowrap' } }, message.text) : null,
            ),
            h(
              'button',
              { style: UI.outBtnAccent, onClick: () => void save(true), disabled: busy || !configured, title: configured ? '保存当前查询配置并执行一次请求' : '先选择模板或填写查询地址' },
              h(Icon, { name: 'play', size: 12 }),
              busy ? '查询中…' : '保存并测试',
            ),
          ),
          rows.length > 0
            ? h('div', { style: UI.metrics }, ...tiles.map((row, index) => h(MetricCard, { key: index, label: row ? row.label : '', value: row ? row.value : undefined, unit: row ? row.unit : undefined })))
            : h('div', { style: UI.empty }, '暂无查询结果'),
          message !== null && message.ok !== true ? h('div', { style: UI.errText }, message.text) : null,
        ),

        h(
          'div',
          { style: { ...UI.panel, ...UI.divide } },
          h(
            'div',
            { style: { ...UI.grid2, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px' } },
            LField({ label: '查询方式' }, h(Select, {
              value: config.mode,
              options: [
                { value: 'none', label: '关闭' },
                { value: 'http', label: 'HTTP 接口' },
              ],
              onChange: (mode) => setConfig({ ...config, mode }),
              style: { ...UI.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '10px' },
            })),
            LField({ label: '自动刷新（分钟）' }, h('input', {
              style: { ...UI.input, ...UI.mono },
              inputMode: 'numeric',
              placeholder: '0 = 关闭',
              value: String(config.interval || ''),
              onChange: (event) => {
                const digits = event.target.value.replace(/[^0-9]/g, '')
                setConfig({ ...config, interval: digits.length === 0 ? 0 : Math.min(1440, Number(digits)) })
              },
            })),
          ),
          h('div', { style: { ...UI.divide, paddingTop: '16px' } }, LField({ label: '查询模板' }, h(Select, {
            value: preset,
            options: USAGE_PRESET_TEMPLATES.map((item) => ({ value: item.id, label: item.label })),
            onChange: applyPreset,
            style: { ...UI.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '10px' },
            ariaLabel: '选择用量查询模板',
          }))),
          h(
            'div',
            { style: UI.divide },
            h(
              'button',
              { type: 'button', style: UI.drawer, 'aria-expanded': rulesOpen, onClick: () => setRulesOpen(!rulesOpen) },
              h(
                'span',
                { style: UI.drawerLeft },
                h(Icon, { name: 'chevronRight', size: 12, style: { transform: rulesOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease', color: 'var(--dsw-alias-label-tertiary, #888)' } }),
                '请求与字段映射',
              ),
              h(
                'span',
                { style: UI.drawerRight },
                h('span', { style: UI.pill }, `${config.method || 'GET'} · ${config.extract.length} 个字段`),
              ),
            ),
            rulesOpen
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: { ...UI.grid2, marginTop: '16px' } },
                    LField({ label: '请求方法' }, h(Select, {
                      value: config.method,
                      options: [
                        { value: 'GET', label: 'GET' },
                        { value: 'POST', label: 'POST' },
                      ],
                      onChange: (method) => setConfig({ ...config, method }),
                      style: { ...UI.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '10px' },
                    })),
                    LField({ label: '查询地址' }, h('input', { style: { ...UI.input, ...UI.mono }, value: config.url, placeholder: 'https://gateway.example.com/api/usage', onChange: (event) => setConfig({ ...config, url: event.target.value }) })),
                    LField({ label: '凭据引用' }, h('input', { style: { ...UI.input, ...UI.mono }, value: config.keyRef, placeholder: 'OPENCODE_API_KEY', onChange: (event) => setConfig({ ...config, keyRef: event.target.value }) })),
                  ),
                  LField({ label: '请求头' }, h('textarea', { style: { ...UI.textarea, ...UI.mono }, value: config.headersText, placeholder: 'Authorization: Bearer {key}', onChange: (event) => setConfig({ ...config, headersText: event.target.value }) })),
                  config.method === 'POST'
                    ? LField({ label: '请求体' }, h('textarea', { style: { ...UI.textarea, ...UI.mono }, value: config.body, onChange: (event) => setConfig({ ...config, body: event.target.value }) }))
                    : null,
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
                      h('span', { style: UI.label }, '返回字段'),
                      h('button', { type: 'button', style: { ...UI.link, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }, onClick: () => setConfig({ ...config, extract: [...config.extract, { label: '', path: '' }] }) }, '+ 添加字段'),
                    ),
                    ...config.extract.map((entry, index) =>
                      h(
                        'div',
                        { key: index, style: { display: 'grid', gridTemplateColumns: '4fr 7fr 32px', gap: '8px', alignItems: 'center' } },
                        h('input', { style: { ...UI.cellInput, height: '28px' }, value: entry.label, placeholder: '5 小时已用%', onChange: (event) => setExtract(index, 'label', event.target.value) }),
                        h('input', { style: { ...UI.cellInput, height: '28px', ...UI.mono }, value: entry.path, placeholder: 'usage.rolling.percent', onChange: (event) => setExtract(index, 'path', event.target.value) }),
                        h('button', { type: 'button', style: UI.iconBtn, onClick: () => setConfig({ ...config, extract: config.extract.filter((_, at) => at !== index) }) }, h(Icon, { name: 'x', size: 12 })),
                      ),
                    ),
                  ),
                )
              : null,
          ),
        ),
      )
    }

    /** Config pane: basic fields, the credential drawer, then the model table. */
    function ConfigPane({ draft, row, mode, catalog, onChange }) {
      const creating = mode === 'create'
      const [credOpen, setCredOpen] = React.useState(false)
      const [discoverOpen, setDiscoverOpen] = React.useState(false)
      const [endpointCache, setEndpointCache] = React.useState(null)
      const [endpointBusy, setEndpointBusy] = React.useState(false)
      const [endpointError, setEndpointError] = React.useState(null)
      const [pickerIndex, setPickerIndex] = React.useState(null)
      const pickerRef = React.useRef(null)
      const entry = (Array.isArray(catalog) ? catalog : []).find((item) => item.provider === draft.provider)
      const catalogRoute = entry !== undefined && entry.declared === false
      const keyConfigured = row ? row.keyConfigured === true : false
      const endpointKey = JSON.stringify([draft.provider, draft.baseURL, draft.apiKeyEnv, draft.headersText, draft.apiKey])
      const endpointModels = endpointCache !== null && endpointCache.key === endpointKey ? endpointCache.models : null

      async function loadRowModels(force) {
        if (!force && endpointModels !== null) return
        if (endpointBusy) return
        if (String(draft.provider ?? '').trim().length === 0 || (!catalogRoute && String(draft.baseURL ?? '').trim().length === 0)) {
          setEndpointError('先填写提供商 ID 和接口地址')
          return
        }
        setEndpointBusy(true)
        setEndpointError(null)
        try {
          const typedKey = String(draft.apiKey ?? '').trim()
          const body = await call('/discover', {
            method: 'POST',
            body: JSON.stringify({
              provider: draft.provider,
              baseURL: draft.baseURL,
              apiKeyEnv: draft.apiKeyEnv,
              headers: parseHeaderLines(draft.headersText),
              ...(typedKey.length > 0 ? { apiKey: typedKey } : {}),
            }),
          })
          if (!body.ok) throw new Error(body.message ?? '无法读取模型列表')
          setEndpointCache({ key: endpointKey, models: Array.isArray(body.models) ? body.models : [] })
        } catch (error) {
          setEndpointError(String(error && error.message ? error.message : error))
        } finally {
          setEndpointBusy(false)
        }
      }

      React.useEffect(() => {
        if (pickerIndex !== null && pickerRef.current && typeof pickerRef.current.scrollIntoView === 'function') {
          pickerRef.current.scrollIntoView({ block: 'nearest', behavior: 'auto' })
        }
      }, [pickerIndex, endpointBusy, endpointCache, endpointError])

      function availableRowModels(index) {
        return endpointModels === null ? [] : endpointModels.filter((model) => !draft.models.some((item, at) => at !== index && item.id === model.id))
      }

      function toggleRowPicker(index) {
        if (pickerIndex === index) {
          setPickerIndex(null)
          return
        }
        setPickerIndex(index)
        void loadRowModels(false)
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '26px' } },

        h(
          'div',
          { style: UI.panel },
          h(
            'div',
            { style: UI.panelHead },
            h('div', { style: UI.sectionTitle }, h('span', { style: UI.accent }), '基本信息', creating ? null : h('span', { style: { ...UI.count, fontFamily: 'var(--dsw-font-markdown-code-block, ui-monospace, monospace)' }, title: '提供商 ID' }, draft.provider)),
          ),
          h(
            'div',
            { style: UI.grid2 },
            creating ? LField({ label: 'ID', required: true }, h('input', {
              style: { ...UI.input, ...UI.mono, ...(creating ? {} : UI.inputDisabled) },
              value: draft.provider,
              disabled: !creating,
              title: creating ? undefined : '保存后 ID 不可修改；需要改名请新建一个提供商',
              placeholder: 'opencode-zen',
              onChange: (event) => onChange({ ...draft, provider: event.target.value }),
            })) : null,
            LField({ label: '显示名称' }, h('input', {
              style: UI.input,
              value: draft.displayName,
              placeholder: '默认同 ID',
              onChange: (event) => onChange({ ...draft, displayName: event.target.value }),
            })),
            catalogRoute
              ? null
              : LField({ label: '接口地址 Base URL', required: true }, h('input', {
                  style: { ...UI.input, ...UI.mono },
                  value: draft.baseURL,
                  placeholder: 'https://api.example.com/v1',
                  onChange: (event) => onChange({ ...draft, baseURL: event.target.value }),
                })),
            LField({ label: '接口协议' }, h(Select, {
              value: draft.api,
              options: [
                ...(catalogRoute ? [{ value: '', label: '沿用内置目录' }] : []),
                ...API_OPTIONS.map((option) => ({ value: option, label: API_LABEL[option] })),
              ],
              onChange: (api) => onChange({ ...draft, api }),
              style: { ...UI.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '10px' },
            })),
          ),
          catalogRoute
            ? h('div', { style: UI.muted }, `内置目录路由：端点由 pi-ai 提供${entry.nativeAuth === true ? '，Key 也由它自己管' : ''}；要自定义端点请换一个目录里没有的 ID。`)
            : null,
          looksLikeSecret(draft.displayName)
            ? h('div', { style: UI.errText }, '显示名看起来是 API Key；它会明文写进配置，密钥请填在下方的 API Key 里。')
            : null,

          h(
            'div',
            { style: UI.divide },
            h(
              'button',
              { type: 'button', style: UI.drawer, 'aria-expanded': credOpen, onClick: () => setCredOpen(!credOpen) },
              h(
                'span',
                { style: UI.drawerLeft },
                h(Icon, { name: 'chevronRight', size: 12, style: { transform: credOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease', color: 'var(--dsw-alias-label-tertiary, #888)' } }),
                '密钥与请求头',
              ),
              h(
                'span',
                { style: UI.drawerRight },
                h('span', { style: UI.link }, credOpen ? '收起' : '展开'),
              ),
            ),
            credOpen
              ? h(
                  'div',
                  { style: { ...UI.grid2, marginTop: '10px' } },
                  LField({ label: '凭据引用' }, h('input', {
                    style: { ...UI.input, ...UI.mono },
                    value: draft.apiKeyEnv,
                    placeholder: 'OPENCODE_API_KEY',
                    onChange: (event) => onChange({ ...draft, apiKeyEnv: event.target.value }),
                  })),
                  LField({ label: keyConfigured ? 'API Key（已配置，留空不改动）' : 'API Key' }, h('input', {
                    type: 'password',
                    autoComplete: 'off',
                    spellCheck: false,
                    style: { ...UI.input, ...UI.mono },
                    value: draft.apiKey ?? '',
                    placeholder: keyConfigured ? '留空沿用已有 Key' : '粘贴 Key',
                    onChange: (event) => onChange({ ...draft, apiKey: event.target.value }),
                  })),
                  LField({ label: '自定义请求头（每行 名称: 值）', span: true }, h('textarea', {
                    style: { ...UI.textarea, ...UI.mono },
                    value: draft.headersText,
                    placeholder: 'x-opencode-session: {uuid}',
                    onChange: (event) => onChange({ ...draft, headersText: event.target.value }),
                  })),
                )
              : null,
          ),
        ),

        h(
          'div',
          { style: { ...UI.panel, ...UI.divide } },
          h(
            'div',
            { style: UI.panelHead },
            h('div', { style: UI.sectionTitle }, h('span', { style: UI.accent }), '模型', h('span', { style: UI.count }, String(draft.models.length))),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' } },
              h('button', { style: UI.outBtn, onClick: () => setDiscoverOpen(!discoverOpen) }, discoverOpen ? '收起导入' : '批量导入'),
              h('button', {
                style: UI.outBtn,
                onClick: () => onChange({ ...draft, models: [...draft.models, { id: '', name: '', contextWindow: 0, image: false }] }),
              }, h(Icon, { name: 'plus', size: 12 }), '添加模型'),
            ),
          ),

          draft.models.length === 0
            ? h('div', { style: UI.empty }, '暂无模型。可批量导入，也可添加一行后选择。')
            : h(
                'div',
                { style: UI.table },
                h(
                  'div',
                  { style: UI.th },
                  h('span', null, '模型 ID'),
                  h('span', null, '显示名称'),
                  h('span', null, '上下文窗口'),
                  h('span', { style: { textAlign: 'center' } }, '端点'),
                  h('span', { style: { textAlign: 'center' } }, '图片'),
                  h('span', null, ''),
                ),
                ...draft.models.flatMap((model, index) => [
                  h(
                    'div',
                    { key: `model-row-${index}`, style: UI.tr },
                    h('input', {
                      style: { ...UI.cellInput, ...UI.mono },
                      value: model.id,
                      title: model.id,
                      placeholder: 'deepseek-v4.1-flash',
                      onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, id: event.target.value } : item)) }),
                    }),
                    h('input', {
                      style: UI.cellInput,
                      value: model.name,
                      title: model.name,
                      placeholder: '显示名称',
                      onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, name: event.target.value } : item)) }),
                    }),
                    h(
                      'div',
                      { style: UI.ctxWrap },
                      h('input', {
                        style: { ...UI.cellInput, ...UI.mono },
                        inputMode: 'numeric',
                        value: String(model.contextWindow || ''),
                        onChange: (event) => {
                          const digits = event.target.value.replace(/[^0-9]/g, '')
                          onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, contextWindow: digits.length === 0 ? 0 : Number(digits) } : item)) })
                        },
                      }),
                    ),
                    h('button', {
                      type: 'button',
                      style: { ...UI.outBtn, width: '100%', minHeight: '30px', padding: '0 4px', justifyContent: 'center', fontSize: '11px' },
                      'aria-label': `为第 ${index + 1} 行选择端点模型`,
                      'aria-expanded': pickerIndex === index,
                      'aria-controls': `dsh-pp-model-picker-${index}`,
                      onClick: () => toggleRowPicker(index),
                    }, '选择'),
                    h('input', {
                      type: 'checkbox',
                      checked: model.image === true,
                      title: model.image ? '允许在会话中发送图片（input: [text, image]）' : '仅文本；勾选后允许发送图片',
                      style: { justifySelf: 'center', margin: 0, width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--dsw-alias-brand-primary, #4d6bfe)' },
                      onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, image: event.target.checked } : item)) }),
                    }),
                    h('button', {
                      type: 'button',
                      style: { ...UI.iconBtn, color: 'var(--dsw-alias-label-secondary, #68717b)' },
                      title: `移除模型 ${model.id || index + 1}`,
                      'aria-label': `移除模型 ${model.id || index + 1}`,
                      onClick: () => {
                        onChange({ ...draft, models: draft.models.filter((_, at) => at !== index) })
                        setPickerIndex(null)
                      },
                    }, h(Icon, { name: 'trash', size: 14 })),
                  ),
                  pickerIndex === index
                    ? h(
                        'div',
                        { key: `model-picker-${index}`, id: `dsh-pp-model-picker-${index}`, ref: pickerRef, style: UI.modelPicker },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
                          h('strong', { style: { fontSize: '12px', fontWeight: 600 } }, '从端点选择模型'),
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                            h('button', { type: 'button', style: UI.outBtn, onClick: () => void loadRowModels(true) }, '刷新'),
                            h('button', { type: 'button', style: UI.outBtn, onClick: () => setPickerIndex(null) }, '收起'),
                          ),
                        ),
                        endpointBusy
                          ? h('div', { style: UI.empty }, '正在读取端点模型…')
                          : endpointError
                            ? h('div', { style: UI.errText }, endpointError)
                            : endpointModels === null
                              ? h('div', { style: UI.empty }, '等待读取端点模型')
                              : availableRowModels(index).length === 0
                                ? h('div', { style: UI.empty }, endpointModels.length === 0 ? '端点未返回模型' : '没有其他可选模型')
                                : h(
                                    'div',
                                    { role: 'listbox', 'aria-label': '端点模型', style: UI.modelPickerList },
                                    ...availableRowModels(index).map((option) =>
                                      h(
                                        'button',
                                        {
                                          key: option.id,
                                          type: 'button',
                                          role: 'option',
                                          'aria-selected': false,
                                          style: UI.modelOption,
                                          title: option.id,
                                          onClick: () => {
                                            onChange({ ...draft, models: replaceModelAt(draft.models, index, option) })
                                            setPickerIndex(null)
                                          },
                                        },
                                        h('span', { style: UI.modelOptionName }, option.name || option.id),
                                        h('span', { style: UI.modelOptionId }, option.id),
                                      ),
                                    ),
                                  ),
                      )
                    : null,
                ]),
              ),

          discoverOpen
            ? h(DiscoveryPanel, {
                draft,
                onImport: (models) => {
                  const merged = draft.models.filter((model) => String(model.id).trim().length > 0)
                  for (const model of models) if (!merged.some((entry) => entry.id === model.id)) merged.push(model)
                  onChange({ ...draft, models: merged })
                },
              })
            : null,
        ),
      )
    }

    /**
     * One gateway. Collapsed it is a single row; open it carries its own tabs,
     * its own draft and one save action for whichever pane is showing.
     */
    function ProviderCard({ row, mode, open, onToggle, catalog, probe, onProbe, onDelete, onSaved, onRefresh, onClose, onError, onNotice }) {
      const creating = mode === 'create'
      const [seenOpen, setSeenOpen] = React.useState(open)
      const [tab, setTab] = React.useState('config')
      const [busy, setBusy] = React.useState(false)
      const [usageBusy, setUsageBusy] = React.useState(false)
      const [draft, setDraft] = React.useState(() => (creating ? emptyDraft() : draftFrom(row)))
      const [usageDirty, setUsageDirty] = React.useState(false)
      const [resetVersion, setResetVersion] = React.useState(0)
      const usageApi = React.useRef(null)

      React.useEffect(() => {
        if (open) setSeenOpen(true)
      }, [open])

      const entry = (Array.isArray(catalog) ? catalog : []).find((item) => item.provider === draft.provider)
      const catalogRoute = entry !== undefined && entry.declared === false
      const displayName = draft.displayName || draft.provider || '未命名'
      const keyConfigured = creating ? false : row ? row.keyConfigured === true : false
      const noReference = creating ? false : row ? row.keyReason === 'no-reference' : false
      const probeBody = probe && probe.busy !== true ? probe.body : null
      const pingOk = probeBody !== null && probeBody !== undefined && probeBody.ok === true
      const dirty = JSON.stringify(draft) !== JSON.stringify(creating ? emptyDraft() : draftFrom(row)) || usageDirty

      function toggle() {
        onToggle()
      }

      async function saveConfig() {
        const baseURL = String(draft.baseURL ?? '').trim()
        if (!catalogRoute && baseURL.length === 0) {
          onError('手写路由必须填 baseURL（pi-ai 的目录里没有这条 provider）。')
          return
        }
        const typedKey = String(draft.apiKey ?? '').trim()
        if (typedKey.length > 0 && String(draft.apiKeyEnv ?? '').trim().length === 0) {
          onError('填了 API Key，但「凭据引用」还是空的：给它一个名字（例如 OPENCODE_API_KEY）。')
          return
        }
        setBusy(true)
        try {
          let models = modelsForSave(draft)
          if (!catalogRoute && models.length === 0) {
            const found = await call('/discover', {
              method: 'POST',
              body: JSON.stringify({
                provider: draft.provider,
                baseURL,
                apiKeyEnv: draft.apiKeyEnv,
                ...(typedKey.length > 0 ? { apiKey: typedKey } : {}),
                headers: parseHeaderLines(draft.headersText),
              }),
            })
            models = (Array.isArray(found && found.models) ? found.models : []).map((model) => ({
              id: model.id,
              name: model.name ?? model.id,
              ...(Number.isInteger(model.contextWindow) && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
              input: (model.suggestedInput ?? ['text']).includes('image') ? ['text', 'image'] : ['text'],
            }))
            if (models.length === 0) {
              onError(found && found.ok === false ? String(found.message ?? '端点没有返回模型。') : '端点没有返回模型：先用「批量导入」添加模型，再保存。')
              return
            }
          }
          const payload = {
            provider: draft.provider,
            displayName: draft.displayName,
            api: draft.api,
            baseURL,
            apiKeyEnv: draft.apiKeyEnv,
            headers: parseHeaderLines(draft.headersText),
            models,
          }
          if (typedKey.length > 0) payload.apiKey = typedKey
          const body = await call('/provider', { method: 'POST', body: JSON.stringify(payload) })
          const savedRow = Array.isArray(body && body.providers) ? body.providers.find((item) => item.provider === draft.provider) : null
          setDraft(savedRow ? draftFrom(savedRow) : (current) => ({ ...current, apiKey: '' }))
          onSaved(body, draft.provider)
        } catch (err) {
          onError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      function cancel() {
        if (creating) {
          onClose()
          return
        }
        setDraft(draftFrom(row))
        setUsageDirty(false)
        setUsageBusy(false)
        setResetVersion((current) => current + 1)
        usageApi.current = null
        onClose()
      }

      return h(
        'div',
        { style: { ...UI.card, ...(open ? UI.cardOpen : {}) } },

        h(
          'div',
          { style: UI.cardHead, onClick: toggle },
          h('span', { style: { ...UI.dot, ...(pingOk ? UI.dotOn : probe && probe.busy === true ? UI.dotBusy : {}) } }),
          h('span', { style: UI.name }, displayName),
          h(
            'span',
            { style: UI.pills },
            keyConfigured ? h('span', { style: UI.pill }, '已就绪') : null,
            !keyConfigured && noReference ? h('span', { style: UI.pill }, '无凭据引用') : null,
            dirty ? h('span', { style: { ...UI.pill, color: 'var(--dsw-alias-state-warn-primary, #b45309)' } }, '未保存') : null,
            pingOk
              ? h('span', { style: { ...UI.pill, ...UI.pillOk }, title: probeText(probeBody) }, '连通正常')
              : probeBody !== null && probeBody !== undefined
                ? h('span', { style: { ...UI.pill, ...UI.pillWarn }, title: probeText(probeBody) }, '连通失败')
                : probe && probe.busy === true
                  ? h('span', { style: { ...UI.pill, ...UI.pillWarn } }, '正在测速…')
                  : null,
          ),
          h(
            'span',
            { style: UI.actions, onClick: (event) => event.stopPropagation() },
            h('button', { style: UI.outBtn, onClick: toggle }, open ? '收起' : creating ? '继续' : '编辑'),
          ),
        ),

        open || seenOpen
          ? h(
              'div',
              { key: resetVersion, style: { ...UI.tray, display: open ? 'flex' : 'none' } },
              h(
                'div',
                { style: UI.trayHead },
                h(
                  'div',
                  { style: UI.seg, role: 'tablist', 'aria-label': '提供商设置' },
                  h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'config', style: { ...UI.segBtn, ...(tab === 'config' ? UI.segOn : {}) }, onClick: () => setTab('config') }, '模型配置'),
                  h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'usage', style: { ...UI.segBtn, ...(tab === 'usage' ? UI.segOn : {}) }, onClick: () => setTab('usage') }, '用量查询'),
                ),
              ),

              h('div', { style: { display: tab === 'config' ? 'block' : 'none' } }, h(ConfigPane, { draft, row, mode, catalog, onChange: setDraft })),
              h('div', { style: { display: tab === 'usage' ? 'block' : 'none' } }, h(UsagePane, {
                    provider: creating ? draft.provider : row.provider,
                    baseURL: creating ? draft.baseURL : row.baseURL,
                    apiKeyEnv: creating ? draft.apiKeyEnv : row.apiKeyEnv,
                    initial: creating ? null : row.usage,
                    initialResult: creating ? null : row.usageResult,
                    onApi: (api) => {
                      usageApi.current = api
                    },
                    onRefresh: () => (creating ? undefined : onRefresh()),
                    onError,
                    onDirtyChange: setUsageDirty,
                    onBusyChange: setUsageBusy,
                  })),
              tab === 'config' ? h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '14px', borderTop: '1px solid var(--dsw-alias-border-l1, #e1e4e8)' } },
                creating ? null : h('button', { style: UI.outBtn, onClick: () => onProbe(), disabled: probe && probe.busy === true }, h(Icon, { name: 'bolt', size: 12 }), probe && probe.busy === true ? '测速中…' : '测连通'),
                probeBody !== null && probeBody !== undefined ? h('span', { style: pingOk ? UI.okText : UI.errText, title: probeText(probeBody) }, pingOk ? `HTTP ${probeBody.status} · ${probeBody.elapsed}ms · ${probeBody.modelCount} 个模型` : probeText(probeBody)) : null,
                onDelete ? h('button', { style: { ...UI.ghost, color: 'var(--dsw-alias-state-error-primary, #c33)' }, onClick: () => onDelete() }, '删除提供商') : null,
              ) : null,
              h(
                'div',
                { style: UI.footer },
                h('span', { style: UI.muted }, tab === 'config' ? '模型配置' : '用量查询'),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' } },
                  h('button', { style: UI.ghost, onClick: cancel }, '取消'),
                  h(
                    'button',
                    {
                      style: { ...UI.solid, opacity: busy || usageBusy ? 0.7 : 1 },
                      disabled: busy || usageBusy,
                      onClick: () => {
                        if (tab === 'config') void saveConfig()
                        else if (usageApi.current !== null) void usageApi.current.save(false)
                      },
                    },
                    busy || usageBusy ? '保存中…' : '保存',
                  ),
                ),
              ),
            )
          : null,
      )
    }

    /** The page: header with the three actions, then one card per gateway. */
    function ProvidersPage() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [creating, setCreating] = React.useState(false)
      const [activeProvider, setActiveProvider] = React.useState(null)
      const [probes, setProbes] = React.useState({})
      const [refreshing, setRefreshing] = React.useState(false)
      const rootRef = React.useRef(null)

      async function reload() {
        try {
          setState(await call('/state'))
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      React.useEffect(() => {
        void reload()
      }, [])

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

      async function probe(provider) {
        setProbes((current) => ({ ...current, [provider]: { busy: true } }))
        try {
          const body = await call('/probe', { method: 'POST', body: JSON.stringify({ provider }) })
          setProbes((current) => ({ ...current, [provider]: { busy: false, body } }))
        } catch (err) {
          setProbes((current) => ({ ...current, [provider]: { busy: false, body: { ok: false, message: String(err && err.message ? err.message : err) } } }))
        }
      }

      async function probeAll() {
        const list = state && Array.isArray(state.providers) ? state.providers : []
        setRefreshing(true)
        try {
          for (const row of list) await probe(row.provider)
        } finally {
          setRefreshing(false)
        }
      }

      async function remove(row) {
        const ok = typeof window === 'undefined' || typeof window.confirm !== 'function' ? true : window.confirm(`删除 provider “${row.provider}”？（模型会立刻从选择器消失）`)
        if (!ok) return
        try {
          setState(await call(`/provider?provider=${encodeURIComponent(row.provider)}`, { method: 'DELETE' }))
          setActiveProvider((current) => current === row.provider ? null : current)
          setNotice(`已删除 ${row.provider}`)
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const providers = state && Array.isArray(state.providers) ? state.providers : []
      const catalog = state && Array.isArray(state.catalog) ? state.catalog : []

      return h(
        'div',
        { style: UI.page, ref: rootRef, className: 'dsh-pp', spellCheck: false },

        h(
          'div',
          { style: UI.head },
          h(
            'div',
            { style: UI.headTop },
            h('div', { style: UI.headLeft }, h('h2', { style: UI.title }, '模型增强'), h('span', { style: UI.badge }, `${providers.length} 个网关`)),
            h(
              'div',
              { style: UI.headActions },
              h('button', {
                style: UI.ghost,
                title: '用量模板保存在 $DSH_HOME/storages/dsh-provider-plus/usage.json',
                onClick: () => setNotice('用量模板：$DSH_HOME/storages/dsh-provider-plus/usage.json · provider 配置：设置 → 模型'),
              }, h(Icon, { name: 'code', size: 12 }), '配置文件'),
              h('button', { style: UI.ghost, onClick: () => void probeAll(), disabled: refreshing }, h(Icon, { name: 'refresh', size: 12 }), refreshing ? '测速中…' : '全量测速'),
            ),
          ),
          h('p', { style: { ...UI.muted, margin: 0 } }, '管理自定义提供商、模型能力与用量查询。'),
        ),

        error !== null ? h('div', { style: UI.errText }, error) : null,
        notice !== null ? h('div', { style: UI.muted }, notice) : null,

        providers.length === 0 && creating === false
          ? h('div', { style: UI.empty }, '还没有任何提供商。')
          : null,

        ...providers.map((row) =>
          h(ProviderCard, {
            key: row.provider,
            mode: 'edit',
            row,
            open: activeProvider === row.provider,
            onToggle: () => setActiveProvider((current) => current === row.provider ? null : row.provider),
            catalog,
            probe: probes[row.provider] ?? null,
            onProbe: () => void probe(row.provider),
            onDelete: () => void remove(row),
            onSaved: (body, provider) => {
              setState(body)
              setNotice(`已保存 ${provider}`)
            },
            onRefresh: reload,
            onClose: () => setActiveProvider(null),
            onError: setError,
            onNotice: setNotice,
          }),
        ),
        creating
          ? h(ProviderCard, {
              key: '__new',
              mode: 'create',
              row: null,
              open: activeProvider === '__new',
              onToggle: () => setActiveProvider((current) => current === '__new' ? null : '__new'),
              catalog,
              probe: null,
              onProbe: () => {},
              onDelete: null,
              onClose: () => {
                setCreating(false)
                setActiveProvider(null)
              },
              onSaved: (body) => {
                setCreating(false)
                setActiveProvider(null)
                setState(body)
                setNotice('已保存新提供商。')
              },
              onRefresh: reload,
              onError: setError,
              onNotice: setNotice,
            })
          : null,
        h('button', { type: 'button', style: UI.addButton, onClick: () => { setCreating(true); setActiveProvider('__new') }, disabled: creating }, h(Icon, { name: 'plus', size: 14 }), '新建提供商'),
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
      const [open, setOpen] = React.useState(false)

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
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '9px', marginTop: '8px' } },
        h(
          'button',
          {
            type: 'button',
            style: S.disclosure,
            title: open ? '收起' : '图片支持与连通性',
            onClick: () => setOpen((current) => !current),
          },
          h('span', { style: { ...S.chevron, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' } }, '›'),
          total === 0 ? '图片 —' : `图片 ${imageCount}/${total}`,
        ),
        open
          ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0 } },
              probe !== null && probe.busy !== true && probe.body
                ? h(
                    'span',
                    {
                      title: probeText(probe.body),
                      style: { ...S.probeInline, maxWidth: '60%', ...(probe.body.ok === true ? S.okText : S.errText) },
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
            )
          : null,
      )
    }

    /**
     * One usage row as plain text: the unit always trails the number, so a quota
     * reads "5 小时已用 3.2%" instead of "5 小时已用% 3.2". Mirrors MetricCard,
     * which already strips a trailing "%" from the label and appends it to the
     * value; older templates carry no unit, so the label itself is the hint.
     */
    function usageRowText(row) {
      const label = row && row.label !== undefined && row.label !== null ? String(row.label) : ''
      const text = label.replace(/%\s*$/, '')
      const value = row ? row.value : undefined
      if (value === undefined || value === null) return `${text} —`
      const numeric =
        typeof value === 'number'
        || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      if (numeric !== true) return `${text} ${String(value)}`
      const num = Number(value)
      if (row && row.unit === '$') return `${text} $${num}`
      const percentStyle =
        (row && row.unit === '%')
        || ((row && (row.unit === undefined || row.unit === '')) && /%\s*$/.test(label))
      return percentStyle === true ? `${text} ${num}%` : `${text} ${num}`
    }

    /**
     * Composer toolbar chip: the last usage result of every provider that has
     * one, so quota is readable without opening Settings. Click to expand.
     */
    function UsageActivity(props) {
      // The composer knows the session's selection through the durable
      // `modelSelection` projection; the chip follows that provider only.
      const useProjection = typeof props?.useProjection === 'function' ? props.useProjection : () => undefined
      const selection = useProjection('modelSelection', (value) => (value && (value.next ?? value.lastUsed)) || null)
      const providerId = selection && typeof selection.provider === 'string' ? selection.provider : ''
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)

      async function load() {
        try {
          setState(await call('/state'))
        } catch {
          /* Offline or not configured yet; the chip simply stays hidden. */
        }
      }

      React.useEffect(() => {
        void load()
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        function onPointerDown(event) {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [open])

      const rows = ((state && Array.isArray(state.providers) ? state.providers : []) ?? []).filter(
        (item) =>
          item.provider === providerId
          && item.usage
          && item.usage.mode === 'http'
          && item.usageResult
          && Array.isArray(item.usageResult.rows)
          && item.usageResult.rows.length > 0,
      )
      if (providerId.length === 0 || rows.length === 0) return null

      return h(
        'div',
        { ref: rootRef, style: { position: 'relative', display: 'flex', alignItems: 'center' } },
        h(
          'button',
          {
            type: 'button',
            style: S.activityChip,
            title: '当前模型所属提供商的最近一次用量',
            onClick: () => {
              const next = !open
              setOpen(next)
              if (next) void load()
            },
          },
          '用量总览',
        ),
        open
          ? h(
              'div',
              { style: S.activityPanel },
              ...rows.map((item) =>
                h(
                  'div',
                  { key: item.provider, style: S.activityRow },
                  h('span', { style: { fontWeight: 600 } }, item.displayName || item.provider),
                  h('span', { style: S.hint }, item.usageResult.rows.map(usageRowText).join(' · ')),
                  h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #666)' } }, item.usageResult.at ? new Date(item.usageResult.at).toLocaleString('zh-CN', { hour12: false }) : ''),
                ),
              ),
            )
          : null,
      )
    }

    /**
     * The settings shell maps a section id to a glyph with a hard-coded table
     * (models, account, plugins, …) and gives unknown ids the gear; the
     * `settings.section` registration has no icon option. Point the rendered
     * sprite reference at the Models glyph instead, and re-apply whenever the
     * shell rebuilds its navigation.
     */
    function useModelsNavIcon() {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      const target = '#dsw-icon-data-outline-medium'
      let queued = false
      function apply() {
        queued = false
        for (const button of document.querySelectorAll('nav button')) {
          if (!button.textContent || !button.textContent.includes('模型增强')) continue
          const use = button.querySelector('svg use')
          if (use !== null && use.getAttribute('href') !== target) use.setAttribute('href', target)
        }
      }
      function schedule() {
        if (queued) return
        queued = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply)
        else setTimeout(apply, 0)
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
      apply()
      return () => observer.disconnect()
    }

    function apply(ctx) {
      // Inline styles cannot reach ::placeholder, so the lighter hint colour
      // lives in one scoped rule. Chromium's default grey is too dark against
      // the panel background and ignores the theme in dark mode.
      try {
        if (typeof document !== 'undefined' && document.getElementById('dsh-provider-plus-placeholder') === null) {
          const style = document.createElement('style')
          style.id = 'dsh-provider-plus-placeholder'
          style.textContent =
            '.dsh-pp input::placeholder,.dsh-pp textarea::placeholder{color:var(--dsw-alias-label-secondary,#555);opacity:.45}'
          document.head.appendChild(style)
        }
      } catch (error) {
        console.warn('[dsh-provider-plus] placeholder style failed:', error)
      }
      try {
        const stop = useModelsNavIcon()
        if (typeof ctx.effect === 'function') ctx.effect(() => stop)
      } catch (error) {
        console.warn('[dsh-provider-plus] nav icon swap failed:', error)
      }
      try {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'provider-plus', order: 11, label: () => '模型增强' }, ProvidersPage),
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
      try {
        ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register({ name: 'conversation.input.activity' }, UsageActivity),
        )
      } catch (error) {
        console.error('[dsh-provider-plus] usage activity failed to register:', error)
      }
    }

    return { name: 'dsh-provider-plus', inject, apply, __test: { ConfigPane, replaceModelAt } }
  },
})
