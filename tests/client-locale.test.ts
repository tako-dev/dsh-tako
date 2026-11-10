import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * The browser half (client/client.js) is a plain script that registers itself
 * with `window.__ModuleLoader__`. These tests load it exactly the way the dsh
 * web client does — a stub module loader captures the factory, a stub `require`
 * supplies a recording React — and then drive `apply(ctx)` against stub
 * contexts, with and without a locale service, to pin the i18n contract:
 *
 * - the complete zh/en dictionary is registered under the plugin namespace;
 * - every slot entry declares the namespace, so components receive `t`;
 * - the sidebar label thunk follows the registered translator (language switches);
 * - without a locale service (older dsh, or a stubbed context) nothing
 *   registers, `inject` keeps no hard locale dependency, and every text
 *   renders through the inline fallback dictionary — before and after the
 *   service appears late.
 */

type Element = { tag: string | Function, props: Record<string, unknown> | null, children: unknown[] }
type Plugin = { inject: string[], apply: (ctx: unknown) => unknown }
type ModuleRow = { id: string, factory: (require: (spec: string) => unknown) => Plugin }

/** The keys of the pre-i18n inline dictionary — one must not go missing in a migration. */
const EXPECTED_KEYS = [
  'signIn', 'signInAgain', 'cancel', 'waiting', 'openLink', 'success', 'failed', 'denied', 'timeout', 'remote',
  'panel', 'consoleTitle', 'accountCard', 'signedIn', 'signedOut', 'signedOutLead', 'account', 'plan', 'unknown', 'whoamiFailed',
  'signOut', 'signOutWorking', 'logoutRevoked', 'logoutRemoved', 'logoutNone', 'logoutExternal',
  'quotaCard', 'quotaRemain', 'quotaUsed', 'quotaPoints', 'quotaUsedShare', 'quotaNoteUsd', 'quotaNoteUnknown',
  'quotaNeedsLogin', 'quotaUnavailable',
  'catalogCard', 'catalogModel', 'catalogContext', 'catalogVision', 'visionBadge', 'yes', 'no', 'catalogDefault', 'catalogEmpty',
  'catalogMore', 'catalogLess', 'catalogSyncing', 'catalogRetrying', 'catalogFailed', 'catalogAttempts', 'catalogReadAgain',
  'catalogDirectoryError', 'catalogSettingsError', 'catalogWriteError', 'catalogReadOnlyError', 'catalogEmptyError', 'catalogTransactionError',
  'refreshIn', 'refreshSoon', 'refreshOnlyAtStartup', 'loadFailed', 'retry',
  'updateCard', 'updateAvailable', 'updateCommand', 'upToDate', 'pluginVersion', 'copy', 'copied', 'updateFailed',
  'updateNow', 'updating', 'updateInstalled', 'updateInstallFailed',
  'footerRemain', 'footerUsed', 'windowHours', 'weeklyShort', 'walletBalance', 'planWindows',
  'servicesCard', 'serviceConsole', 'servicePricing', 'serviceWallet', 'serviceSubscriptions', 'serviceDocs',
  'openInTako', 'managePlan', 'topUp', 'plazaLink',
  'keyCard', 'keyHint', 'keyOrPaste', 'keyConfigured', 'keyMissing', 'keyPlaceholder', 'keySave', 'keySaving',
  'keySaved', 'keyInvalid', 'keyClear', 'keyClearing', 'keyCleared', 'keyClearExternal', 'keyClearNone',
  'keyShow', 'keyHide', 'keySource', 'endpointLabel', 'credentialLabel',
  'catalogSummary', 'catalogSearch', 'catalogFilterAll', 'catalogFilterVision', 'catalogFilterLong',
  'catalogFilterReasoning', 'catalogNoMatch', 'catalogShown', 'catalogReasoningBadge',
  // console tabs, diagnostics, announcements
  'tabOverview', 'tabRequests', 'tabUsage', 'tabModels', 'tabKey', 'tabConfig',
  'diagCopy', 'diagCopied', 'noticeDismiss', 'noticeTitle', 'noticeEmpty', 'noticeExpand', 'noticeCollapse',
  'cardChannels', 'cardEndpoints', 'cardStandard', 'cardRealized', 'cardOutputRatio', 'cardClaude',
  // request logs
  'logsEmpty', 'logsNeedLogin', 'logsModel', 'logsRefresh', 'logsLoading',
  'logsColTime', 'logsColModel', 'logsColIn', 'logsColOut', 'logsColCost', 'logsColDuration', 'logsColRequest',
  'logTypeTopup', 'logTypeConsume', 'logTypeManage', 'logTypeSystem', 'logTypeError', 'logTypeRefund', 'logTypeLogin',
  // usage + key details
  'usageToday', 'usageTokenCard', 'usageGranted', 'usageUsed', 'usageAvailable', 'usageUnlimited', 'usageExpires',
  'usageNever', 'usageModelLimits', 'usageNoLimits', 'usagePerModel', 'usageRequests',
  'keyTokenCard', 'keyName', 'keyExpires', 'keyModels',
  // sync + pins + config tab
  'syncNow', 'syncWorking', 'syncFailed', 'pinTitle', 'unpinTitle', 'pinFailed',
  'configSave', 'configSaving', 'configSaved', 'configFailed', 'configReadOnly', 'configRetryDelays',
  'configRefresh', 'configDefaultCtx', 'configClaudeOnly', 'configInclude', 'configExclude',
  'configPinnedField', 'configSearchProvider', 'configSearchTako', 'configSearchDefault', 'configOverrides',
]

