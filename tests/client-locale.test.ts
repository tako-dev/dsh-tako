import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
  'catalogMore', 'catalogLess',
  'refreshIn', 'refreshSoon', 'refreshOnlyAtStartup', 'loadFailed', 'retry',
  'updateCard', 'updateAvailable', 'updateCommand', 'upToDate', 'pluginVersion', 'copy', 'copied', 'updateFailed',
  'updateNow', 'updating', 'updateInstalled', 'updateInstallFailed',
  'footerRemain', 'footerUsed', 'windowHours', 'weeklyShort', 'walletBalance', 'planWindows',
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
function materialize(): { plugin: Plugin, render: (component: unknown, props: Record<string, unknown>) => unknown } {
  const createElement = (tag: string | Function, props: Record<string, unknown> | null, ...children: unknown[]): unknown =>
    typeof tag === 'function' ? (tag as (props: unknown) => unknown)(props ?? {}) : { tag, props, children }
  let hookIndex = 0
  const react = {
    createElement,
    useEffect: () => {},
    useRef: () => ({ current: true }),
    useState: (initial: unknown) => {
      const value = hookStates[hookIndex] ?? initial
      hookIndex++
      return [value, () => {}]
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
    hookStates = [{ status: 'pending', id: '1', url: 'https://tako.example/app/authorize' }]
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
    // busyLogout, logoutNote, then useTakoLogin's login state. CatalogCard's
    // expand flag is the next hook (the recording stub inlines function
    // components); omitted here so it defaults to false.
    hookStates = [undefined, undefined, catalog, undefined, false, undefined, { status: 'idle' }]
    try {
      // No `t` seat (an older host renders the entry without one): inline fallback.
      setDocumentLang('zh-CN')
      let rendered = render(page, {}) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, 'Tako 控制台')).toBeUndefined()
      expect(findText(rendered, '登录状态')).toBeUndefined()
      expect(findText(rendered, '模型目录')).toBeUndefined()
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

      hookStates = [{ configured: false }, undefined, catalog, undefined, false, undefined, { status: 'idle' }]
      rendered = render(page, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Tako')
      expect(findText(rendered, '钥匙走')).toBe('登录后，额度、模型和搜索会跟这把钥匙走')
      expect(findByTestId(rendered, 'dsh-tako-console-sign-in')).toBeDefined()
      expect(findText(rendered, '需要登录后查看')).toBe('需要登录后查看')

      hookStates = [{
        configured: true,
        maskedKey: 'cr_****abcd',
        me: { userName: 'Ada', planName: 'Pro' },
      }, undefined, catalog, undefined, false, undefined, { status: 'idle' }]
      rendered = render(page, { t: face.bind() }) as Element
      expect(findByTag(rendered, 'h1')?.children[0]).toBe('Ada')
      expect(findByTestId(rendered, 'dsh-tako-console-key')?.children[0]).toBe('cr_****abcd')
      expect(findText(rendered, 'Pro')).toBe('Pro')
      expect(findByTestId(rendered, 'dsh-tako-console-sign-out')).toBeDefined()
      expect(findText(rendered, '登录状态')).toBeUndefined()
    } finally {
      hookStates = []
    }
  })

  it('shows the first 3 catalog models and hides the rest until expanded', async () => {
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
      ],
      nextSyncAt: Date.now() + 5 * 60_000,
    }
    // CatalogCard's useState is consumed next after TakoConsolePage's 7 hooks
    // because the recording React stub runs function components inline.
    // [status, statusError, catalog, catalogError, busyLogout, logoutNote, login, catalogOpen]
    hookStates = [undefined, undefined, catalog, undefined, false, undefined, { status: 'idle' }, false]
    try {
      face.setActive('zh')
      let rendered = render(page, { t: face.bind() }) as Element
      expect(collectModels(rendered)).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto'])
      expect(findByAttr(rendered, 'data-model', 'other-model')).toBeUndefined()
      expect(findText(rendered, '1M')).toBe('1M')
      expect(findText(rendered, '1.05M')).toBe('1.05M')
      expect(findText(rendered, '272K')).toBe('272K')
      const more = findByTestId(rendered, 'dsh-tako-catalog-more')
      expect(findText(more, '其余')).toBe('其余 1 个')

      hookStates = [undefined, undefined, catalog, undefined, false, undefined, { status: 'idle' }, true]
      rendered = render(page, { t: face.bind() }) as Element
      expect(collectModels(rendered)).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto', 'other-model'])
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
    hookStates = [undefined, undefined, undefined, undefined, false, undefined, { status: 'idle' }]
    try {
      const mark = findByTestId(render(page, {}), 'dsh-tako-mark')
      expect(mark?.tag).toBe('img')
      expect(String(mark?.props?.src)).toMatch(/^data:image\/png;base64,/)
    } finally {
      hookStates = []
    }
  })
})