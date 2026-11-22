import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * The browser half (client/client.js) is a plain script that registers itself
 * with `window.__ModuleLoader__`. These tests load it exactly the way the dsh
 * web client does — a stub module loader captures the factory, a stub `require`
 * supplies a recording React — and then drive `apply(ctx)` against stub
 * contexts, with and without a locale service, to pin the i18n, pricing,
 * flat model directory, console, and sidebar footer contracts.
 */

type Element = { tag: string | Function, props: Record<string, unknown> | null, children: unknown[] }
type Plugin = { inject: string[], apply: (ctx: unknown) => unknown }
type ModuleRow = { id: string, factory: (require: (spec: string) => unknown) => Plugin }
type SlotEntry = { slot: string, options: Record<string, unknown>, component: unknown }

/** Core dictionary keys that must stay present and non-empty in both zh and en. */
const REQUIRED_KEYS = [
  'signIn', 'signInAgain', 'cancel', 'waiting', 'openLink', 'success', 'failed', 'denied', 'timeout', 'remote',
  'panel', 'modelsPanel', 'modelsSub', 'gotoModels', 'gotoConsole', 'backToConsole', 'consoleTitle',
  'accountCard', 'signedIn', 'signedOut', 'connected', 'signedOutLead', 'signinTitle', 'signinDesc',
  'account', 'plan', 'paygoBadge', 'noPlanBadge', 'unknown', 'whoamiFailed',
  'signOut', 'signOutWorking', 'logoutRevoked', 'logoutRemoved', 'logoutNone', 'logoutExternal',
  'quotaCard', 'quotaRemain', 'quotaUsed', 'quotaPoints', 'quotaUsedShare', 'quotaNoteUsd', 'quotaNoteUnknown',
  'quotaNeedsLogin', 'quotaUnavailable', 'walletBalance', 'walletBalanceTitle', 'walletLow',
  'planWindows', 'planQuotaTitle', 'windowHours', 'windowHoursLong', 'weeklyShort', 'thisWeek',
  'planWindowWarn', 'paygoTitle', 'paygoDesc', 'spendChartTitle', 'topModelsTitle',
  'footerRemain', 'footerRemainShort', 'footerUsed', 'footerSignIn', 'footerSignInHint', 'footerPaygoHint', 'footerLowWarn',
  'catalogCard', 'catalogModel', 'catalogContext', 'catalogVision', 'visionBadge', 'yes', 'no', 'catalogDefault', 'catalogEmpty',
  'catalogSyncing', 'catalogRetrying', 'catalogFailed', 'catalogAttempts', 'catalogReadAgain',
  'catalogDirectoryError', 'catalogSettingsError', 'catalogWriteError', 'catalogReadOnlyError', 'catalogEmptyError', 'catalogTransactionError',
  'refreshIn', 'refreshSoon', 'refreshOnlyAtStartup', 'loadFailed', 'retry', 'consoleRestartRequired',
  'searchModelsPlaceholder', 'currentChatLabel', 'notSelected', 'filterBtn', 'filterDone', 'filterClear',
  'filterVendor', 'filterCapability', 'filterBilling',
  'priceDetail', 'priceAvg', 'curCnyShort', 'curUsdShort', 'usdWarnChip', 'cnyNote', 'discountNote',
  'per1M', 'per1K', 'perCall', 'sortRec', 'sortPrice', 'sortDisc', 'sortName', 'viewCard', 'viewTable',
  'quickAll', 'quickFav', 'quickPromo', 'quickCheap', 'quickCode', 'quickLong', 'quickVision',
  'priceInput', 'priceCache', 'priceOutput', 'priceRealizedTag', 'priceStdTag', 'priceNewNoRealized',
  'discountBadge', 'promoBar', 'promoEnds', 'setChatModel', 'currentChatModel', 'setChatNeedLogin',
  'setChatDone', 'setChatFallback', 'favAdd', 'favAdded', 'copyModelId', 'plazaShort',
  'updateCard', 'updateAvailable', 'updateCommand', 'upToDate', 'verUpToDate', 'checkUpdate', 'pluginVersion',
  'copy', 'copied', 'updateFailed', 'updateNow', 'updating', 'updateInstalled', 'updateInstallFailed',
  'servicesCard', 'serviceConsole', 'servicePricing', 'serviceWallet', 'serviceSubscriptions', 'serviceDocs',
  'openInTako', 'managePlan', 'topUp', 'plazaLink',
  'keyCard', 'keyHint', 'keyOrPaste', 'keyConfigured', 'keyMissing', 'keyPlaceholder', 'keySave', 'keySaving',
  'keySaved', 'keyInvalid', 'keyClear', 'keyClearing', 'keyCleared', 'keyClearExternal', 'keyClearNone',
  'keyShow', 'keyHide', 'keySource', 'endpointLabel', 'credentialLabel', 'keyPlaintextHost',
  'tabOverview', 'tabRequests', 'tabUsage', 'tabModels', 'tabKey', 'tabConfig',
  'diagCopy', 'diagCopied', 'noticeDismiss', 'noticeTitle', 'noticeEmpty', 'noticeExpand', 'noticeCollapse',
  'noticeHistory', 'noticeHistoryHide',
  'cardChannels', 'cardEndpoints', 'cardClaude',
  'logsEmpty', 'logsNeedLogin', 'logsModel', 'logsRefresh', 'logsLoading',
  'logsColTime', 'logsColModel', 'logsColIn', 'logsColOut', 'logsColCost', 'logsColDuration', 'logsColRequest',
  'logTypeTopup', 'logTypeConsume', 'logTypeManage', 'logTypeSystem', 'logTypeError', 'logTypeRefund', 'logTypeLogin',
  'usageToday', 'usageTokenCard', 'usageGranted', 'usageUsed', 'usageAvailable', 'usageUnlimited', 'usageExpires',
  'usageNever', 'usageModelLimits', 'usageNoLimits', 'usagePerModel', 'usageRequests',
  'keyTokenCard', 'keyName', 'keyExpires', 'keyModels',
  'syncNow', 'syncWorking', 'syncFailed', 'pinTitle', 'unpinTitle', 'pinFailed',
  'configSave', 'configSaving', 'configSaved', 'configFailed', 'configReadOnly', 'configRetryDelays',
  'configRefresh', 'configDefaultCtx', 'configClaudeOnly', 'configInclude', 'configExclude',
  'configPinnedField', 'configSearchProvider', 'configSearchTako', 'configSearchDefault', 'configOverrides',
  'configCatalogSection',
]

let row: ModuleRow | undefined

async function loadModuleRow(): Promise<ModuleRow> {
  if (row !== undefined) return row
  const globals = globalThis as unknown as Record<string, unknown>
  const events = new EventTarget()
  globals.window = {
    __ModuleLoader__: { load: (m: ModuleRow) => { row = m } },
    location: { hostname: '127.0.0.1' },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  }
  globals.document = { documentElement: { lang: 'zh-CN' } }
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true })
  // @ts-expect-error TS7016: client/client.js is an untyped plain-JS bundle
  await import('../client/client.js')
  if (row === undefined) throw new Error('client/client.js did not call window.__ModuleLoader__.load')
  return row
}

/** Initial useState results, indexed by hook order, consumed by one render. */
let hookStates: unknown[] = []

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
      const value = hookStates[index] !== undefined ? hookStates[index] : (typeof initial === 'function' ? (initial as () => unknown)() : initial)
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