let row: ModuleRow | undefined

async function loadModuleRow(): Promise<ModuleRow> {
  if (row !== undefined) return row
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = { __ModuleLoader__: { load: (m: ModuleRow) => { row = m } }, location: { hostname: '127.0.0.1' } }
  globals.document = { documentElement: { lang: 'zh-CN' } }
  // Node exposes a getter-only `navigator`; the fallback only reads it when the
  // document language is empty, which these tests never leave it.
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true })
  // The browser bundle ships without type declarations on purpose (no client
  // build step); its side effect registers the module row with our stub.
  // @ts-expect-error TS7016: client/client.js is an untyped plain-JS bundle
  await import('../client/client.js')
  if (row === undefined) throw new Error('client/client.js did not call window.__ModuleLoader__.load')
  return row
}

/** Initial useState results, indexed by hook order, consumed by one render. */
let hookStates: unknown[] = []

/**
 * Materialize the bundle once per test against a recording React stub. The
 * stub runs function components inline (no virtual DOM), which is enough to
 * read the texts the real page would render.
 */
function materialize(options: {
  effect?: (callback: () => void | (() => void)) => void,
  setState?: (index: number, value: unknown) => void,
} = {}): { plugin: Plugin, render: (component: unknown, props: Record<string, unknown>) => unknown } {
  const createElement = (tag: string | Function, props: Record<string, unknown> | null, ...children: unknown[]): unknown =>
    typeof tag === 'function' ? (tag as (props: unknown) => unknown)(props ?? {}) : { tag, props, children }
  let hookIndex = 0
  const react = {
    createElement,
    useEffect: (callback: () => void | (() => void)) => { options.effect?.(callback) },
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = hookIndex++
      const value = hookStates[index] ?? initial
      return [value, (next: unknown) => { options.setState?.(index, next) }]
    },
  }
  if (row === undefined) throw new Error('module row not loaded yet')
  const plugin = row.factory(spec => {
    if (spec !== 'react') throw new Error(`unexpected require ${String(spec)}`)
    return react
  })
  const render = (component: unknown, props: Record<string, unknown>) => {
    hookIndex = 0
    return (component as (props: unknown) => unknown)(props)
  }
  return { plugin, render }
}

/** A minimal stand-in for the host's locale service (the LocaleRuntime contract we rely on). */
function localeService() {
  const registered: { ns: string, dicts: Record<string, Record<string, string>> }[] = []
  let active = 'zh'
  const interpolate = (template: string, params: Record<string, unknown> | undefined) =>
    params === undefined ? template : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
  const face = {
    activeLocale: () => active,
    setActive: (id: string) => { active = id },
    calls: registered,
    register: (ns: string, dicts: Record<string, Record<string, string>>) => {
      const record = { ns, dicts }
      registered.push(record)
      return () => { registered.splice(registered.indexOf(record), 1) }
    },
    bind: () => (key: string, params?: Record<string, unknown>) => {
      const dicts = registered.at(-1)?.dicts
      return interpolate(dicts?.[active]?.[key] ?? key, params)
    },
  }
  return face
}

/** A context double with the surfaces apply() touches, recording what was registered. */
function stubCtx(options: { locale?: unknown } = {}) {
  const listeners: ((name: string, value: unknown) => void)[] = []
  const entries: { slot: string, options: Record<string, unknown>, component: unknown }[] = []
  const injections: (() => unknown)[] = []
  const ctx = {
    get: (name: string) => (name === 'locale' ? options.locale : undefined),
    on: (_name: string, fn: (name: string, value: unknown) => void) => { listeners.push(fn); return () => {} },
    effect: (setup: () => unknown) => { setup(); return () => {} },
    slots: {
      inject: (_slot: string, callback: () => unknown) => { injections.push(callback); return () => {} },
      register: (slotOptions: Record<string, unknown>, component: unknown) => {
        entries.push({ slot: String(slotOptions.name), options: slotOptions, component })
        return () => {}
      },
    },
  }
  const runInjections = () => { for (const callback of injections) callback() }
  const provide = (name: string, value: unknown) => { for (const fn of listeners) fn(name, value) }
  return { ctx, entries, runInjections, provide }
}

const setDocumentLang = (lang: string) => {
  (globalThis as unknown as { document: { documentElement: { lang: string } } }).document.documentElement.lang = lang
}

/** Deep-search an element tree (elements, arrays, strings) for the first string containing `needle`. */
function findText(node: unknown, needle: string): string | undefined {
  if (typeof node === 'string') return node.includes(needle) ? node : undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findText(child, needle)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  for (const child of (node as Element).children ?? []) {
    const found = findText(child, needle)
    if (found !== undefined) return found
  }
  return undefined
}

