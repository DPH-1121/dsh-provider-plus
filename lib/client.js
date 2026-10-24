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
        background: 'var(--dsw-alias-label-primary, #111)',
        color: 'var(--dsw-alias-bg-base, #fff)',
        whiteSpace: 'nowrap',
      },
      disclosure: {
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '18px',
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-tertiary, #7a7a7a)',
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
        borderColor: 'transparent',
        background: 'var(--dsw-alias-label-primary, #111)',
        color: 'var(--dsw-alias-bg-base, #fff)',
      },
      activityChip: {
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '18px',
        padding: '1px 8px',
        borderRadius: '999px',
        cursor: 'pointer',
        border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #666)',
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
        gap: '6px',
        padding: '8px 10px',
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
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-primary, #111)',
      },
      activityHead: {
        fontSize: '10px',
        lineHeight: '14px',
        color: 'var(--dsw-alias-label-tertiary, #666)',
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
    function Select({ value, options, onChange, style, disabled }) {
      const [open, setOpen] = React.useState(false)
      const [active, setActive] = React.useState(0)
      const [up, setUp] = React.useState(false)
      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const current = options.find((option) => option.value === value) ?? options[0]

      React.useEffect(() => {
        if (!open) return undefined
        function onPointerDown(event) {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [open])

      function openMenu() {
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
          setUp(below < 140 && above > below)
        }
        setOpen(true)
      }

      function choose(index) {
        const option = options[index]
        if (option === undefined) return
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
          style: { position: 'relative', width: '100%', minWidth: 0, ...(style ?? {}) },
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
          },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current === undefined ? '' : current.label),
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
                    style: {
                      ...S.button,
                      width: '100%',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      textAlign: 'left',
                      background: index === active ? 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.05))' : 'transparent',
                      color: option.value === value ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'var(--dsw-alias-label-primary, #111)',
                    },
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
      page: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 16px 18px 0' },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minWidth: 0, flexWrap: 'nowrap' },
      headLeft: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '0 1 auto' },
      title: { margin: 0, fontSize: '17px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap' },
      badge: { fontSize: '11px', lineHeight: '18px', padding: '0 8px', borderRadius: '999px', border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', color: 'var(--dsw-alias-label-secondary, #555)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      headActions: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto', whiteSpace: 'nowrap' },
      ghost: { height: '28px', padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', lineHeight: '1', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #555)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      solid: { height: '28px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', lineHeight: '1', borderRadius: '8px', border: 'none', background: 'var(--dsw-alias-label-primary, #111)', color: 'var(--dsw-alias-bg-base, #fff)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      card: { border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', borderRadius: '12px', background: 'var(--dsw-alias-bg-base, #fff)', overflow: 'hidden' },
      cardOpen: { borderColor: 'var(--dsw-alias-border-l2, #0000001f)', boxShadow: '0 1px 3px rgba(17, 24, 39, 0.06)' },
      cardHead: { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', minWidth: 0, cursor: 'pointer' },
      dot: { width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto', background: 'var(--dsw-alias-state-idle-primary, #c2c8d0)' },
      dotOn: { background: 'var(--dsw-alias-state-success-primary, #10b981)', boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.14)' },
      dotBusy: { background: 'var(--dsw-alias-state-warn-primary, #f59e0b)' },
      name: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' },
      pills: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', lineHeight: '18px', padding: '0 7px', borderRadius: '6px', border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', color: 'var(--dsw-alias-label-secondary, #555)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      pillOk: { color: 'var(--dsw-alias-state-success-primary, #0a7)', borderColor: 'transparent', background: 'rgba(16, 185, 129, 0.10)' },
      pillWarn: { color: 'var(--dsw-alias-state-warn-primary, #b45309)', borderColor: 'transparent', background: 'rgba(245, 158, 11, 0.12)' },
      pillAccent: { color: 'var(--dsw-alias-brand-primary, #4d6bfe)', borderColor: 'transparent', background: 'rgba(77, 107, 254, 0.10)' },
      actions: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto', marginLeft: 'auto' },
      iconBtn: { width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #888)', cursor: 'pointer', flex: '0 0 auto' },
      tray: { borderTop: '0.5px solid var(--dsw-alias-border-l1, #00000014)', background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.02))', padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: '12px' },
      trayHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 },
      seg: { display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px', background: 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.04))', border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', flex: '0 0 auto' },
      segBtn: { fontSize: '12px', lineHeight: '20px', padding: '0 10px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #555)', cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' },
      segOn: { background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #111)', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)' },
      panel: { border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', borderRadius: '10px', background: 'var(--dsw-alias-bg-base, #fff)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px' },
      panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 },
      sectionTitle: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap', minWidth: 0 },
      accent: { width: '3px', height: '14px', borderRadius: '2px', background: 'var(--dsw-alias-brand-primary, #4d6bfe)', flex: '0 0 auto' },
      count: { fontSize: '11px', lineHeight: '18px', padding: '0 6px', borderRadius: '4px', background: 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.04))', color: 'var(--dsw-alias-label-secondary, #555)' },
      grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
      label: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary, #555)', whiteSpace: 'nowrap' },
      req: { color: 'var(--dsw-alias-state-error-primary, #c33)' },
      input: { height: '30px', width: '100%', boxSizing: 'border-box', padding: '0 10px', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #111)', fontSize: '12px', outline: 'none' },
      textarea: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #111)', fontSize: '12px', outline: 'none', resize: 'vertical', minHeight: '50px' },
      mono: { fontFamily: 'var(--dsw-font-markdown-code-block, ui-monospace, monospace)', fontSize: '12px' },
      drawer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%', padding: '2px 0', border: 'none', background: 'transparent', cursor: 'pointer', minWidth: 0, textAlign: 'left' },
      drawerLeft: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      drawerRight: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0, justifyContent: 'flex-end', flex: '0 1 auto' },
      link: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary, #4d6bfe)', whiteSpace: 'nowrap', flex: '0 0 auto' },
      outBtn: { height: '26px', padding: '0 9px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', borderRadius: '7px', border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #555)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      outBtnAccent: { height: '26px', padding: '0 9px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', borderRadius: '7px', border: '0.5px solid transparent', background: 'rgba(77, 107, 254, 0.10)', color: 'var(--dsw-alias-brand-primary, #4d6bfe)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      table: { border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', borderRadius: '8px', overflow: 'hidden' },
      th: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 2fr) 132px 48px 32px', gap: '8px', alignItems: 'center', padding: '6px 10px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.02))', borderBottom: '0.5px solid var(--dsw-alias-border-l1, #00000014)' },
      tr: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 2fr) 132px 48px 32px', gap: '8px', alignItems: 'center', padding: '6px 10px', borderBottom: '0.5px solid var(--dsw-alias-border-l1, #00000014)' },
      cellInput: { height: '26px', width: '100%', boxSizing: 'border-box', padding: '0 8px', borderRadius: '6px', border: '0.5px solid var(--dsw-alias-border-l2, #0000001f)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #111)', fontSize: '12px', outline: 'none' },
      ctxWrap: { position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 },
      ctxBadge: { position: 'absolute', right: '5px', fontSize: '10px', lineHeight: '16px', padding: '0 4px', borderRadius: '4px', background: 'rgba(77, 107, 254, 0.10)', color: 'var(--dsw-alias-brand-primary, #4d6bfe)', pointerEvents: 'none' },
      visionOn: { borderColor: 'transparent', background: 'rgba(77, 107, 254, 0.10)', color: 'var(--dsw-alias-brand-primary, #4d6bfe)', justifyContent: 'center' },
      visionOff: { color: 'var(--dsw-alias-label-tertiary, #999)', justifyContent: 'center' },
      metrics: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' },
      metric: { height: '98px', padding: '10px 12px', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l1, #00000014)', background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.02))', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0, boxSizing: 'border-box' },
      metricLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #555)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      metricRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
      metricValue: { fontSize: '20px', fontWeight: 700, lineHeight: '1', color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap' },
      metricTag: { fontSize: '11px', whiteSpace: 'nowrap' },
      barTrack: { height: '5px', borderRadius: '999px', background: 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.06))', overflow: 'hidden' },
      barFill: { height: '100%', borderRadius: '999px', background: 'var(--dsw-alias-brand-primary, #4d6bfe)', transition: 'width .4s ease' },
      muted: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', whiteSpace: 'pre-wrap' },
      okText: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-state-success-primary, #0a7)', whiteSpace: 'pre-wrap' },
      errText: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary, #c33)', whiteSpace: 'pre-wrap' },
      presetRow: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
      presetLabel: { width: '56px', flex: '0 0 56px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #555)', whiteSpace: 'nowrap' },
      presetWrap: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 },
      chip: { fontSize: '11px', lineHeight: '22px', padding: '0 9px', borderRadius: '7px', border: '0.5px solid transparent', background: 'var(--dsw-specific-input-minor, rgba(0, 0, 0, 0.04))', color: 'var(--dsw-alias-label-secondary, #555)', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      chipOn: { background: 'var(--dsw-alias-label-primary, #111)', color: 'var(--dsw-alias-bg-base, #fff)' },
      empty: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #888)' },
      divide: { borderTop: '0.5px solid var(--dsw-alias-border-l1, #00000014)', paddingTop: '10px' },
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
    function LField({ label, required, children, span }) {
      return h(
        'label',
        { style: { ...UI.field, ...(span === true ? { gridColumn: '1 / -1' } : {}) } },
        h('span', { style: UI.label }, label, required === true ? h('span', { style: UI.req }, ' *') : null),
        children,
      )
    }

    /** 1000000 → 1M, 200000 → 200K; the badge next to the context input. */
    function formatContext(value) {
      const num = Number(value)
      if (!Number.isFinite(num) || num <= 0) return ''
      if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}M`
      if (num >= 1000) return `${Math.round(num / 1000)}K`
      return String(num)
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

    /** Split "5 小时已用%" / "通用余额" into the two preset rows the prototype has. */
    const PRESET_ROWS = [
      { key: 'template', label: '网关模板' },
      { key: 'plan', label: '厂商套餐' },
    ]

    /**
     * Usage pane: a quota overview on top, the query shape below, and the raw
     * HTTP mapping behind one disclosure. Save lives in the card header, so the
     * pane exposes its action through `onApi`.
     */
    function UsagePane({ provider, baseURL, apiKeyEnv, initial, initialResult, onApi, onRefresh, onError }) {
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
            setMessage(body.ok === true ? { ok: true, text: rows.length === 0 ? '查询成功，但配置里没有取值字段。' : '已拉取最新数据。' } : { ok: false, text: body.message ?? '查询失败' })
          } else {
            setMessage({ ok: true, text: '用量模板已保存。' })
          }
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

      const rows = result && Array.isArray(result.rows) ? result.rows : []
      const updated = result && result.at ? new Date(result.at).toLocaleString('zh-CN', { hour12: false }) : null
      const tiles = rows.length > 0 ? rows.slice(0, 3) : [null, null, null]
      const configured = config.mode === 'http' && String(config.url).trim().length > 0

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },

        h(
          'div',
          { style: UI.panel },
          h(
            'div',
            { style: UI.panelHead },
            h(
              'div',
              { style: UI.sectionTitle },
              h('span', { style: { ...UI.dot, background: 'var(--dsw-alias-state-success-primary, #10b981)' } }),
              '实时用量监控概览',
              h('span', { style: UI.muted }, updated === null ? '尚未拉取' : `更新于 ${updated}`),
            ),
            h(
              'button',
              { style: UI.outBtnAccent, onClick: () => void save(true), disabled: busy || !configured },
              h(Icon, { name: 'play', size: 12 }),
              busy ? '查询中…' : '立即拉取测试',
            ),
          ),
          h('div', { style: UI.metrics }, ...tiles.map((row, index) => h(MetricCard, { key: index, label: row ? row.label : '', value: row ? row.value : undefined, unit: row ? row.unit : undefined }))),
          message !== null ? h('div', { style: message.ok === true ? UI.okText : UI.errText }, message.text) : null,
        ),

        h(
          'div',
          { style: UI.panel },
          h(
            'div',
            { style: UI.grid2 },
            LField({ label: '查询方式' }, h(Select, {
              value: config.mode,
              options: [
                { value: 'none', label: '未配置' },
                { value: 'http', label: 'HTTP 模板（JSON 点路径提取）' },
              ],
              onChange: (mode) => setConfig({ ...config, mode }),
              style: { ...UI.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '10px' },
            })),
            LField({ label: '自动轮询间隔（分钟）' }, h('input', {
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
          h(
            'div',
            { style: { ...UI.divide, display: 'flex', flexDirection: 'column', gap: '8px' } },
            ...PRESET_ROWS.map((row) =>
              h(
                'div',
                { key: row.key, style: UI.presetRow },
                h('span', { style: UI.presetLabel }, row.label),
                h(
                  'div',
                  { style: UI.presetWrap },
                  ...USAGE_PRESET_TEMPLATES.filter((item) => item.group === row.key).map((item) =>
                    h(
                      'button',
                      {
                        key: item.id,
                        type: 'button',
                        style: { ...UI.chip, ...(preset === item.id ? UI.chipOn : {}) },
                        onClick: () => applyPreset(item.id),
                      },
                      item.label,
                    ),
                  ),
                ),
              ),
            ),
          ),
          h(
            'div',
            { style: UI.divide },
            h(
              'button',
              { type: 'button', style: UI.drawer, onClick: () => setRulesOpen(!rulesOpen) },
              h(
                'span',
                { style: UI.drawerLeft },
                h(Icon, { name: 'chevronRight', size: 12, style: { transform: rulesOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease', color: 'var(--dsw-alias-label-tertiary, #888)' } }),
                '接口请求与取值字段映射',
              ),
              h(
                'span',
                { style: UI.drawerRight },
                h('span', { style: UI.pill }, config.method || 'GET'),
                h('span', { style: UI.pill }, `${config.extract.length} 个映射字段`),
                h('span', { style: UI.link }, rulesOpen ? '收起规则' : '展开配置'),
              ),
            ),
            rulesOpen
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: { ...UI.grid2, gridTemplateColumns: '2fr 3fr 2fr', marginTop: '10px' } },
                    LField({ label: '方法' }, h(Select, {
                      value: config.method,
                      options: [
                        { value: 'GET', label: 'GET' },
                        { value: 'POST', label: 'POST' },
                      ],
                      onChange: (method) => setConfig({ ...config, method }),
                      style: { ...UI.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '10px' },
                    })),
                    LField({ label: '查询 Endpoint URL' }, h('input', { style: { ...UI.input, ...UI.mono }, value: config.url, placeholder: 'https://gateway.example.com/api/usage', onChange: (event) => setConfig({ ...config, url: event.target.value }) })),
                    LField({ label: '凭据引用（{key} 替换源）' }, h('input', { style: { ...UI.input, ...UI.mono }, value: config.keyRef, placeholder: 'OPENCODE_API_KEY', onChange: (event) => setConfig({ ...config, keyRef: event.target.value }) })),
                  ),
                  LField({ label: '请求头（每行 名称: 值，支持 {key}）' }, h('textarea', { style: { ...UI.textarea, ...UI.mono }, value: config.headersText, placeholder: 'Authorization: Bearer {key}', onChange: (event) => setConfig({ ...config, headersText: event.target.value }) })),
                  config.method === 'POST'
                    ? LField({ label: '请求体' }, h('textarea', { style: { ...UI.textarea, ...UI.mono }, value: config.body, onChange: (event) => setConfig({ ...config, body: event.target.value }) }))
                    : null,
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
                      h('span', { style: UI.label }, '取值字段映射'),
                      h('button', { type: 'button', style: { ...UI.link, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }, onClick: () => setConfig({ ...config, extract: [...config.extract, { label: '', path: '' }] }) }, '+ 增加字段'),
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
      const entry = (Array.isArray(catalog) ? catalog : []).find((item) => item.provider === draft.provider)
      const catalogRoute = entry !== undefined && entry.declared === false
      const keyConfigured = row ? row.keyConfigured === true : false
      const headersPresent = String(draft.headersText ?? '').trim().length > 0

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },

        h(
          'div',
          { style: UI.panel },
          h(
            'div',
            { style: UI.panelHead },
            h('div', { style: UI.sectionTitle }, h('span', { style: UI.accent }), '基本信息'),
            h('span', { style: { ...UI.mono, color: 'var(--dsw-alias-label-tertiary, #888)' } }, `ID: ${draft.provider || '—'}`),
          ),
          h(
            'div',
            { style: UI.grid2 },
            LField({ label: 'ID', required: true }, h('input', {
              style: { ...UI.input, ...UI.mono },
              value: draft.provider,
              disabled: !creating,
              placeholder: 'opencode-zen',
              onChange: (event) => onChange({ ...draft, provider: event.target.value }),
            })),
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
              { type: 'button', style: UI.drawer, onClick: () => setCredOpen(!credOpen) },
              h(
                'span',
                { style: UI.drawerLeft },
                h(Icon, { name: 'chevronRight', size: 12, style: { transform: credOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease', color: 'var(--dsw-alias-label-tertiary, #888)' } }),
                '凭据与请求头',
              ),
              h(
                'span',
                { style: UI.drawerRight },
                h('span', { style: UI.pill }, `引用: ${draft.apiKeyEnv || '未设置'}`),
                headersPresent ? h('span', { style: { ...UI.pill, ...UI.pillAccent } }, '含请求头') : null,
                h('span', { style: UI.link }, credOpen ? '收起' : '展开配置'),
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
          { style: UI.panel },
          h(
            'div',
            { style: UI.panelHead },
            h('div', { style: UI.sectionTitle }, h('span', { style: UI.accent }), '模型', h('span', { style: UI.count }, String(draft.models.length))),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' } },
              h('button', { style: UI.outBtn, onClick: () => setDiscoverOpen(!discoverOpen) }, discoverOpen ? '收起拉取' : '从端点拉取'),
              h('button', {
                style: UI.outBtn,
                onClick: () => onChange({ ...draft, models: [...draft.models, { id: '', name: '', contextWindow: 0, image: false }] }),
              }, h(Icon, { name: 'plus', size: 12 }), '添加模型'),
            ),
          ),

          draft.models.length === 0
            ? h('div', { style: UI.empty }, '还没有模型：保存时会自动向端点拉取，或点「从端点拉取」挑选。')
            : h(
                'div',
                { style: UI.table },
                h(
                  'div',
                  { style: UI.th },
                  h('span', null, '模型 ID'),
                  h('span', null, '显示名称'),
                  h('span', null, '上下文窗口'),
                  h('span', { style: { textAlign: 'center' } }, '图片'),
                  h('span', null, ''),
                ),
                ...draft.models.map((model, index) =>
                  h(
                    'div',
                    { key: index, style: UI.tr },
                    h('input', {
                      style: { ...UI.cellInput, ...UI.mono },
                      value: model.id,
                      placeholder: 'deepseek-v4.1-flash',
                      onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, id: event.target.value } : item)) }),
                    }),
                    h('input', {
                      style: UI.cellInput,
                      value: model.name,
                      placeholder: '显示名称',
                      onChange: (event) => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, name: event.target.value } : item)) }),
                    }),
                    h(
                      'div',
                      { style: UI.ctxWrap },
                      h('input', {
                        style: { ...UI.cellInput, ...UI.mono, paddingRight: '38px' },
                        inputMode: 'numeric',
                        value: String(model.contextWindow || ''),
                        onChange: (event) => {
                          const digits = event.target.value.replace(/[^0-9]/g, '')
                          onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, contextWindow: digits.length === 0 ? 0 : Number(digits) } : item)) })
                        },
                      }),
                      formatContext(model.contextWindow) === ''
                        ? null
                        : h('span', { style: UI.ctxBadge }, formatContext(model.contextWindow)),
                    ),
                    h('button', {
                      type: 'button',
                      style: { ...UI.outBtn, ...(model.image ? UI.visionOn : UI.visionOff) },
                      title: model.image ? '支持图片输入' : '仅文本，点一下开启图片',
                      onClick: () => onChange({ ...draft, models: draft.models.map((item, at) => (at === index ? { ...item, image: !item.image } : item)) }),
                    }, h(Icon, { name: 'image', size: 12 })),
                    h('button', {
                      type: 'button',
                      style: UI.iconBtn,
                      title: '移除该模型',
                      onClick: () => onChange({ ...draft, models: draft.models.filter((_, at) => at !== index) }),
                    }, h(Icon, { name: 'x', size: 12 })),
                  ),
                ),
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
    function ProviderCard({ row, mode, catalog, probe, onProbe, onDelete, onSaved, onRefresh, onClose, onError, onNotice }) {
      const creating = mode === 'create'
      const [open, setOpen] = React.useState(creating)
      const [tab, setTab] = React.useState('config')
      const [busy, setBusy] = React.useState(false)
      const [draft, setDraft] = React.useState(() => (creating ? emptyDraft() : draftFrom(row)))
      const usageApi = React.useRef(null)

      const entry = (Array.isArray(catalog) ? catalog : []).find((item) => item.provider === draft.provider)
      const catalogRoute = entry !== undefined && entry.declared === false
      const displayName = draft.displayName || draft.provider || '未命名'
      const keyConfigured = creating ? false : row ? row.keyConfigured === true : false
      const noReference = creating ? false : row ? row.keyReason === 'no-reference' : false
      const probeBody = probe && probe.busy !== true ? probe.body : null
      const pingOk = probeBody !== null && probeBody !== undefined && probeBody.ok === true

      function toggle() {
        if (creating) return
        if (!open) setDraft(draftFrom(row))
        setOpen(!open)
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
              onError(found && found.ok === false ? String(found.message ?? '端点没有返回模型。') : '端点没有返回模型：先用「从端点拉取」勾几个，再保存。')
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
          setDraft((current) => ({ ...current, apiKey: '' }))
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
        setOpen(false)
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
            keyConfigured ? h('span', { style: { ...UI.pill, ...UI.pillOk } }, h(Icon, { name: 'key', size: 11 }), '已就绪') : null,
            !keyConfigured && noReference ? h('span', { style: UI.pill }, '无凭据引用') : null,
            pingOk
              ? h('span', { style: { ...UI.pill, ...UI.pillOk }, title: probeText(probeBody) }, `HTTP ${probeBody.status} · ${probeBody.elapsed}ms · ${probeBody.modelCount} 个模型`)
              : probeBody !== null && probeBody !== undefined
                ? h('span', { style: { ...UI.pill, ...UI.pillWarn }, title: probeText(probeBody) }, '连通失败')
                : probe && probe.busy === true
                  ? h('span', { style: { ...UI.pill, ...UI.pillWarn } }, '正在测速…')
                  : null,
          ),
          h(
            'span',
            { style: UI.actions, onClick: (event) => event.stopPropagation() },
            h('button', { style: UI.outBtn, onClick: () => onProbe(), disabled: probe && probe.busy === true }, h(Icon, { name: 'bolt', size: 12 }), '测连通'),
            h('button', { style: UI.outBtn, onClick: () => { setTab('usage'); setOpen(true) } }, h(Icon, { name: 'chart', size: 12 }), '用量测试'),
            creating
              ? null
              : h('button', { style: UI.outBtn, onClick: toggle }, open ? '收起' : '展开', h(Icon, { name: open ? 'chevronDown' : 'chevronRight', size: 12 })),
            onDelete ? h('button', { style: UI.iconBtn, title: '删除该提供商', onClick: () => onDelete() }, h(Icon, { name: 'trash', size: 13 })) : null,
          ),
        ),

        open
          ? h(
              'div',
              { style: UI.tray },
              h(
                'div',
                { style: UI.trayHead },
                h(
                  'div',
                  { style: UI.seg },
                  h('button', { type: 'button', style: { ...UI.segBtn, ...(tab === 'config' ? UI.segOn : {}) }, onClick: () => setTab('config') }, h(Icon, { name: 'code', size: 12 }), '提供商配置 (基本信息 & 模型)'),
                  h('button', { type: 'button', style: { ...UI.segBtn, ...(tab === 'usage' ? UI.segOn : {}) }, onClick: () => setTab('usage') }, h(Icon, { name: 'chart', size: 12 }), '用量测试 / 余额查询'),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' } },
                  h('button', { style: UI.ghost, onClick: cancel }, '取消'),
                  h(
                    'button',
                    {
                      style: { ...UI.solid, opacity: busy ? 0.7 : 1 },
                      disabled: busy,
                      onClick: () => {
                        if (tab === 'config') void saveConfig()
                        else if (usageApi.current !== null) void usageApi.current.save(true)
                      },
                    },
                    h(Icon, { name: 'check', size: 12 }),
                    busy ? '保存中…' : tab === 'config' ? (creating ? '保存' : '保存更改') : '保存并测试',
                  ),
                ),
              ),

              tab === 'config'
                ? h(ConfigPane, { draft, row, mode, catalog, onChange: setDraft })
                : h(UsagePane, {
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
                  }),
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
          h('div', { style: UI.headLeft }, h('h2', { style: UI.title }, '提供商增强'), h('span', { style: UI.badge }, `${providers.length} 个网关`)),
          h(
            'div',
            { style: UI.headActions },
            h('button', {
              style: UI.ghost,
              title: '用量模板保存在 $DSH_HOME/storages/dsh-provider-plus/usage.json',
              onClick: () => setNotice('用量模板：$DSH_HOME/storages/dsh-provider-plus/usage.json · provider 配置：设置 → 模型'),
            }, h(Icon, { name: 'code', size: 12 }), '配置文件'),
            h('button', { style: UI.ghost, onClick: () => void probeAll(), disabled: refreshing }, h(Icon, { name: 'refresh', size: 12 }), refreshing ? '测速中…' : '全量测速'),
            h('button', { style: UI.solid, onClick: () => setCreating(true) }, h(Icon, { name: 'plus', size: 12 }), '新建提供商'),
          ),
        ),

        error !== null ? h('div', { style: UI.errText }, error) : null,
        notice !== null ? h('div', { style: UI.muted }, notice) : null,

        creating
          ? h(ProviderCard, {
              key: '__new',
              mode: 'create',
              row: null,
              catalog,
              probe: null,
              onProbe: () => {},
              onDelete: null,
              onClose: () => setCreating(false),
              onSaved: (body) => {
                setCreating(false)
                setState(body)
                setNotice('已保存新提供商。')
              },
              onRefresh: reload,
              onError: setError,
              onNotice: setNotice,
            })
          : null,

        providers.length === 0 && creating === false
          ? h('div', { style: UI.empty }, '还没有任何 provider。点右上角「新建提供商」开始。')
          : null,

        ...providers.map((row) =>
          h(ProviderCard, {
            key: row.provider,
            mode: 'edit',
            row,
            catalog,
            probe: probes[row.provider] ?? null,
            onProbe: () => void probe(row.provider),
            onDelete: () => void remove(row),
            onSaved: (body, provider) => {
              setState(body)
              setNotice(`已保存 ${provider}`)
            },
            onRefresh: reload,
            onClose: () => {},
            onError: setError,
            onNotice: setNotice,
          }),
        ),
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
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', marginTop: '2px' } },
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
     * Composer toolbar chip: the last usage result of every provider that has
     * one, so quota is readable without opening Settings. Click to expand.
     */
    function UsageActivity() {
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
        (item) => item.usageResult && Array.isArray(item.usageResult.rows) && item.usageResult.rows.length > 0,
      )
      if (rows.length === 0) return null

      return h(
        'div',
        { ref: rootRef, style: { position: 'relative', display: 'flex', alignItems: 'center' } },
        h(
          'button',
          {
            type: 'button',
            style: S.activityChip,
            title: '所有提供商的最近一次用量；与当前会话正在用的模型无关',
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
              h('div', { style: S.activityHead }, '所有提供商 · 最近一次查询（与当前模型无关）'),
              ...rows.map((item) =>
                h(
                  'div',
                  { key: item.provider, style: S.activityRow },
                  h('span', { style: { fontWeight: 600 } }, item.displayName || item.provider),
                  h('span', { style: S.hint }, item.usageResult.rows.map((row) => `${row.label} ${row.value === undefined ? '—' : JSON.stringify(row.value)}`).join(' · ')),
                  h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #666)' } }, item.usageResult.at ? new Date(item.usageResult.at).toLocaleString('zh-CN', { hour12: false }) : ''),
                ),
              ),
            )
          : null,
      )
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
      try {
        ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register({ name: 'conversation.input.activity' }, UsageActivity),
        )
      } catch (error) {
        console.error('[dsh-provider-plus] usage activity failed to register:', error)
      }
    }

    return { name: 'dsh-provider-plus', inject, apply }
  },
})
