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
    ]

    function trimBase(value) {
      return String(value ?? '').replace(/\/+$/, '')
    }

    function usagePresetFields(id, baseUrl, apiKeyEnv) {
      const base = trimBase(baseUrl)
      const keyRef = apiKeyEnv ?? ''
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
        gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1.2fr) 86px 52px 34px',
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
        background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
        color: '#fff',
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
      tr: { display: 'grid', gridTemplateColumns: '1.5fr 1.2fr 86px 52px 34px', gap: '8px', alignItems: 'center', padding: '2px 0' },
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
        advancedOpen: false,
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

    /** Usage editor: a template plus a live "test now" that reports the raw error. */
    function UsagePanel({ provider, initial, baseURL, apiKeyEnv }) {
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
      const [preset, setPreset] = React.useState('custom')
      const [busy, setBusy] = React.useState(false)
      const [outcome, setOutcome] = React.useState(null)

      function applyPreset(id) {
        const fields = usagePresetFields(id, baseURL, apiKeyEnv)
        setPreset(id)
        setOutcome(null)
        setConfig({ ...config, mode: 'http', ...fields })
      }

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
        ),
        h(
          'div',
          { style: { width: '220px', maxWidth: '100%' } },
          h(Field, { label: '查询方式' }, h(Select, {
            value: config.mode,
            options: [
              { value: 'none', label: '未配置' },
              { value: 'http', label: 'HTTP 模板' },
            ],
            onChange: (mode) => setConfig({ ...config, mode }),
          })),
        ),
        h('div', { style: S.hint }, '订阅网关的额度通常不在数据面。填一个能返回 JSON 的只读接口，再把要显示的字段用点路径取出来；{key} 会被替换成该凭据。'),
        config.mode === 'http'
          ? h(
              React.Fragment,
              null,
              ...['template', 'plan'].map((group) =>
                h(
                  'div',
                  { key: group, style: S.presetRow },
                  h('span', { style: S.presetLabel }, group === 'template' ? '模板' : '套餐'),
                  ...USAGE_PRESET_TEMPLATES.filter((item) => item.group === group).map((item) =>
                    h(
                      'button',
                      {
                        key: item.id,
                        type: 'button',
                        style: { ...S.presetButton, ...(preset === item.id ? S.presetActive : {}) },
                        onClick: () => applyPreset(item.id),
                      },
                      item.label,
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { style: S.grid },
                h(Field, { label: 'URL', span: true }, h('input', { style: S.input, value: config.url, placeholder: 'https://example.com/api/usage', onChange: (event) => setConfig({ ...config, url: event.target.value }) })),
                h(Field, { label: '方法' }, h(Select, {
                  value: config.method,
                  options: [
                    { value: 'GET', label: 'GET' },
                    { value: 'POST', label: 'POST' },
                  ],
                  onChange: (method) => setConfig({ ...config, method }),
                })),
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
          { style: S.editorHead },
          h('span', { style: S.editorTitle }, creating ? '新建提供商' : '编辑提供商'),
          h('span', { style: S.editorSubject }, draft.provider || '未命名'),
          h('div', { style: S.grow }),
          h('button', { style: S.button, onClick: onClose }, '取消'),
          h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
        ),

        h(
          'div',
          { style: S.group },
          h('div', { style: S.groupHead }, h('span', { style: S.groupTitle }, '基本信息')),
          h(
            'div',
            { style: S.grid },
            h(
              Field,
              { label: 'ID（必填）' },
              h('input', {
                style: { ...S.input, ...S.mono },
                value: draft.provider,
                disabled: !creating,
                placeholder: '小写字母、数字、连字符',
                onChange: (event) => onChange({ ...draft, provider: event.target.value }),
              }),
            ),
            h(
              Field,
              { label: '显示名' },
              h('input', {
                style: S.input,
                value: draft.displayName,
                placeholder: '可选，默认用 ID',
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
              h(Select, {
                value: draft.api,
                options: [
                  ...(catalogRoute ? [{ value: '', label: '沿用内置目录' }] : []),
                  ...API_OPTIONS.map((option) => ({ value: option, label: API_LABEL[option] })),
                ],
                onChange: (value) => onChange({ ...draft, api: value }),
              }),
            ),
          ),
          catalogRoute
            ? h('div', { style: S.note }, `pi-ai 内置路由：baseURL 由目录提供（${entry.defaultBaseURL ?? '目录端点'}），不要填；模型留空 = 目录全部模型。`)
            : null,
        ),

        h(
          'div',
          { style: S.group },
          h(
            'div',
            { style: S.groupHead },
            h('span', { style: S.groupTitle }, '凭据与请求头'),
            h('span', { style: S.groupHint }, '可选'),
            h('div', { style: S.grow }),
            h(
              'button',
              { style: S.button, onClick: () => onChange({ ...draft, advancedOpen: draft.advancedOpen !== true }) },
              draft.advancedOpen === true ? '收起' : '展开',
            ),
          ),
          draft.advancedOpen === true
            ? h(
                'div',
                { style: S.grid },
                h(
                  Field,
                  { label: '凭据引用' },
                  h('input', {
                    style: S.input,
                    value: draft.apiKeyEnv,
                    placeholder: 'COMMANDCODE_API_KEY',
                    onChange: (event) => onChange({ ...draft, apiKeyEnv: event.target.value }),
                  }),
                ),
                h(Field, { label: '请求头（每行 名称: 值）', span: true }, h('textarea', {
                  style: { ...S.input, minHeight: '48px' },
                  value: draft.headersText,
                  placeholder: 'x-opencode-session: {uuid}',
                  onChange: (event) => onChange({ ...draft, headersText: event.target.value }),
                })),
                h('div', { style: { ...S.groupHint, gridColumn: '1 / -1' } }, '{uuid} 会在保存时替换成一个固定 UUID（opencode go 这类网关需要 x-opencode-session）。'),
              )
            : null,
        ),

        h('div', { style: S.divider }),

        h(
          'div',
          { style: S.group },
          h(
            'div',
            { style: S.groupHead },
            h('span', { style: S.groupTitle }, catalogRoute ? '模型（留空 = 用目录全部）' : '模型（必填）'),
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
                  { style: S.tableHead },
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
        ),
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
        { style: S.root, ref: rootRef, spellCheck: false },
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
                  setCreating((current) => current ?? emptyDraft())
                },
              },
              '+ 新建提供商',
            ),
          ),
        ),
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
          // Collapsed is the default: one line with the name and the actions.
          // Chips, the editor and the model list only exist while expanded, so
          // a list of ten providers still reads as a list.
          const expanded = editingThis || usageOpen === row.provider
          return h(
            'div',
            { key: row.provider, style: S.card },
            h(
              'div',
              { style: S.headerRow },
              h('span', { style: S.nameShrink, title: row.provider }, row.displayName),
              h(
                'span',
                {
                  title: probeBody !== null ? probeText(probeBody) : undefined,
                  style: {
                    ...S.probeInline,
                    flex: '1 1 0',
                    minWidth: 0,
                    maxWidth: 'none',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    ...(probeBody === null ? { visibility: 'hidden' } : {}),
                    ...(probeBody !== null && probeBody.ok === true ? S.okText : probeBody !== null ? S.errText : {}),
                  },
                },
                probeBody !== null ? probeText(probeBody) : '连通状态',
              ),
              h(
                'div',
                { style: S.actions },
                h('button', { style: S.button, onClick: () => testProvider(row), disabled: probing }, probing ? '测试中…' : '测连通'),
                h('button', { style: S.button, onClick: () => toggleEditor(row) }, editingThis ? '收起' : '展开'),
                h('button', { style: { ...S.button, minWidth: '76px' }, onClick: () => setUsageOpen(usageOpen === row.provider ? null : row.provider) }, usageOpen === row.provider ? '收起用量' : '用量'),
                row.deletable === true ? h('button', { style: S.danger, onClick: () => void removeProvider(row) }, '删除') : null,
              ),
            ),

            expanded
              ? h(
                  'div',
                  { style: S.row },
                  row.keyConfigured ? Chip({ text: 'Key 已配置', style: S.okChip }) : Chip({ text: row.keyReason === 'no-reference' ? '无凭据引用' : 'Key 未配置', style: S.badChip }),
                  row.origin === 'composition' ? Chip({ text: '组合层声明' }) : null,
                  row.declaredByCatalog === true ? Chip({ text: '内置目录' }) : null,
                  Chip({ text: `${row.models.length} 个模型` }),
                  Chip({ text: `${row.imageModels} 个支持图片`, style: row.imageModels > 0 ? S.okChip : undefined }),
                )
              : null,

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

            usageOpen === row.provider ? h(UsagePanel, { provider: row.provider, initial: row.usage, baseURL: row.baseURL, apiKeyEnv: row.apiKeyEnv }) : null,

            expanded && !editingThis && row.models.length > 0
              ? h(
                  'div',
                  { style: S.group },
                  h(
                    'div',
                    { style: S.groupHead },
                    h('span', { style: S.groupTitle }, '模型'),
                    h('span', { style: S.groupHint }, '只读；修改请点上面的“展开”'),
                  ),
                  h(
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
                  ),
                )
              : expanded && !editingThis && row.declaredByCatalog === true
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
                  style: { ...S.probeInline, maxWidth: '42%', ...(probe.body.ok === true ? S.okText : S.errText) },
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