/** Deep-search an element tree for the first node whose data-testid matches. */
function findByTestId(node: unknown, testId: string): Element | undefined {
  return findByAttr(node, 'data-testid', testId)
}

/** Deep-search an element tree for the first node with a matching attribute. */
function findByAttr(node: unknown, attr: string, value: string): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByAttr(child, attr, value)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  const el = node as Element
  if (el.props?.[attr] === value) return el
  for (const child of el.children ?? []) {
    const found = findByAttr(child, attr, value)
    if (found !== undefined) return found
  }
  return undefined
}

function findByTag(node: unknown, tag: string): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTag(child, tag)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  const el = node as Element
  if (el.tag === tag) return el
  for (const child of el.children ?? []) {
    const found = findByTag(child, tag)
    if (found !== undefined) return found
  }
  return undefined
}

function collectModels(node: unknown): string[] {
  const ids: string[] = []
  const walk = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(walk)
      return
    }
    if (item === null || typeof item !== 'object') return
    const el = item as Element
    if (typeof el.props?.['data-model'] === 'string') ids.push(el.props['data-model'] as string)
    for (const child of el.children ?? []) walk(child)
  }
  walk(node)
  return ids
}

describe('client i18n: registration', () => {
  it('registers the complete zh/en dictionary under the dsh-tako namespace', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    const face = localeService()
    const { ctx } = stubCtx({ locale: face })
    plugin.apply(ctx)
    expect(face.calls.length).toBe(1)
    expect(face.calls[0]!.ns).toBe('dsh-tako')
    const dicts = face.calls[0]!.dicts
    expect(Object.keys(dicts).sort()).toEqual(['en', 'zh'])
    for (const locale of ['zh', 'en'] as const) {
      expect(Object.keys(dicts[locale]!).sort(), `keys of ${locale}`).toEqual([...EXPECTED_KEYS].sort())
      for (const [key, value] of Object.entries(dicts[locale]!)) expect(value, `${locale}.${key}`).toMatch(/./)
    }
  })

  it('treats the desktop workbench as a local host so plugin login is not marked remote', async () => {
    await loadModuleRow()
    const win = globalThis.window as unknown as { location: { hostname: string }, __DSH_TAKO_PROFILE__?: boolean }
    const previous = win.location.hostname
    win.location.hostname = 'app'
    win.__DSH_TAKO_PROFILE__ = true
    hookStates = [{ status: 'pending', id: '1', url: 'https://tako.example/app/authorize' }, '', false, false, undefined]
    try {
      const { plugin } = materialize()
      const { ctx, entries, runInjections } = stubCtx()
      plugin.apply(ctx)
      runInjections()
      const SignIn = entries.find(entry => entry.slot === 'settings.models.provider-card')!.component
      const { render } = materialize()
      const local = render(SignIn, { provider: { provider: 'tako' }, keyConfigured: false, t: (key: string) => key })
      expect(findText(local, 'remote')).toBeUndefined()
      delete win.__DSH_TAKO_PROFILE__
      const remote = render(SignIn, { provider: { provider: 'tako' }, keyConfigured: false, t: (key: string) => key })
      expect(findText(remote, 'remote')).toBe('remote')
    } finally {
      win.location.hostname = previous
      delete win.__DSH_TAKO_PROFILE__
      hookStates = []
    }
  })

  it('keeps activation gated on slots only — no hard locale dependency', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    expect(plugin.inject).toEqual(['slots'])
  })

  it('every slot entry declares the locale namespace, and the label thunk follows the service language', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    expect(entries.map(entry => entry.slot).sort()).toEqual(['main', 'settings.models.provider-card', 'sidebar.footer.action', 'sidebar.panellist'])
    for (const entry of entries) expect(entry.options.locale).toBe('dsh-tako')
    const label = entries.find(entry => entry.slot === 'sidebar.panellist')!.options.label as () => string
    face.setActive('zh')
    expect(label()).toBe('Tako 控制台')
    face.setActive('en')
    expect(label()).toBe('Tako Console')
  })

  it('interpolates the refresh countdown through the registered translator', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    const face = localeService()
    const { ctx } = stubCtx({ locale: face })
    plugin.apply(ctx)
    const t = face.bind()
    face.setActive('zh')
    expect(t('refreshIn', { minutes: 5 })).toBe('约 5 分钟后刷新')
    face.setActive('en')
    expect(t('refreshIn', { minutes: 5 })).toBe('refreshes in ~5 min')
  })
})