function stubCtx(options: { locale?: unknown } = {}) {
  const listeners: ((name: string, value: unknown) => void)[] = []
  const entries: SlotEntry[] = []
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

const findConsolePage = (entries: SlotEntry[]) =>
  entries.find(entry => entry.slot === 'main' && entry.options.key === 'tako-console')!.component
const findModelsPage = (entries: SlotEntry[]) =>
  entries.find(entry => entry.slot === 'main' && entry.options.key === 'tako-models')!.component
const findSidebar = (entries: SlotEntry[], id: string) =>
  entries.find(entry => entry.slot === 'sidebar.panellist' && entry.options.id === id)!

const setDocumentLang = (lang: string) => {
  (globalThis as unknown as { document: { documentElement: { lang: string } } }).document.documentElement.lang = lang
}

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

function findByTestId(node: unknown, testId: string): Element | undefined {
  return findByAttr(node, 'data-testid', testId)
}

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

function findByTextButton(node: unknown, text: string): Element | undefined {
  if (Array.isArray(node)) return node.map(child => findByTextButton(child, text)).find(Boolean)
  if (node === null || typeof node !== 'object') return undefined
  const el = node as Element
  if (el.tag === 'button' && findText(el, text) === text) return el
  return findByTextButton(el.children ?? [], text)
}

const DEFAULT_PREFS = { priceMode: 'detail', currency: 'cny', tokenUnit: 'M', layout: 'card', sort: 'rec' }

/**
 * Helper for TakoConsolePage hook slots (indices 0..16):
 *  0 status, 1 statusError, 2 catalog, 3 catalogError, 4 busyLogout, 5 logoutNote,
 *  6 tab, 7 notice, 8 dismissedNotice, 9 diagCopied, 10 noticeHistoryOpen,
 *  11 login.state, 12 usage, 13 recentLogs, 14 pinned, 15 activeModel, 16 prefs.
 */
function consoleHooks(opts: {
  status?: unknown, statusError?: unknown, catalog?: unknown, catalogError?: unknown,
  busyLogout?: boolean, logoutNote?: unknown, tab?: string, notice?: unknown,
  dismissed?: string[], diagCopied?: boolean, historyOpen?: boolean,
  login?: unknown, usage?: unknown, recentLogs?: unknown, pinned?: string[],
  activeModel?: string, prefs?: Partial<typeof DEFAULT_PREFS>,
  extra?: unknown[],
} = {}): unknown[] {
  return [
    opts.status,
    opts.statusError,
    opts.catalog,
    opts.catalogError,
    opts.busyLogout ?? false,
    opts.logoutNote,
    opts.tab ?? 'overview',
    opts.notice,
    opts.dismissed ?? [],
    opts.diagCopied ?? false,
    opts.historyOpen ?? false,
    opts.login ?? { status: 'idle' },
    opts.usage,
    opts.recentLogs,
    opts.pinned ?? [],
    opts.activeModel,
    { ...DEFAULT_PREFS, ...opts.prefs },
    ...(opts.extra ?? []),
  ]
}

/**
 * Helper for TakoModelsPage hook slots (indices 0..15):
 *  0 status, 1 catalog, 2 catalogError, 3 pinned, 4 activeModel, 5 prefs,
 *  6 query, 7 quick, 8 vendors, 9 caps, 10 bill, 11 vendorAll,
 *  12 openMenu, 13 filterOpen, 14 drawerId, 15 toastText.
 */
function modelsPageHooks(opts: {
  status?: unknown, catalog?: unknown, catalogError?: unknown, pinned?: string[],
  activeModel?: string, prefs?: Partial<typeof DEFAULT_PREFS>,
  query?: string, quick?: string, vendors?: string[], caps?: string[], bill?: string,
  vendorAll?: boolean, openMenu?: string | null, filterOpen?: boolean, drawerId?: string | null,
  toastText?: string,
} = {}): unknown[] {
  return [
    opts.status,
    opts.catalog,
    opts.catalogError,
    opts.pinned ?? [],
    opts.activeModel,
    { ...DEFAULT_PREFS, ...opts.prefs },
    opts.query ?? '',
    opts.quick ?? 'all',
    opts.vendors ?? [],
    opts.caps ?? [],
    opts.bill ?? 'all',
    opts.vendorAll ?? false,
    opts.openMenu ?? null,
    opts.filterOpen ?? false,
    opts.drawerId ?? null,
    opts.toastText,
  ]
}

describe('client i18n: registration', () => {
  it('registers symmetric, non-empty zh/en dictionaries under the dsh-tako namespace', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    const face = localeService()
    const { ctx } = stubCtx({ locale: face })
    plugin.apply(ctx)
    expect(face.calls.length).toBe(1)
    expect(face.calls[0]!.ns).toBe('dsh-tako')
    const dicts = face.calls[0]!.dicts
    expect(Object.keys(dicts).sort()).toEqual(['en', 'zh'])
    expect(Object.keys(dicts.zh!).sort()).toEqual(Object.keys(dicts.en!).sort())
    for (const locale of ['zh', 'en'] as const) {
      for (const required of REQUIRED_KEYS) {
        expect(dicts[locale]![required], `${locale}.${required}`).toMatch(/./)
      }
      for (const [key, value] of Object.entries(dicts[locale]!)) {
        expect(value, `${locale}.${key}`).toMatch(/./)
      }
    }
  })

  it('treats the desktop workbench as a local host so plugin login is not marked remote', async () => {
    await loadModuleRow()
    const win = globalThis.window as unknown as { location: { hostname: string }, __DSH_TAKO_PROFILE__?: boolean }
    const previous = win.location.hostname
    win.location.hostname = 'app'
    win.__DSH_TAKO_PROFILE__ = true
    hookStates = [{ status: 'pending', id: '1', url: 'https://tako.example/app/authorize' }, 2, '', false, undefined]
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

  it('keeps browser sign-in but blocks the 0.6-only paste route on a previous Host', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const SignIn = entries.find(entry => entry.slot === 'settings.models.provider-card')!.component
    try {
      face.setActive('en')
      hookStates = [{ status: 'idle' }, 0]
      const legacy = render(SignIn, { provider: { provider: 'tako' }, keyConfigured: false, t: face.bind() }) as Element
      expect(findByTestId(legacy, 'dsh-tako-sign-in')).toBeDefined()
      expect(findByTestId(legacy, 'dsh-tako-paste-key')).toBeUndefined()
      expect(findByTestId(legacy, 'dsh-tako-sign-in-restart-required')).toBeDefined()
      hookStates = [{ status: 'idle' }, 2, '', false, undefined]
      const current = render(SignIn, { provider: { provider: 'tako' }, keyConfigured: false, t: face.bind() }) as Element
      expect(findByTestId(current, 'dsh-tako-paste-key')).toBeDefined()
      expect(findByTestId(current, 'dsh-tako-sign-in-restart-required')).toBeUndefined()
    } finally { hookStates = [] }
  })

  it('retries the Host protocol probe after a transient catalog failure', async () => {
    await loadModuleRow()
    vi.useFakeTimers()
    const effects: (() => void | (() => void))[] = []
    const updates: Array<{ index: number, value: unknown }> = []
    const { plugin, render } = materialize({
      effect: callback => { effects.push(callback) },
      setState: (index, value) => { updates.push({ index, value }) },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const SignIn = entries.find(entry => entry.slot === 'settings.models.provider-card')!.component
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (!String(input).includes('tako.catalog')) return new Response(null, { status: 404 })
      calls++
      if (calls === 1) throw new Error('temporary connection loss')
      return Response.json({ consoleApiVersion: 2, models: [] })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = [{ status: 'idle' }, undefined]
      render(SignIn, { provider: { provider: 'tako' }, keyConfigured: false })
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toBe(1)
      expect(updates.some(update => update.index === 1)).toBe(false)
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toBe(2)
      expect(updates).toContainEqual({ index: 1, value: 2 })
    } finally {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
      vi.useRealTimers()
      hookStates = []
    }
  })

  it('keeps activation gated on slots only — no hard locale dependency', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    expect(plugin.inject).toEqual(['slots'])
  })

  it('registers Models + Console main/sidebar slots with dsh-tako locale and dynamic labels', async () => {
    await loadModuleRow()
    const { plugin } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    expect(entries.map(entry => entry.slot).sort()).toEqual([
      'main', 'main', 'settings.models.provider-card', 'sidebar.footer.action', 'sidebar.panellist', 'sidebar.panellist',
    ])
    for (const entry of entries) expect(entry.options.locale).toBe('dsh-tako')
    const modelsLabel = findSidebar(entries, 'tako-models').options.label as () => string
    const consoleLabel = findSidebar(entries, 'tako-console').options.label as () => string
    expect(findSidebar(entries, 'tako-models').options.order).toBe(19)
    expect(findSidebar(entries, 'tako-console').options.order).toBe(20)
    face.setActive('zh')
    expect(modelsLabel()).toBe('Tako 模型')
    expect(consoleLabel()).toBe('Tako 控制台')
    face.setActive('en')
    expect(modelsLabel()).toBe('Tako Models')
    expect(consoleLabel()).toBe('Tako Console')
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
    expect(face.calls.length).toBe(0)
    const consoleLabel = findSidebar(entries, 'tako-console').options.label as () => string
    const modelsLabel = findSidebar(entries, 'tako-models').options.label as () => string
    expect(consoleLabel()).toBe('Tako 控制台')
    expect(modelsLabel()).toBe('Tako 模型')
    setDocumentLang('en')
    expect(consoleLabel()).toBe('Tako Console')
    expect(modelsLabel()).toBe('Tako Models')
    provide('locale', face)
    expect(face.calls.length).toBe(1)
    face.setActive('zh')
    expect(consoleLabel()).toBe('Tako 控制台')
    face.setActive('en')
    expect(consoleLabel()).toBe('Tako Console')
  })

  it('renders Models and Console pages through inline fallback and honors props.t', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const modelsPage = findModelsPage(entries)
    const consolePage = findConsolePage(entries)
    const catalog = { consoleApiVersion: 2, models: [{ id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] }], nextSyncAt: Date.now() + 5 * 60_000 }
    try {
      setDocumentLang('zh-CN')
      hookStates = modelsPageHooks({ catalog })
      let rendered = render(modelsPage, {}) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako 模型')
      expect(findText(rendered, '分钟后刷新')).toBe('约 5 分钟后刷新')
      const card = findByTestId(rendered, 'dsh-tako-modelcard-deepseek-v4.1-flash')
      expect(findText(findByAttr(card, 'className', 'ctx'), '1M')).toBe('1M')
      expect(findText(card, '视觉')).toBe('视觉')

      setDocumentLang('en')
      hookStates = modelsPageHooks({ catalog })
      rendered = render(modelsPage, {}) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako Models')
      expect(findText(rendered, 'min')).toBe('refreshes in ~5 min')

      // props.t overrides document language
      face.setActive('zh')
      hookStates = modelsPageHooks({ catalog })
      rendered = render(modelsPage, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako 模型')

      // Signed-out centered sign-in card
      hookStates = consoleHooks({ status: { consoleApiVersion: 2, configured: false }, catalog })
      rendered = render(consolePage, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findByTestId(rendered, 'dsh-tako-console-sign-in')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-key-input')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-key-save')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-models')).toBeUndefined()

      // Signed-in Console Overview
      hookStates = consoleHooks({
        status: { consoleApiVersion: 2, configured: true, maskedKey: 'cr_****abcd', me: { userName: 'Ada', planName: 'Pro', quotaRemainUsd: 30 } },
        catalog,
      })
      rendered = render(consolePage, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Ada')
      expect(findText(rendered, 'cr_****abcd')).toBe('cr_****abcd')
      expect(findText(rendered, 'Pro')).toBe('Pro')
      expect(findByTestId(rendered, 'dsh-tako-console-sign-out')).toBeDefined()
      expect(findByAttr(rendered, 'data-dsh-tako-card', 'account')).toBeDefined()
      // Default currency is CNY actual spend ($30 internal ÷ 3 = ¥10.00)
      expect(findText(findByTestId(rendered, 'dsh-tako-quota-remain'), '¥10.00')).toBe('¥10.00')
    } finally {
      hookStates = []
    }
  })

  it('keeps a previous Host usable and blocks 0.6-only routes until restart', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = findConsolePage(entries)
    const catalog = { models: [{ id: 'existing-model' }], nextSyncAt: null }
    hookStates = consoleHooks({ status: { configured: true, maskedKey: 'cr_****abcd' }, catalog, tab: 'requests' })
    try {
      face.setActive('en')
      const rendered = render(page, { t: face.bind() }) as Element
      expect(findByTestId(rendered, 'dsh-tako-console-restart-required')).toBeDefined()
      expect(JSON.stringify(rendered)).toContain('Restart dsh')
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-requests')).toBeUndefined()
      expect(findByTestId(rendered, 'dsh-tako-console-sign-out')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-key-input')).toBeUndefined()
    } finally { hookStates = [] }
  })

  it('keeps legacy-safe cards visible while the protocol catalog is unavailable', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = findConsolePage(entries)
    hookStates = consoleHooks({ status: { configured: true, maskedKey: 'cr_****abcd' }, catalog: undefined, catalogError: 'HTTP 503', tab: 'requests' })
    try {
      face.setActive('en')
      const rendered = render(page, { t: face.bind() }) as Element
      expect(findByAttr(rendered, 'data-dsh-tako-card', 'account')).toBeDefined()
      expect(findByAttr(rendered, 'data-dsh-tako-card', 'services')).toBeDefined()
      expect(findByAttr(rendered, 'data-dsh-tako-card', 'update')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-console-restart-required')).toBeUndefined()
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-requests')).toBeUndefined()
      expect(JSON.stringify(rendered)).toContain('HTTP 503')
    } finally { hookStates = [] }
  })

  it('never calls 0.6-only routes while a previous Host is still running', async () => {
    await loadModuleRow()
    const effects: (() => void | (() => void))[] = []
    const { plugin, render } = materialize({ effect: callback => { effects.push(callback) } })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const fetchImpl = vi.fn(async (input: string) => {
      const url = String(input)
      if (url.includes('tako.status')) return Response.json({ configured: true, maskedKey: 'cr_****abcd' })
      if (url.includes('tako.catalog')) return Response.json({ models: [], lastSyncAt: 1, nextSyncAt: null, status: 'ready' })
      if (url.includes('tako.update')) return Response.json({ current: '0.5.22', latest: '0.6.0', upToDate: false })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const disposers: (() => void)[] = []
    try {
      hookStates = consoleHooks({
        status: { configured: true, maskedKey: 'cr_****abcd' },
        catalog: { models: [], lastSyncAt: 1, nextSyncAt: null, status: 'ready' },
      })
      render(findConsolePage(entries), {})
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3))
      const routes = fetchImpl.mock.calls.map(([input]) => String(input))
      expect(routes).toEqual(expect.arrayContaining(['/api/tako.status', '/api/tako.catalog', '/api/tako.update']))
      for (const route of ['/api/tako.key', '/api/tako.logs', '/api/tako.usage', '/api/tako.notice', '/api/tako.config', '/api/tako.sync', '/api/tako.model']) {
        expect(routes).not.toContain(route)
      }
    } finally {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
      hookStates = []
    }
  })

  it('shows safe retry failure and sync controls in Console Settings tab', async () => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const page = findConsolePage(entries)
    hookStates = consoleHooks({
      catalog: {
        consoleApiVersion: 2, models: [], lastSyncAt: null, nextSyncAt: null, refreshIntervalMs: 1800000,
        status: 'failed', attempts: 4, lastError: { code: 'write-failed', message: 'untrusted-payload', at: 10 },
      },
      tab: 'config',
    })
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
    const { plugin, render } = materialize({
      effect: callback => { effects.push(callback) },
      setState: (index, value) => { if (index === 2) updates.push(value) },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const page = findConsolePage(entries)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (!String(input).includes('tako.catalog')) return Response.json({ consoleApiVersion: 2, configured: false })
      calls++
      return Response.json(calls === 1 ? { consoleApiVersion: 2, models: [], lastSyncAt: null, nextSyncAt: Date.now() + 1000, status: 'retrying' }
        : { consoleApiVersion: 2, models: [{ id: 'recovered' }], lastSyncAt: Date.now(), nextSyncAt: null, status: 'ready' })
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
    const { plugin, render } = materialize({
      effect: callback => { effects.push(callback) },
      setState: (index, value) => { if (index === 2) updates.push(value) },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    let calls = 0
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      if (!String(input).includes('tako.catalog')) return Response.json({ consoleApiVersion: 2, configured: false })
      calls++
      signal = init.signal ?? undefined
      return Response.json({ consoleApiVersion: 2, models: [], lastSyncAt: null, nextSyncAt: null, status: 'failed' })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = []
      render(findConsolePage(entries), {})
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
    const { plugin, render } = materialize({
      effect: callback => { effects.push(callback) },
      setState: (index, value) => { if (index === 2) updates.push(value) },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const deadline = Date.now() + 1800000
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (!String(input).includes('tako.catalog')) return Response.json({ consoleApiVersion: 2, configured: false })
      calls++
      return Response.json(Date.now() < deadline ? { consoleApiVersion: 2, models: [], lastSyncAt: null, nextSyncAt: deadline, status: 'failed' }
        : { consoleApiVersion: 2, models: [{ id: 'later-success' }], lastSyncAt: Date.now(), nextSyncAt: null, status: 'ready' })
    }))
    const disposers: (() => void)[] = []
    try {
      hookStates = []
      render(findConsolePage(entries), {})
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
    const consolePage = findConsolePage(entries)
    const modelsPage = findModelsPage(entries)
    const status = {
      consoleApiVersion: 2,
      configured: true,
      origin: 'https://tako.example',
      maskedKey: 'cr_****WXYZ',
      me: { userName: 'u', planName: 'Pro', quotaRemainUsd: 2 },
      plan: { windowMinutes: 300, windowCost: 12, windowCostLimit: 200, weeklyCost: 80, weeklyCostLimit: 930 },
    }
    const catalog = { consoleApiVersion: 2, models: [{ id: 'swe-2', contextWindow: 262000, input: ['text', 'image'] }], nextSyncAt: null }
    try {
      hookStates = consoleHooks({ status, catalog })
      let rendered = render(consolePage, { t: face.bind() }) as Element
      let flat = JSON.stringify(rendered)
      for (const path of ['/dashboard', '/pricing', '/wallet', '/subscriptions', '/docs']) {
        expect(flat).toContain(`https://tako.example${path}`)
      }
      expect(flat).not.toContain('pricing?search=swe-2')

      // Model details drawer links to the reported origin's pricing search
      hookStates = modelsPageHooks({ status, catalog, drawerId: 'swe-2' })
      rendered = render(modelsPage, { t: face.bind() }) as Element
      flat = JSON.stringify(rendered)
      expect(flat).toContain('https://tako.example/pricing?search=swe-2')
    } finally {
      hookStates = []
    }
  })
})

describe('client flat model directory, plaza pricing & filter drawer', () => {
  const richCatalog = {
    consoleApiVersion: 2,
    models: [
      { id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
      { id: 'claude-fable-5-2', contextWindow: 200_000, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
      { id: 'grok-4.6', contextWindow: 256_000, input: ['text'], reasoningEfforts: { high: 'high' } },
      { id: 'free-chat-model', contextWindow: 128_000, input: ['text'], reasoningEfforts: false },
      { id: 'per-call-model', contextWindow: 128_000, input: ['text'], reasoningEfforts: false },
      { id: 'new-unmeasured', contextWindow: 128_000, input: ['text'] },
      { id: 'extra-model-1', contextWindow: 128_000, input: ['text'] },
      { id: 'extra-model-2', contextWindow: 128_000, input: ['text'] },
    ],
    cards: [
      {
        id: 'deepseek-v4.1-flash', vendor: 'deepseek', vendorName: 'DeepSeek',
        description: '旗舰推理模型，1M 上下文', billingType: 'token',
        capabilities: ['reasoning', 'vision', 'code', 'longContext'],
        endpoints: ['openai', 'anthropic'], groups: ['default'],
        contextWindow: 1_000_000, vision: true, reasoning: true, claudeCodeOnly: false,
        inputPriceUsdPerMillion: 3, cachePriceUsdPerMillion: 0.3, outputPriceUsdPerMillion: 12,
        standardPriceUsdPerMillion: 4.5, realizedPriceUsdPerMillion: 2.1, cacheHitRate: 0.72,
        officialInputPriceUsdPerMillion: 9, officialOutputPriceUsdPerMillion: 36,
        officialRatio: 0.32, channelCount: 5, channelTag: '主力通道',
        channels: [{ name: '主力通道', tag: '极速' }],
      },
      {
        id: 'claude-fable-5-2', vendor: 'anthropic', vendorName: 'Anthropic',
        description: '强编码模型', billingType: 'token',
        capabilities: ['reasoning', 'vision', 'code'],
        endpoints: ['anthropic'], groups: ['default'],
        contextWindow: 200_000, vision: true, reasoning: true, claudeCodeOnly: false,
        inputPriceUsdPerMillion: 6, cachePriceUsdPerMillion: 0.6, outputPriceUsdPerMillion: 30,
        standardPriceUsdPerMillion: 9, realizedPriceUsdPerMillion: 6, cacheHitRate: 0.65,
        officialRatio: 0.08, channelCount: 3,
        promo: { label: '限时特惠', endsAt: '12-01', originalInputPriceUsdPerMillion: 12 },
      },
      {
        id: 'grok-4.6', vendor: 'xai', vendorName: 'xAI',
        description: '动态分档计费', billingType: 'dynamic',
        capabilities: ['reasoning'], endpoints: ['openai'], groups: ['default'],
        contextWindow: 256_000, vision: false, reasoning: true, claudeCodeOnly: false,
        inputPriceUsdPerMillion: 1.5, cachePriceUsdPerMillion: 0.3, outputPriceUsdPerMillion: 4.5,
        standardPriceUsdPerMillion: 2.4, officialRatio: 0.25, channelCount: 1,
      },
      {
        id: 'free-chat-model', vendor: 'deepseek', vendorName: 'DeepSeek',
        description: '免费体验模型', billingType: 'free',
        capabilities: ['code'], endpoints: ['openai'], groups: ['default'],
        contextWindow: 128_000, vision: false, reasoning: false, claudeCodeOnly: false,
        inputPriceUsdPerMillion: 0, outputPriceUsdPerMillion: 0,
        // Even if upstream mistakenly passes an officialRatio, client strict gate must drop it!
        officialRatio: 0.01, channelCount: 1,
      },
      {
        id: 'per-call-model', vendor: 'tako', vendorName: 'Tako',
        description: '按次固定计费模型', billingType: 'call',
        capabilities: ['tools'], endpoints: ['openai'], groups: ['default'],
        contextWindow: 128_000, vision: false, reasoning: false, claudeCodeOnly: false,
        callPriceUsd: 0.3, officialRatio: 0.1, channelCount: 1,
      },
      {
        id: 'new-unmeasured', vendor: 'openai', vendorName: 'OpenAI',
        description: '新上线无实测数据', billingType: 'token',
        capabilities: ['reasoning'], endpoints: ['openai'], groups: ['default'],
        contextWindow: 128_000, vision: false, reasoning: true, claudeCodeOnly: false,
        inputPriceUsdPerMillion: 3, outputPriceUsdPerMillion: 9,
        standardPriceUsdPerMillion: 4.5, officialRatio: 1.0, channelCount: 1,
      },
    ],
    nextSyncAt: null,
  }

  async function renderModels(opts: Parameters<typeof modelsPageHooks>[0] = {}, locale: 'zh' | 'en' = 'zh') {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    face.setActive(locale)
    hookStates = modelsPageHooks({ catalog: richCatalog, ...opts })
    return { rendered: render(findModelsPage(entries), { t: face.bind() }) as Element, face }
  }

  it('displays all models directly flat full-width with no folding and no permanent filter column', async () => {
    try {
      const { rendered } = await renderModels()
      // All 8 models appear immediately without folding behind "N more"
      expect(collectModels(rendered)).toHaveLength(8)
      expect(findByTestId(rendered, 'dsh-tako-catalog-more')).toBeUndefined()
      expect(findByTestId(rendered, 'dsh-tako-catalog-grid')).toBeDefined()
      // Filter drawer is on-demand, not rendered permanently as a side column
      expect(findByTestId(rendered, 'dsh-tako-filter-toggle')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-filter-drawer')).toBeUndefined()
      // Sync button moved out of model directory toolbar
      expect(findByTestId(rendered, 'dsh-tako-catalog-sync')).toBeUndefined()

      // Opens filter drawer on demand
      const opened = await renderModels({ filterOpen: true })
      expect(findByTestId(opened.rendered, 'dsh-tako-filter-drawer')).toBeDefined()
      expect(findText(opened.rendered, 'DeepSeek')).toBeDefined()
    } finally { hookStates = [] }
  })

  it('defaults to CNY actual spend, toggles to Internal USD with mandatory warning, and supports /1K unit', async () => {
    try {
      // Default: CNY actual spend (internal USD ÷ 3): input $3 → ¥1, cache $0.3 → ¥0.1, output $12 → ¥4
      const cny = await renderModels()
      const pricePanel = findByTestId(cny.rendered, 'dsh-tako-price-deepseek-v4.1-flash')
      expect(findText(pricePanel, '¥1')).toBe('¥1')
      expect(findText(pricePanel, '¥0.1')).toBe('¥0.1')
      expect(findText(pricePanel, '¥4')).toBe('¥4')
      expect(findText(pricePanel, '¥ / 1M tokens')).toBe('¥ / 1M tokens')
      expect(findByTestId(cny.rendered, 'dsh-tako-usd-warning')).toBeUndefined()
      // Per-call model: $0.3 internal → ¥0.1 / 次
      expect(findText(findByTestId(cny.rendered, 'dsh-tako-price-per-call-model'), '¥0.1')).toBe('¥0.1')

      // Internal USD toggle: ×3 + mandatory orange warning chip
      const usd = await renderModels({ prefs: { currency: 'usd' } })
      const usdPanel = findByTestId(usd.rendered, 'dsh-tako-price-deepseek-v4.1-flash')
      expect(findText(usdPanel, '$3')).toBe('$3')
      expect(findText(usdPanel, '$12')).toBe('$12')
      expect(findByTestId(usd.rendered, 'dsh-tako-usd-warning')).toBeDefined()
      expect(findText(findByTestId(usd.rendered, 'dsh-tako-usd-warning'), '¥1 = $3')).toBeDefined()

      // /1K unit divides token price by 1000, but leaves per-call price untouched
      const perK = await renderModels({ prefs: { currency: 'cny', tokenUnit: 'K' } })
      expect(findText(findByTestId(perK.rendered, 'dsh-tako-price-deepseek-v4.1-flash'), '¥0.001')).toBe('¥0.001')
      expect(findText(findByTestId(perK.rendered, 'dsh-tako-price-per-call-model'), '¥0.1')).toBe('¥0.1')
    } finally { hookStates = [] }
  })

  it('supports Average view (realized + std + hit rate, plus new-model fallback) and strict discount gating', async () => {
    try {
      const avg = await renderModels({ prefs: { priceMode: 'avg', currency: 'cny' } })
      // deepseek-v4.1-flash: realized $2.1 → ¥0.7, std $4.5 → ¥1.5, hit 72%
      const flashPrice = findByTestId(avg.rendered, 'dsh-tako-price-deepseek-v4.1-flash')
      expect(findText(flashPrice, '¥0.7')).toBe('¥0.7')
      expect(findText(flashPrice, '标准负载 ¥1.5 · 缓存命中 72%')).toBeDefined()
      // new-unmeasured: no realized → falls back to std ¥1.5 + new-model copy
      const newPrice = findByTestId(avg.rendered, 'dsh-tako-price-new-unmeasured')
      expect(findText(newPrice, '¥1.5')).toBe('¥1.5')
      expect(findText(newPrice, '新上线，暂无 7 日实测数据')).toBeDefined()

      // Strict discount badge gating:
      // - token (0.32) and dynamic (0.25) show discount badges
      expect(findByTestId(avg.rendered, 'dsh-tako-discount-deepseek-v4.1-flash')).toBeDefined()
      expect(findText(findByTestId(avg.rendered, 'dsh-tako-discount-deepseek-v4.1-flash'), '0.32x')).toBeDefined()
      expect(findByTestId(avg.rendered, 'dsh-tako-discount-grok-4.6')).toBeDefined()
      // - free, per-call, and official-priced (>=0.99) NEVER show discount badges
      expect(findByTestId(avg.rendered, 'dsh-tako-discount-free-chat-model')).toBeUndefined()
      expect(findByTestId(avg.rendered, 'dsh-tako-discount-per-call-model')).toBeUndefined()
      expect(findByTestId(avg.rendered, 'dsh-tako-discount-new-unmeasured')).toBeUndefined()
      // - promo badge + bar rendered for promo model
      const promoCard = findByTestId(avg.rendered, 'dsh-tako-modelcard-claude-fable-5-2')
      expect(findText(promoCard, '限时特惠')).toBeDefined()
      expect(findText(promoCard, '截至 12-01')).toBeDefined()
    } finally { hookStates = [] }
  })

  it('filters by quick strip, search, vendor/capability/billing, supports table view, pins, and active chat state', async () => {
    try {
      // Quick filters
      expect(collectModels((await renderModels({ quick: 'promo' })).rendered)).toEqual(['claude-fable-5-2'])
      expect(collectModels((await renderModels({ quick: 'cheap' })).rendered)).toEqual(['claude-fable-5-2'])
      expect(collectModels((await renderModels({ quick: 'fav', pinned: ['grok-4.6'] })).rendered)).toEqual(['grok-4.6'])
      expect(collectModels((await renderModels({ quick: 'long' })).rendered)).toEqual(['deepseek-v4.1-flash'])
      // Search & no-match state
      expect(collectModels((await renderModels({ query: 'fable' })).rendered)).toEqual(['claude-fable-5-2'])
      expect(findByTestId((await renderModels({ query: 'nonexistent-xyz' })).rendered, 'dsh-tako-catalog-nomatch')).toBeDefined()
      // Filter drawer criteria (billing = free / call, vendor = Anthropic)
      expect(collectModels((await renderModels({ bill: 'free' })).rendered)).toEqual(['free-chat-model'])
      expect(collectModels((await renderModels({ bill: 'call' })).rendered)).toEqual(['per-call-model'])
      expect(collectModels((await renderModels({ vendors: ['Anthropic'] })).rendered)).toEqual(['claude-fable-5-2'])
      // Pinned ordering + active chat model highlight
      const pinned = await renderModels({ pinned: ['grok-4.6'], activeModel: 'claude-fable-5-2' })
      expect(collectModels(pinned.rendered)[0]).toBe('grok-4.6')
      expect(findByTestId(pinned.rendered, 'dsh-tako-pin-grok-4.6')?.props?.['data-active']).toBe('true')
      expect(findText(findByTestId(pinned.rendered, 'dsh-tako-use-claude-fable-5-2'), '当前对话模型')).toBeDefined()
      // Table view + colSpan=3 on per-call row
      const table = await renderModels({ prefs: { layout: 'table' } })
      expect(findByTestId(table.rendered, 'dsh-tako-catalog-table')).toBeDefined()
      const callRow = findByTestId(table.rendered, 'dsh-tako-modelrow-per-call-model')
      expect(findByAttr(callRow, 'colSpan', '3') ?? findByAttr(callRow, 'className', 'span-call')).toBeDefined()
    } finally { hookStates = [] }
  })
})

describe('client sidebar footer quota card (4 states x wide/rail)', () => {
  async function renderFooter(status: unknown, wide: boolean, prefs = DEFAULT_PREFS) {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    face.setActive('zh')
    hookStates = [status, prefs]
    const Footer = entries.find(entry => entry.slot === 'sidebar.footer.action')!.component
    return render(Footer, { wide, t: face.bind() }) as Element
  }

  it('renders healthy plan, low plan, wallet-only balance, signed-out empty, and collapsed 56px rail', async () => {
    try {
      // 1. Healthy plan (wide)
      const planEl = await renderFooter({
        consoleApiVersion: 2, configured: true,
        me: { userName: 'Ada', planName: 'Pro Max', quotaRemainUsd: 120 }, // ¥40.00
        plan: { windowMinutes: 300, windowCost: 56, windowCostLimit: 200, weeklyCost: 418, weeklyCostLimit: 930 },
      }, true)
      const planBtn = findByTestId(planEl, 'dsh-tako-footer')!
      expect(planBtn.props?.['data-tako-quota']).toBe('plan')
      expect(planBtn.props?.['data-tako-low']).toBe('false')
      expect(findText(planBtn, '¥40.00')).toBe('¥40.00')
      expect(findText(planBtn, '72%')).toBe('72%')

      // 2. Low plan (<30% remaining on 5h window)
      const lowEl = await renderFooter({
        consoleApiVersion: 2, configured: true,
        me: { userName: 'Ada', planName: 'Pro Max', quotaRemainUsd: 9 }, // ¥3.00 < ¥10
        plan: { windowMinutes: 300, windowCost: 184, windowCostLimit: 200, weeklyCost: 400, weeklyCostLimit: 930 },
      }, true)
      const lowBtn = findByTestId(lowEl, 'dsh-tako-footer')!
      expect(lowBtn.props?.['data-tako-quota']).toBe('low')
      expect(lowBtn.props?.['data-tako-low']).toBe('true')
      expect(findText(lowBtn, '额度偏低')).toBeDefined()

      // 3. Wallet-only (PayGo)
      const balEl = await renderFooter({
        consoleApiVersion: 2, configured: true,
        me: { userName: 'Bob', quotaRemainUsd: 90 }, // ¥30.00
      }, true)
      const balBtn = findByTestId(balEl, 'dsh-tako-footer')!
      expect(balBtn.props?.['data-tako-quota']).toBe('balance')
      expect(findText(balBtn, '按量')).toBe('按量')
      expect(findText(balBtn, '¥30.00')).toBe('¥30.00')

      // 4. Signed-out empty
      const emptyEl = await renderFooter({ consoleApiVersion: 2, configured: false }, true)
      const emptyBtn = findByTestId(emptyEl, 'dsh-tako-footer')!
      expect(emptyBtn.props?.['data-tako-quota']).toBe('empty')
      expect(findText(emptyBtn, '登录 Tako')).toBe('登录 Tako')

      // 5. Collapsed 56px rail with low-quota amber badge
      const railEl = await renderFooter({
        consoleApiVersion: 2, configured: true,
        me: { userName: 'Ada', planName: 'Pro', quotaRemainUsd: 9 },
        plan: { windowMinutes: 300, windowCost: 184, windowCostLimit: 200, weeklyCost: 400, weeklyCostLimit: 930 },
      }, false)
      const railBtn = findByTestId(railEl, 'dsh-tako-footer')!
      expect(railBtn.props?.['data-tako-quota']).toBe('low')
      expect(findByTag(railBtn, 'svg')).toBeDefined()
      expect(findByAttr(railBtn, 'className', 'badge')).toBeDefined()
    } finally { hookStates = [] }
  })
})

describe('client account refresh ordering', () => {
  async function mount(slot: 'tako-console' | 'tako-models' | 'sidebar.footer.action') {
    await loadModuleRow()
    hookStates = []
    const effects: (() => void | (() => void))[] = []
    const updates: unknown[] = []
    const errors: unknown[] = []
    const { plugin, render } = materialize({
      effect: effect => { effects.push(effect) },
      setState: (index, value) => {
        if (index === 0) updates.push(value)
        if (index === 1) errors.push(value)
      },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const comp = slot === 'tako-console' ? findConsolePage(entries)
      : slot === 'tako-models' ? findModelsPage(entries)
      : entries.find(entry => entry.slot === 'sidebar.footer.action')!.component
    const rendered = render(comp, { wide: true })
    const pending: { resolve: (value: Response) => void, reject: (error: Error) => void, signal?: AbortSignal }[] = []
    vi.stubGlobal('fetch', vi.fn((input: string, init: RequestInit) => {
      if (!String(input).includes('tako.status')) return Promise.resolve(Response.json({ models: [], status: 'ready', lastSyncAt: 1 }))
      return new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject, signal: init.signal ?? undefined }) })
    }))
    const disposers = effects.map(effect => effect()).filter((dispose): dispose is () => void => typeof dispose === 'function')
    return { rendered, updates, errors, pending, dispose: () => { disposers.forEach(dispose => dispose()) } }
  }

  for (const slot of ['tako-console', 'tako-models', 'sidebar.footer.action'] as const) {
    it(`${slot} refreshes on credential change and ignores an older successful read`, async () => {
      vi.useFakeTimers()
      const view = await mount(slot)
      try {
        expect(view.pending).toHaveLength(1)
        window.dispatchEvent(new Event('dsh-tako-credential'))
        expect(view.pending).toHaveLength(2)
        view.pending[1]!.resolve(Response.json({ configured: true, me: { userName: 'New account' } }))
        await vi.advanceTimersByTimeAsync(0)
        view.pending[0]!.resolve(Response.json({ configured: false }))
        await vi.advanceTimersByTimeAsync(0)
        expect(view.updates.at(-1)).toMatchObject({ configured: true, me: { userName: 'New account' } })
      } finally { view.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() }
    })

    it(`${slot} ignores an older failure after a newer read`, async () => {
      vi.useFakeTimers()
      const view = await mount(slot)
      try {
        window.dispatchEvent(new Event('focus'))
        expect(view.pending).toHaveLength(2)
        view.pending[1]!.resolve(Response.json({ configured: true, me: { userName: 'Current account' } }))
        await vi.advanceTimersByTimeAsync(0)
        const count = view.updates.length
        view.pending[0]!.reject(new Error('old request failed'))
        await vi.advanceTimersByTimeAsync(0)
        expect(view.updates).toHaveLength(count)
        if (slot === 'tako-console') expect(view.errors.every(error => error === undefined)).toBe(true)
        expect(view.updates.at(-1)).toMatchObject({ configured: true })
      } finally { view.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() }
    })

    it(`${slot} aborts in-flight status reads and removes listeners on unload`, async () => {
      vi.useFakeTimers()
      const view = await mount(slot)
      try {
        view.dispose()
        expect(view.pending[0]!.signal?.aborted).toBe(true)
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('dsh-tako-credential'))
        expect(view.pending).toHaveLength(1)
        view.pending[0]!.resolve(Response.json({ configured: true }))
        await vi.advanceTimersByTimeAsync(0)
        expect(view.updates).toHaveLength(0)
      } finally { view.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() }
    })
  }
})

describe('client logout completion note', () => {
  for (const outcome of ['revoked', 'removed', 'not-configured', 'external', 'network-error', 'http-error'] as const) {
    it(`handles ${outcome} without erasing a sign-in that is still current`, async () => {
      await loadModuleRow()
      hookStates = consoleHooks({
        status: { configured: true, me: { userName: 'Test account' } },
        login: { status: 'success', user: 'Test account', key: 'cr_****test', credential: 'TAKO_API_KEY' },
      })
      const changes: unknown[] = []
      const notes: unknown[] = []
      const { plugin, render } = materialize({
        setState: (index, value) => {
          if (index === 11) changes.push(value)
          if (index === 5) notes.push(value)
        },
      })
      const { ctx, entries, runInjections } = stubCtx()
      plugin.apply(ctx)
      runInjections()
      vi.stubGlobal('fetch', vi.fn(async (input: string) => {
        if (!String(input).includes('tako.logout')) return Response.json({ configured: false })
        if (outcome === 'network-error') throw new Error('logout failed')
        if (outcome === 'http-error') return Response.json({ ok: false, error: 'credential store unavailable' }, { status: 500 })
        return Response.json({ ok: true, action: outcome })
      }))
      try {
        const view = render(findConsolePage(entries), {})
        const logout = findByTestId(view, 'dsh-tako-console-sign-out')?.props?.onClick
        expect(typeof logout).toBe('function')
        await (logout as () => Promise<void>)()
        const cleared = ['revoked', 'removed', 'not-configured'].includes(outcome)
        expect(changes).toEqual(cleared ? [{ status: 'idle' }] : [])
        if (outcome.endsWith('error')) expect(String(notes.at(-1))).toMatch(/logout failed|credential store unavailable/)
      } finally { hookStates = []; vi.unstubAllGlobals() }
    })
  }
})

describe('client primary browser sign-in button', () => {
  for (const mode of ['browser-popup', 'desktop-denied-blank'] as const) {
    it(`opens the authorization URL through the ${mode} path`, async () => {
      await loadModuleRow()
      vi.useFakeTimers()
      hookStates = []
      const tab = { location: { href: 'about:blank' }, opener: {}, close: vi.fn() }
      const open = vi.fn(() => mode === 'browser-popup' ? tab : null)
      vi.stubGlobal('window', { ...window, open })
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'pending', id: 'test-login', url: 'https://tako.example/app/authorize' })))
      const effects: (() => void | (() => void))[] = []
      const { plugin, render } = materialize({ effect: callback => { effects.push(callback) } })
      const { ctx, entries, runInjections } = stubCtx()
      plugin.apply(ctx)
      runInjections()
      const view = render(entries.find(entry => entry.slot === 'settings.models.provider-card')!.component,
        { provider: { provider: 'tako' }, keyConfigured: false })
      const disposers = effects.map(effect => effect()).filter((dispose): dispose is () => void => typeof dispose === 'function')
      try {
        const start = findByTestId(view, 'dsh-tako-sign-in')?.props?.onClick
        expect(typeof start).toBe('function')
        await (start as () => Promise<void>)()
        expect(open.mock.calls[0]).toEqual(['about:blank', '_blank'])
        if (mode === 'browser-popup') {
          expect(tab.location.href).toBe('https://tako.example/app/authorize')
          expect(tab.opener).toBeNull()
          expect(open).toHaveBeenCalledTimes(1)
        } else {
          expect(open.mock.calls[1]).toEqual(['https://tako.example/app/authorize', '_blank'])
        }
      } finally { disposers.forEach(dispose => dispose()); vi.unstubAllGlobals(); vi.useRealTimers() }
    })
  }
})

