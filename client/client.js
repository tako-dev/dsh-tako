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
 * (`api/tako.status|logout|catalog`) with relative fetches.
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
    const PI_AI_NS = 'llm-pi-ai'
    const PROVIDER = 'tako'
    const PANEL_ID = 'tako-console'
    const POLL_MS = 1500

    const zh = () => {
      const lang = (document.documentElement.lang || navigator.language || '').toLowerCase()
      return lang.startsWith('zh')
    }
    const T = {
      signIn: ['通过浏览器登录 Tako', 'Sign in to Tako with the browser'],
      signInAgain: ['重新登录 Tako', 'Sign in to Tako again'],
      cancel: ['取消', 'Cancel'],
      waiting: ['请在新打开的 Tako 页面确认授权…', 'Confirm the request on the Tako page that just opened…'],
      openLink: ['没有弹出页面？点这里打开', 'Nothing opened? Open the sign-in page'],
      success: ['已登录，API key 已保存', 'Signed in; the API key is saved'],
      failed: ['登录失败', 'Sign-in failed'],
      denied: ['已在 Tako 页面拒绝授权', 'The request was declined on the Tako page'],
      timeout: ['等待超时（5 分钟），请重试', 'Timed out after 5 minutes; try again'],
      remote: [
        '当前页面不是从 dsh 所在机器的本机地址打开的：登录完成后 Tako 会跳回 dsh 主机的 127.0.0.1，浏览器在另一台机器上时这一步到不了。请改为粘贴 API key，或在 dsh 主机上运行 dsh-tako login --no-open --port <端口> 并用 ssh -L 转发。',
        'This page is not opened from the dsh host itself: Tako redirects back to 127.0.0.1 on the dsh host, which a browser on another machine cannot reach. Paste an API key instead, or run dsh-tako login --no-open --port <port> on the host and forward it with ssh -L.',
      ],
      // console panel
      panel: ['Tako 控制台', 'Tako Console'],
      consoleTitle: ['Tako 控制台', 'Tako Console'],
      accountCard: ['登录状态', 'Sign-in status'],
      signedIn: ['已登录', 'Signed in'],
      signedOut: ['未登录', 'Not signed in'],
      account: ['账号', 'Account'],
      plan: ['套餐', 'Plan'],
      unknown: ['未知', 'unknown'],
      whoamiFailed: ['账号信息获取失败', 'Could not fetch the account'],
      signOut: ['退出', 'Sign out'],
      signOutWorking: ['退出中…', 'Signing out…'],
      logoutRevoked: ['已在 Tako 吊销这个 key，并从 dsh 凭据中删除', 'The key was revoked on Tako and removed from dsh credentials'],
      logoutRemoved: ['已从 dsh 凭据中删除，但在 Tako 吊销失败', 'Removed from dsh credentials, but revoking it on Tako failed'],
      logoutNone: ['没有已保存的 Tako key', 'No Tako key is stored'],
      logoutExternal: ['这个 key 来自环境变量或 .env，插件不去吊销或删除；要停用请在对应位置移除', 'This key comes from an environment variable or .env; remove it there instead'],
      quotaCard: ['余额 / 额度', 'Quota'],
      quotaRemain: ['剩余额度', 'Credit remaining'],
      quotaUsed: ['已用额度', 'Credit used'],
      quotaPoints: ['点', 'points'],
      quotaUsedShare: (percent) => [`已用占比 ${percent}`, `${percent} used`],
      quotaNoteUsd: ['美元按 Tako 官网口径换算：500,000 点 = $1', 'USD is converted the way the Tako site does it: 500,000 points = $1'],
      quotaNoteUnknown: ['单位是 Tako 额度点数；美元换算未知', 'Shown in Tako quota points; the USD conversion is unknown'],
      quotaNeedsLogin: ['需要登录后查看', 'Sign in to see your quota'],
      quotaUnavailable: ['暂时拿不到额度信息', 'Quota information is unavailable'],
      catalogCard: ['模型目录', 'Model catalog'],
      catalogModel: ['模型', 'Model'],
      catalogContext: ['上下文窗口', 'Context window'],
      catalogVision: ['图片输入', 'Image input'],
      yes: ['支持', 'Yes'],
      no: ['不支持', 'No'],
      catalogDefault: ['默认', 'default'],
      catalogEmpty: ['目录尚未同步；插件会在启动后拉取 Tako 的公开目录', 'The catalog has not synced yet; the plugin fetches Tako\'s public directory after startup'],
      refreshIn: (minutes) => [`约 ${minutes} 分钟后刷新`, `refreshes in ~${minutes} min`],
      refreshSoon: ['即将刷新', 'refreshing soon'],
      refreshOnlyAtStartup: ['只在启动时刷新', 'refreshed at startup only'],
      loadFailed: ['加载失败', 'Could not load'],
      retry: ['重试', 'Retry'],
    }
    const t = key => T[key][zh() ? 0 : 1]
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
      const progress = LoginProgress({ state: login.state })
      if (progress !== null) children.push(h('div', { key: 'progress' }, progress))
      return h('div', { 'data-dsh-tako': 'sign-in', style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' } }, children)
    }

    // ---------------------------------------------------------------- console panel

    /** A simple "T" with a curled tentacle tail, at the size the sidebar asks for. */
    function TakoPanelIcon(props) {
      const size = props.size || 18
      const color = props.active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
        style: { display: 'block', flex: 'none', color },
      },
        h('path', { d: 'M5.5 5h13', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' }),
        h('path', { d: 'M12 5v11.5a2.5 2.5 0 0 0 2.5 2.5h1.5', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' }),
      )
    }

    const mono = { fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: '0.9em' }
    const rowStyle = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }
    const buttonStyle = {
      font: 'inherit', padding: '4px 12px', borderRadius: '6px', border: '1px solid currentColor',
      background: 'transparent', color: 'inherit', cursor: 'pointer',
    }
    const quietButton = {
      font: 'inherit', padding: '4px 8px', border: 'none', background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)', textDecoration: 'underline', cursor: 'pointer',
    }
    const muted = { color: 'var(--dsw-alias-label-tertiary)' }

    function Card(props) {
      return h('section', {
        'data-dsh-tako-card': props.name,
        style: {
          border: '0.5px solid var(--dsw-alias-border-l2)',
          borderRadius: 'var(--dsw-radius-lg)',
          background: 'var(--dsw-alias-bg-layer-1)',
          padding: '14px 18px 16px',
          marginBottom: '14px',
          display: 'flex', flexDirection: 'column', gap: '10px',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' } },
          h('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 500, lineHeight: '22px' } }, props.title),
          props.extra === undefined ? null : h('div', { style: { ...muted, fontSize: '12px' } }, props.extra)),
        props.children)
    }

    const fmtNumber = value => (typeof value === 'number' ? value.toLocaleString('en-US') : '—')

    /** "refreshes in ~x min", counted down locally from nextSyncAt; no server polling. */
    function Countdown(props) {
      const nextSyncAt = props.nextSyncAt
      const [, setTick] = useState(0)
      useEffect(() => {
        if (nextSyncAt === null || nextSyncAt === undefined) return
        const timer = setInterval(() => setTick(n => n + 1), 1000)
        return () => clearInterval(timer)
      }, [nextSyncAt])
      if (nextSyncAt === null || nextSyncAt === undefined) return t('refreshOnlyAtStartup')
      const minutes = Math.ceil(Math.max(0, nextSyncAt - Date.now()) / 60000)
      return minutes <= 0 ? t('refreshSoon') : T.refreshIn(minutes)[zh() ? 0 : 1]
    }

    function AccountCard(props) {
      const status = props.status
      const login = props.login
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
      const progress = LoginProgress({ state: login.state })
      if (progress !== null) children.push(progress)
      if (props.logoutNote !== undefined) {
        children.push(h('div', { key: 'note', role: 'status', style: { fontSize: '0.85em', overflowWrap: 'anywhere' } }, props.logoutNote))
      }
      return Card({ name: 'account', title: t('accountCard'), children })
    }

    /**
     * The site's own palette for the quota bar: Tako's stylesheet defines
     * `--primary: #3ea4ec` for light and `#0e72bc` under `.dark` (verified on
     * https://tako.shiroha.tech). dsh signals dark with `body[data-ds-dark-theme]`,
     * so a tiny class beats an inline style here: it follows theme switches live.
     */
    const ensureQuotaStyle = () => {
      if (document.getElementById('dsh-tako-quota-style') !== null) return
      const style = document.createElement('style')
      style.id = 'dsh-tako-quota-style'
      style.textContent = '.dsh-tako-quota-bar{background:#3ea4ec}'
        + 'body[data-ds-dark-theme] .dsh-tako-quota-bar{background:#0e72bc}'
      document.head.appendChild(style)
    }

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
    /** A share (0-1) as a percent, mirroring the site's two-digit cap. */
    const fmtPercent = share => share.toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 2 })

    function QuotaCard(props) {
      const status = props.status
      const children = []
      const configured = status !== undefined && status.configured === true
      if (!configured) {
        children.push(h('div', { key: 'x', style: muted }, status === undefined ? '…' : t('quotaNeedsLogin')))
      } else if (status.me === null || status.me === undefined) {
        children.push(h('div', { key: 'x', style: muted }, t('quotaUnavailable')))
      } else {
        ensureQuotaStyle()
        const me = status.me
        const remain = me.quotaRemain
        const used = me.quotaUsed
        const remainUsd = typeof me.quotaRemainUsd === 'number' ? me.quotaRemainUsd : undefined
        const usedUsd = typeof me.quotaUsedUsd === 'number' ? me.quotaUsedUsd : undefined
        const total = typeof remain === 'number' && typeof used === 'number' ? remain + used : undefined
        const share = total !== undefined && total > 0 ? used / total : undefined
        // The site's quota-card hierarchy: a small label, the big value, and
        // the raw points as a second line. USD first — that is how the Tako
        // console prices quota (quota_display_type: USD) — points as fallback.
        const stat = (key, label, usd, points) => h('div', { key, style: { flex: '1 1 140px', minWidth: 0 } },
          h('div', { style: { ...muted, fontSize: '12px', lineHeight: '16px' } }, label),
          h('div', { 'data-testid': `dsh-tako-quota-${key}`, style: { ...mono, fontSize: '22px', fontWeight: 600, lineHeight: '30px' } },
            usd !== undefined ? fmtUsd(usd) : typeof points === 'number' ? `${fmtNumber(points)} ${t('quotaPoints')}` : '—'),
          usd !== undefined && typeof points === 'number'
            ? h('div', { style: { ...muted, ...mono, fontSize: '12px', lineHeight: '16px' } }, `${fmtNumber(points)} ${t('quotaPoints')}`)
            : null)
        children.push(h('div', { key: 'stats', style: { display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: '2px' } },
          stat('remain', t('quotaRemain'), remainUsd, remain),
          stat('used', t('quotaUsed'), usedUsd, used)))
        if (share !== undefined) {
          children.push(h('div', {
            key: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': used,
            style: { height: '6px', borderRadius: '3px', background: 'var(--dsw-alias-interactive-bg-hover)', overflow: 'hidden' },
          },
            h('div', { className: 'dsh-tako-quota-bar', style: { width: `${Math.min(100, share * 100)}%`, height: '100%' } })))
          children.push(h('div', { key: 'share', style: { ...muted, fontSize: '12px', lineHeight: '16px' } }, T.quotaUsedShare(fmtPercent(share))[zh() ? 0 : 1]))
        }
        if (remain !== undefined || used !== undefined) {
          children.push(h('div', { key: 'note', style: { ...muted, fontSize: '12px', lineHeight: '16px' } },
            remainUsd !== undefined ? t('quotaNoteUsd') : t('quotaNoteUnknown')))
        }
      }
      return Card({ name: 'quota', title: t('quotaCard'), children })
    }

    function CatalogCard(props) {
      const catalog = props.catalog
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
        extra: catalog === undefined || catalog.nextSyncAt === undefined ? undefined : h(Countdown, { nextSyncAt: catalog.nextSyncAt }),
        children,
      })
    }

    function TakoConsolePage() {
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

      const children = [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '4px 0 18px' } },
          h('h1', { style: { margin: 0, fontSize: '20px', fontWeight: 500, lineHeight: '28px' } }, t('consoleTitle')),
          status !== undefined && status.configured && status.maskedKey
            ? h('span', { 'data-testid': 'dsh-tako-console-key', style: { ...mono, fontSize: '0.85em', color: 'var(--dsw-alias-label-secondary)', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm)', padding: '2px 8px' } }, status.maskedKey)
            : null),
      ]
      if (statusError !== undefined) {
        children.push(h('div', { key: 'err', role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '0.9em', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          `${t('loadFailed')}: ${statusError}`,
          h('button', { type: 'button', onClick: () => { void loadStatus(); void loadCatalog() }, style: quietButton }, t('retry'))))
      }
      children.push(AccountCard({ status, login, busyLogout, onLogout: logout, logoutNote }))
      children.push(QuotaCard({ status }))
      children.push(CatalogCard({ catalog, error: catalogError }))
      return h('div', {
        'data-testid': 'dsh-tako-console-page',
        style: { height: '100%', minHeight: 0, overflowY: 'auto', background: 'var(--dsw-alias-bg-base)', fontSize: '14px', lineHeight: '22px' },
      },
        h('div', { style: { maxWidth: '860px', margin: '0 auto', padding: '28px 24px 48px' } }, children))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
          name: 'settings.models.provider-card',
          key: PI_AI_NS,
        }, TakoSignIn))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, TakoConsolePage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
        }, TakoPanelIcon))
      },
    }
  },
})