describe('client i18n: fallback without the locale service', () => {
  it('renders through the inline dictionary when the host has no locale service, and adopts a late arrival', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    const { ctx, entries, runInjections, provide } = stubCtx()
    setDocumentLang('zh-CN')
    plugin.apply(ctx)
    runInjections()
    const face = localeService()
    expect(face.calls.length).toBe(0) // nothing to register against yet
    const label = entries.find(entry => entry.slot === 'sidebar.panellist')!.options.label as () => string
    expect(label()).toBe('Tako 控制台')
    setDocumentLang('en')
    expect(label()).toBe('Tako Console') // the same behavior as the pre-i18n client
    // The service appears after apply (activation is not gated on it): adopt.
    provide('locale', face)
    expect(face.calls.length).toBe(1)
    face.setActive('zh')
    expect(label()).toBe('Tako 控制台')
    face.setActive('en')
    expect(label()).toBe('Tako Console')
  })

  it('the console page falls back per component and honors props.t when the seat is present', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    const catalog = { models: [{ id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] }], nextSyncAt: Date.now() + 5 * 60_000 }
    // useState order in TakoConsolePage: status, statusError, catalog, catalogError,
    // busyLogout, logoutNote, tab, notice, dismissedNotice, diagCopied, then
    // useTakoLogin's login state (index 10). Components the stub inlines share
    // the index stream: overview adds KeyEditor (4) and UpdateCard (5); the
    // models tab adds ModelsTab (3), CatalogCard (3) and Countdown (1).
    hookStates = [undefined, undefined, catalog, undefined, false, undefined, 'models', undefined, undefined, false, { status: 'idle' }]
    try {
      // No `t` seat (an older host renders the entry without one): inline fallback.
      setDocumentLang('zh-CN')
      let rendered = render(page, {}) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, 'Tako 控制台')).toBeUndefined()
      expect(findText(findByAttr(rendered, 'data-dsh-tako-card', 'catalog'), '模型')).toBe('模型')
      expect(findText(rendered, '分钟后刷新')).toBe('约 5 分钟后刷新')
      expect(findText(rendered, '1M')).toBe('1M')
      expect(findText(rendered, '图')).toBe('图')
      expect(findByTestId(rendered, 'dsh-tako-catalog-more')).toBeUndefined()
      setDocumentLang('en')
      rendered = render(page, {}) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, 'Tako Console')).toBeUndefined()
      expect(findText(findByAttr(rendered, 'data-dsh-tako-card', 'catalog'), 'Models')).toBe('Models')
      expect(findText(rendered, 'min')).toBe('refreshes in ~5 min')
      expect(findText(rendered, 'img')).toBe('img')
      // With the seat, props.t wins regardless of the document language.
      face.setActive('en')
      rendered = render(page, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, 'Tako Console')).toBeUndefined()
      expect(findText(findByAttr(rendered, 'data-dsh-tako-card', 'catalog'), 'Models')).toBe('Models')
      face.setActive('zh')
      rendered = render(page, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, 'Tako 控制台')).toBeUndefined()
      expect(findText(findByAttr(rendered, 'data-dsh-tako-card', 'catalog'), '模型')).toBe('模型')
      expect(findText(rendered, '分钟后刷新')).toBe('约 5 分钟后刷新')

      hookStates = [{ configured: false }, undefined, catalog, undefined, false, undefined, 'overview', undefined, undefined, false, { status: 'idle' }, '', false, false, undefined]
      rendered = render(page, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, '钥匙走')).toBe('登录后，额度、模型和搜索会跟这把钥匙走')
      expect(findByTestId(rendered, 'dsh-tako-console-sign-in')).toBeDefined()
      expect(findText(rendered, '需要登录后查看')).toBe('需要登录后查看')
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-models')).toBeUndefined()

      hookStates = [{
        configured: true,
        maskedKey: 'cr_****abcd',
        me: { userName: 'Ada', planName: 'Pro' },
      }, undefined, catalog, undefined, false, undefined, 'overview', undefined, undefined, false, { status: 'idle' }, '', false, false, undefined]
      rendered = render(page, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Ada')
      expect(findText(rendered, 'cr_****abcd')).toBe('cr_****abcd')
      expect(findText(rendered, 'Pro')).toBe('Pro')
      expect(findByTestId(rendered, 'dsh-tako-console-sign-out')).toBeDefined()
      expect(findByTag(rendered, 'input')).toBeDefined()
      expect(findText(findByAttr(rendered, 'data-dsh-tako-card', 'account'), '登录状态')).toBe('登录状态')
      // The models tab is only mounted on demand; nothing from it leaks here.
      expect(findByTestId(rendered, 'dsh-tako-catalog-search')).toBeUndefined()
    } finally {
      hookStates = []
    }
  })

  it('shows safe retry failure and the real interval before a first successful catalog sync', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    hookStates = [undefined, undefined, { models: [], lastSyncAt: null, nextSyncAt: null, refreshIntervalMs: 1800000,
      status: 'failed', attempts: 4, lastError: { code: 'write-failed', message: 'untrusted-payload', at: 10 } },
    undefined, false, undefined, 'models', undefined, undefined, false, { status: 'idle' }]
    try {
      setDocumentLang('zh-CN')
      const rendered = render(page, {})
      expect(findText(rendered, '模型设置写入未完成')).toBe('模型设置写入未完成 · 已尝试 4 次')
      expect(findText(rendered, '只在启动时刷新')).toBeUndefined()
      expect(findText(rendered, '约 30 分钟后刷新')).toBe('约 30 分钟后刷新')
      expect(findText(rendered, 'untrusted-payload')).toBeUndefined()
      expect(findText(rendered, '刷新目录状态')).toBe('刷新目录状态')
      expect(findText(rendered, '立即同步')).toBe('立即同步')
    } finally { hookStates = [] }
  })

  it('re-reads a pending catalog, publishes recovery, and cancels polling on panel unload', async () => {
    await loadModuleRow()
    vi.useFakeTimers()
    const effects: (() => void | (() => void))[] = []
    const updates: unknown[] = []
    const { plugin, render } = materialize({ effect: callback => { effects.push(callback) },
      setState: (index, value) => { if (index === 2) updates.push(value) } })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (!String(input).includes('tako.catalog')) return Response.json({ configured: false })
      calls++
      return Response.json(calls === 1 ? { models: [], lastSyncAt: null, nextSyncAt: Date.now() + 1000, status: 'retrying' }
        : { models: [{ id: 'recovered' }], lastSyncAt: Date.now(), nextSyncAt: null, status: 'ready' })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = []
      render(page, {})
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toBe(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toBe(2)
      expect(updates.at(-1)).toMatchObject({ models: [{ id: 'recovered' }], status: 'ready' })
      for (const dispose of disposers) dispose()
      await vi.advanceTimersByTimeAsync(10000)
      expect(calls).toBe(2)
    } finally {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
      vi.useRealTimers()
      hookStates = []
    }
  })

  it('bounds rapid catalog reads and stops further publication on unload', async () => {
    await loadModuleRow()
    vi.useFakeTimers()
    const effects: (() => void | (() => void))[] = []
    const updates: unknown[] = []
    const { plugin, render } = materialize({ effect: callback => { effects.push(callback) },
      setState: (index, value) => { if (index === 2) updates.push(value) } })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    let calls = 0
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      if (!String(input).includes('tako.catalog')) return Response.json({ configured: false })
      calls++
      signal = init.signal ?? undefined
      return Response.json({ models: [], lastSyncAt: null, nextSyncAt: null, status: 'failed' })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = []
      render(entries.find(entry => entry.slot === 'main')!.component, {})
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.advanceTimersByTimeAsync(120000)
      expect(calls).toBe(30)
      for (const dispose of disposers) dispose()
      expect(signal?.aborted).toBe(true)
      const settledUpdates = updates.length
      await vi.advanceTimersByTimeAsync(120000)
      expect(updates.length).toBe(settledUpdates)
      expect(calls).toBe(30)
    } finally {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
      vi.useRealTimers()
      hookStates = []
    }
  })

  it('retains a known regular refresh deadline after the initial fast-poll budget is exhausted', async () => {
    await loadModuleRow()
    vi.useFakeTimers()
    const effects: (() => void | (() => void))[] = []
    const updates: unknown[] = []
    const { plugin, render } = materialize({ effect: callback => { effects.push(callback) },
      setState: (index, value) => { if (index === 2) updates.push(value) } })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const deadline = Date.now() + 1800000
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (!String(input).includes('tako.catalog')) return Response.json({ configured: false })
      calls++
      return Response.json(Date.now() < deadline ? { models: [], lastSyncAt: null, nextSyncAt: deadline, status: 'failed' }
        : { models: [{ id: 'later-success' }], lastSyncAt: Date.now(), nextSyncAt: null, status: 'ready' })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = []
      render(entries.find(entry => entry.slot === 'main')!.component, {})
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.advanceTimersByTimeAsync(120000)
      expect(calls).toBe(30)
      await vi.advanceTimersByTimeAsync(1800000 - 120000 + 250)
      expect(calls).toBe(31)
      expect(updates.at(-1)).toMatchObject({ models: [{ id: 'later-success' }], status: 'ready' })
    } finally {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
      vi.useRealTimers()
      hookStates = []
    }
  })

  it('links into the Tako site using the origin the host reports', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    const status = {
      configured: true,
      origin: 'https://tako.example',
      maskedKey: 'cr_****WXYZ',
      me: { userName: 'u', planName: 'Pro', quotaRemainUsd: 2 },
      plan: { windowMinutes: 300, windowCost: 12, windowCostLimit: 200, weeklyCost: 80, weeklyCostLimit: 930 },
    }
    const catalog = { models: [{ id: 'swe-2', contextWindow: 262000, input: ['text', 'image'] }], nextSyncAt: null }
    // Overview mounts KeyEditor (4) and UpdateCard (5); the models tab mounts
    // ModelsTab (3) then CatalogCard (3) then Countdown (1).
    hookStates = [status, undefined, catalog, undefined, false, undefined, 'overview', undefined, undefined, false, { status: 'idle' }, '', false, false, undefined]
    try {
      let rendered = render(page, { t: face.bind() }) as Element
      let flat = JSON.stringify(rendered)
      for (const path of ['/dashboard', '/pricing', '/wallet', '/subscriptions', '/docs']) {
        expect(flat).toContain(`https://tako.example${path}`)
      }
      expect(flat).not.toContain('pricing?search=swe-2')

      hookStates = [status, undefined, catalog, undefined, false, undefined, 'models', undefined, undefined, false, { status: 'idle' }, undefined, false, undefined, false, '', 'all']
      rendered = render(page, { t: face.bind() }) as Element
      flat = JSON.stringify(rendered)
      expect(flat).toContain('https://tako.example/pricing?search=swe-2')
    } finally {
      hookStates = []
    }
  })

  it('previews six catalog models and hides the rest until expanded', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    const catalog = {
      models: [
        { id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] },
        { id: 'deepseek-v4-pro', contextWindow: 1_050_000 },
        { id: 'tako-auto', contextWindow: 272_000 },
        { id: 'other-model' },
        { id: 'extra-model-1' },
        { id: 'extra-model-2' },
        { id: 'extra-model-3' },
        { id: 'extra-model-4' },
      ],
      nextSyncAt: Date.now() + 5 * 60_000,
    }
    // CatalogCard's hooks land after TakoConsolePage's 11 and ModelsTab's 3
    // because the recording React stub inlines function components; the open
    // flag is the 4th index inside ModelsTab (pinned, syncBusy, syncNote, open).
    const modelsHooks = (open = false) => [undefined, undefined, catalog, undefined, false, undefined, 'models', undefined, undefined, false, { status: 'idle' },
      undefined, false, undefined, open]
    try {
      face.setActive('zh')
      hookStates = modelsHooks(false)
      let rendered = render(page, { t: face.bind() }) as Element
      expect(collectModels(rendered)).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto', 'other-model', 'extra-model-1', 'extra-model-2'])
      expect(findByAttr(rendered, 'data-model', 'extra-model-3')).toBeUndefined()
      expect(findText(rendered, '1M')).toBe('1M')
      expect(findText(rendered, '1.05M')).toBe('1.05M')
      expect(findText(rendered, '272K')).toBe('272K')
      const more = findByTestId(rendered, 'dsh-tako-catalog-more')
      expect(findText(more, '其余')).toBe('其余 2 个')

      hookStates = modelsHooks(true)
      rendered = render(page, { t: face.bind() }) as Element
      expect(collectModels(rendered)).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto', 'other-model', 'extra-model-1', 'extra-model-2', 'extra-model-3', 'extra-model-4'])
      expect(findText(findByAttr(rendered, 'data-model', 'other-model'), '—')).toBe('—')
      expect(findText(findByTestId(rendered, 'dsh-tako-catalog-more'), '收起')).toBe('收起')
    } finally {
      hookStates = []
    }
  })
})

