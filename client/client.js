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
    const KEY_ROUTE = 'api/tako.key'
    const LOGS_ROUTE = 'api/tako.logs'
    const USAGE_ROUTE = 'api/tako.usage'
    const NOTICE_ROUTE = 'api/tako.notice'
    const CONFIG_ROUTE = 'api/tako.config'
    const SYNC_ROUTE = 'api/tako.sync'
    /** New 0.6 console routes require this running Host protocol. */
    const CONSOLE_API_VERSION = 2
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
        consoleTitle: 'Tako',
        accountCard: '登录状态',
        signedIn: '已登录',
        signedOut: '未登录',
        signedOutLead: '登录后，额度、模型和搜索会跟这把钥匙走',
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
        catalogCard: '模型',
        catalogModel: '模型',
        catalogContext: '上下文窗口',
        catalogVision: '图片输入',
        visionBadge: '图',
        yes: '支持',
        no: '不支持',
        catalogDefault: '默认',
        catalogEmpty: '目录尚未同步；插件正在获取 Tako 的公开目录',
        catalogSyncing: '正在同步目录',
        catalogRetrying: '目录同步未完成，正在等待重试',
        catalogFailed: '目录同步失败',
        catalogAttempts: '已尝试 {count} 次',
        catalogReadAgain: '刷新目录状态',
        catalogDirectoryError: '暂时无法获取模型目录',
        catalogSettingsError: '模型设置尚未就绪',
        catalogWriteError: '模型设置写入未完成',
        catalogTransactionError: '运行时重载事务冲突；若重试仍失败，请重启 dsh',
        catalogReadOnlyError: '当前 profile 为只读，模型设置未写入',
        catalogEmptyError: '过滤后没有可用的聊天模型',
        catalogMore: '其余 {count} 个',
        catalogLess: '收起',
        refreshIn: '约 {minutes} 分钟后刷新',
        refreshSoon: '即将刷新',
        refreshOnlyAtStartup: '只在启动时刷新',
        loadFailed: '加载失败',
        retry: '重试',
        consoleRestartRequired: '控制台已更新，但 Host 仍在运行旧版插件。请重启 dsh 后使用全部功能。',
        // update card
        updateCard: '更新',
        updateAvailable: '有新版本',
        updateCommand: '升级命令（升级后重启 dsh 生效）:',
        upToDate: '已是最新版本 {version}',
        pluginVersion: '插件 {version}',
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
        servicesCard: 'Tako 服务',
        serviceConsole: '控制台',
        servicePricing: '模型广场',
        serviceWallet: '钱包',
        serviceSubscriptions: '订阅',
        serviceDocs: '文档',
        openInTako: '在 Tako 打开',
        managePlan: '管理订阅',
        topUp: '充值',
        plazaLink: '在广场查看',
        // api key editor
        keyCard: 'API key',
        keyHint: '浏览器登录不方便（远程机器、SSH、没有浏览器）时，可以直接粘贴 key',
        keyOrPaste: '或直接粘贴 API key：',
        keyConfigured: '已配置',
        keyMissing: '未配置',
        keyPlaceholder: '粘贴 Tako API key（cr_…）',
        keySave: '保存并验证',
        keySaving: '验证中…',
        keySaved: 'API key 已保存，账号信息已刷新',
        keyInvalid: 'key 校验失败',
        keyClear: '清除本地 key',
        keyClearing: '清除中…',
        keyCleared: '已从 dsh 凭据中删除',
        keyClearExternal: '这个 key 来自环境变量或 .env，插件不会删除；请在对应位置移除',
        keyClearNone: '没有已保存的 Tako key',
        keyShow: '显示',
        keyHide: '隐藏',
        keySource: '来源',
        endpointLabel: '接口',
        credentialLabel: '凭据',
        // catalog toolbar
        catalogSummary: '共 {count} 个 · 视觉 {vision} · 长上下文 {long} · 推理 {reasoning}',
        catalogSearch: '搜索模型名…',
        catalogFilterAll: '全部',
        catalogFilterVision: '视觉',
        catalogFilterLong: '长上下文',
        catalogFilterReasoning: '推理',
        catalogNoMatch: '没有匹配的模型',
        catalogShown: '显示 {shown} / {total}',
        catalogReasoningBadge: '推理',
        // console tabs
        tabOverview: '概览',
        tabRequests: '请求',
        tabUsage: '用量',
        tabModels: '模型',
        tabKey: '密钥',
        tabConfig: '配置',
        // diagnostics
        diagCopy: '复制诊断',
        diagCopied: '已复制',
        // announcements
        noticeDismiss: '知道了',
        noticeTitle: '公告',
        noticeEmpty: '暂无公告',
        noticeExpand: '展开',
        noticeCollapse: '收起',
        // model cards
        cardChannels: '渠道',
        cardEndpoints: '端点',
        cardStandard: '标准',
        cardRealized: '实测',
        cardOutputRatio: '输出倍率',
        cardClaude: 'ClaudeCode',
        // request logs
        logsEmpty: '这把 key 还没有请求记录',
        logsNeedLogin: '登录后可查看这把 key 的请求记录',
        logsModel: '全部模型',
        logsRefresh: '刷新',
        logsLoading: '加载中…',
        logsColTime: '时间',
        logsColModel: '模型',
        logsColIn: '输入',
        logsColOut: '输出',
        logsColCost: '花费',
        logsColDuration: '耗时',
        logsColRequest: '请求',
        logTypeTopup: '充值',
        logTypeConsume: '消费',
        logTypeManage: '管理',
        logTypeSystem: '系统',
        logTypeError: '错误',
        logTypeRefund: '退款',
        logTypeLogin: '登录',
        // usage
        usageToday: '今日花费',
        usageTokenCard: '密钥额度',
        usageGranted: '总额度',
        usageUsed: '已用',
        usageAvailable: '可用',
        usageUnlimited: '不限额度',
        usageExpires: '到期',
        usageNever: '永不',
        usageModelLimits: '模型白名单',
        usageNoLimits: '全部模型',
        usagePerModel: '按模型（今日）',
        usageRequests: '{count} 次',
        // key tab
        keyTokenCard: '密钥详情',
        keyName: '名称',
        keyExpires: '到期时间',
        keyModels: '可用模型',
        // sync
        syncNow: '立即同步',
        syncWorking: '同步中…',
        syncFailed: '同步触发失败',
        // pin
        pinTitle: '置顶',
        unpinTitle: '取消置顶',
        pinFailed: '置顶保存失败',
        // config tab
        configSave: '保存',
        configSaving: '保存中…',
        configSaved: '已保存',
        configFailed: '保存失败',
        configReadOnly: '当前 profile 为只读，配置不可修改',
        configRetryDelays: '失败快速重试延迟（毫秒，逗号分隔）',
        configRefresh: '目录刷新间隔（分钟，0 为仅启动时）',
        configDefaultCtx: '默认上下文窗口',
        configClaudeOnly: '包含仅 Claude Code 客户端的模型',
        configInclude: '只保留（逗号分隔，* 通配）',
        configExclude: '排除（逗号分隔，* 通配）',
        configPinnedField: '置顶模型（逗号分隔）',
        configSearchProvider: '联网搜索',
        configSearchTako: 'Tako',
        configSearchDefault: '官方默认',
        configOverrides: '模型覆盖（只读）',
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
        consoleTitle: 'Tako',
        accountCard: 'Sign-in status',
        signedIn: 'Signed in',
        signedOut: 'Not signed in',
        signedOutLead: 'Sign in and quota, models, and search follow this key',
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
        catalogCard: 'Models',
        catalogModel: 'Model',
        catalogContext: 'Context window',
        catalogVision: 'Image input',
        visionBadge: 'img',
        yes: 'Yes',
        no: 'No',
        catalogDefault: 'default',
        catalogEmpty: 'The catalog has not synced yet; the plugin is fetching Tako\'s public directory',
        catalogSyncing: 'Syncing the catalog',
        catalogRetrying: 'Catalog sync has not completed; waiting to retry',
        catalogFailed: 'Catalog sync failed',
        catalogAttempts: '{count} attempts',
        catalogReadAgain: 'Refresh catalog status',
        catalogDirectoryError: 'The model directory could not be retrieved',
        catalogSettingsError: 'Model settings are not ready',
        catalogWriteError: 'The model settings write did not complete',
        catalogTransactionError: 'Runtime reload transaction conflict; restart dsh if retries keep failing',
        catalogReadOnlyError: 'The profile is read-only; model settings were not written',
        catalogEmptyError: 'No chat models remain after filtering',
        catalogMore: '{count} more',
        catalogLess: 'Show less',
        refreshIn: 'refreshes in ~{minutes} min',
        refreshSoon: 'refreshing soon',
        refreshOnlyAtStartup: 'refreshed at startup only',
        loadFailed: 'Could not load',
        retry: 'Retry',
        consoleRestartRequired: 'The console was updated while the Host is still running the previous plugin. Restart dsh to use every feature.',
        // update card
        updateCard: 'Update',
        updateAvailable: 'Update available:',
        updateCommand: 'Upgrade command (restart dsh after upgrading):',
        upToDate: 'Up to date: {version}',
        pluginVersion: 'Plugin {version}',
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
        servicesCard: 'Tako services',
        serviceConsole: 'Dashboard',
        servicePricing: 'Model plaza',
        serviceWallet: 'Wallet',
        serviceSubscriptions: 'Subscriptions',
        serviceDocs: 'Docs',
        openInTako: 'Open in Tako',
        managePlan: 'Manage plan',
        topUp: 'Top up',
        plazaLink: 'View in plaza',
        // api key editor
        keyCard: 'API key',
        keyHint: 'Paste a key directly when the browser sign-in is impractical (remote host, SSH, no browser)',
        keyOrPaste: 'Or paste an API key:',
        keyConfigured: 'configured',
        keyMissing: 'not configured',
        keyPlaceholder: 'Paste a Tako API key (cr_…)',
        keySave: 'Save and verify',
        keySaving: 'Verifying…',
        keySaved: 'API key saved; the account view has been refreshed',
        keyInvalid: 'The key was rejected',
        keyClear: 'Remove the local key',
        keyClearing: 'Removing…',
        keyCleared: 'Removed from the dsh credentials',
        keyClearExternal: 'This key comes from an environment variable or .env; remove it there instead',
        keyClearNone: 'No Tako key is stored',
        keyShow: 'Show',
        keyHide: 'Hide',
        keySource: 'source',
        endpointLabel: 'endpoint',
        credentialLabel: 'credential',
        // catalog toolbar
        catalogSummary: '{count} models · {vision} vision · {long} long-context · {reasoning} reasoning',
        catalogSearch: 'Filter by model name…',
        catalogFilterAll: 'All',
        catalogFilterVision: 'Vision',
        catalogFilterLong: 'Long context',
        catalogFilterReasoning: 'Reasoning',
        catalogNoMatch: 'No models match',
        catalogShown: 'showing {shown} / {total}',
        catalogReasoningBadge: 'reasoning',
        // console tabs
        tabOverview: 'Overview',
        tabRequests: 'Requests',
        tabUsage: 'Usage',
        tabModels: 'Models',
        tabKey: 'Key',
        tabConfig: 'Settings',
        // diagnostics
        diagCopy: 'Copy diagnostics',
        diagCopied: 'Copied',
        // announcements
        noticeDismiss: 'Dismiss',
        noticeTitle: 'Announcements',
        noticeEmpty: 'No announcements',
        noticeExpand: 'Expand',
        noticeCollapse: 'Collapse',
        // model cards
        cardChannels: 'channels',
        cardEndpoints: 'endpoints',
        cardStandard: 'std',
        cardRealized: 'realized',
        cardOutputRatio: 'out',
        cardClaude: 'ClaudeCode',
        // request logs
        logsEmpty: 'This key has no requests yet',
        logsNeedLogin: 'Sign in to see this key\'s requests',
        logsModel: 'All models',
        logsRefresh: 'Refresh',
        logsLoading: 'Loading…',
        logsColTime: 'Time',
        logsColModel: 'Model',
        logsColIn: 'In',
        logsColOut: 'Out',
        logsColCost: 'Cost',
        logsColDuration: 'Time',
        logsColRequest: 'Request',
        logTypeTopup: 'top-up',
        logTypeConsume: 'consume',
        logTypeManage: 'manage',
        logTypeSystem: 'system',
        logTypeError: 'error',
        logTypeRefund: 'refund',
        logTypeLogin: 'login',
        // usage
        usageToday: 'Spent today',
        usageTokenCard: 'Key credit',
        usageGranted: 'Granted',
        usageUsed: 'Used',
        usageAvailable: 'Available',
        usageUnlimited: 'Unlimited',
        usageExpires: 'Expires',
        usageNever: 'Never',
        usageModelLimits: 'Model allowlist',
        usageNoLimits: 'All models',
        usagePerModel: 'Per model (today)',
        usageRequests: '{count} req',
        // key tab
        keyTokenCard: 'Key details',
        keyName: 'Name',
        keyExpires: 'Expires',
        keyModels: 'Models',
        // sync
        syncNow: 'Sync now',
        syncWorking: 'Syncing…',
        syncFailed: 'Could not trigger a sync',
        // pin
        pinTitle: 'Pin',
        unpinTitle: 'Unpin',
        pinFailed: 'Could not save the pins',
        // config tab
        configSave: 'Save',
        configSaving: 'Saving…',
        configSaved: 'Saved',
        configFailed: 'Could not save',
        configReadOnly: 'The profile is read-only; settings cannot be changed',
        configRetryDelays: 'Fast retry delays after failures (ms, comma-separated)',
        configRefresh: 'Catalog refresh interval (minutes, 0 = startup only)',
        configDefaultCtx: 'Default context window',
        configClaudeOnly: 'Include Claude-Code-only models',
        configInclude: 'Include only (comma-separated, * wildcards)',
        configExclude: 'Exclude (comma-separated, * wildcards)',
        configPinnedField: 'Pinned models (comma-separated)',
        configSearchProvider: 'Web search',
        configSearchTako: 'Tako',
        configSearchDefault: 'Official default',
        configOverrides: 'Model overrides (read-only)',
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
    // Desktop serves the workbench at dsh-app://app, so hostname is "app", not
    // 127.0.0.1. The host is still this machine; the preload marks that profile.
    const loopback = () => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(window.location.hostname)
      || window.__DSH_TAKO_PROFILE__ === true
    // A relative "api/..." URL misses the host when the page path is nested.
    const hostPath = route => route.charAt(0) === '/' ? route : `/${route}`
    const notifyCredential = () => {
      try { window.dispatchEvent(new Event('dsh-tako-credential')) } catch {}
    }

    async function call(method, route, body, signal) {
      const init = { method, headers: { accept: 'application/json' }, cache: 'no-store', signal }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(hostPath(route), init)
      let data
      try { data = await response.json() } catch { data = undefined }
      if (data === undefined) throw new Error(`HTTP ${response.status}`)
      return data
    }

    /** Read the lightweight catalog route to classify the running Host before exposing 0.6-only controls. */
    function useConsoleApiVersion() {
      const [version, setVersion] = useState(undefined)
      useEffect(() => {
        let alive = true
        let timer
        const probe = async () => {
          try {
            const value = await call('GET', CATALOG_ROUTE)
            if (alive) setVersion(value && value.consoleApiVersion === CONSOLE_API_VERSION ? CONSOLE_API_VERSION : 0)
          } catch {
            // Transport failure is not evidence of an old Host. Keep safe controls visible and retry locally.
            if (alive) timer = setTimeout(probe, 2000)
          }
        }
        void probe()
        return () => { alive = false; clearTimeout(timer) }
      }, [])
      return version
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
            const next = await fetch(`${hostPath(ROUTE)}?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(r => r.json())
            if (!alive.current) return
            if (next.status === 'pending') { setState(next); poll(id); return }
            const settled = next.status === 'idle' ? { status: 'error', code: 'failed', message: 'sign-in no longer pending' } : next
            setState(settled)
            if (settled.status === 'success') notifyCredential()
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
          } else if (typeof started.url === 'string' && started.url !== '') {
            // Desktop denies about:blank, then opens http(s) in the system browser.
            window.open(started.url, '_blank')
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

    /**
     * Compact "paste a key" row for the Models-page provider card, so a key
     * can be configured without the browser round trip. Same host route as the
     * console page's key editor.
     */
    function PasteKeyRow(props) {
      const t = props.t ?? fallbackT
      const [value, setValue] = useState('')
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      const save = async () => {
        const key = value.trim()
        if (key === '' || busy) return
        setBusy(true)
        setNote(undefined)
        try {
          const result = await call('POST', KEY_ROUTE, { key })
          if (!alive.current) return
          if (result !== undefined && result.ok === true) {
            setValue('')
            setNote({ tone: 'ok', text: t('keySaved') })
            notifyCredential()
          } else {
            const detail = result === undefined ? 'unknown' : (result.message || result.code || 'unknown')
            setNote({ tone: 'error', text: `${t('keyInvalid')}: ${detail}` })
          }
        } catch (error) {
          if (alive.current) setNote({ tone: 'error', text: `${t('keyInvalid')}: ${String(error && error.message || error)}` })
        } finally {
          if (alive.current) setBusy(false)
        }
      }
      const children = [
        h('div', { key: 'label', style: { fontSize: '0.85em', opacity: 0.72 } }, t('keyOrPaste')),
        h('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            key: 'input',
            type: 'password',
            value,
            placeholder: t('keyPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            'data-testid': 'dsh-tako-paste-key-input',
            onChange: event => setValue(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') void save() },
            style: { font: 'inherit', padding: '4px 8px', borderRadius: '6px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', minWidth: '220px', flex: '1 1 220px' },
          }),
          h('button', {
            key: 'save',
            type: 'button',
            disabled: busy || value.trim() === '',
            onClick: save,
            'data-testid': 'dsh-tako-paste-key-save',
            style: { font: 'inherit', padding: '4px 12px', borderRadius: '6px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: busy || value.trim() === '' ? 'default' : 'pointer', opacity: busy || value.trim() === '' ? 0.5 : 1 },
          }, busy ? t('keySaving') : t('keySave'))),
      ]
      if (note !== undefined) {
        children.push(h('div', {
          key: 'note',
          role: note.tone === 'error' ? 'alert' : 'status',
          style: {
            fontSize: '0.85em',
            overflowWrap: 'anywhere',
            color: note.tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)',
          },
        }, note.text))
      }
      return h('div', { 'data-testid': 'dsh-tako-paste-key', style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, children)
    }

    function TakoSignIn(props) {
      const provider = props.provider
      const t = props.t ?? fallbackT
      const login = useTakoLogin()
      const consoleApiVersion = useConsoleApiVersion()
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
      if (consoleApiVersion === CONSOLE_API_VERSION) children.push(h(PasteKeyRow, { key: 'paste', t }))
      else if (consoleApiVersion === 0) children.push(h('div', {
        key: 'restart-required', role: 'alert', 'data-testid': 'dsh-tako-sign-in-restart-required',
        style: { fontSize: '0.85em', color: 'var(--dsw-alias-state-warn-primary)' },
      }, t('consoleRestartRequired')))
      return h('div', { 'data-dsh-tako': 'sign-in', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } }, children)
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
      const kicker = props.title === undefined && props.extra === undefined
        ? null
        : h('div', { className: 'dsh-tako-kicker' },
          props.title,
          props.extra === undefined ? null : h('span', { className: 'dsh-tako-extra' }, props.extra))
      return h('section', { 'data-dsh-tako-card': props.name, className: 'dsh-tako-section' },
        kicker,
        h('div', { className: 'dsh-tako-body' }, props.children))
    }

    const DEFAULT_TAKO_ORIGIN = 'https://tako.shiroha.tech'

    /** The Tako origin the host reported, or the public site for hosts that predate the field. */
    const takoOrigin = status => {
      const origin = status !== undefined && typeof status.origin === 'string' ? status.origin.replace(/\/+$/, '') : ''
      return origin === '' ? DEFAULT_TAKO_ORIGIN : origin
    }

    function TakoChip(props) {
      return h('a', {
        href: props.href,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: props.className === undefined ? 'dsh-tako-chip' : `dsh-tako-chip ${props.className}`,
      }, props.label, h('span', { className: 'arrow', 'aria-hidden': true }, '↗'))
    }

    /** Quick jumps into the Tako site, so the console is a door into the service, not a dead end. */
    function ServicesCard(props) {
      const t = props.t ?? fallbackT
      const origin = props.origin
      const items = [
        ['serviceConsole', '/dashboard'],
        ['servicePricing', '/pricing'],
        ['serviceWallet', '/wallet'],
        ['serviceSubscriptions', '/subscriptions'],
        ['serviceDocs', '/docs'],
      ]
      return Card({
        name: 'services',
        title: t('servicesCard'),
        children: [h('div', { key: 'links', className: 'dsh-tako-links' },
          items.map(([key, path]) => h(TakoChip, { key, href: origin + path, label: t(key) })))],
      })
    }

    function ensureTakoTheme() {
      if (typeof document.getElementById !== 'function') return
      const css = [
        '.dsh-tako-sheet{display:flex;flex-direction:column;gap:14px;max-width:780px;margin:0 auto;padding:20px 24px 56px}',
        '.dsh-tako-head{display:flex;align-items:flex-start;gap:12px}',
        '.dsh-tako-head h1{margin:0;font-size:22px;font-weight:500;letter-spacing:0.04em}',
        '.dsh-tako-hero{display:flex;align-items:center;gap:14px;padding:4px 2px 2px}',
        '.dsh-tako-hero-name{display:flex;align-items:baseline;gap:10px;min-width:0;flex-wrap:wrap}',
        '.dsh-tako-hero-name h1{margin:0;font-size:20px;font-weight:600;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-tako-hero-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
        '.dsh-tako-hero-spacer{flex:1}',
        '.dsh-tako-sub{font-size:13px;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-kicker{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-extra{letter-spacing:0;text-transform:none;font-size:12px}',
        '.dsh-tako-body{display:flex;flex-direction:column;gap:10px;margin-top:8px}',
        '.dsh-tako-tentacle{display:block;width:100%;height:10px}',
        // tab bar + cards + shared primitives
        '.dsh-tako-section{background:var(--dsw-alias-settings-card-fill);border:0.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl,20px);padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
        '.dsh-tako-tabs{display:flex;gap:2px;border-bottom:0.5px solid var(--dsw-alias-border-l2);margin:2px 0 4px;overflow-x:auto}',
        '.dsh-tako-tab{font:inherit;font-size:13px;padding:7px 12px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
        '.dsh-tako-tab:hover{color:var(--dsw-alias-label-primary)}',
        '.dsh-tako-tab[data-active="true"]{color:' + CLAY + ';border-bottom-color:' + CLAY + '}',
        '.dsh-tako-btn{font:inherit;font-size:13px;padding:4px 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
        '.dsh-tako-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-tako-btn:disabled{opacity:0.5;cursor:default}',
        '.dsh-tako-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-button-primary-foreground);border-color:transparent}',
        '.dsh-tako-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill))}',
        '.dsh-tako-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
        '.dsh-tako-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-tako-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}',
        '.dsh-tako-table th{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);font-weight:500;text-align:left;padding:6px 8px 6px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);white-space:nowrap}',
        '.dsh-tako-table td{padding:6px 8px 6px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);vertical-align:top;white-space:nowrap}',
        '.dsh-tako-table td.w{white-space:normal;overflow-wrap:anywhere}',
        '.dsh-tako-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-tako-table .m{font-family:ui-monospace,"IBM Plex Mono",monospace;max-width:140px;overflow:hidden;text-overflow:ellipsis}',
        '.dsh-tako-pill{display:inline-flex;align-items:center;font-size:10px;padding:1px 7px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none;letter-spacing:0.04em}',
        '.dsh-tako-pill[data-tone="warn"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
        '.dsh-tako-pill[data-tone="error"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
        '.dsh-tako-pill[data-tone="ok"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
        '.dsh-tako-pill[data-tone="clay"]{border-color:' + CLAY + ';color:' + CLAY + '}',
        '.dsh-tako-notice{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-radius:12px;border:0.5px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary);font-size:13px}',
        '.dsh-tako-notice>div{flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}',
        '.dsh-tako-notice button{flex:none}',
        '.dsh-tako-notices{display:flex;flex-direction:column;gap:8px}',
        '.dsh-tako-notice-item{padding:10px 14px;border-radius:12px;border:0.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);font-size:13px;transition:border-color .15s ease}',
        '.dsh-tako-notice-item:hover{border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}',
        '.dsh-tako-notice-item>summary{display:flex;gap:10px;align-items:center;cursor:pointer;list-style:none;user-select:none}',
        '.dsh-tako-notice-item>summary::-webkit-details-marker{display:none}',
        '.dsh-tako-notice-item[open]>summary{margin-bottom:6px}',
        '.dsh-tako-notice-item>summary>button{margin-left:auto;flex:none}',
        '.dsh-tako-notice-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-notice-dot[data-tone="info"]{background:var(--dsw-alias-state-info-primary,#3b82f6)}',
        '.dsh-tako-notice-dot[data-tone="success"]{background:var(--dsw-alias-state-success-primary)}',
        '.dsh-tako-notice-dot[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}',
        '.dsh-tako-notice-dot[data-tone="error"]{background:var(--dsw-alias-state-error-primary)}',
        '.dsh-tako-notice-preview{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
        '.dsh-tako-notice-date{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
        '.dsh-tako-notice-body{font-size:13px;line-height:1.6;overflow-wrap:anywhere}',
        '.dsh-tako-notice-body h4{margin:6px 0 2px;font-size:13px;font-weight:600}',
        '.dsh-tako-notice-body ul{margin:2px 0;padding-left:18px}',
        '.dsh-tako-notice-body code{font-family:ui-monospace,"IBM Plex Mono",monospace;font-size:12px;background:var(--dsw-alias-interactive-bg-hover);padding:0 4px;border-radius:4px}',
        '.dsh-tako-notice-body a{color:' + CLAY + '}',
        '.dsh-tako-notice-x{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
        // model cards
        '.dsh-tako-model-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
        '@media (max-width:560px){.dsh-tako-model-grid{grid-template-columns:1fr}}',
        '.dsh-tako-model-card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:14px;border:0.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-settings-card-fill));cursor:pointer;transition:border-color .15s ease;min-width:0}',
        '.dsh-tako-model-card:hover{border-color:' + CLAY + '}',
        '.dsh-tako-model-card[data-pinned="true"]{border-color:' + CLAY + '}',
        '.dsh-tako-model-card-top{display:flex;gap:10px;align-items:center;min-width:0}',
        '.dsh-tako-model-card-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,"IBM Plex Mono",monospace;font-size:13px;font-weight:500}',
        '.dsh-tako-model-card-vendor{flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:' + CLAY + ';background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l2)}',
        '.dsh-tako-model-card-desc{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-tako-model-card-pills{display:flex;gap:4px;flex-wrap:wrap}',
        '.dsh-tako-model-card-price{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;font-variant-numeric:tabular-nums}',
        '.dsh-tako-model-card-price b{font-weight:500;color:' + CLAY + '}',
        '.dsh-tako-model-card-foot{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:6px;flex-wrap:wrap;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-tako-field{display:flex;gap:14px;align-items:baseline;padding:7px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
        '.dsh-tako-field:last-of-type{border-bottom:none}',
        '.dsh-tako-field>label{flex:none;width:210px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
        '.dsh-tako-field>.v{flex:1;min-width:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.dsh-tako-check{display:flex;gap:8px;align-items:center;font-size:13px}',
        '.dsh-tako-code{font-family:ui-monospace,"IBM Plex Mono",monospace;font-size:12px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);overflow:auto;white-space:pre;max-height:160px}',
        '.dsh-tako-bar>i[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}',
        '.dsh-tako-bar>i[data-tone="error"]{background:var(--dsw-alias-state-error-primary)}',
        '.dsh-tako-stamp .n[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}',
        '.dsh-tako-stamp .n[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
        // unchanged primitives
        '.dsh-tako-stamps{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 28px}',
        '.dsh-tako-stamps-3{grid-template-columns:repeat(3,minmax(0,1fr))}',
        '.dsh-tako-stamp .n{font-variant-numeric:tabular-nums;font-size:22px;font-weight:500;line-height:28px}',
        '.dsh-tako-stamp .n small{font-size:13px;font-weight:400;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-model{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;margin:0 -10px;border-radius:8px;transition:background .15s ease}',
        '.dsh-tako-model:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-tako-model a{color:inherit;text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-tako-model a:hover{color:' + CLAY + '}',
        '.dsh-tako-pin{flex:none;font:inherit;font-size:13px;padding:2px 5px;border:none;background:transparent;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary));cursor:pointer;line-height:1}',
        '.dsh-tako-pin[data-active="true"]{color:' + CLAY + '}',
        '.dsh-tako-links{display:flex;flex-wrap:wrap;gap:8px}',
        '.dsh-tako-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:inherit;text-decoration:none;font-size:12px;line-height:18px;transition:border-color .15s ease,color .15s ease}',
        '.dsh-tako-chip:hover{border-color:' + CLAY + ';color:' + CLAY + '}',
        '.dsh-tako-chip .arrow{opacity:.45;font-size:11px}',
        '.dsh-tako-chip[data-active="true"]{border-color:' + CLAY + ';color:' + CLAY + '}',
        '.dsh-tako-status{display:inline-flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);display:inline-block}',
        '.dsh-tako-dot.on{background:var(--dsw-alias-state-success-primary)}',
        '.dsh-tako-plan{display:inline-flex;align-items:center;padding:1px 8px;border:0.5px solid ' + CLAY + ';border-radius:999px;color:' + CLAY + ';font-size:11px;line-height:18px;letter-spacing:0}',
        '.dsh-tako-primary{font:inherit;padding:5px 14px;border:0.5px solid ' + CLAY + ';border-radius:999px;background:' + CLAY + ';color:#fff;cursor:pointer;transition:opacity .15s ease}',
        '.dsh-tako-primary:hover{opacity:.88}',
        '.dsh-tako-ghost{font:inherit;padding:5px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:inherit;cursor:pointer;transition:border-color .15s ease,color .15s ease}',
        '.dsh-tako-ghost:hover{border-color:' + CLAY + ';color:' + CLAY + '}',
        '.dsh-tako-cardfoot{display:flex;gap:14px;flex-wrap:wrap;margin-top:4px}',
        '.dsh-tako-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-tako-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
        '.dsh-tako-input{font:inherit;font-size:13px;padding:5px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;min-width:0;flex:1 1 160px}',
        '.dsh-tako-input:focus{outline:none;border-color:' + CLAY + '}',
        '.dsh-tako-input:disabled{opacity:0.5}',
        '.dsh-tako-select{font:inherit;font-size:13px;padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}',
        '.dsh-tako-summary{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
        '.dsh-tako-tag{font-size:11px;padding:1px 6px;border-radius:4px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none}',
        '.dsh-tako-badge{font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:' + CLAY + '}',
        '.dsh-tako-footer{display:flex;align-items:center;gap:10px;width:100%;padding:6px 2px;border:none;background:transparent;color:inherit;text-align:left;cursor:pointer}',
        '.dsh-tako-footer .frac{font-variant-numeric:tabular-nums;font-size:13px;font-weight:500}',
        '.dsh-tako-footer .k{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-tako-ink{color:' + CLAY + '}',
        '.dsh-tako-bar{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
        '.dsh-tako-bar>i{display:block;height:100%;background:' + CLAY + ';border-radius:inherit}',
        '.dsh-tako-footer-bar{height:4px;width:100%;margin-top:3px}',
      ].join('')
      // Replace the rules when they changed: a hot-reloaded client must not keep
      // the stylesheet an older bundle installed under the same id.
      let style = document.getElementById('dsh-tako-theme')
      if (style === null) {
        style = document.createElement('style')
        style.id = 'dsh-tako-theme'
        document.head.appendChild(style)
      }
      if (style.textContent !== css) style.textContent = css
    }

    /** Compact context windows: 1_000_000 → 1M, 1_050_000 → 1.05M, 272_000 → 272K. */
    const compactContext = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const scaled = (n, suffix) => `${Math.round(n * 100) / 100}${suffix}`
      if (Math.abs(value) >= 1_000_000) return scaled(value / 1_000_000, 'M')
      if (Math.abs(value) >= 1_000) return scaled(value / 1_000, 'K')
      return value.toLocaleString()
    }

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
      if (nextSyncAt === null || nextSyncAt === undefined) {
        if (props.refreshIntervalMs > 0) return t('refreshIn', { minutes: Math.ceil(props.refreshIntervalMs / 60000) })
        if (props.lastSyncAt === null && props.refreshIntervalMs === undefined) return t('catalogSyncing')
        return t('refreshOnlyAtStartup')
      }
      const minutes = Math.ceil(Math.max(0, nextSyncAt - Date.now()) / 60000)
      return minutes <= 0 ? t('refreshSoon') : t('refreshIn', { minutes })
    }

    /**
     * Paste-a-key fallback for the browser sign-in: the host verifies the key
     * against `/api/desktop/me` before storing it, so a typo cannot silently
     * break the route. The input is cleared once the key is accepted; the
     * displayed value always comes back masked from `/api/tako.status`.
     */
    function KeyEditor(props) {
      const t = props.t ?? fallbackT
      const configured = props.status !== undefined && props.status.configured === true
      const [value, setValue] = useState('')
      const [reveal, setReveal] = useState(false)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])

      const save = async () => {
        const key = value.trim()
        if (key === '' || busy) return
        setBusy(true)
        setNote(undefined)
        try {
          const result = await call('POST', KEY_ROUTE, { key })
          if (!alive.current) return
          if (result !== undefined && result.ok === true) {
            setValue('')
            setNote({ tone: 'ok', text: t('keySaved') })
            props.onChanged?.()
          } else {
            const detail = result === undefined ? 'unknown' : (result.message || result.code || 'unknown')
            setNote({ tone: 'error', text: `${t('keyInvalid')}: ${detail}` })
          }
        } catch (error) {
          if (alive.current) setNote({ tone: 'error', text: `${t('keyInvalid')}: ${String(error && error.message || error)}` })
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const clear = async () => {
        if (busy) return
        setBusy(true)
        setNote(undefined)
        try {
          const result = await call('POST', KEY_ROUTE, { action: 'clear' })
          if (!alive.current) return
          const action = result === undefined ? 'none' : result.action
          if (action === 'removed') setNote({ tone: 'ok', text: t('keyCleared') })
          else if (action === 'external') setNote({ tone: 'muted', text: t('keyClearExternal') })
          else if (action === 'not-configured') setNote({ tone: 'muted', text: t('keyClearNone') })
          else setNote({ tone: 'error', text: `${t('failed')}: ${result && result.message ? result.message : 'unknown'}` })
          if (action === 'removed' || action === 'external') props.onChanged?.()
        } catch (error) {
          if (alive.current) setNote({ tone: 'error', text: `${t('failed')}: ${String(error && error.message || error)}` })
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const input = h('input', {
        key: 'input',
        type: reveal ? 'text' : 'password',
        value,
        placeholder: t('keyPlaceholder'),
        autoComplete: 'off',
        spellCheck: false,
        'data-testid': 'dsh-tako-key-input',
        onChange: event => setValue(event.target.value),
        onKeyDown: event => { if (event.key === 'Enter') void save() },
        className: 'dsh-tako-input',
      })
      const row = h('div', { key: 'row', className: 'dsh-tako-toolbar' },
        input,
        h('button', { key: 'toggle', type: 'button', onClick: () => setReveal(v => !v), style: quietButton, 'data-testid': 'dsh-tako-key-toggle' }, reveal ? t('keyHide') : t('keyShow')),
        h('button', {
          key: 'save',
          type: 'button',
          disabled: busy || value.trim() === '',
          onClick: save,
          'data-testid': 'dsh-tako-key-save',
          style: { ...buttonStyle, opacity: busy || value.trim() === '' ? 0.5 : 1 },
        }, busy ? t('keySaving') : t('keySave')),
        configured
          ? h('button', { key: 'clear', type: 'button', disabled: busy, onClick: clear, 'data-testid': 'dsh-tako-key-clear', style: { ...quietButton, color: 'var(--dsw-alias-state-error-primary)' } }, busy ? t('keyClearing') : t('keyClear'))
          : null)

      const children = [
        h('div', { key: 'head', className: 'dsh-tako-kicker' },
          t('keyCard'),
          h('span', { className: 'dsh-tako-extra' }, configured ? t('keyConfigured') : t('keyMissing'))),
        row,
        h('div', { key: 'hint', className: 'dsh-tako-sub' }, t('keyHint')),
      ]
      if (note !== undefined) {
        children.push(h('div', {
          key: 'note',
          role: note.tone === 'error' ? 'alert' : 'status',
          'data-testid': 'dsh-tako-key-note',
          style: {
            fontSize: '0.85em',
            overflowWrap: 'anywhere',
            color: note.tone === 'error'
              ? 'var(--dsw-alias-state-error-primary)'
              : note.tone === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)',
          },
        }, note.text))
      }
      return h('div', { 'data-dsh-tako-card': 'key', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', paddingTop: '12px', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } }, children)
    }

    function AccountCard(props) {
      const status = props.status
      const login = props.login
      const t = props.t ?? fallbackT
      const configured = status !== undefined && status.configured === true
      const compact = props.compact === true
      const userName = configured && status.me && status.me.userName ? status.me.userName : t('consoleTitle')
      const planName = configured && status.me && status.me.planName ? status.me.planName : undefined
      const maskedKey = configured && status.maskedKey ? status.maskedKey : undefined
      const body = compact ? [] : [h('h1', { key: 'h' }, userName)]
      if (!compact) body.push(h('div', { key: 'status', className: 'dsh-tako-status' },
        h('span', { className: configured ? 'dsh-tako-dot on' : 'dsh-tako-dot', 'aria-hidden': true }),
        configured ? t('signedIn') : t('signedOut'),
        planName === undefined ? null : h('span', { className: 'dsh-tako-plan' }, planName)))
      if (status !== undefined && !configured) {
        body.push(h('div', { key: 'lead', className: 'dsh-tako-sub' }, t('signedOutLead')))
      } else if (maskedKey !== undefined && !compact) {
        body.push(h('div', { key: 'sub', className: 'dsh-tako-sub' },
          h('span', { key: 'key', 'data-testid': 'dsh-tako-console-key', style: mono }, maskedKey)))
      }
      if (configured && (status.baseURL !== undefined || status.credential !== undefined)) {
        const parts = []
        if (status.baseURL !== undefined) parts.push(`${t('endpointLabel')} ${status.baseURL}`)
        if (status.credential !== undefined) parts.push(`${t('credentialLabel')} ${status.credential}`)
        body.push(h('div', { key: 'endpoint', className: 'dsh-tako-sub', 'data-testid': 'dsh-tako-console-endpoint', style: { ...mono, fontSize: '0.78em', overflowWrap: 'anywhere' } }, parts.join(' · ')))
      }
      if (configured && status.meError !== undefined) {
        body.push(h('div', { key: 'meerr', role: 'status', style: { fontSize: '0.85em', color: 'var(--dsw-alias-state-warn-primary)', overflowWrap: 'anywhere' } }, `${t('whoamiFailed')}: ${status.meError}`))
      }
      const actions = []
      const origin = takoOrigin(status)
      if (status !== undefined && !configured) {
        actions.push(h('button', { key: 'in', type: 'button', 'data-testid': 'dsh-tako-console-sign-in', disabled: login.busy, onClick: login.start, className: 'dsh-tako-primary', style: { opacity: login.busy ? 0.6 : 1 } }, t('signIn')))
      } else if (configured) {
        actions.push(h('button', { key: 'again', type: 'button', disabled: login.busy, onClick: login.start, className: 'dsh-tako-ghost', style: { opacity: login.busy ? 0.6 : 1 } }, t('signInAgain')))
        actions.push(h('button', { key: 'out', type: 'button', 'data-testid': 'dsh-tako-console-sign-out', disabled: props.busyLogout, onClick: props.onLogout, className: 'dsh-tako-ghost', style: { color: 'var(--dsw-alias-state-error-primary)' } }, props.busyLogout ? t('signOutWorking') : t('signOut')))
        actions.push(h(TakoChip, { key: 'open', href: origin + '/dashboard', label: t('openInTako') }))
      }
      if (login.busy) actions.push(h('button', { key: 'cancel', type: 'button', onClick: login.cancel, style: quietButton }, t('cancel')))
      if (actions.length > 0) body.push(h('div', { key: 'actions', style: rowStyle }, actions))
      const progress = LoginProgress({ state: login.state, t })
      if (progress !== null) body.push(progress)
      if (props.logoutNote !== undefined) {
        body.push(h('div', { key: 'note', role: 'status', style: { fontSize: '0.85em', overflowWrap: 'anywhere' } }, props.logoutNote))
      }
      if (props.allowKeyEditor !== false) body.push(h(KeyEditor, { key: 'key-editor', status, t, onChanged: props.onKeyChanged }))
      const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, flex: 1 } }, ...body)
      if (compact) return h('section', { className: 'dsh-tako-section', 'data-dsh-tako-card': 'account' },
        h('div', { className: 'dsh-tako-kicker' }, t('accountCard')), wrap)
      return h('header', { className: 'dsh-tako-head', 'data-dsh-tako-card': 'account' },
        TakoMark(32), wrap)
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
        children.push(h('div', { key: 'x', role: 'status', className: 'dsh-tako-sub' }, t('pluginVersion', { version: update.current })))
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
      return Card({ name: 'update', children })
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
        const load = async () => {
          try {
            const next = await call('GET', STATUS_ROUTE)
            if (alive.current) setStatus(next)
          } catch {
            if (alive.current) setStatus({ configured: false })
          }
        }
        const onCredential = () => { void load() }
        void load()
        window.addEventListener('dsh-tako-credential', onCredential)
        window.addEventListener('focus', onCredential)
        return () => {
          window.removeEventListener('dsh-tako-credential', onCredential)
          window.removeEventListener('focus', onCredential)
        }
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
      const origin = props.origin ?? DEFAULT_TAKO_ORIGIN
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
      if (configured) {
        children.push(h('div', { key: 'links', className: 'dsh-tako-cardfoot' },
          h(TakoChip, { href: origin + '/subscriptions', label: t('managePlan') }),
          h(TakoChip, { href: origin + '/wallet', label: t('topUp') })))
      }
      const planName = configured && status.me && status.me.planName ? status.me.planName : undefined
      return Card({
        name: 'quota',
        title: t('quotaCard'),
        extra: planName === undefined ? undefined : h('span', { className: 'dsh-tako-plan' }, planName),
        children,
      })
    }

    /** Context windows at or above this count as long-context in the catalog filter. */
    const LONG_CONTEXT = 500_000
    /** Rows shown before "show all"; the toolbar still counts the whole catalog. */
    const CATALOG_PREVIEW = 6

    /**
     * One plaza-style model card. `card` carries the display-only fields the
     * console route pairs with each route model; `model` supplies the DSH
     * flags, so older hosts without cards still render a minimal card.
     */
    function ModelCardView(props) {
      const t = props.t ?? fallbackT
      const model = props.model
      const card = props.card
      const pills = []
      if (model.contextWindow !== undefined || (card && card.contextWindow !== undefined)) pills.push(h('span', { key: 'ctx', className: 'dsh-tako-pill' }, compactContext((card && card.contextWindow) || model.contextWindow)))
      const vision = card ? card.vision : (model.input || []).includes('image')
      const reasoning = card ? card.reasoning : model.reasoningEfforts !== false
      if (vision) pills.push(h('span', { key: 'v', className: 'dsh-tako-pill', 'data-badge': 'vision' }, t('visionBadge')))
      if (reasoning) pills.push(h('span', { key: 'r', className: 'dsh-tako-pill', 'data-badge': 'reasoning' }, t('catalogReasoningBadge')))
      if (card && card.claudeCodeOnly) pills.push(h('span', { key: 'cc', className: 'dsh-tako-pill', 'data-tone': 'warn' }, t('cardClaude')))
      if (card && card.channelTag) pills.push(h('span', { key: 'ct', className: 'dsh-tako-pill', 'data-tone': 'clay' }, card.channelTag))
      const price = []
      if (card && typeof card.standardPriceUsdPerMillion === 'number') price.push(h('span', { key: 'std' }, `${t('cardStandard')} `, h('b', null, `$${card.standardPriceUsdPerMillion}/M`)))
      if (card && typeof card.realizedPriceUsdPerMillion === 'number') price.push(h('span', { key: 'real' }, `${t('cardRealized')} `, h('b', null, `~$${card.realizedPriceUsdPerMillion}/M`)))
      if (card && typeof card.outputRatio === 'number' && card.outputRatio !== 1) price.push(h('span', { key: 'out', style: muted }, `${t('cardOutputRatio')} ×${card.outputRatio}`))
      if (card && typeof card.cacheHitRate === 'number' && card.cacheHitRate > 0) price.push(h('span', { key: 'cache', style: muted }, `cache ${Math.round(card.cacheHitRate * 100)}%`))
      const foot = []
      if (card && card.channelCount > 0) foot.push(`${t('cardChannels')} ${card.channelCount}`)
      if (card && card.endpoints.length > 0) foot.push(`${t('cardEndpoints')} ${card.endpoints.slice(0, 3).join('·')}${card.endpoints.length > 3 ? ' +' + (card.endpoints.length - 3) : ''}`)
      const vendor = card && card.vendor ? String(card.vendor) : ''
      return h('div', {
        className: 'dsh-tako-model-card',
        'data-model': model.id,
        'data-pinned': String(props.pinned === true),
        role: 'link',
        tabIndex: 0,
        onClick: () => { window.open(props.url, '_blank', 'noopener') },
        'data-testid': `dsh-tako-modelcard-${model.id}`,
      },
        h('div', { className: 'dsh-tako-model-card-top' },
          h('span', { className: 'dsh-tako-model-card-vendor', 'aria-hidden': true }, (vendor || model.id).slice(0, 1).toUpperCase()),
          h('span', { className: 'dsh-tako-model-card-id', title: model.id }, model.id),
          props.pin,
          h('a', { href: props.url, target: '_blank', rel: 'noopener noreferrer', className: 'dsh-tako-ghost', style: { padding: '0 2px' }, onClick: event => event.stopPropagation() }, '↗')),
        card && card.description ? h('div', { className: 'dsh-tako-model-card-desc', title: card.description }, card.description) : null,
        pills.length > 0 ? h('div', { className: 'dsh-tako-model-card-pills' }, pills) : null,
        price.length > 0 ? h('div', { className: 'dsh-tako-model-card-price' }, price) : null,
        foot.length > 0 ? h('div', { className: 'dsh-tako-model-card-foot' }, foot.join(' · ')) : null)
    }

    function CatalogCard(props) {
      const catalog = props.catalog
      const t = props.t ?? fallbackT
      const origin = props.origin ?? DEFAULT_TAKO_ORIGIN
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const children = []
      if (catalog === undefined) {
        children.push(h('div', { key: 'x', style: muted }, props.error === undefined ? '…' : `${t('loadFailed')}: ${props.error}`))
      } else if (catalog.models === undefined || catalog.models.length === 0) {
        children.push(h('div', { key: 'x', style: muted }, t('catalogEmpty')))
      } else {
        const models = catalog.models
        children.push(h('div', { key: 'links', className: 'dsh-tako-cardfoot', style: { marginTop: 0 } },
          h(TakoChip, { href: origin + '/pricing', label: t('plazaLink') })))
        const hasVision = model => (model.input || []).includes('image')
        const hasLong = model => typeof model.contextWindow === 'number' && model.contextWindow >= LONG_CONTEXT
        const hasReasoning = model => model.reasoningEfforts !== false
        const stats = {
          vision: models.filter(hasVision).length,
          long: models.filter(hasLong).length,
          reasoning: models.filter(hasReasoning).length,
        }
        const cards = Array.isArray(props.cards) ? props.cards : []
        const cardsById = new Map(cards.map(card => [card.id, card]))
        const needle = query.trim().toLowerCase()
        const filtering = needle !== '' || filter !== 'all'
        const matched = models.filter(model => {
          if (filter === 'vision' && !hasVision(model)) return false
          if (filter === 'long' && !hasLong(model)) return false
          if (filter === 'reasoning' && !hasReasoning(model)) return false
          if (needle === '') return true
          if (model.id.toLowerCase().includes(needle)) return true
          const card = cardsById.get(model.id)
          return card !== undefined && typeof card.description === 'string' && card.description.toLowerCase().includes(needle)
        })
        const expanded = open || filtering
        const shown = expanded ? matched : matched.slice(0, CATALOG_PREVIEW)

        children.push(h('div', { key: 'summary', className: 'dsh-tako-summary', 'data-testid': 'dsh-tako-catalog-summary' },
          t('catalogSummary', { count: models.length, vision: stats.vision, long: stats.long, reasoning: stats.reasoning })))

        const chips = [
          ['all', t('catalogFilterAll')],
          ['vision', t('catalogFilterVision')],
          ['long', t('catalogFilterLong')],
          ['reasoning', t('catalogFilterReasoning')],
        ]
        children.push(h('div', { key: 'toolbar', className: 'dsh-tako-toolbar' },
          h('input', {
            type: 'search',
            value: query,
            placeholder: t('catalogSearch'),
            'data-testid': 'dsh-tako-catalog-search',
            onChange: event => setQuery(event.target.value),
            className: 'dsh-tako-input',
          }),
          ...chips.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            'data-filter': id,
            'data-active': String(filter === id),
            'data-testid': `dsh-tako-catalog-filter-${id}`,
            onClick: () => setFilter(current => current === id ? 'all' : id),
            className: 'dsh-tako-chip',
          }, label))))

        if (shown.length === 0) {
          children.push(h('div', { key: 'nomatch', style: { ...muted, padding: '6px 0' }, 'data-testid': 'dsh-tako-catalog-nomatch' }, t('catalogNoMatch')))
        }
        const pinned = Array.isArray(props.pinned) ? props.pinned : []
        const pinButton = model => props.onTogglePin === undefined ? null : h('button', {
          type: 'button',
          className: 'dsh-tako-pin',
          'data-active': String(pinned.includes(model.id)),
          'data-testid': `dsh-tako-pin-${model.id}`,
          title: pinned.includes(model.id) ? t('unpinTitle') : t('pinTitle'),
          onClick: event => { event.stopPropagation(); void props.onTogglePin(model.id) },
        }, pinned.includes(model.id) ? '★' : '☆')
        const plazaUrl = id => `${origin}/pricing?search=${encodeURIComponent(id)}`
        if (cards.length > 0) {
          children.push(h('div', { key: 'grid', className: 'dsh-tako-model-grid' },
            shown.map(model => h(ModelCardView, {
              key: model.id,
              model,
              card: cardsById.get(model.id),
              t,
              url: plazaUrl(model.id),
              pin: pinButton(model),
              pinned: pinned.includes(model.id),
            }))))
        } else {
          for (const model of shown) {
            const vision = hasVision(model)
            children.push(h('div', { key: model.id, className: 'dsh-tako-model', 'data-model': model.id },
              pinButton(model),
              h('a', {
                className: 'dsh-tako-model-name',
                style: mono,
                title: model.id,
                href: plazaUrl(model.id),
                target: '_blank',
                rel: 'noopener noreferrer',
              }, model.id),
              h('span', { style: { display: 'flex', gap: '6px', alignItems: 'baseline', flex: 'none' } },
                h('span', { style: { ...muted, fontVariantNumeric: 'tabular-nums' } }, compactContext(model.contextWindow)),
                vision ? h('span', { className: 'dsh-tako-tag', 'data-badge': 'vision' }, t('visionBadge')) : null,
                model.reasoningEfforts !== false ? h('span', { className: 'dsh-tako-tag', 'data-badge': 'reasoning' }, t('catalogReasoningBadge')) : null)))
          }
        }
        if (!expanded && matched.length > shown.length) {
          children.push(h('button', {
            key: 'more',
            type: 'button',
            'data-testid': 'dsh-tako-catalog-more',
            onClick: () => setOpen(value => !value),
            style: { ...quietButton, alignSelf: 'flex-start' },
          }, t('catalogMore', { count: matched.length - shown.length })))
        } else if (filtering) {
          children.push(h('div', { key: 'shown', className: 'dsh-tako-summary', 'data-testid': 'dsh-tako-catalog-shown' }, t('catalogShown', { shown: shown.length, total: models.length })))
        } else if (open && expanded && matched.length > CATALOG_PREVIEW) {
          children.push(h('button', {
            key: 'less',
            type: 'button',
            'data-testid': 'dsh-tako-catalog-more',
            onClick: () => setOpen(value => !value),
            style: { ...quietButton, alignSelf: 'flex-start' },
          }, t('catalogLess')))
        }
      }
      if (catalog?.status && catalog.status !== 'ready') {
        const label = { syncing: 'catalogSyncing', retrying: 'catalogRetrying', failed: 'catalogFailed' }[catalog.status]
        if (label) children.push(h('div', { key: 'phase', role: 'status', style: muted }, t(label)))
      }
      if (catalog?.lastError) {
        const label = { 'directory-unavailable': 'catalogDirectoryError', 'settings-not-ready': 'catalogSettingsError',
          'write-failed': 'catalogWriteError', 'runtime-transaction': 'catalogTransactionError',
          'read-only': 'catalogReadOnlyError', 'empty-catalog': 'catalogEmptyError' }[catalog.lastError.code]
        children.push(h('div', { key: 'failure', role: 'status', style: muted },
          `${t(label || 'catalogFailed')} · ${t('catalogAttempts', { count: catalog.attempts ?? 0 })}`))
      }
      const foot = []
      if (props.onRefresh) foot.push(h('button', { key: 'refresh', type: 'button', onClick: props.onRefresh,
        className: 'dsh-tako-btn', 'data-testid': 'dsh-tako-catalog-refresh' }, t('catalogReadAgain')))
      if (props.onSync) foot.push(h('button', { key: 'sync', type: 'button',
        disabled: props.syncBusy === true,
        onClick: props.onSync,
        className: 'dsh-tako-btn', 'data-testid': 'dsh-tako-catalog-sync' }, props.syncBusy === true ? t('syncWorking') : t('syncNow')))
      if (foot.length > 0) children.push(h('div', { key: 'foot', className: 'dsh-tako-cardfoot' }, foot))
      if (props.syncNote) children.push(h('div', { key: 'syncnote', role: 'status', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-catalog-syncnote' }, props.syncNote))
      return Card({
        name: 'catalog',
        title: t('catalogCard'),
        extra: catalog === undefined || catalog.nextSyncAt === undefined ? undefined : h(Countdown, {
          nextSyncAt: catalog.nextSyncAt, lastSyncAt: catalog.lastSyncAt, refreshIntervalMs: catalog.refreshIntervalMs, t }),
        children,
      })
    }

    /** `## heading\n- item` → flat text; announcements arrive as small markdown blobs. */
    const stripMarkdown = text => String(text ?? '').replace(/^[#>\-*+\s]+/gm, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim()

    const fmtDateTime = ms => {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
      const date = new Date(ms)
      const pad = n => String(n).padStart(2, '0')
      const now = new Date()
      const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
      if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    const fmtFullTime = ms => {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const d = new Date(ms)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const compactTokens = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 1_000_000 * 10) / 10}M`
      if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000 * 10) / 10}K`
      return String(value)
    }
    const LOG_TYPE_KEYS = { 1: 'logTypeTopup', 3: 'logTypeManage', 4: 'logTypeSystem', 5: 'logTypeError', 6: 'logTypeRefund', 7: 'logTypeLogin' }
    const logTypeLabel = (type, t) => {
      const key = LOG_TYPE_KEYS[type]
      return key === undefined ? String(type ?? '—') : t(key)
    }
    const quotaUsd = quota => typeof quota === 'number' && Number.isFinite(quota) ? fmtUsd(quota / 500000) : '—'

    /** Inline markdown-lite: **bold**, `code`, [text](https://url). Input is text nodes, never raw HTML. */
    const mdInline = text => {
      const parts = []
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]*\]\((?:https?:\/\/|mailto:)[^)\s]*\))/g
      let last = 0
      let match
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) parts.push(h('code', { key: parts.length }, token.slice(1, -1)))
        else if (token.startsWith('**')) parts.push(h('strong', { key: parts.length }, token.slice(2, -2)))
        else {
          const label = token.slice(token.indexOf('[') + 1, token.indexOf(']'))
          const url = token.slice(token.indexOf('(') + 1, -1)
          parts.push(h('a', { key: parts.length, href: url, target: '_blank', rel: 'noopener noreferrer' }, label))
        }
        last = match.index + token.length
      }
      if (last < text.length) parts.push(text.slice(last))
      return parts
    }

    /** Block-level markdown-lite: ## headings, - / * lists, blank-line-separated paragraphs. */
    const mdLite = text => {
      const blocks = []
      for (const line of String(text ?? '').split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
        if (heading !== null) { blocks.push(h('h4', { key: blocks.length }, mdInline(heading[2]))); continue }
        const bullet = /^[-*·]\s+(.*)$/.exec(trimmed)
        if (bullet !== null) {
          const last = blocks[blocks.length - 1]
          if (last !== undefined && last.tag === 'ul') last.children.push(h('li', { key: last.children.length }, mdInline(bullet[1])))
          else blocks.push(h('ul', { key: blocks.length }, h('li', { key: 0 }, mdInline(bullet[1]))))
          continue
        }
        blocks.push(h('p', { key: blocks.length, style: { margin: '2px 0' } }, mdInline(trimmed)))
      }
      return blocks
    }

    const NOTICE_TONES = { ongoing: 'info', success: 'success', warning: 'warn', error: 'error' }

    function NoticeItem(props) {
      const t = props.t ?? fallbackT
      const item = props.item
      const preview = stripMarkdown(item.content).split('\n').filter(line => line !== '')[0] ?? ''
      const date = item.publishDate !== undefined ? String(item.publishDate).slice(0, 10) : item.date
      // <details>/<summary> gives the expand/collapse for free, no hook slot.
      return h('details', {
        className: 'dsh-tako-notice-item',
        'data-testid': 'dsh-tako-notice-item',
      },
        h('summary', { className: 'dsh-tako-notice-summary' },
          h('span', { className: 'dsh-tako-notice-dot', 'data-tone': NOTICE_TONES[item.type], 'aria-hidden': true }),
          h('span', { className: 'dsh-tako-notice-preview' }, preview),
          date === undefined ? null : h('span', { className: 'dsh-tako-notice-date' }, date),
          h('button', {
            type: 'button',
            className: 'dsh-tako-ghost',
            'data-testid': 'dsh-tako-notice-dismiss',
            onClick: event => { event.preventDefault(); event.stopPropagation(); props.onDismiss(item) },
          }, t('noticeDismiss'))),
        h('div', { className: 'dsh-tako-notice-body', 'data-testid': 'dsh-tako-notice-body' }, mdLite(item.content)))
    }

    function NoticeList(props) {
      const t = props.t ?? fallbackT
      const items = (props.notice && props.notice.announcements) || []
      const visible = items.filter(item => item && (props.dismissed || []).includes(noticeId(item)) === false)
      if (visible.length === 0) return null
      return h('div', { className: 'dsh-tako-notices', 'data-testid': 'dsh-tako-notice' },
        visible.map(item => h(NoticeItem, { key: noticeId(item), item, t, onDismiss: props.onDismiss })))
    }

    const noticeId = item => item.id !== undefined ? String(item.id) : String(item.publishDate ?? '') + ':' + String(item.content ?? '').slice(0, 40)

    function OverviewTab(props) {
      const t = props.t
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-overview', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        props.notice !== undefined && props.notice.ok === true && Array.isArray(props.notice.announcements)
          ? h(NoticeList, { key: 'notice', notice: props.notice, dismissed: props.dismissed || [], onDismiss: props.onDismiss, t })
          : null,
        AccountCard({ status: props.status, login: props.login, busyLogout: props.busyLogout, compact: true,
          onLogout: props.onLogout, logoutNote: props.logoutNote, t, onKeyChanged: props.onKeyChanged,
          allowKeyEditor: props.allowKeyEditor }),
        QuotaCard({ status: props.status, origin: props.origin, t }),
        ServicesCard({ origin: props.origin, t }),
        h(UpdateCard, { key: 'update', t }))
    }

    function RequestsTab(props) {
      const t = props.t ?? fallbackT
      const [logs, setLogs] = useState(undefined)
      const [error, setError] = useState(undefined)
      const [model, setModel] = useState('')
      const [refreshing, setRefreshing] = useState(false)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      const load = async next => {
        if (refreshing) return
        setRefreshing(true)
        try {
          const query = (next ?? model) === '' ? '' : `?model=${encodeURIComponent(next ?? model)}`
          const result = await call('GET', LOGS_ROUTE + query)
          if (!alive.current) return
          if (result && result.ok === true) { setLogs(result.logs || []); setError(undefined) }
          else { setError(result && result.message ? String(result.message) : (result && result.code) || 'error'); setLogs(undefined) }
        } catch (err) {
          if (alive.current) { setError(String(err && err.message || err)); setLogs(undefined) }
        } finally {
          if (alive.current) setRefreshing(false)
        }
      }
      useEffect(() => { void load('') }, [])
      const children = []
      const catalog = props.catalog
      const models = catalog === undefined || catalog.models === undefined ? [] : catalog.models
      children.push(h('div', { key: 'bar', className: 'dsh-tako-toolbar' },
        h('select', {
          className: 'dsh-tako-select',
          value: model,
          'data-testid': 'dsh-tako-logs-model',
          onChange: event => { setModel(event.target.value); void load(event.target.value) },
        },
          h('option', { value: '' }, t('logsModel')),
          models.map(m => h('option', { key: m.id, value: m.id }, m.id))),
        h('button', { type: 'button', className: 'dsh-tako-btn', 'data-testid': 'dsh-tako-logs-refresh', disabled: refreshing, onClick: () => { void load() } }, refreshing ? t('logsLoading') : t('logsRefresh'))))
      if (error !== undefined) {
        const text = error === 'not-configured' ? t('logsNeedLogin') : `${t('loadFailed')}: ${error}`
        children.push(h('div', { key: 'err', role: 'alert', style: { ...muted, fontSize: '13px' }, 'data-testid': 'dsh-tako-logs-error' }, text))
      } else if (logs === undefined) {
        children.push(h('div', { key: 'load', style: muted }, t('logsLoading')))
      } else if (logs.length === 0) {
        children.push(h('div', { key: 'empty', style: muted, 'data-testid': 'dsh-tako-logs-empty' }, t('logsEmpty')))
      } else {
        children.push(h('table', { key: 'table', className: 'dsh-tako-table', 'data-testid': 'dsh-tako-logs-table' },
          h('thead', null, h('tr', null,
            h('th', null, t('logsColTime')), h('th', null, t('logsColModel')), h('th', null, t('logsColIn')),
            h('th', null, t('logsColOut')), h('th', null, t('logsColCost')), h('th', null, t('logsColDuration')),
            h('th', null, ''), h('th', null, t('logsColRequest')), h('th', null, 'IP'))),
          h('tbody', null, logs.map(row => h('tr', { key: row.id ?? row.requestId },
            h('td', null, fmtDateTime(typeof row.createdAt === 'number' ? row.createdAt * 1000 : row.createdAt)),
            h('td', { className: 'm', title: row.modelName }, row.modelName || '—'),
            h('td', null, compactTokens(row.promptTokens)),
            h('td', null, compactTokens(row.completionTokens)),
            h('td', null, quotaUsd(row.quota)),
            h('td', null, typeof row.useTime === 'number' ? `${row.useTime}s` : '—'),
            h('td', null, row.type !== undefined && row.type !== 2 ? h('span', { className: 'dsh-tako-pill', 'data-tone': row.type === 5 ? 'error' : undefined }, logTypeLabel(row.type, t)) : (row.isStream === true ? h('span', { className: 'dsh-tako-pill' }, 'stream') : null)),
            h('td', { className: 'm', title: row.requestId }, typeof row.requestId === 'string' ? row.requestId.slice(0, 8) : '—'),
            h('td', null, row.ip || '—'))))))
      }
      return h('section', { 'data-dsh-tako-card': 'logs', className: 'dsh-tako-section', 'data-testid': 'dsh-tako-tabpanel-requests' }, children)
    }

    function UsageTab(props) {
      const t = props.t ?? fallbackT
      const [usage, setUsage] = useState(undefined)
      const [error, setError] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      useEffect(() => {
        void (async () => {
          try {
            const result = await call('GET', USAGE_ROUTE)
            if (!alive.current) return
            if (result && result.ok === true) { setUsage(result); setError(undefined) }
            else setError(result && result.message ? String(result.message) : (result && result.code) || 'error')
          } catch (err) {
            if (alive.current) setError(String(err && err.message || err))
          }
        })()
      }, [])
      const children = []
      if (error !== undefined) {
        children.push(h('div', { key: 'err', role: 'alert', style: { ...muted, fontSize: '13px' } }, `${t('loadFailed')}: ${error}`))
      } else if (usage === undefined) {
        children.push(h('div', { key: 'load', style: muted }, '…'))
      } else {
        children.push(h('section', { key: 'daily', className: 'dsh-tako-section', 'data-dsh-tako-card': 'daily' },
          h('div', { className: 'dsh-tako-kicker' }, t('usageToday')),
          h('div', { className: 'dsh-tako-stamp' },
            h('div', { className: 'n dsh-tako-ink', 'data-testid': 'dsh-tako-usage-daily' },
              usage.statsError ? '—' : fmtUsd(usage.dailyCostUsd)),
            usage.statsError ? h('div', { style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-usage-statserror' }, usage.statsError) : null)))
        const token = usage.token || {}
        const tokenRows = []
        if (usage.tokenError) tokenRows.push(h('div', { key: 'te', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-usage-tokenerror' }, usage.tokenError))
        else {
          if (token.unlimitedQuota === true) tokenRows.push(h('div', { key: 'ul', className: 'dsh-tako-pill', 'data-tone': 'ok' }, t('usageUnlimited')))
          else if (typeof token.grantedUsd === 'number' && token.grantedUsd > 0) {
            const share = remainingShare(token.usedUsd, token.grantedUsd)
            tokenRows.push(h('div', { key: 'bar', className: 'dsh-tako-bar' }, h('i', {
              'data-tone': share !== undefined && share <= 0.05 ? 'error' : share !== undefined && share <= 0.2 ? 'warn' : undefined,
              style: { width: `${(1 - (share ?? 0)) * 100}%` } })))
          }
          tokenRows.push(h('div', { key: 'grid', className: 'dsh-tako-stamps dsh-tako-stamps-3' },
            h('div', { className: 'dsh-tako-stamp' }, h('div', { className: 'dsh-tako-kicker' }, t('usageGranted')), h('div', { className: 'n' }, fmtUsd(token.grantedUsd))),
            h('div', { className: 'dsh-tako-stamp' }, h('div', { className: 'dsh-tako-kicker' }, t('usageUsed')), h('div', { className: 'n' }, fmtUsd(token.usedUsd))),
            h('div', { className: 'dsh-tako-stamp' }, h('div', { className: 'dsh-tako-kicker' }, t('usageAvailable')), h('div', { className: 'n' }, fmtUsd(token.availableUsd)))))
        }
        children.push(h('section', { key: 'token', className: 'dsh-tako-section', 'data-dsh-tako-card': 'token' },
          h('div', { className: 'dsh-tako-kicker' }, t('usageTokenCard')), ...tokenRows))
        const models = Array.isArray(usage.models) ? usage.models : []
        children.push(h('section', { key: 'models', className: 'dsh-tako-section', 'data-dsh-tako-card': 'permodel' },
          h('div', { className: 'dsh-tako-kicker' }, t('usagePerModel')),
          usage.modelStatsError ? h('div', { style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-usage-modelerror' }, usage.modelStatsError)
            : models.length === 0 ? h('div', { style: muted }, '—')
            : models.map(row => h('div', { key: row.model, className: 'dsh-tako-model', 'data-model': row.model },
                h('span', { className: 'dsh-tako-model-name', style: mono }, row.model),
                h('span', { style: { display: 'flex', gap: '10px', alignItems: 'baseline', flex: 'none', fontSize: '12px' } },
                  h('span', { style: muted }, t('usageRequests', { count: row.requests ?? 0 })),
                  h('span', { style: muted }, `${compactTokens(row.inputTokens)} / ${compactTokens(row.outputTokens)}`),
                  h('span', { style: { ...mono, fontSize: '12px' } }, fmtUsd(row.costUsd)))))))
      }
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-usage', style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, children)
    }

    function ModelsTab(props) {
      const t = props.t ?? fallbackT
      const [pinned, setPinned] = useState(undefined)
      const [syncBusy, setSyncBusy] = useState(false)
      const [syncNote, setSyncNote] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      useEffect(() => {
        void (async () => {
          try {
            const result = await call('GET', CONFIG_ROUTE)
            if (alive.current && result && result.ok === true && result.config && Array.isArray(result.config.pinned)) setPinned(result.config.pinned)
            else if (alive.current) setPinned([])
          } catch {
            if (alive.current) setPinned([])
          }
        })()
      }, [])
      const togglePin = async id => {
        const current = Array.isArray(pinned) ? pinned : []
        const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id]
        setPinned(next)
        try {
          const result = await call('POST', CONFIG_ROUTE, { set: { pinned: next } })
          if (!alive.current) return
          if (!result || result.ok !== true) { setPinned(current); setSyncNote(t('pinFailed')) }
        } catch (err) {
          if (!alive.current) return
          setPinned(current)
          setSyncNote(`${t('pinFailed')}: ${String(err && err.message || err)}`)
        }
      }
      const sync = async () => {
        setSyncBusy(true)
        setSyncNote(undefined)
        try {
          const result = await call('POST', SYNC_ROUTE, {})
          if (!alive.current) return
          if (!result || result.ok !== true) setSyncNote(t('syncFailed'))
          else props.onRefresh()
        } catch (err) {
          if (alive.current) setSyncNote(`${t('syncFailed')}: ${String(err && err.message || err)}`)
        } finally {
          if (alive.current) setSyncBusy(false)
        }
      }
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-models' },
        h(CatalogCard, {
          catalog: props.catalog,
          cards: props.catalog && props.catalog.cards,
          error: props.catalogError,
          origin: props.origin,
          onRefresh: props.onRefresh,
          onSync: () => { void sync() },
          syncBusy,
          syncNote,
          pinned: pinned ?? [],
          onTogglePin: pinned === undefined ? undefined : id => { void togglePin(id) },
          t,
        }))
    }

    function KeyTab(props) {
      const t = props.t ?? fallbackT
      const [usage, setUsage] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      useEffect(() => {
        if (props.configured !== true) return
        void (async () => {
          try {
            const result = await call('GET', USAGE_ROUTE)
            if (alive.current && result && result.ok === true) setUsage(result)
          } catch { /* token detail degrades to the status card alone */ }
        })()
      }, [])
      const status = props.status
      const token = usage === undefined ? undefined : usage.token
      const limits = token && token.modelLimitsEnabled === true ? Object.keys(token.modelLimits || {}) : []
      const children = [
        KeyEditor({ status, t, onChanged: props.onKeyChanged, key: 'editor' }),
      ]
      if (props.configured === true) {
        const rows = []
        if (status && status.maskedKey) rows.push(h('div', { key: 'mask', className: 'dsh-tako-field' }, h('label', null, 'key'), h('div', { className: 'v', style: mono }, status.maskedKey)))
        if (token && token.name) rows.push(h('div', { key: 'name', className: 'dsh-tako-field' }, h('label', null, t('keyName')), h('div', { className: 'v' }, token.name)))
        if (token) rows.push(h('div', { key: 'exp', className: 'dsh-tako-field' }, h('label', null, t('keyExpires')),
          h('div', { className: 'v' }, !token.expiresAt || token.expiresAt <= 0 ? t('usageNever') : fmtFullTime(token.expiresAt * 1000))))
        rows.push(h('div', { key: 'models', className: 'dsh-tako-field' }, h('label', null, t('keyModels')),
          h('div', { className: 'v' }, limits.length === 0 ? t('usageNoLimits') : limits.map(id => h('span', { key: id, className: 'dsh-tako-tag' }, id)))))
        children.push(Card({ name: 'keytoken', title: t('keyTokenCard'), children: rows, key: 'token' }))
      }
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-key', style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, children)
    }

    function ConfigTab(props) {
      const t = props.t ?? fallbackT
      const [config, setConfig] = useState(undefined)
      const [error, setError] = useState(undefined)
      const [form, setForm] = useState(undefined)
      const [saving, setSaving] = useState(false)
      const [note, setNote] = useState(undefined)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      const csv = list => Array.isArray(list) ? list.join(', ') : ''
      const parseCsv = text => String(text ?? '').split(',').map(item => item.trim()).filter(item => item !== '')
      const parseInts = text => {
        const items = parseCsv(text)
        for (const item of items) if (!/^\d+$/.test(item)) return undefined
        return items.map(Number)
      }
      const toForm = result => ({
        refreshMinutes: typeof result.config.refreshIntervalMs === 'number' ? String(Math.round(result.config.refreshIntervalMs / 60000)) : '30',
        retryDelays: csv(result.config.syncRetryDelaysMs),
        defaultContextWindow: typeof result.config.defaultContextWindow === 'number' ? String(result.config.defaultContextWindow) : '',
        includeClaudeCodeOnly: result.config.includeClaudeCodeOnly === true,
        include: csv(result.config.include),
        exclude: csv(result.config.exclude),
        pinned: csv(result.config.pinned),
        searchProvider: result.webSearchProvider === 'tako' ? 'tako' : 'deepseek-official',
      })
      const load = async () => {
        try {
          const result = await call('GET', CONFIG_ROUTE)
          if (!alive.current) return
          if (result && result.ok === true) { setConfig(result); setForm(toForm(result)); setError(undefined) }
          else setError(result && result.message ? String(result.message) : (result && result.code) || 'error')
        } catch (err) {
          if (alive.current) setError(String(err && err.message || err))
        }
      }
      useEffect(() => { void load() }, [])
      const field = (key, label, input) => h('div', { key, className: 'dsh-tako-field', 'data-field': key }, h('label', null, label), h('div', { className: 'v' }, input))
      const text = (key, label, dataTest) => field(key, label, h('input', {
        className: 'dsh-tako-input', value: form === undefined ? '' : form[key], disabled: config === undefined || config.writable === false,
        'data-testid': dataTest,
        onChange: event => setForm({ ...form, [key]: event.target.value }),
      }))
      const save = async () => {
        if (config === undefined || form === undefined) return
        const minutes = parseInt(form.refreshMinutes, 10)
        const retries = parseInts(form.retryDelays)
        const ctxWin = form.defaultContextWindow.trim() === '' ? undefined : parseInt(form.defaultContextWindow, 10)
        const set = {}
        if (!Number.isNaN(minutes)) set.refreshIntervalMs = Math.max(0, minutes) * 60000
        if (retries !== undefined) set.syncRetryDelaysMs = retries
        if (ctxWin !== undefined && !Number.isNaN(ctxWin) && ctxWin >= 1) set.defaultContextWindow = ctxWin
        set.includeClaudeCodeOnly = form.includeClaudeCodeOnly
        set.include = parseCsv(form.include)
        set.exclude = parseCsv(form.exclude)
        set.pinned = parseCsv(form.pinned)
        set.webSearchProvider = form.searchProvider
        setSaving(true)
        setNote(undefined)
        try {
          const result = await call('POST', CONFIG_ROUTE, { set })
          if (!alive.current) return
          if (result && result.ok === true) { setNote(t('configSaved')); await load() }
          else setNote(`${t('configFailed')}: ${result && result.message ? result.message : (result && result.code) || 'error'}`)
        } catch (err) {
          if (alive.current) setNote(`${t('configFailed')}: ${String(err && err.message || err)}`)
        } finally {
          if (alive.current) setSaving(false)
        }
      }
      const children = []
      if (error !== undefined) children.push(h('div', { key: 'err', role: 'alert', style: { ...muted, fontSize: '13px' } }, `${t('loadFailed')}: ${error}`))
      else if (form === undefined) children.push(h('div', { key: 'load', style: muted }, '…'))
      else {
        const readOnly = config === undefined || config.writable === false
        if (readOnly) children.push(h('div', { key: 'ro', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-config-readonly' }, t('configReadOnly')))
        children.push(h('section', { key: 'form', className: 'dsh-tako-section', 'data-dsh-tako-card': 'config' },
          text('refreshMinutes', t('configRefresh'), 'dsh-tako-config-refresh'),
          text('retryDelays', t('configRetryDelays'), 'dsh-tako-config-retry'),
          text('defaultContextWindow', t('configDefaultCtx'), 'dsh-tako-config-ctx'),
          field('include', t('configInclude'), h('input', {
            className: 'dsh-tako-input', value: form.include, disabled: readOnly, 'data-testid': 'dsh-tako-config-include',
            onChange: event => setForm({ ...form, include: event.target.value }),
          })),
          field('exclude', t('configExclude'), h('input', {
            className: 'dsh-tako-input', value: form.exclude, disabled: readOnly, 'data-testid': 'dsh-tako-config-exclude',
            onChange: event => setForm({ ...form, exclude: event.target.value }),
          })),
          field('pinned', t('configPinnedField'), h('input', {
            className: 'dsh-tako-input', value: form.pinned, disabled: readOnly, 'data-testid': 'dsh-tako-config-pinned',
            onChange: event => setForm({ ...form, pinned: event.target.value }),
          })),
          field('claude', ' ', h('label', { className: 'dsh-tako-check' },
            h('input', {
              type: 'checkbox', checked: form.includeClaudeCodeOnly, disabled: readOnly, 'data-testid': 'dsh-tako-config-claude',
              onChange: event => setForm({ ...form, includeClaudeCodeOnly: event.target.checked }),
            }), t('configClaudeOnly'))),
          field('search', t('configSearchProvider'), h('select', {
            className: 'dsh-tako-select', value: form.searchProvider, disabled: readOnly, 'data-testid': 'dsh-tako-config-search',
            onChange: event => setForm({ ...form, searchProvider: event.target.value }),
          },
            h('option', { value: 'tako' }, t('configSearchTako')),
            h('option', { value: 'deepseek-official' }, t('configSearchDefault')))),
          config && config.config && config.config.overrides !== undefined && Object.keys(config.config.overrides).length > 0
            ? field('overrides', t('configOverrides'), h('pre', { className: 'dsh-tako-code' }, JSON.stringify(config.config.overrides, null, 2)))
            : null,
          !readOnly ? h('div', { key: 'actions', className: 'dsh-tako-cardfoot' },
            h('button', { type: 'button', className: 'dsh-tako-btn dsh-tako-btn-primary', disabled: saving, 'data-testid': 'dsh-tako-config-save', onClick: () => { void save() } }, saving ? t('configSaving') : t('configSave'))) : null))
        if (note !== undefined) children.push(h('div', { key: 'note', role: 'status', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-config-note' }, note))
      }
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-config', style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, children)
    }

    const TABS = [
      ['overview', 'tabOverview'],
      ['requests', 'tabRequests'],
      ['usage', 'tabUsage'],
      ['models', 'tabModels'],
      ['key', 'tabKey'],
      ['config', 'tabConfig'],
    ]

    function TakoConsolePage(props) {
      const t = props.t ?? fallbackT
      const [status, setStatus] = useState(undefined)
      const [statusError, setStatusError] = useState(undefined)
      const [catalog, setCatalog] = useState(undefined)
      const [catalogError, setCatalogError] = useState(undefined)
      const [busyLogout, setBusyLogout] = useState(false)
      const [logoutNote, setLogoutNote] = useState(undefined)
      const [tab, setTab] = useState('overview')
      const [notice, setNotice] = useState(undefined)
      const [dismissedNotice, setDismissedNotice] = useState(undefined)
      const [diagCopied, setDiagCopied] = useState(false)
      const login = useTakoLogin()

      const alive = useRef(true)
      const catalogRequest = useRef(undefined)
      const catalogController = useRef(undefined)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; catalogController.current?.abort() }
      }, [])

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
      const loadCatalog = () => {
        if (catalogRequest.current) return catalogRequest.current
        const controller = new AbortController()
        catalogController.current = controller
        const request = (async () => {
          try {
            const next = await call('GET', CATALOG_ROUTE, undefined, controller.signal)
            if (!alive.current || controller.signal.aborted) return
            setCatalog(next)
            setCatalogError(undefined)
            return next
          } catch (error) {
            if (alive.current && !controller.signal.aborted) setCatalogError(String(error && error.message || error))
          }
        })()
        catalogRequest.current = request
        void request.finally(() => {
          if (catalogRequest.current === request) catalogRequest.current = undefined
        })
        return request
      }

      useEffect(() => { void loadStatus() }, [])
      useEffect(() => {
        if (catalog === undefined || catalog.consoleApiVersion !== CONSOLE_API_VERSION) return
        void (async () => {
          try {
            const result = await call('GET', NOTICE_ROUTE)
            if (alive.current) setNotice(result)
          } catch {
            if (alive.current) setNotice({ ok: false })
          }
        })()
      }, [catalog && catalog.consoleApiVersion])
      useEffect(() => {
        let disposed = false
        let timer
        let pendingReads = 0
        const poll = async () => {
          const next = await loadCatalog()
          if (disposed) return
          const unsettled = !next || next.status === 'syncing' || next.status === 'retrying' || next.lastSyncAt === null
          if (unsettled) {
            // Bound rapid reads; after one minute the explicit refresh remains available.
            if (++pendingReads < 30) timer = setTimeout(poll, 2000)
            else if (typeof next?.nextSyncAt === 'number') {
              // Keep the advertised deadline after the fast-read budget is exhausted.
              timer = setTimeout(poll, Math.min(2147483647, Math.max(60000, next.nextSyncAt - Date.now() + 250)))
            }
          } else if (typeof next.nextSyncAt === 'number') {
            pendingReads = 0
            timer = setTimeout(poll, Math.min(2147483647, Math.max(2000, next.nextSyncAt - Date.now() + 250)))
          }
        }
        void poll()
        return () => { disposed = true; clearTimeout(timer); catalogController.current?.abort() }
      }, [])
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
          notifyCredential()
        } catch (error) {
          if (alive.current) setLogoutNote(`${t('failed')}: ${String(error && error.message || error)}`)
        } finally {
          if (alive.current) setBusyLogout(false)
        }
      }

      ensureTakoTheme()
      const origin = takoOrigin(status)
      const me = status === undefined || status.me === null || status.me === undefined ? undefined : status.me
      const planName = me && me.planName ? me.planName : undefined
      const name = me && me.userName ? me.userName : (status && status.configured === true ? t('signedIn') : 'Tako')
      const diagnostics = () => {
        const lines = [
          `dsh-tako console diagnostics`,
          `endpoint: ${status && status.origin ? status.origin : '?'}`,
          `configured: ${status === undefined ? '?' : status.configured}`,
          `key: ${status && status.maskedKey ? status.maskedKey : '(none)'}`,
          `credential: ${status && status.credential ? status.credential : '(unknown)'}`,
          `account: ${me && me.userName ? me.userName : '(none)'}${planName ? ` (${planName})` : ''}`,
          `catalog: ${catalog === undefined ? 'unloaded' : `${catalog.status || '?'} · ${(catalog.models || []).length} models · last ${fmtFullTime(catalog.lastSyncAt)}`}`,
          `catalog error: ${catalogError || (catalog && catalog.lastError ? catalog.lastError.message : '(none)')}`,
          `status error: ${statusError || '(none)'}`,
          `notice: ${notice === undefined ? 'unloaded' : notice.ok === true ? `${(notice.announcements || []).length}` : 'failed'}`,
        ]
        return lines.join('\n')
      }
      const copyDiagnostics = async () => {
        try { await navigator.clipboard.writeText(diagnostics()) } catch { /* clipboard blocked */ }
        setDiagCopied(true)
        setTimeout(() => setDiagCopied(false), 2000)
      }
      const hero = h('div', { key: 'hero', className: 'dsh-tako-hero' },
        TakoMark(36),
        h('div', { className: 'dsh-tako-hero-name' },
          h('h1', null, name),
          planName === undefined ? null : h('span', { className: 'dsh-tako-plan' }, planName),
          status && status.maskedKey ? h('span', { className: 'dsh-tako-hero-meta', style: mono }, status.maskedKey) : null),
        h('span', { className: 'dsh-tako-hero-spacer' }),
        h('button', { type: 'button', className: 'dsh-tako-btn', 'data-testid': 'dsh-tako-copy-diagnostics', onClick: () => { void copyDiagnostics() } }, diagCopied ? t('diagCopied') : t('diagCopy')))
      const renderPage = children => h('div', {
        'data-testid': 'dsh-tako-console-page',
        style: { height: '100%', minHeight: 0, overflowY: 'auto', fontSize: '14px', lineHeight: '22px' },
      }, h('div', { className: 'dsh-tako-sheet' }, children))
      const protocolPending = catalog === undefined
      const legacyHost = catalog !== undefined && catalog.consoleApiVersion !== CONSOLE_API_VERSION
      const tabs = protocolPending || legacyHost ? undefined : h('div', { key: 'tabs', className: 'dsh-tako-tabs', role: 'tablist' },
        TABS.map(([id, key]) => h('button', {
          key: id,
          type: 'button',
          role: 'tab',
          className: 'dsh-tako-tab',
          'data-active': String(tab === id),
          'data-testid': `dsh-tako-tab-${id}`,
          onClick: () => setTab(id),
        }, t(key))))
      const children = tabs === undefined ? [hero] : [hero, tabs]
      if (protocolPending || legacyHost) {
        if (legacyHost) children.push(h('div', {
          key: 'restart-required', role: 'alert', className: 'dsh-tako-section',
          'data-testid': 'dsh-tako-console-restart-required',
          style: { color: 'var(--dsw-alias-state-warn-primary)' },
        }, t('consoleRestartRequired')))
        else if (catalogError !== undefined) children.push(h('div', {
          key: 'catalog-error', role: 'alert', className: 'dsh-tako-section',
          style: { color: 'var(--dsw-alias-state-error-primary)' },
        }, `${t('loadFailed')}: ${catalogError}`,
        h('button', { type: 'button', onClick: () => { void loadCatalog() }, className: 'dsh-tako-ghost' }, t('retry'))))
        else children.push(h('div', { key: 'protocol-loading', style: muted }, '…'))
        children.push(h(OverviewTab, {
          key: 'overview', t, status, login, busyLogout, onLogout: logout, logoutNote,
          onKeyChanged: async () => {}, allowKeyEditor: false, origin, notice: undefined,
          dismissed: [], onDismiss: () => {},
        }))
        if (catalog !== undefined) children.push(h(CatalogCard, {
          key: 'catalog', t, catalog, error: catalogError, origin,
          onRefresh: () => { void loadCatalog() },
        }))
        return renderPage(children)
      }
      if (statusError !== undefined) {
        children.push(h('div', { key: 'err', role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '0.9em', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          `${t('loadFailed')}: ${statusError}`,
          h('button', { type: 'button', onClick: () => { void loadStatus(); void loadCatalog() }, className: 'dsh-tako-ghost' }, t('retry'))))
      }
      const onKeyChanged = async () => { await loadStatus(); notifyCredential() }
      if (tab === 'overview') children.push(h(OverviewTab, { key: 'overview', t, status, login, busyLogout, onLogout: logout, logoutNote, onKeyChanged, origin, notice, dismissed: dismissedNotice, onDismiss: item => setDismissedNotice([...(Array.isArray(dismissedNotice) ? dismissedNotice : []), noticeId(item)]) }))
      else if (tab === 'requests') children.push(h(RequestsTab, { key: 'requests', t, catalog }))
      else if (tab === 'usage') children.push(h(UsageTab, { key: 'usage', t }))
      else if (tab === 'models') children.push(h(ModelsTab, { key: 'models', t, catalog, catalogError, origin, onRefresh: () => { void loadCatalog() } }))
      else if (tab === 'key') children.push(h(KeyTab, { key: 'key', t, status, configured: status !== undefined && status.configured === true, onKeyChanged }))
      else if (tab === 'config') children.push(h(ConfigTab, { key: 'config', t }))
      return renderPage(children)
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