describe('client sign-in request lifetime', () => {
  async function mount() {
    await loadModuleRow()
    hookStates = [{ status: 'pending', id: 'older-attempt', url: 'https://tako.example/app/authorize' }]
    const effects: (() => void | (() => void))[] = []
    const changes: unknown[] = []
    const tab = { location: { href: 'about:blank' }, close: vi.fn() }
    vi.stubGlobal('window', { ...window, open: vi.fn(() => tab) })
    const pending: { init: RequestInit, resolve: (response: Response) => void }[] = []
    vi.stubGlobal('fetch', vi.fn((input: string, init: RequestInit = {}) => {
      if (!String(input).includes('tako.login')) return Promise.resolve(Response.json({ consoleApiVersion: 2 }))
      if (init.body && JSON.parse(String(init.body)).action === 'cancel') return Promise.resolve(Response.json({ status: 'idle' }))
      return new Promise<Response>(resolve => { pending.push({ init, resolve }) })
    }))
    const { plugin, render } = materialize({
      effect: effect => { effects.push(effect) },
      setState: (index, value) => { if (index === 0) changes.push(value) },
    })
    const { ctx, entries, runInjections } = stubCtx()
    plugin.apply(ctx)
    runInjections()
    const view = render(entries.find(entry => entry.slot === 'settings.models.provider-card')!.component,
      { provider: { provider: 'tako' } })
    const disposers = effects.map(effect => effect()).filter((dispose): dispose is () => void => typeof dispose === 'function')
    return {
      start: findByTestId(view, 'dsh-tako-sign-in')!.props!.onClick as () => Promise<void>,
      cancel: findByTextButton(view, '取消')!.props!.onClick as () => Promise<void>,
      pending, changes, tab, dispose: () => { disposers.forEach(dispose => dispose()) },
    }
  }

  it('does not navigate or publish a delayed start after unmount', async () => {
    vi.useFakeTimers()
    const view = await mount()
    try {
      const starting = view.start()
      view.dispose()
      view.pending[0]!.resolve(Response.json({ status: 'pending', id: 'new-attempt', url: 'https://tako.example/app/authorize' }))
      await starting
      await vi.advanceTimersByTimeAsync(1500)
      expect(view.changes).toEqual([{ status: 'starting' }])
      expect(view.tab.location.href).toBe('about:blank')
      expect(view.tab.close).toHaveBeenCalled()
      expect(view.pending).toHaveLength(1)
    } finally { view.dispose(); hookStates = []; vi.unstubAllGlobals(); vi.useRealTimers() }
  })

  it('does not revive a cancelled attempt when an older poll finishes', async () => {
    vi.useFakeTimers()
    const view = await mount()
    try {
      const starting = view.start()
      view.pending[0]!.resolve(Response.json({ status: 'pending', id: 'new-attempt', url: 'https://tako.example/app/authorize' }))
      await starting
      await vi.advanceTimersByTimeAsync(1500)
      expect(view.pending).toHaveLength(2)
      await view.cancel()
      view.pending[1]!.resolve(Response.json({ status: 'success', id: 'new-attempt', key: 'cr_****test' }))
      await vi.advanceTimersByTimeAsync(0)
      expect(view.changes.at(-1)).toEqual({ status: 'idle' })
    } finally { view.dispose(); hookStates = []; vi.unstubAllGlobals(); vi.useRealTimers() }
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
    hookStates = consoleHooks()
    try {
      const mark = findByTestId(render(findConsolePage(entries), {}), 'dsh-tako-mark')
      expect(mark?.tag).toBe('img')
      expect(String(mark?.props?.src)).toMatch(/^data:image\/png;base64,/)
    } finally {
      hookStates = []
    }
  })
})