describe('client TakoMark', () => {
  it('inlines the PNG as a data URL and never uses import.meta', () => {
    const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
    expect(source).not.toContain('import.meta')
    const match = source.match(/const TAKO_MARK_URL = '(data:image\/png;base64,([A-Za-z0-9+/=]+))'/)
    expect(match).not.toBeNull()
    const png = readFileSync(new URL('../client/icon.png', import.meta.url))
    expect(Buffer.from(match![2]!, 'base64').equals(png)).toBe(true)
  })

  it('renders dsh-tako-mark as an img whose src is the inlined PNG data URL', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    hookStates = [undefined, undefined, undefined, undefined, false, undefined, { status: 'idle' }, '', false, false, undefined]
    try {
      const mark = findByTestId(render(page, {}), 'dsh-tako-mark')
      expect(mark?.tag).toBe('img')
      expect(String(mark?.props?.src)).toMatch(/^data:image\/png;base64,/)
    } finally {
      hookStates = []
    }
  })
})
describe('client console surfaces', () => {
  const catalog = {
    models: [
      { id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
      { id: 'deepseek-v4-pro', contextWindow: 1_050_000, input: ['text'] },
      { id: 'tako-auto', contextWindow: 272_000, input: ['text'], reasoningEfforts: false },
      { id: 'gemma-4-31b-it', input: ['text'] },
    ],
    nextSyncAt: null,
  }
  /**
   * TakoConsolePage consumes 11 useState slots (status, statusError, catalog,
   * catalogError, busyLogout, logoutNote, tab, notice, dismissedNotice,
   * diagCopied, login). Inlined components share the stream afterwards:
   * overview → KeyEditor(4) + UpdateCard(5); key tab → KeyTab(1) + KeyEditor(4);
   * models tab → ModelsTab(3: pinned, syncBusy, syncNote) + CatalogCard(3: open,
   * query, filter); requests → RequestsTab(4); usage → UsageTab(2);
   * config → ConfigTab(5: config, error, form, saving, note).
   */
  const pageHooks = (options: { tab?: string, filter?: string, query?: string, open?: boolean, keyValue?: string, pinned?: string[] } = {}): unknown[] => {
    const base = [undefined, undefined, catalog, undefined, false, undefined, options.tab ?? 'overview', undefined, undefined, false, { status: 'idle' }]
    const tab = options.tab ?? 'overview'
    if (tab === 'models') return [...base, options.pinned, false, undefined, options.open ?? false, options.query ?? '', options.filter ?? 'all']
    if (tab === 'key') return [...base, undefined, options.keyValue ?? '', false, false, undefined]
    if (tab === 'overview') return [...base, options.keyValue ?? '', false, false, undefined]
    return base
  }

  const renderPage = async (hooks: unknown[]) => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    hookStates = hooks
    face.setActive('zh')
    return { rendered: render(page, { t: face.bind() }) as Element, face, render, page }
  }

  it('offers a paste-a-key editor and a searchable catalog summary on the models tab', async () => {
    try {
      const overview = await renderPage(pageHooks())
      expect(findByTestId(overview.rendered, 'dsh-tako-key-input')).toBeDefined()
      expect(findByTestId(overview.rendered, 'dsh-tako-key-save')).toBeDefined()
      expect(findByTestId(overview.rendered, 'dsh-tako-tab-requests')).toBeDefined()
      expect(findByTestId(overview.rendered, 'dsh-tako-copy-diagnostics')).toBeDefined()

      const { rendered } = await renderPage(pageHooks({ tab: 'models' }))
      expect(findByTestId(rendered, 'dsh-tako-catalog-search')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-catalog-filter-all')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-catalog-filter-vision')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-catalog-filter-long')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-catalog-filter-reasoning')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-catalog-sync')).toBeDefined()
      expect(findText(findByTestId(rendered, 'dsh-tako-catalog-summary'), '共 4 个')).toBe('共 4 个 · 视觉 1 · 长上下文 2 · 推理 3')
      expect(findByTestId(rendered, 'dsh-tako-catalog-filter-long')?.children[0]).toBe('长上下文')
      expect(findByTestId(rendered, 'dsh-tako-key-input')).toBeUndefined()
    } finally {
      hookStates = []
    }
  })

  it('filters the catalog by capability and by name', async () => {
    try {
      let { rendered } = await renderPage(pageHooks({ tab: 'models', filter: 'vision' }))
      expect(collectModels(rendered)).toEqual(['deepseek-v4.1-flash'])

      const named = await renderPage(pageHooks({ tab: 'models', query: 'tako' }))
      rendered = named.rendered
      expect(collectModels(rendered)).toEqual(['tako-auto'])
      expect(findText(findByTestId(rendered, 'dsh-tako-catalog-shown'), '显示')).toBe('显示 1 / 4')

      const miss = await renderPage(pageHooks({ tab: 'models', query: 'no-such-model' }))
      expect(findByTestId(miss.rendered, 'dsh-tako-catalog-nomatch')).toBeDefined()
      expect(findText(miss.rendered, '没有匹配的模型')).toBe('没有匹配的模型')
    } finally {
      hookStates = []
    }
  })

  it('renders pin stars on catalog rows when the config lists pinned models', async () => {
    try {
      const { rendered } = await renderPage(pageHooks({ tab: 'models', pinned: ['deepseek-v4.1-flash'] }))
      expect(findByTestId(rendered, 'dsh-tako-pin-deepseek-v4.1-flash')?.props?.['data-active']).toBe('true')
      expect(findByTestId(rendered, 'dsh-tako-pin-tako-auto')?.props?.['data-active']).toBe('false')
    } finally {
      hookStates = []
    }
  })

  it('renders plaza-style model cards when the catalog carries cards', async () => {
    const withCards = {
      ...catalog,
      cards: [{
        id: 'deepseek-v4.1-flash', vendor: 'deepseek', description: '旗舰模型，1M 上下文', tags: ['1M', 'Vision'],
        endpoints: ['openai', 'anthropic'], groups: ['default'], contextWindow: 1_000_000, vision: true, reasoning: true,
        claudeCodeOnly: false, standardPriceUsdPerMillion: 4, realizedPriceUsdPerMillion: 3.2,
        cacheHitRate: 0.8, channelCount: 5, channelTag: '安全', outputRatio: 4,
      }],
    }
    try {
      const hooks = pageHooks({ tab: 'models', pinned: ['deepseek-v4.1-flash'] })
      hooks[2] = withCards
      const { rendered } = await renderPage(hooks)
      const card = findByTestId(rendered, 'dsh-tako-modelcard-deepseek-v4.1-flash')
      expect(card).toBeDefined()
      expect(card?.props?.['data-pinned']).toBe('true')
      expect(findText(card, '旗舰模型')).toBeDefined()
      expect(findText(card, '$4/M')).toBeDefined()
      expect(findText(card, '~$3.2/M')).toBeDefined()
      expect(findText(card, '安全')).toBeDefined()
      expect(findText(card, '渠道 5')).toBeDefined()
      expect(findText(card, 'openai·anthropic')).toBeDefined()
      expect(findByTestId(card, 'dsh-tako-pin-deepseek-v4.1-flash')).toBeDefined()
      // legacy row markup is replaced by the card grid
      expect(findByAttr(rendered, 'data-dsh-tako-card', 'catalog')).toBeDefined()
    } finally {
      hookStates = []
    }
  })

  it('shows the notice list on the overview and keeps tab panels exclusive', async () => {
    try {
      const hooks = pageHooks()
      hooks[7] = { ok: true, announcements: [{ id: 7, type: 'warning', publishDate: '2026-11-10T02:00:00Z', content: '## 波动\n服务波动\n- a\n- b' }, { id: 8, type: 'success', publishDate: '2026-11-09T00:00:00Z', content: '已恢复' }] }
      const { rendered } = await renderPage(hooks)
      const notice = findByTestId(rendered, 'dsh-tako-notice')
      expect(notice).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-notice-item')).toBeDefined()
      expect(findText(notice, '波动')).toBeDefined()
      expect(findText(notice, '2026-11-10')).toBeDefined()
      // the expanded body renders markdown-lite
      const body = findByTestId(rendered, 'dsh-tako-notice-body')
      expect(body).toBeDefined()
      expect(findText(body, '服务波动')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-overview')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-requests')).toBeUndefined()

      // dismissed by id → the whole list hides when nothing is left
      const next = pageHooks()
      next[7] = { ok: true, announcements: [{ id: 7, content: '## 波动\n服务波动' }] }
      next[8] = ['7']
      const second = await renderPage(next)
      expect(findByTestId(second.rendered, 'dsh-tako-notice')).toBeUndefined()
    } finally {
      hookStates = []
    }
  })

  it('renders request logs with the model filter select', async () => {
    try {
      const hooks = pageHooks({ tab: 'requests' })
      hooks.push([
        { id: 1, createdAt: 1718000000, modelName: 'deepseek-v4.1-flash', promptTokens: 1200, completionTokens: 300, quota: 250000, useTime: 3, isStream: true, requestId: 'chatcmpl-abc123', ip: '1.2.3.4', type: 2 },
      ], undefined, '', false)
      const { rendered } = await renderPage(hooks)
      expect(findByTestId(rendered, 'dsh-tako-logs-table')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-logs-model')).toBeDefined()
      expect(findText(rendered, 'deepseek-v4.1-flash')).toBeDefined()
      expect(findText(rendered, 'chatcmpl')).toBeDefined()
      expect(findText(rendered, '1.2K')).toBeDefined()
    } finally {
      hookStates = []
    }
  })

  it('degrades per-leg errors on the usage tab instead of blanking the panel', async () => {
    try {
      const hooks = pageHooks({ tab: 'usage' })
      hooks.push({
        ok: true,
        token: { name: 'k', grantedUsd: 10, usedUsd: 2.5, availableUsd: 7.5, unlimitedQuota: false, expiresAt: 0 },
        dailyCostUsd: undefined, statsError: 'user-stats HTTP 503',
        models: [{ model: 'deepseek-v4.1-flash', requests: 3, inputTokens: 1000, outputTokens: 200, costUsd: 0.01 }],
      }, undefined)
      const { rendered } = await renderPage(hooks)
      expect(findByTestId(rendered, 'dsh-tako-usage-statserror')).toBeDefined()
      expect(findText(rendered, 'deepseek-v4.1-flash')).toBeDefined()
      expect(findText(rendered, '$7.5')).toBeDefined()
    } finally {
      hookStates = []
    }
  })

  it('posts the config form back to the config route', async () => {
    vi.useFakeTimers()
    const setStates: Record<number, unknown> = {}
    const effects: (() => void | (() => void))[] = []
    const { plugin, render } = materialize({
      effect: callback => { effects.push(callback) },
      setState: (index, value) => { setStates[index] = value },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const page = entries.find(entry => entry.slot === 'main')!.component
    const posts: { url: string, body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      const url = String(input)
      if (url.includes('tako.config') && init.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) })
        return Response.json({ ok: true })
      }
      if (url.includes('tako.config')) return Response.json({
        ok: true, writable: true,
        config: { refreshIntervalMs: 1_800_000, syncRetryDelaysMs: [1000, 5000], defaultContextWindow: 128_000, pinned: ['tako-auto'], include: [], exclude: [], includeClaudeCodeOnly: false, overrides: {} },
        webSearchProvider: 'tako',
      })
      if (url.includes('tako.catalog')) return Response.json({ models: [], lastSyncAt: null, nextSyncAt: null })
      return Response.json({ configured: false })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = [undefined, undefined, { models: [] }, undefined, false, undefined, 'config', undefined, undefined, false, { status: 'idle' }]
      render(page, {})
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.advanceTimersByTimeAsync(0)
      // ConfigTab's form state (index 13) was written by the config GET.
      const form = setStates[13] as Record<string, unknown> | undefined
      expect(form?.refreshMinutes).toBe('30')
      expect(form?.retryDelays).toBe('1000, 5000')
      // Replay the recorded states for a second render so the form is mounted.
      hookStates = [undefined, undefined, { models: [] }, undefined, false, undefined, 'config', undefined, undefined, false, { status: 'idle' }, setStates[11], setStates[12], setStates[13]]
      const rendered = render(page, {}) as Element
      const save = findByTestId(rendered, 'dsh-tako-config-save')
      expect(save).toBeDefined()
      void ((save!.props as { onClick: () => void }).onClick)()
      await vi.advanceTimersByTimeAsync(0)
      expect(posts.length).toBe(1)
      const set = (posts[0]!.body as { set: Record<string, unknown> }).set
      expect(set.refreshIntervalMs).toBe(1_800_000)
      expect(set.syncRetryDelaysMs).toEqual([1000, 5000])
      expect(set.pinned).toEqual(['tako-auto'])
      expect(set.webSearchProvider).toBe('tako')
    } finally {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
      vi.useRealTimers()
      hookStates = []
    }
  })
})
