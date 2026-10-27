/*
 * dsh-tako browser half: the "Sign in to Tako with the browser" control on
 * the Tako card of Settings -> Models, plus the "Tako Console" sidebar panel.
 *
 * Hand-written in the Web client's module format (a lazy factory whose id is
 * the package name; React comes from the page's module table), like the
 * official plugin templates, so the package needs no client build step.
 * It fills the `settings.models.provider-card` slot under the official
 * llm-pi-ai settings namespace (rendered only on the `tako` route's card),
 * registers the full page `tako-console` in the `main` slot, and adds the
 * `sidebar.panellist` entry that opens it (same id, like the official plugin
 * manager panel). The panel talks to the plugin's host routes
 * (`api/tako.status|logout|catalog|update`) with relative fetches.
 *
 * All visible texts go through the dsh client's official i18n: `apply`
 * registers this namespace's zh/en dictionaries with the host's `ctx.locale`
 * service, slot entries declare the namespace so their components receive
 * `t` through props, and the sidebar label reads a bound translate so it
 * follows language switches. Hosts without the locale service (older dsh,
 * or stubbed test contexts) keep rendering through the inline fallback
 * dictionary below, which picks the language from `<html lang>` exactly like
 * the pre-i18n client did.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tako',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const ROUTE = 'api/tako.login'
    const STATUS_ROUTE = 'api/tako.status'
    const LOGOUT_ROUTE = 'api/tako.logout'
    const CATALOG_ROUTE = 'api/tako.catalog'
    const UPDATE_ROUTE = 'api/tako.update'
    /** The command the update card offers: re-running the install upgrades the plugin. */
    const UPGRADE_COMMAND = 'dsh plugin --profile web add dsh-tako'
    const PI_AI_NS = 'llm-pi-ai'
    const PROVIDER = 'tako'
    const PANEL_ID = 'tako-console'
    const POLL_MS = 1500
    /** This plugin's own locale-namespace id, as registered with `ctx.locale`. */
    const NS = 'dsh-tako'

    // The complete zh/en dictionary. It is registered with the host's locale
    // service (which interpolates `{name}` holes itself) and doubles as the
    // offline fallback for hosts that have no such service.
    const DICTS = {
      zh: {
        signIn: '通过浏览器登录 Tako',
        signInAgain: '重新登录 Tako',
        cancel: '取消',
        waiting: '请在新打开的 Tako 页面确认授权…',
        openLink: '没有弹出页面？点这里打开',
        success: '已登录，API key 已保存',
        failed: '登录失败',
        denied: '已在 Tako 页面拒绝授权',
        timeout: '等待超时（5 分钟），请重试',
        remote: '当前页面不是从 dsh 所在机器的本机地址打开的：登录完成后 Tako 会跳回 dsh 主机的 127.0.0.1，浏览器在另一台机器上时这一步到不了。请改为粘贴 API key，或在 dsh 主机上运行 dsh-tako login --no-open --port <端口> 并用 ssh -L 转发。',
        // console panel
        panel: 'Tako 控制台',
        consoleTitle: 'Tako 控制台',
        accountCard: '登录状态',
        signedIn: '已登录',
        signedOut: '未登录',
        account: '账号',
        plan: '套餐',
        unknown: '未知',
        whoamiFailed: '账号信息获取失败',
        signOut: '退出',
        signOutWorking: '退出中…',
        logoutRevoked: '已在 Tako 吊销这个 key，并从 dsh 凭据中删除',
        logoutRemoved: '已从 dsh 凭据中删除，但在 Tako 吊销失败',
        logoutNone: '没有已保存的 Tako key',
        logoutExternal: '这个 key 来自环境变量或 .env，插件不去吊销或删除；要停用请在对应位置移除',
        quotaCard: '余额 / 额度',
        quotaRemain: '剩余额度',
        quotaUsed: '已用额度',
        quotaPoints: '点',
        quotaUsedShare: '已用占比 {percent}',
        quotaNoteUsd: '美元按 Tako 官网口径换算：500,000 点 = $1',
        quotaNoteUnknown: '单位是 Tako 额度点数；美元换算未知',
        quotaNeedsLogin: '需要登录后查看',
        quotaUnavailable: '暂时拿不到额度信息',
        catalogCard: '模型目录',
        catalogModel: '模型',
        catalogContext: '上下文窗口',
        catalogVision: '图片输入',
        yes: '支持',
        no: '不支持',
        catalogDefault: '默认',
        catalogEmpty: '目录尚未同步；插件会在启动后拉取 Tako 的公开目录',
        refreshIn: '约 {minutes} 分钟后刷新',
        refreshSoon: '即将刷新',
        refreshOnlyAtStartup: '只在启动时刷新',
        loadFailed: '加载失败',
        retry: '重试',
        // update card
        updateCard: '更新',
        updateAvailable: '有新版本',
        updateCommand: '升级命令（升级后重启 dsh 生效）:',
        upToDate: '已是最新版本 {version}',
        copy: '复制',
        copied: '已复制',
        updateFailed: '检查更新失败',
        updateNow: '立即更新',
        updating: '正在更新…',
        updateInstalled: '已安装 {version}，请重启 dsh 后生效',
        updateInstallFailed: '更新失败',
        footerRemain: '剩余',
        footerUsed: '已用',
        windowHours: '{hours}h',
        weeklyShort: '本周',
        walletBalance: '钱包',
        planWindows: '套餐额度',
      },
      en: {
        signIn: 'Sign in to Tako with the browser',
        signInAgain: 'Sign in to Tako again',
        cancel: 'Cancel',
        waiting: 'Confirm the request on the Tako page that just opened…',
        openLink: 'Nothing opened? Open the sign-in page',
        success: 'Signed in; the API key is saved',
        failed: 'Sign-in failed',
        denied: 'The request was declined on the Tako page',
        timeout: 'Timed out after 5 minutes; try again',
        remote: 'This page is not opened from the dsh host itself: Tako redirects back to 127.0.0.1 on the dsh host, which a browser on another machine cannot reach. Paste an API key instead, or run dsh-tako login --no-open --port <port> on the host and forward it with ssh -L.',
        // console panel
        panel: 'Tako Console',
        consoleTitle: 'Tako Console',
        accountCard: 'Sign-in status',
        signedIn: 'Signed in',
        signedOut: 'Not signed in',
        account: 'Account',
        plan: 'Plan',
        unknown: 'unknown',
        whoamiFailed: 'Could not fetch the account',
        signOut: 'Sign out',
        signOutWorking: 'Signing out…',
        logoutRevoked: 'The key was revoked on Tako and removed from dsh credentials',
        logoutRemoved: 'Removed from dsh credentials, but revoking it on Tako failed',
        logoutNone: 'No Tako key is stored',
        logoutExternal: 'This key comes from an environment variable or .env; remove it there instead',
        quotaCard: 'Quota',
        quotaRemain: 'Credit remaining',
        quotaUsed: 'Credit used',
        quotaPoints: 'points',
        quotaUsedShare: '{percent} used',
        quotaNoteUsd: 'USD is converted the way the Tako site does it: 500,000 points = $1',
        quotaNoteUnknown: 'Shown in Tako quota points; the USD conversion is unknown',
        quotaNeedsLogin: 'Sign in to see your quota',
        quotaUnavailable: 'Quota information is unavailable',
        catalogCard: 'Model catalog',
        catalogModel: 'Model',
        catalogContext: 'Context window',
        catalogVision: 'Image input',
        yes: 'Yes',
        no: 'No',
        catalogDefault: 'default',
        catalogEmpty: 'The catalog has not synced yet; the plugin fetches Tako\'s public directory after startup',
        refreshIn: 'refreshes in ~{minutes} min',
        refreshSoon: 'refreshing soon',
        refreshOnlyAtStartup: 'refreshed at startup only',
        loadFailed: 'Could not load',
        retry: 'Retry',
        // update card
        updateCard: 'Update',
        updateAvailable: 'Update available:',
        updateCommand: 'Upgrade command (restart dsh after upgrading):',
        upToDate: 'Up to date: {version}',
        copy: 'Copy',
        copied: 'Copied',
        updateFailed: 'Could not check for updates',
        updateNow: 'Update now',
        updating: 'Updating…',
        updateInstalled: 'Installed {version}. Restart dsh to load it.',
        updateInstallFailed: 'Update failed',
        footerRemain: 'Left',
        footerUsed: 'Used',
        windowHours: '{hours}h',
        weeklyShort: 'Week',
        walletBalance: 'Wallet',
        planWindows: 'Plan windows',
      },
    }

    /**
     * The fallback translator for hosts without the locale service: the same
     * dictionaries, with the language read from `<html lang>` (or the
     * browser), like the pre-i18n client. Anything but a zh* page language
     * falls back to English, and `{name}` holes interpolate like the service.
     */
    const fallbackLang = () => {
      const lang = (document.documentElement.lang || navigator.language || '').toLowerCase()
      return lang.startsWith('zh') ? 'zh' : 'en'
    }
    const fallbackT = (key, params) => {
      const template = DICTS[fallbackLang()][key]
      if (template === undefined) return key
      if (params === undefined || params === null) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
    }
    /**
     * The namespace-bound translator used outside components (the sidebar
     * label thunk): the locale service's bound translate once the dictionaries
     * are registered, the inline fallback until then.
     */
    let boundT = fallbackT
    const loopback = () => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(window.location.hostname)

    async function call(method, route, body) {
      const init = { method, headers: { accept: 'application/json' }, cache: 'no-store' }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(route, init)
      let data
      try { data = await response.json() } catch { data = undefined }
      if (data === undefined) throw new Error(`HTTP ${response.status}`)
      return data
    }

    /**
     * The browser sign-in flow, shared by the Models-page card and the console
     * panel: start (opens the tab inside the click so popup blockers allow it)
     * and poll the login route until it settles. `state.status` is
     * idle | starting | pending | success | error, the login route's answer.
     */
    function useTakoLogin() {
      const [state, setState] = useState({ status: 'idle' })
      const timer = useRef(undefined)
      const alive = useRef(true)
      useEffect(() => () => {
        alive.current = false
        if (timer.current !== undefined) clearTimeout(timer.current)
      }, [])

      const poll = id => {
        timer.current = setTimeout(async () => {
          if (!alive.current) return
          try {
            const next = await fetch(`${ROUTE}?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(r => r.json())
            if (!alive.current) return
            if (next.status === 'pending') { setState(next); poll(id); return }
            setState(next.status === 'idle' ? { status: 'error', code: 'failed', message: 'sign-in no longer pending' } : next)
          } catch (error) {
            if (alive.current) setState({ status: 'error', code: 'failed', message: String(error && error.message || error) })
          }
        }, POLL_MS)
      }

      const start = async () => {
        // Open the tab inside the click so popup blockers allow it; point it at Tako once the URL is known.
        const tab = window.open('about:blank', '_blank')
        setState({ status: 'starting' })
        try {
          const started = await call('POST', ROUTE, { action: 'start' })
          if (started.status !== 'pending') {
            if (tab) tab.close()
            setState(started)
            return
          }
          if (tab) {
            try { tab.opener = null } catch {}
            tab.location.href = started.url
          }
          setState(started)
          poll(started.id)
        } catch (error) {
          if (tab) tab.close()
          setState({ status: 'error', code: 'failed', message: String(error && error.message || error) })
        }
      }
      const cancel = async () => {
        if (timer.current !== undefined) clearTimeout(timer.current)
        try { await call('POST', ROUTE, { action: 'cancel' }) } catch {}
        setState({ status: 'idle' })
      }

      const busy = state.status === 'starting' || state.status === 'pending'
      return { state, start, cancel, busy }
    }

    /** The pending/success/error notes and the sign-in link, shared by both surfaces. */
    function LoginProgress(props) {
      const state = props.state
      const t = props.t ?? fallbackT
      const children = []
      const note = (key, text, tone) => children.push(h('div', {
        key,
        role: tone === 'error' ? 'alert' : 'status',
        style: {
          fontSize: '0.85em',
          opacity: tone === 'muted' ? 0.7 : 1,
          color: tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : tone === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'inherit',
          overflowWrap: 'anywhere',
        },
      }, text))
      if (state.status === 'pending') {
        note('wait', t('waiting'), 'muted')
        children.push(h('a', { key: 'link', href: state.url, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: '0.85em' } }, t('openLink')))
      } else if (state.status === 'success') {
        const who = [state.user, state.plan].filter(Boolean).join(' · ')
        note('ok', `${t('success')}${who ? `（${who}）` : ''} — ${state.key} → ${state.credential}`, 'ok')
      } else if (state.status === 'error') {
        if (state.code !== 'cancelled') note('err', state.code === 'denied' ? t('denied') : state.code === 'timeout' ? t('timeout') : `${t('failed')}: ${state.message}`, 'error')
      }
      if (!loopback()) note('remote', t('remote'), 'muted')
      return children.length === 0 ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, children)
    }

    function TakoSignIn(props) {
      const provider = props.provider
      const t = props.t ?? fallbackT
      const login = useTakoLogin()
      if (provider === undefined || provider.provider !== PROVIDER) return null

      const children = []
      children.push(h('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          disabled: login.busy,
          onClick: login.start,
          'data-testid': 'dsh-tako-sign-in',
          style: { font: 'inherit', padding: '4px 12px', borderRadius: '6px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: login.busy ? 'default' : 'pointer', opacity: login.busy ? 0.6 : 1 },
        }, props.keyConfigured ? t('signInAgain') : t('signIn')),
        login.busy ? h('button', { type: 'button', onClick: login.cancel, style: { font: 'inherit', padding: '4px 8px', border: 'none', background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' } }, t('cancel')) : null,
      ))
      const progress = LoginProgress({ state: login.state, t })
      if (progress !== null) children.push(h('div', { key: 'progress' }, progress))
      return h('div', { 'data-dsh-tako': 'sign-in', style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' } }, children)
    }

    // ---------------------------------------------------------------- console panel

    // DSH loads this as a classic script, so the mark is an inlined PNG data URL.
    const TAKO_MARK_URL = 'data:image/png;base64,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'

    function TakoMark(size) {
      return h('img', {
        src: TAKO_MARK_URL,
        width: size,
        height: size,
        alt: '',
        'aria-hidden': true,
        'data-testid': 'dsh-tako-mark',
        style: { display: 'block', flex: 'none', borderRadius: Math.round(size * 8 / 24) },
      })
    }

    function TakoPanelIcon(props) {
      return TakoMark(props.size || 18)
    }

    const CLAY = '#c45c3e'
    const BONE = '#ddd4c6'
    const mono = { fontFamily: 'ui-monospace, "IBM Plex Mono", monospace', fontSize: '0.9em' }
    const rowStyle = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }
    const buttonStyle = {
      font: 'inherit', padding: '2px 0', border: 'none', borderBottom: `1px solid ${CLAY}`,
      borderRadius: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
    }
    const quietButton = {
      font: 'inherit', padding: '2px 0', border: 'none', background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)', textDecoration: 'underline', cursor: 'pointer',
    }
    const muted = { color: 'var(--dsw-alias-label-tertiary)' }

    function Tentacle() {
      return h('svg', { className: 'dsh-tako-tentacle', viewBox: '0 0 320 8', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M0 4 C40 8 80 0 120 4 S200 8 240 3 S280 0 320 5', stroke: CLAY, strokeWidth: '1.2', strokeLinecap: 'round' }))
    }

    function Card(props) {
      return h('section', { 'data-dsh-tako-card': props.name, className: 'dsh-tako-section' },
        h('div', { className: 'dsh-tako-kicker' },
          props.title,
          props.extra === undefined ? null : h('span', { className: 'dsh-tako-extra' }, props.extra)),
        h('div', { className: 'dsh-tako-body' }, props.children))
    }

    function ensureTakoTheme() {
      if (typeof document.getElementById !== 'function') return
      if (document.getElementById('dsh-tako-theme') !== null) return
      const style = document.createElement('style')
      style.id = 'dsh-tako-theme'
      style.textContent = [
        '.dsh-tako-sheet{display:flex;flex-direction:column;gap:22px;max-width:720px;margin:0 auto;padding:28px 24px 56px}',
        '.dsh-tako-head{display:flex;align-items:center;gap:12px}',
        '.dsh-tako-head h1{margin:0;font-size:22px;font-weight:500;letter-spacing:0.04em}',
        '.dsh-tako-kicker{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-extra{letter-spacing:0;text-transform:none;font-size:12px}',
        '.dsh-tako-body{display:flex;flex-direction:column;gap:10px;margin-top:8px}',
        '.dsh-tako-tentacle{display:block;width:100%;height:10px}',
        '.dsh-tako-stamps{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}',
        '.dsh-tako-stamps-3{grid-template-columns:repeat(3,minmax(0,1fr))}',
        '.dsh-tako-stamp .n{font-variant-numeric:tabular-nums;font-size:22px;font-weight:500;line-height:28px}',
        '.dsh-tako-stamp .n small{font-size:13px;font-weight:400;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-footer{display:flex;align-items:center;gap:10px;width:100%;padding:6px 2px;border:none;background:transparent;color:inherit;text-align:left;cursor:pointer}',
        '.dsh-tako-footer .frac{font-variant-numeric:tabular-nums;font-size:13px;font-weight:500}',
        '.dsh-tako-footer .k{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-ink{color:' + CLAY + '}',
        '.dsh-tako-bar{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
        '.dsh-tako-bar>i{display:block;height:100%;background:' + CLAY + ';border-radius:inherit}',
        '.dsh-tako-footer-bar{height:4px;width:100%;margin-top:3px}',
      ].join('')
      document.head.appendChild(style)
    }

    const fmtNumber = value => (typeof value === 'number' ? value.toLocaleString('en-US') : '—')

    /** "refreshes in ~x min", counted down locally from nextSyncAt; no server polling. */
    function Countdown(props) {
      const nextSyncAt = props.nextSyncAt
      const t = props.t ?? fallbackT
      const [, setTick] = useState(0)
      useEffect(() => {
        if (nextSyncAt === null || nextSyncAt === undefined) return
        const timer = setInterval(() => setTick(n => n + 1), 1000)
        return () => clearInterval(timer)
      }, [nextSyncAt])
      if (nextSyncAt === null || nextSyncAt === undefined) return t('refreshOnlyAtStartup')
      const minutes = Math.ceil(Math.max(0, nextSyncAt - Date.now()) / 60000)
      return minutes <= 0 ? t('refreshSoon') : t('refreshIn', { minutes })
    }

    function AccountCard(props) {
      const status = props.status
      const login = props.login
      const t = props.t ?? fallbackT
      const children = []
      const configured = status !== undefined && status.configured === true
      const detail = (key, label, value) => h('div', { key, style: rowStyle },
        h('span', { style: { ...muted, minWidth: '3.5em' } }, label),
        value)
      if (status === undefined) {
        children.push(h('div', { key: 'loading', style: muted }, '…'))
      } else {
        children.push(h('div', { key: 'state', style: rowStyle },
          h('span', { style: muted }, configured ? t('signedIn') : t('signedOut')),
          configured ? h('span', { style: { ...mono, color: 'var(--dsw-alias-label-secondary)', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm)', padding: '1px 6px' } }, status.maskedKey || '') : null))
        if (configured && status.me !== null && status.me !== undefined) {
          children.push(detail('account', t('account'), h('span', { style: mono }, status.me.userName || t('unknown'))))
          children.push(detail('plan', t('plan'), h('span', { style: mono }, status.me.planName || t('unknown'))))
        }
        if (configured && status.meError !== undefined) {
          children.push(h('div', { key: 'meerr', role: 'status', style: { fontSize: '0.85em', color: 'var(--dsw-alias-state-warn-primary)', overflowWrap: 'anywhere' } }, `${t('whoamiFailed')}: ${status.meError}`))
        }
      }
      const actions = []
      if (status !== undefined && !configured) {
        actions.push(h('button', { key: 'in', type: 'button', 'data-testid': 'dsh-tako-console-sign-in', disabled: login.busy, onClick: login.start, style: { ...buttonStyle, opacity: login.busy ? 0.6 : 1 } }, t('signIn')))
      } else if (configured) {
        actions.push(h('button', { key: 'again', type: 'button', disabled: login.busy, onClick: login.start, style: { ...buttonStyle, opacity: login.busy ? 0.6 : 1 } }, t('signInAgain')))
        actions.push(h('button', { key: 'out', type: 'button', 'data-testid': 'dsh-tako-console-sign-out', disabled: props.busyLogout, onClick: props.onLogout, style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary)' } }, props.busyLogout ? t('signOutWorking') : t('signOut')))
      }
      if (login.busy) actions.push(h('button', { key: 'cancel', type: 'button', onClick: login.cancel, style: quietButton }, t('cancel')))
      if (actions.length > 0) children.push(h('div', { key: 'actions', style: rowStyle }, actions))
      const progress = LoginProgress({ state: login.state, t })
      if (progress !== null) children.push(progress)
      if (props.logoutNote !== undefined) {
        children.push(h('div', { key: 'note', role: 'status', style: { fontSize: '0.85em', overflowWrap: 'anywhere' } }, props.logoutNote))
      }
      return Card({ name: 'account', title: t('accountCard'), children })
    }

    /**
     * The update card: the plugin cannot hot-update itself, so this compares
     * the installed version with npm's latest (host route, cached server-side)
     * and, when behind, POSTs /api/tako.update to install it, then asks the
     * user to restart dsh. The upgrade command with a copy button stays as a
     * fallback. It loads on its own and renders while pending, so it never
     * blocks the other cards.
     */
    function UpdateCard(props) {
      const t = props.t ?? fallbackT
      const [update, setUpdate] = useState(undefined)
      const [updateError, setUpdateError] = useState(undefined)
      const [copied, setCopied] = useState(false)
      const [installing, setInstalling] = useState(false)
      const [installError, setInstallError] = useState(undefined)
      const alive = useRef(true)
      const commandText = useRef(undefined)
      useEffect(() => () => { alive.current = false }, [])
      useEffect(() => {
        void (async () => {
          try {
            const next = await call('GET', UPDATE_ROUTE)
            if (!alive.current) return
            setUpdate(next)
            setUpdateError(undefined)
          } catch (error) {
            if (alive.current) setUpdateError(String(error && error.message || error))
          }
        })()
      }, [])

      const copyCommand = async () => {
        try {
          await navigator.clipboard.writeText(UPGRADE_COMMAND)
          setCopied(true)
          return
        } catch {}
        // Not a secure context or the clipboard is blocked: select the text, so a manual copy still works.
        const node = commandText.current
        const selection = node === undefined || node === null ? null : window.getSelection()
        if (selection === null || selection === undefined) return
        const range = document.createRange()
        range.selectNodeContents(node)
        selection.removeAllRanges()
        selection.addRange(range)
      }

      const install = async () => {
        setInstalling(true)
        setInstallError(undefined)
        try {
          const next = await call('POST', UPDATE_ROUTE, {})
          if (!alive.current) return
          if (next.ok === true) {
            setUpdate({
              ...update,
              ...next,
              pendingRestart: next.pendingRestart === true || next.skipped !== true,
              installed: next.installed || next.latest,
            })
            setInstallError(undefined)
          } else {
            setInstallError(next.error !== undefined && next.error !== '' ? String(next.error) : t('updateInstallFailed'))
          }
        } catch (error) {
          if (alive.current) setInstallError(String(error && error.message || error))
        } finally {
          if (alive.current) setInstalling(false)
        }
      }

      const children = []
      const installedVersion = update === undefined ? '' : (update.installed || update.latest || update.current || '')
      const showInstalled = update !== undefined && (update.pendingRestart === true || (update.ok === true && update.skipped === false))
      const showUpToDate = update !== undefined && (update.upToDate === true || (update.ok === true && update.skipped === true && update.pendingRestart !== true))
      if (update === undefined) {
        children.push(h('div', { key: 'x', role: 'status', style: muted }, updateError === undefined ? '…' : t('updateFailed')))
      } else if (update.checkError !== undefined) {
        children.push(h('div', { key: 'x', role: 'status', style: muted, title: String(update.checkError) }, t('updateFailed')))
      } else if (showInstalled) {
        children.push(h('div', { key: 'done', role: 'status', style: { fontSize: '0.85em', color: 'var(--dsw-alias-state-success-primary)' } }, t('updateInstalled', { version: installedVersion })))
      } else if (showUpToDate) {
        children.push(h('div', { key: 'x', role: 'status', style: muted }, t('upToDate', { version: update.current })))
      } else {
        children.push(h('div', { key: 'new', style: rowStyle },
          h('span', null, t('updateAvailable')),
          h('b', { style: mono }, update.latest)))
        children.push(h('button', {
          key: 'now',
          type: 'button',
          'data-testid': 'dsh-tako-console-update-now',
          disabled: installing,
          onClick: install,
          style: { ...buttonStyle, opacity: installing ? 0.6 : 1, alignSelf: 'flex-start' },
        }, installing ? t('updating') : t('updateNow')))
        if (installError !== undefined) {
          children.push(h('div', { key: 'ierr', role: 'alert', style: { fontSize: '0.85em', color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' } }, `${t('updateInstallFailed')}: ${installError}`))
        }
        children.push(h('div', { key: 'hint', style: { ...muted, fontSize: '0.85em' } }, t('updateCommand')))
        children.push(h('div', { key: 'cmd', style: rowStyle },
          h('code', {
            ref: commandText,
            'data-testid': 'dsh-tako-upgrade-command',
            style: { ...mono, whiteSpace: 'nowrap', overflowX: 'auto', padding: '4px 10px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm)', background: 'var(--dsw-alias-interactive-bg-hover)' },
          }, UPGRADE_COMMAND),
          h('button', { type: 'button', 'data-testid': 'dsh-tako-console-copy-upgrade', onClick: copyCommand, style: { ...buttonStyle, padding: '4px 10px' } }, copied ? t('copied') : t('copy'))))
      }
      return Card({ name: 'update', title: t('updateCard'), children })
    }

    const ensureQuotaStyle = ensureTakoTheme

    /**
     * Money the way the site's console prints it: USD with the narrow symbol,
     * up to 2 decimals from $1, up to 4 below, values that would round to
     * zero bumped to the smallest shown step.
     */
    const fmtUsd = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const digits = Math.abs(value) >= 1 ? 2 : 4
      const floor = 10 ** -digits
      const shown = value !== 0 && Math.abs(value) < floor ? (value > 0 ? floor : -floor) : value
      return shown.toLocaleString(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: digits })
    }

    function openTakoConsole(t) {
      const label = t('panel')
      const buttons = document.querySelectorAll('nav button[aria-label]')
      for (const button of buttons) {
        if (button.getAttribute('aria-label') === label) {
          button.click()
          return
        }
      }
    }

    function hasPlanQuota(plan) {
      if (!plan) return false
      return (plan.windowCostLimit || 0) > 0 || (plan.weeklyCostLimit || 0) > 0
    }

    function windowLabel(plan, t) {
      const mins = plan && plan.windowMinutes > 0 ? plan.windowMinutes : 300
      const hours = mins / 60
      const shown = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10)
      return t('windowHours', { hours: shown })
    }

    function fracUsd(used, limit) {
      const u = typeof used === 'number' ? fmtUsd(used) : '—'
      if (typeof limit !== 'number' || limit <= 0) return u
      return `${u} / ${fmtUsd(limit)}`
    }

    function remainingShare(used, limit) {
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return undefined
      const spent = typeof used === 'number' && Number.isFinite(used) ? used : 0
      return Math.max(0, Math.min(1, (limit - spent) / limit))
    }

    /** Remaining share of a subscription window, as a compact percent. */
    function remainingPercent(used, limit) {
      const share = remainingShare(used, limit)
      if (share === undefined) return '—'
      return share.toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 0 })
    }

    function QuotaBar(used, limit, extraClass) {
      const share = remainingShare(used, limit)
      if (share === undefined) return null
      const percent = Math.round(share * 100)
      return h('div', {
        className: extraClass === undefined ? 'dsh-tako-bar' : `dsh-tako-bar ${extraClass}`,
        role: 'progressbar',
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
      }, h('i', { style: { width: `${percent}%` } }))
    }

    function TakoFooter(props) {
      const wide = props.wide === true
      const t = props.t ?? fallbackT
      const [status, setStatus] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      useEffect(() => {
        ensureTakoTheme()
        void (async () => {
          try {
            const next = await call('GET', STATUS_ROUTE)
            if (alive.current) setStatus(next)
          } catch {
            if (alive.current) setStatus({ configured: false })
          }
        })()
      }, [])
      const configured = status !== undefined && status.configured === true
      const plan = configured ? status.plan : undefined
      const onPlan = hasPlanQuota(plan)
      const remain = configured && typeof status.me?.quotaRemainUsd === 'number' ? fmtUsd(status.me.quotaRemainUsd) : undefined
      let body
      if (status === undefined) body = h('span', { className: 'k' }, '…')
      else if (!configured) body = h('span', { className: 'frac dsh-tako-ink' }, t('signIn'))
      else if (onPlan) body = h('span', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
        h('span', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 } },
          h('span', { style: { minWidth: 0 } },
            h('span', { className: 'k' }, windowLabel(plan, t) + ' '),
            h('span', { className: 'frac' }, remainingPercent(plan.windowCost, plan.windowCostLimit)),
            QuotaBar(plan.windowCost, plan.windowCostLimit, 'dsh-tako-footer-bar')),
          h('span', { style: { minWidth: 0 } },
            h('span', { className: 'k' }, t('weeklyShort') + ' '),
            h('span', { className: 'frac' }, remainingPercent(plan.weeklyCost, plan.weeklyCostLimit)),
            QuotaBar(plan.weeklyCost, plan.weeklyCostLimit, 'dsh-tako-footer-bar'))),
        h('span', null, h('span', { className: 'k' }, t('walletBalance') + ' '), h('span', { className: 'frac dsh-tako-ink' }, remain || '—')))
      else body = h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('span', { className: 'k' }, t('walletBalance')),
        h('span', { className: 'frac dsh-tako-ink' }, remain || '—'))
      return h('button', {
        type: 'button',
        className: 'dsh-tako-footer',
        'data-testid': 'dsh-tako-footer',
        'data-tako-quota': !configured ? 'empty' : onPlan ? 'plan' : 'balance',
        onClick: () => { openTakoConsole(t) },
      },
        h('span', { 'aria-hidden': true, style: { flex: 'none' } }, TakoMark(wide ? 22 : 18)),
        wide ? h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 } }, body) : null)
    }
    /** A share (0-1) as a percent, mirroring the site's two-digit cap. */
    const fmtPercent = share => share.toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 2 })

    function QuotaCard(props) {
      const status = props.status
      const t = props.t ?? fallbackT
      const children = []
      const configured = status !== undefined && status.configured === true
      const plan = configured ? status.plan : undefined
      const onPlan = hasPlanQuota(plan)
      if (!configured) {
        children.push(h('div', { key: 'x', style: muted }, status === undefined ? '…' : t('quotaNeedsLogin')))
      } else if (onPlan) {
        const remainUsd = status.me?.quotaRemainUsd
        const stamp = (key, label, value, hint, used, limit) => h('div', { key, className: 'dsh-tako-stamp' },
          h('div', { className: 'dsh-tako-kicker' }, label),
          h('div', { className: 'n', 'data-testid': `dsh-tako-quota-${key}` }, value),
          used === undefined ? null : QuotaBar(used, limit),
          hint === undefined ? null : h('div', { style: { ...muted, fontSize: '12px' } }, hint))
        children.push(h('div', { key: 'stamps', className: 'dsh-tako-stamps dsh-tako-stamps-3' },
          stamp('window', windowLabel(plan, t), remainingPercent(plan.windowCost, plan.windowCostLimit), fracUsd(plan.windowCost, plan.windowCostLimit), plan.windowCost, plan.windowCostLimit),
          stamp('week', t('weeklyShort'), remainingPercent(plan.weeklyCost, plan.weeklyCostLimit), fracUsd(plan.weeklyCost, plan.weeklyCostLimit), plan.weeklyCost, plan.weeklyCostLimit),
          stamp('remain', t('walletBalance'), typeof remainUsd === 'number' ? fmtUsd(remainUsd) : '—')))
        if (status.planError) {
          children.push(h('div', { key: 'pe', role: 'status', style: { ...muted, fontSize: '12px' } }, status.planError))
        }
      } else if (status.me === null || status.me === undefined) {
        children.push(h('div', { key: 'x', style: muted }, status.planError || t('quotaUnavailable')))
      } else {
        const remainUsd = status.me.quotaRemainUsd
        children.push(h('div', { key: 'wallet', className: 'dsh-tako-stamp' },
          h('div', { className: 'dsh-tako-kicker' }, t('walletBalance')),
          h('div', { className: 'n dsh-tako-ink', 'data-testid': 'dsh-tako-quota-remain' },
            typeof remainUsd === 'number' ? fmtUsd(remainUsd) : '—')))
      }
      return Card({ name: 'quota', title: onPlan ? t('planWindows') : t('quotaCard'), children })
    }

    function CatalogCard(props) {
      const catalog = props.catalog
      const t = props.t ?? fallbackT
      const children = []
      if (catalog === undefined) {
        children.push(h('div', { key: 'x', style: muted }, props.error === undefined ? '…' : `${t('loadFailed')}: ${props.error}`))
      } else if (catalog.models === undefined || catalog.models.length === 0) {
        children.push(h('div', { key: 'x', style: muted }, t('catalogEmpty')))
      } else {
        const head = { padding: '6px 10px', textAlign: 'left', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400, fontSize: '12px', borderBottom: '0.5px solid var(--dsw-alias-border-l2)', whiteSpace: 'nowrap' }
        const cell = { padding: '6px 10px', borderBottom: '0.5px solid var(--dsw-alias-border-l2)', overflowWrap: 'anywhere' }
        children.push(h('div', { key: 'table', style: { overflowX: 'auto' } },
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' } },
            h('thead', null, h('tr', null,
              h('th', { style: head }, t('catalogModel')),
              h('th', { style: head }, t('catalogContext')),
              h('th', { style: head }, t('catalogVision')))),
            h('tbody', null, catalog.models.map(model => h('tr', { key: model.id, 'data-model': model.id },
              h('td', { style: { ...cell, ...mono } }, model.id),
              h('td', { style: cell }, model.contextWindow === undefined ? `— (${t('catalogDefault')})` : fmtNumber(model.contextWindow)),
              h('td', { style: cell }, (model.input || []).includes('image') ? t('yes') : t('no'))))))))
      }
      return Card({
        name: 'catalog',
        title: t('catalogCard'),
        extra: catalog === undefined || catalog.nextSyncAt === undefined ? undefined : h(Countdown, { nextSyncAt: catalog.nextSyncAt, t }),
        children,
      })
    }

    function TakoConsolePage(props) {
      const t = props.t ?? fallbackT
      const [status, setStatus] = useState(undefined)
      const [statusError, setStatusError] = useState(undefined)
      const [catalog, setCatalog] = useState(undefined)
      const [catalogError, setCatalogError] = useState(undefined)
      const [busyLogout, setBusyLogout] = useState(false)
      const [logoutNote, setLogoutNote] = useState(undefined)
      const login = useTakoLogin()

      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])

      const loadStatus = async () => {
        try {
          const next = await call('GET', STATUS_ROUTE)
          if (!alive.current) return
          setStatus(next)
          setStatusError(undefined)
        } catch (error) {
          if (alive.current) setStatusError(String(error && error.message || error))
        }
      }
      const loadCatalog = async () => {
        try {
          const next = await call('GET', CATALOG_ROUTE)
          if (!alive.current) return
          setCatalog(next)
          setCatalogError(undefined)
        } catch (error) {
          if (alive.current) setCatalogError(String(error && error.message || error))
        }
      }

      useEffect(() => { void loadStatus(); void loadCatalog() }, [])
      // A finished sign-in changes the stored key; refresh the status card.
      useEffect(() => { if (login.state.status === 'success') { setLogoutNote(undefined); void loadStatus() } }, [login.state.status])

      const logout = async () => {
        setBusyLogout(true)
        setLogoutNote(undefined)
        try {
          const result = await call('POST', LOGOUT_ROUTE, {})
          if (!alive.current) return
          if (result.action === 'revoked') setLogoutNote(t('logoutRevoked'))
          else if (result.action === 'removed') setLogoutNote(result.warning === undefined ? t('logoutRemoved') : `${t('logoutRemoved')}: ${result.warning}`)
          else if (result.action === 'external') setLogoutNote(t('logoutExternal'))
          else setLogoutNote(t('logoutNone'))
          await loadStatus()
        } catch (error) {
          if (alive.current) setLogoutNote(`${t('failed')}: ${String(error && error.message || error)}`)
        } finally {
          if (alive.current) setBusyLogout(false)
        }
      }

      ensureTakoTheme()
      const children = [
        h('header', { key: 'head', className: 'dsh-tako-head' },
          TakoMark(28),
          h('div', null,
            h('div', { className: 'dsh-tako-kicker' }, 'Tako'),
            h('h1', null, t('consoleTitle'))),
          status !== undefined && status.configured && status.maskedKey
            ? h('span', { 'data-testid': 'dsh-tako-console-key', style: { ...mono, marginLeft: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, status.maskedKey)
            : null),
        Tentacle(),
      ]
      if (statusError !== undefined) {
        children.push(h('div', { key: 'err', role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '0.9em', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          `${t('loadFailed')}: ${statusError}`,
          h('button', { type: 'button', onClick: () => { void loadStatus(); void loadCatalog() }, style: quietButton }, t('retry'))))
      }
      children.push(AccountCard({ status, login, busyLogout, onLogout: logout, logoutNote, t }))
      children.push(Tentacle())
      children.push(QuotaCard({ status, t }))
      children.push(Tentacle())
      children.push(CatalogCard({ catalog, error: catalogError, t }))
      children.push(Tentacle())
      children.push(h(UpdateCard, { key: 'update', t }))
      return h('div', {
        'data-testid': 'dsh-tako-console-page',
        style: { height: '100%', minHeight: 0, overflowY: 'auto', fontSize: '14px', lineHeight: '22px' },
      },
        h('div', { className: 'dsh-tako-sheet' }, children))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        /**
         * Register the dictionaries with the host's locale service so every
         * text follows the client's language setting. Activation is gated only
         * on `slots` (a hard requirement on `locale` would park the whole
         * plugin on hosts without the service), so the service may appear
         * after `apply`: try it now, and otherwise retry whenever a service
         * is provided. Registering bumps the locale revision, so outlets
         * already on screen pick the dictionaries up late; the disposer hangs
         * on this plugin's fiber, so a plugin disable/re-enable re-registers.
         * Hosts (or stubs) without a usable service keep the inline fallback.
         */
        const adoptLocale = face => {
          if (face === undefined || typeof face.register !== 'function' || typeof face.bind !== 'function') return false
          try {
            const dispose = face.register(NS, DICTS)
            boundT = face.bind(NS)
            if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'dsh-tako: locale dictionaries')
            return true
          } catch {
            return false
          }
        }
        if (!adoptLocale(typeof ctx.get === 'function' ? ctx.get('locale') : undefined) && typeof ctx.on === 'function') {
          ctx.on('internal/service', (name, value) => {
            if (name !== 'locale') return
            if (value === undefined) { boundT = fallbackT; return }
            adoptLocale(value)
          })
        }

        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
          name: 'settings.models.provider-card',
          key: PI_AI_NS,
          locale: NS,
        }, TakoSignIn))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, TakoConsolePage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => boundT('panel'),
          locale: NS,
        }, TakoPanelIcon))
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-tako-quota',
          order: 10,
          locale: NS,
        }, TakoFooter))
      },
    }
  },
})