describe('client console surfaces', () => {
  const catalog = {
    consoleApiVersion: 2,
    models: [
      { id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
      { id: 'deepseek-v4-pro', contextWindow: 1_050_000, input: ['text'] },
      { id: 'tako-auto', contextWindow: 272_000, input: ['text'], reasoningEfforts: false },
      { id: 'gemma-4-31b-it', input: ['text'] },
    ],
    nextSyncAt: null,
  }

  const renderPage = async (hooks: unknown[]) => {
    await loadModuleRow()
    const { plugin, render } = materialize()
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    plugin.apply(ctx)
    runInjections()
    const page = findConsolePage(entries)
    hookStates = hooks
    face.setActive('zh')
    return { rendered: render(page, { t: face.bind() }) as Element, face, render, page }
  }

  it('renders overview KPIs, plan meters with >90% warning, PayGo fallback, and USD warning toggle', async () => {
    try {
      // Plan active + >90% used (remaining <10%)
      const lowPlan = await renderPage(consoleHooks({
        status: {
          consoleApiVersion: 2, configured: true, maskedKey: 'cr_****abcd',
          me: { userName: 'Ada', planName: 'Pro Max', quotaRemainUsd: 12 }, // ¥4.00
          plan: { windowMinutes: 300, windowCost: 185, windowCostLimit: 200, weeklyCost: 400, weeklyCostLimit: 930 },
        },
        catalog,
      }))
      expect(findByTestId(lowPlan.rendered, 'dsh-tako-tabpanel-overview')).toBeDefined()
      expect(findByTestId(lowPlan.rendered, 'dsh-tako-tab-requests')).toBeDefined()
      expect(findByTestId(lowPlan.rendered, 'dsh-tako-copy-diagnostics')).toBeDefined()
      expect(findText(findByTestId(lowPlan.rendered, 'dsh-tako-quota-remain'), '¥4.00')).toBe('¥4.00')
      expect(findText(lowPlan.rendered, '即将用尽')).toBeDefined()

      // Switch to Internal USD -> 3x + warning chip
      const usdView = await renderPage(consoleHooks({
        status: {
          consoleApiVersion: 2, configured: true, maskedKey: 'cr_****abcd',
          me: { userName: 'Ada', quotaRemainUsd: 12 },
        },
        catalog,
        prefs: { currency: 'usd' },
      }))
      expect(findText(findByTestId(usdView.rendered, 'dsh-tako-quota-remain'), '$12.00')).toBe('$12.00')
      expect(findByTestId(usdView.rendered, 'dsh-tako-usd-warning')).toBeDefined()
      // PayGo card rendered when no plan
      expect(findText(usdView.rendered, '按量计费')).toBeDefined()
    } finally { hookStates = [] }
  })

  it('shows the notice list on the overview and keeps tab panels exclusive', async () => {
    try {
      const { rendered } = await renderPage(consoleHooks({
        catalog,
        notice: { ok: true, announcements: [{ id: 7, type: 'warning', publishDate: '2026-11-10T02:00:00Z', content: '## 波动\n服务波动\n- a\n- b' }] },
      }))
      const notice = findByTestId(rendered, 'dsh-tako-notice')
      expect(notice).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-notice-item')).toBeDefined()
      expect(findText(notice, '波动')).toBeDefined()
      expect(findText(notice, '2026-11-10')).toBeDefined()
      const body = findByTestId(rendered, 'dsh-tako-notice-body')
      expect(body).toBeDefined()
      expect(findText(body, '服务波动')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-overview')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-tabpanel-requests')).toBeUndefined()

      // Dismissed by id → top slot collapses to history toggle
      const second = await renderPage(consoleHooks({
        catalog,
        notice: { ok: true, announcements: [{ id: 7, content: '## 波动\n服务波动' }] },
        dismissed: ['7'],
      }))
      expect(findByTestId(second.rendered, 'dsh-tako-notice-item')).toBeUndefined()
      expect(findByTestId(second.rendered, 'dsh-tako-notice-history-toggle')).toBeDefined()
    } finally { hookStates = [] }
  })

  it('pins only the newest unread notice and folds the rest behind a history toggle', async () => {
    try {
      const notice = {
        ok: true,
        announcements: [
          { id: 9, type: 'warning', publishDate: '2026-11-10T02:00:00Z', content: '## 最新公告\n服务波动' },
          { id: 8, type: 'success', publishDate: '2026-11-09T00:00:00Z', content: '已恢复' },
          { id: 7, type: 'ongoing', publishDate: '2026-11-01T00:00:00Z', content: '新客活动' },
        ],
      }
      let { rendered } = await renderPage(consoleHooks({ catalog, notice }))
      const list = findByTestId(rendered, 'dsh-tako-notice')
      expect(list).toBeDefined()
      expect(findText(list, '最新公告')).toBeDefined()
      expect(findText(list, '已恢复')).toBeUndefined()
      expect(findText(list, '新客活动')).toBeUndefined()
      expect(findByTestId(rendered, 'dsh-tako-notice-history-toggle')?.children[0]).toBe('历史公告 (2)')

      // Expanded
      rendered = (await renderPage(consoleHooks({ catalog, notice, historyOpen: true }))).rendered
      const items = (function collect(node: unknown, out: Element[] = []): Element[] {
        if (Array.isArray(node)) { for (const child of node) collect(child, out); return out }
        if (typeof node !== 'object' || node === null) return out
        const el = node as Element
        if (el.props?.['data-testid'] === 'dsh-tako-notice-item') out.push(el)
        for (const child of el.children ?? []) collect(child, out)
        return out
      })(rendered)
      expect(items.length).toBe(3)
      expect(String(items[0]?.props?.className)).toBe('dsh-tako-notice-item')
      expect(String(items[1]?.props?.className)).toContain('dsh-tako-notice-read')
      expect(findByTestId(rendered, 'dsh-tako-notice-history-toggle')?.children[0]).toBe('收起历史')

      // All read
      rendered = (await renderPage(consoleHooks({ catalog, notice, dismissed: ['9', '8', '7'] }))).rendered
      expect(findByTestId(rendered, 'dsh-tako-notice-item')).toBeUndefined()
      expect(findByTestId(rendered, 'dsh-tako-notice-history-toggle')?.children[0]).toBe('历史公告 (3)')

      // Newest read, older unread gets top slot
      rendered = (await renderPage(consoleHooks({ catalog, notice, dismissed: ['9', '7'] }))).rendered
      expect(findText(rendered, '已恢复')).toBeDefined()
      expect(findText(rendered, '最新公告')).toBeUndefined()
      expect(findByTestId(rendered, 'dsh-tako-notice-history-toggle')?.children[0]).toBe('历史公告 (2)')
    } finally { hookStates = [] }
  })

  it('remembers dismissed notices in localStorage and skips them next mount', async () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)) },
    }
    const globals = globalThis as unknown as Record<string, unknown>
    const original = (globals.window as Record<string, unknown> | undefined)?.localStorage
    ;(globals.window as Record<string, unknown>).localStorage = storage
    const setStates: Record<number, unknown> = {}
    const { plugin, render } = materialize({
      setState: (index, value) => { setStates[index] = value },
    })
    const face = localeService()
    const { ctx, entries, runInjections } = stubCtx({ locale: face })
    try {
      plugin.apply(ctx)
      runInjections()
      face.setActive('zh')
      const page = findConsolePage(entries)
      const notice = {
        ok: true,
        announcements: [
          { id: 9, type: 'warning', publishDate: '2026-11-10T02:00:00Z', content: '## 最新公告\n服务波动' },
          { id: 8, type: 'success', publishDate: '2026-11-09T00:00:00Z', content: '已恢复' },
        ],
      }
      store.set('dsh-tako.notices.dismissed', '["9"]')
      hookStates = consoleHooks({ catalog, notice, dismissed: ['9'] })
      const rendered = render(page, { t: face.bind() }) as Element
      const list = findByTestId(rendered, 'dsh-tako-notice')
      expect(findText(list, '最新公告')).toBeUndefined()
      expect(findText(list, '已恢复')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-notice-history-toggle')?.children[0]).toBe('历史公告 (1)')
      const dismiss = findByTestId(rendered, 'dsh-tako-notice-dismiss')
      expect(dismiss).toBeDefined()
      void ((dismiss!.props as { onClick: (e: unknown) => void }).onClick)({ preventDefault: () => {}, stopPropagation: () => {} })
      expect(setStates[8]).toEqual(['9', '8'])
      expect(store.get('dsh-tako.notices.dismissed')).toBe('["9","8"]')
    } finally {
      if (original === undefined) delete (globals.window as Record<string, unknown>).localStorage
      else (globals.window as Record<string, unknown>).localStorage = original
      hookStates = []
    }
  })

  it('renders request logs with 3-decimal CNY spend and the model filter select', async () => {
    try {
      const hooks = consoleHooks({
        catalog,
        tab: 'requests',
        extra: [
          [{ id: 1, createdAt: 1718000000, modelName: 'deepseek-v4.1-flash', promptTokens: 1200, completionTokens: 300, quota: 750000, useTime: 3, isStream: true, requestId: 'chatcmpl-abc123', ip: '1.2.3.4', type: 2 }],
          undefined, '', false,
        ],
      })
      const { rendered } = await renderPage(hooks)
      expect(findByTestId(rendered, 'dsh-tako-logs-table')).toBeDefined()
      expect(findByTestId(rendered, 'dsh-tako-logs-model')).toBeDefined()
      expect(findText(rendered, 'deepseek-v4.1-flash')).toBeDefined()
      expect(findText(rendered, 'chatcmpl')).toBeDefined()
      expect(findText(rendered, '1.2K')).toBeDefined()
      // quota 750000 / 500000 = $1.50 internal → ¥0.500 actual (3 decimals)
      expect(findText(rendered, '¥0.500')).toBe('¥0.500')
    } finally { hookStates = [] }
  })

  it('degrades per-leg errors on the usage tab instead of blanking the panel', async () => {
    try {
      const hooks = consoleHooks({
        catalog,
        tab: 'usage',
        extra: [{
          ok: true,
          token: { name: 'k', grantedUsd: 15, usedUsd: 3, availableUsd: 12, unlimitedQuota: false, expiresAt: 0 },
          dailyCostUsd: undefined, statsError: 'user-stats HTTP 503',
          models: [{ model: 'deepseek-v4.1-flash', requests: 3, inputTokens: 1000, outputTokens: 200, costUsd: 0.03 }],
        }, undefined],
      })
      const { rendered } = await renderPage(hooks)
      expect(findByTestId(rendered, 'dsh-tako-usage-statserror')).toBeDefined()
      expect(findText(rendered, 'deepseek-v4.1-flash')).toBeDefined()
      // availableUsd $12 internal ÷ 3 = ¥4.00
      expect(findText(rendered, '¥4.00')).toBe('¥4.00')
    } finally { hookStates = [] }
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
    const page = findConsolePage(entries)
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
      if (url.includes('tako.catalog')) return Response.json({ consoleApiVersion: 2, models: [], lastSyncAt: null, nextSyncAt: null })
      return Response.json({ consoleApiVersion: 2, configured: false })
    }))
    const disposers: (() => void)[] = []
    try {
      // ConfigTab hooks begin at index 17: 17=config, 18=error, 19=form
      hookStates = consoleHooks({ catalog: { consoleApiVersion: 2, models: [] }, tab: 'config' })
      render(page, {})
      for (const effect of effects) { const dispose = effect(); if (dispose) disposers.push(dispose) }
      await vi.advanceTimersByTimeAsync(0)
      const form = setStates[19] as Record<string, unknown> | undefined
      expect(form?.refreshMinutes).toBe('30')
      expect(form?.retryDelays).toBe('1000, 5000')
      hookStates = consoleHooks({
        catalog: { consoleApiVersion: 2, models: [] },
        tab: 'config',
        extra: [setStates[17], setStates[18], setStates[19]],
      })
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
