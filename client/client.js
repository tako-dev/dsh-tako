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

    function TakoMark(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
        'data-testid': 'dsh-tako-mark',
        style: { display: 'block', flex: 'none', borderRadius: 8 },
      },
        h('rect', { width: 24, height: 24, rx: 6, fill: '#c45c3e' }),
        h('path', {
          fill: '#f4eee6',
          d: 'M6.75 11.25C6.75 8.35 9.17 6 12 6s5.25 2.35 5.25 5.25v2.1c0 .58-.47 1.05-1.05 1.05h-.3v2.1c0 .62-.5 1.12-1.12 1.12-.62 0-1.12-.5-1.12-1.12v-1.1h-1.32v1.1c0 .62-.5 1.12-1.12 1.12-.62 0-1.12-.5-1.12-1.12v-1.1h-1.32v1.1c0 .62-.5 1.12-1.12 1.12-.62 0-1.12-.5-1.12-1.12v-2.1h-.3c-.58 0-1.05-.47-1.05-1.05v-2.1Z',
        }),
        h('circle', { cx: 10, cy: 11, r: 0.9, fill: '#c45c3e' }),
        h('circle', { cx: 14, cy: 11, r: 0.9, fill: '#c45c3e' }))
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
