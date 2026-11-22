/*
 * dsh-tako browser half:
 *  - Settings -> Models provider card ("Sign in to Tako" + paste key)
 *  - Model Directory panel ("Tako Models", full-width flat grid/table aligned with Tako Plaza)
 *  - Console panel ("Tako Console", Overview / Usage / Requests / Key / Settings)
 *  - Sidebar footer quota card ("dsh-tako-quota", 4 states x 3 widths)
 *
 * Hand-written in the Web client's module format (classic script, no build step,
 * no ES module syntax; React comes from the page's module table). All visible texts
 * flow through the host's `ctx.locale` service with a symmetric zh/en inline
 * fallback dictionary.
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
    const ACTIVE_MODEL_ROUTE = 'api/tako.model'

    /** Host protocol required for 0.6+ routes. */
    const CONSOLE_API_VERSION = 2
    const UPGRADE_COMMAND = 'dsh plugin --profile web add dsh-tako'
    const PI_AI_NS = 'llm-pi-ai'
    const PROVIDER = 'tako'
    const PANEL_ID = 'tako-console'
    const MODELS_PANEL_ID = 'tako-models'
    const POLL_MS = 1500
    const NS = 'dsh-tako'
    const INTERNAL_USD_PER_CNY = 3
    const LOW_WALLET_CNY = 10
    const DEFAULT_TAKO_ORIGIN = 'https://tako.shiroha.tech'

    const DEFAULT_PREFS = {
      priceMode: 'detail',
      currency: 'cny',
      tokenUnit: 'M',
      layout: 'card',
      sort: 'rec',
    }

    // Complete symmetric zh/en dictionary registered with ctx.locale and used as inline fallback.
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
        // panels & header
        panel: 'Tako 控制台',
        modelsPanel: 'Tako 模型',
        modelsSub: '{count} 个对话模型',
        gotoModels: '模型目录 →',
        gotoConsole: '控制台 →',
        backToConsole: '← 返回控制台',
        allUsage: '全部用量 →',
        consoleTitle: 'Tako',
        accountCard: '登录状态',
        signedIn: '已登录',
        signedOut: '未登录',
        connected: '已连接',
        signedOutLead: '登录后，额度、模型和搜索会跟这把钥匙走',
        signinTitle: '登录 Tako 查看额度与用量',
        signinDesc: '登录后插件会把 Tako 模型接入 DSH 对话，并在侧栏显示套餐与钱包余额。',
        signinRemoteHint: '远程机器 / SSH / 没有浏览器时用粘贴方式',
        account: '账号',
        plan: '套餐',
        paygoBadge: '按量',
        noPlanBadge: '无套餐',
        unknown: '未知',
        whoamiFailed: '账号信息获取失败',
        signOut: '退出',
        signOutWorking: '退出中…',
        logoutRevoked: '已在 Tako 吊销这个 key，并从 dsh 凭据中删除',
        logoutRemoved: '已从 dsh 凭据中删除，但在 Tako 吊销失败',
        logoutNone: '没有已保存的 Tako key',
        logoutExternal: '这个 key 来自环境变量或 .env，插件不去吊销或删除；要停用请在对应位置移除',
        // quota & overview
        quotaCard: '余额 / 额度',
        quotaRemain: '剩余额度',
        quotaUsed: '已用额度',
        quotaPoints: '点',
        quotaUsedShare: '已用占比 {percent}',
        quotaNoteUsd: '美元按 Tako 官网口径换算：500,000 点 = $1',
        quotaNoteUnknown: '单位是 Tako 额度点数；美元换算未知',
        quotaNeedsLogin: '需要登录后查看',
        quotaUnavailable: '暂时拿不到额度信息',
        walletBalance: '钱包',
        walletBalanceTitle: '钱包余额',
        walletLow: '余额偏低',
        internalEquiv: '内部额度 {amount}',
        cnyEquiv: '≈ 人民币 {amount}',
        kpiRecentSpend: '近期花费',
        kpiDailyAvg: '日均 {amount}',
        kpiTotalUsed: '累计已用',
        kpiRecentReq: '近期请求',
        kpiSuccessRate: '成功率 {rate}',
        planWindows: '套餐额度',
        planQuotaTitle: '套餐额度',
        windowHours: '{hours}h',
        windowHoursLong: '{hours} 小时窗口',
        weeklyShort: '周',
        thisWeek: '本周',
        quotaRemaining: '剩余',
        quotaUsedOf: '已用 {used} / {limit}',
        quotaAvailAmount: '{amount} 可用',
        planWindowWarn: '{hours} 小时额度即将用尽，超出部分将从钱包按量扣费',
        paygoTitle: '按量计费',
        paygoDesc: '当前账号没有订阅套餐，所有调用从钱包按量扣费。订阅后可获得 5 小时 / 周额度窗口。',
        learnPlans: '了解套餐 ↗',
        spendChartTitle: '近期花费',
        spendChartSum: '合计 {amount}',
        spendChartEmpty: '暂无近期消费记录',
        todayLabel: '今天',
        topModelsTitle: '花费最多的模型',
        topModelsToday: '今日',
        topModelsOther: '其他 {count} 个模型',
        topModelsEmpty: '暂无模型消费记录',
        footerRemain: '剩余',
        footerRemainShort: '剩',
        footerUsed: '已用',
        footerSignIn: '登录 Tako',
        footerSignInHint: '登录后显示套餐额度与钱包余额',
        footerPaygoHint: '钱包余额 · 按量扣费',
        footerLowWarn: '{window} 额度偏低',
        // catalog & plaza model directory
        catalogCard: '模型',
        catalogModel: '模型',
        catalogContext: '上下文窗口',
        catalogVision: '图片输入',
        visionBadge: '视觉',
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
        searchModelsPlaceholder: '搜索模型名、供应商、简介',
        currentChatLabel: '当前对话',
        notSelected: '未选择',
        filterBtn: '筛选',
        filterDone: '完成',
        filterClear: '清空',
        filterResetAll: '重置全部筛选',
        clearSearch: '清除搜索',
        filterVendor: '供应商',
        filterVendorExpand: '展开全部 {count} 家',
        filterVendorCollapse: '收起',
        filterCapability: '能力',
        filterBilling: '计费方式',
        capReasoning: '推理',
        capVision: '视觉',
        capCode: '代码',
        capTools: '工具调用',
        capLongContext: '1M 上下文',
        billAll: '全部',
        billToken: '按量',
        billCall: '按次',
        billFree: '免费',
        billDynamic: '动态计费',
        billCallBadge: '按次计费',
        billCallShort: '按次',
        billCallFixed: '按次 · 固定价',
        billCallHint: '一次调用固定扣费，与 token 数无关',
        perCall: '/ 次',
        freeNoChargeHint: '不扣钱包与套餐额度',
        priceDetail: '明细价',
        priceAvg: '均价',
        currencyTitle: '货币',
        curCnyShort: '人民币',
        curUsdShort: '内部额度',
        curCnyTitle: '¥ 人民币实付价（默认）',
        curCnyDesc: '= 内部额度美元 ÷ 3，即钱包实际扣费',
        curUsdTitle: '$ 内部额度',
        curUsdDesc: '¥1 = $3 内部额度，非美元现金',
        usdWarnChip: '¥1 = $3 内部额度，非美元现金',
        cnyNote: '人民币实付价 = 内部额度 ÷ 3',
        discountNote: '折扣 = 相对官方价（按量模型才显示）',
        legendDetail: '输入 · 缓存读 · 输出',
        legendAvg: '大号 = 近 7 日实测 · 小字 = 标准负载',
        tokenUnitTitle: 'Token 单位',
        per1M: '每 1M',
        per1K: '每 1K',
        sortRec: '推荐',
        sortRecDesc: '收藏置顶，其后按运营推荐',
        sortPrice: '价格从低到高',
        sortPriceDesc: '按当前价格视图主数字',
        sortDisc: '折扣力度',
        sortDiscDesc: '相对官方倍率从低到高',
        sortName: '名称',
        sortNameDesc: 'A → Z',
        viewCard: '卡片',
        viewTable: '表格',
        quickAll: '全部',
        quickFav: '★ 收藏',
        quickPromo: '限时优惠',
        quickCheap: '≤1 折',
        quickCode: '编码',
        quickLong: '1M 上下文',
        quickVision: '视觉',
        modelsCount: '{count} 个模型',
        priceInput: '输入',
        priceCache: '缓存读',
        priceOutput: '输出',
        priceRealizedTag: '近7日实测',
        priceStdTag: '标准负载价',
        priceRealizedSub: '标准负载 {std} · 缓存命中 {hit}',
        priceRealizedSubNoHit: '标准负载 {std}',
        priceNewNoRealized: '新上线，暂无 7 日实测数据',
        priceOrig: '原价 {price}',
        priceNoData: '暂无定价数据',
        discountBadge: '≈ {ratio}x 官方 {fold} 折',
        promoBar: '官方原价折算 {price} / {unit} 输入',
        promoEnds: '截至 {date}',
        setChatModel: '设为对话模型',
        currentChatModel: '✓ 当前对话模型',
        setChatNeedLogin: '登录 Tako 后才能用 Tako 模型对话',
        setChatDone: '已设为当前对话模型：{model}',
        setChatFallback: '已复制模型 ID {model}，请在模型选择器中切换',
        favAdd: '收藏',
        favAdded: '已收藏',
        favAddToast: '已收藏 {model}（同步到插件 pinned 配置）',
        favRemoveToast: '已取消收藏 {model}',
        copyModelId: '复制 ID',
        copiedModelId: '已复制模型 ID {model}',
        plazaShort: '广场 ↗',
        colModel: '模型',
        colBilling: '计费',
        colRealized: '近7日实测均价',
        colStdLoad: '标准负载价',
        colCacheHit: '缓存命中',
        colVsOfficial: '相对官方',
        colActions: '操作',
        noRealizedShort: '暂无实测',
        emptySearchTitle: '没有找到「{q}」',
        emptySearchDesc: '搜索会匹配模型 ID、供应商与简介。插件目录只含对话模型，生图 / 语音请到 Tako 网页广场。',
        emptyFilterTitle: '当前筛选条件下没有模型',
        emptyFilterDesc: '试试放宽供应商或能力条件',
        drawerFullPrice: '价格全量（{cur}，{unit}）',
        drawerOfficialRef: '官方 {price}',
        drawerRealized7d: '近 7 日实测',
        drawerCacheHit: '缓存命中 {hit}',
        drawerInDsh: '在 DSH 中',
        drawerEffort: '推理强度',
        drawerChannelsCount: '{count} 条',
        drawerContext: '{ctx} 上下文',
        // update
        updateCard: '更新',
        updateAvailable: '有新版本',
        updateCommand: '升级命令（升级后重启 dsh 生效）:',
        upToDate: '已是最新版本 {version}',
        verUpToDate: '已是最新',
        checkUpdate: '检查更新',
        pluginVersion: 'dsh-tako {version}',
        copy: '复制',
        copied: '已复制',
        updateFailed: '检查更新失败',
        updateNow: '立即更新',
        updating: '正在更新…',
        updateInstalled: '已安装 {version}，请重启 dsh 后生效',
        updateInstallFailed: '更新失败',
        // services
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
        keyPlaintextHost: '明文只在主机内，不下发浏览器',
        // legacy catalog toolbar keys (kept for compatibility)
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
        noticeSameOrigin: '与 Tako 站点同源',
        noticeEmpty: '暂无公告',
        noticeExpand: '展开',
        noticeCollapse: '收起',
        noticeHistory: '历史公告 ({count})',
        noticeHistoryHide: '收起历史',
        // model card meta
        cardChannels: '渠道',
        cardEndpoints: '端点',
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
        colStatus: '状态',
        statusSuccess: '成功',
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
        pinTitle: '收藏（置顶到推荐首位）',
        unpinTitle: '取消收藏',
        pinFailed: '收藏保存失败',
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
        configPinnedField: '置顶 / 收藏模型（逗号分隔）',
        configSearchProvider: '联网搜索',
        configSearchHint: '登录后自动设置，不覆盖用户自选',
        configSearchTako: 'Tako',
        configSearchDefault: '官方默认',
        configOverrides: '模型覆盖（只读）',
        configCatalogSection: '目录同步',
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
        // panels & header
        panel: 'Tako Console',
        modelsPanel: 'Tako Models',
        modelsSub: '{count} chat models',
        gotoModels: 'Model directory →',
        gotoConsole: 'Console →',
        backToConsole: '← Back to console',
        allUsage: 'All usage →',
        consoleTitle: 'Tako',
        accountCard: 'Sign-in status',
        signedIn: 'Signed in',
        signedOut: 'Not signed in',
        connected: 'Connected',
        signedOutLead: 'Sign in and quota, models, and search follow this key',
        signinTitle: 'Sign in to Tako for quota & usage',
        signinDesc: 'Sign in to route Tako models in DSH chat and display plan quota & wallet balance in the sidebar.',
        signinRemoteHint: 'Use API key paste on remote machines, SSH, or without a browser',
        account: 'Account',
        plan: 'Plan',
        paygoBadge: 'PayGo',
        noPlanBadge: 'No plan',
        unknown: 'unknown',
        whoamiFailed: 'Could not fetch the account',
        signOut: 'Sign out',
        signOutWorking: 'Signing out…',
        logoutRevoked: 'The key was revoked on Tako and removed from dsh credentials',
        logoutRemoved: 'Removed from dsh credentials, but revoking it on Tako failed',
        logoutNone: 'No Tako key is stored',
        logoutExternal: 'This key comes from an environment variable or .env; remove it there instead',
        // quota & overview
        quotaCard: 'Quota',
        quotaRemain: 'Credit remaining',
        quotaUsed: 'Credit used',
        quotaPoints: 'points',
        quotaUsedShare: '{percent} used',
        quotaNoteUsd: 'USD is converted the way the Tako site does it: 500,000 points = $1',
        quotaNoteUnknown: 'Shown in Tako quota points; the USD conversion is unknown',
        quotaNeedsLogin: 'Sign in to see your quota',
        quotaUnavailable: 'Quota information is unavailable',
        walletBalance: 'Wallet',
        walletBalanceTitle: 'Wallet balance',
        walletLow: 'Low balance',
        internalEquiv: 'Internal {amount}',
        cnyEquiv: '≈ CNY {amount}',
        kpiRecentSpend: 'Recent spend',
        kpiDailyAvg: 'Daily avg {amount}',
        kpiTotalUsed: 'Total used',
        kpiRecentReq: 'Recent requests',
        kpiSuccessRate: 'Success {rate}',
        planWindows: 'Plan windows',
        planQuotaTitle: 'Plan quota',
        windowHours: '{hours}h',
        windowHoursLong: '{hours}-hour window',
        weeklyShort: 'Wk',
        thisWeek: 'This week',
        quotaRemaining: 'left',
        quotaUsedOf: 'Used {used} / {limit}',
        quotaAvailAmount: '{amount} left',
        planWindowWarn: '{hours}h quota nearly exhausted; overage will be billed from your wallet',
        paygoTitle: 'Pay-as-you-go',
        paygoDesc: 'No active subscription plan. Requests bill directly from your wallet; subscribe for 5h / weekly quota windows.',
        learnPlans: 'Explore plans ↗',
        spendChartTitle: 'Recent spend',
        spendChartSum: 'Total {amount}',
        spendChartEmpty: 'No recent spend records',
        todayLabel: 'Today',
        topModelsTitle: 'Top models',
        topModelsToday: 'Today',
        topModelsOther: '{count} other models',
        topModelsEmpty: 'No model spend yet',
        footerRemain: 'Left',
        footerRemainShort: 'Left',
        footerUsed: 'Used',
        footerSignIn: 'Sign in to Tako',
        footerSignInHint: 'Sign in to view plan quota & wallet balance',
        footerPaygoHint: 'Wallet · Pay-as-you-go',
        footerLowWarn: '{window} quota low',
        // catalog & plaza model directory
        catalogCard: 'Models',
        catalogModel: 'Model',
        catalogContext: 'Context window',
        catalogVision: 'Image input',
        visionBadge: 'Vision',
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
        searchModelsPlaceholder: 'Search model, vendor, description',
        currentChatLabel: 'Active chat',
        notSelected: 'Not selected',
        filterBtn: 'Filter',
        filterDone: 'Done',
        filterClear: 'Clear',
        filterResetAll: 'Reset all filters',
        clearSearch: 'Clear search',
        filterVendor: 'Vendor',
        filterVendorExpand: 'Show all {count}',
        filterVendorCollapse: 'Show less',
        filterCapability: 'Capabilities',
        filterBilling: 'Billing',
        capReasoning: 'Reasoning',
        capVision: 'Vision',
        capCode: 'Code',
        capTools: 'Tools',
        capLongContext: '1M context',
        billAll: 'All',
        billToken: 'Token',
        billCall: 'Per call',
        billFree: 'Free',
        billDynamic: 'Dynamic',
        billCallBadge: 'Per call',
        billCallShort: 'Call',
        billCallFixed: 'Per call · fixed',
        billCallHint: 'Fixed fee per request, independent of token count',
        perCall: '/ call',
        freeNoChargeHint: 'Does not consume wallet or plan quota',
        priceDetail: 'Breakdown',
        priceAvg: 'Average',
        currencyTitle: 'Currency',
        curCnyShort: 'CNY',
        curUsdShort: 'Internal',
        curCnyTitle: '¥ CNY actual spend (default)',
        curCnyDesc: '= internal USD ÷ 3, actual wallet spend',
        curUsdTitle: '$ Internal credit',
        curUsdDesc: '¥1 = $3 internal credit, not USD cash',
        usdWarnChip: '¥1 = $3 internal credit, not USD cash',
        cnyNote: 'CNY actual = internal credit ÷ 3',
        discountNote: 'Discount vs official (token models only)',
        legendDetail: 'Input · Cache read · Output',
        legendAvg: 'Large = 7-day realized · Small = standard load',
        tokenUnitTitle: 'Token unit',
        per1M: 'Per 1M',
        per1K: 'Per 1K',
        sortRec: 'Recommended',
        sortRecDesc: 'Favorites first, then curated order',
        sortPrice: 'Lowest price',
        sortPriceDesc: 'By primary price in current view',
        sortDisc: 'Best discount',
        sortDiscDesc: 'Lowest ratio vs official',
        sortName: 'Name',
        sortNameDesc: 'A → Z',
        viewCard: 'Cards',
        viewTable: 'Table',
        quickAll: 'All',
        quickFav: '★ Favorites',
        quickPromo: 'Promo',
        quickCheap: '≤10%',
        quickCode: 'Code',
        quickLong: '1M context',
        quickVision: 'Vision',
        modelsCount: '{count} models',
        priceInput: 'Input',
        priceCache: 'Cache read',
        priceOutput: 'Output',
        priceRealizedTag: '7d realized',
        priceStdTag: 'Std load',
        priceRealizedSub: 'Std load {std} · Cache hit {hit}',
        priceRealizedSubNoHit: 'Std load {std}',
        priceNewNoRealized: 'New model, no 7-day realized data yet',
        priceOrig: 'Was {price}',
        priceNoData: 'No pricing data',
        discountBadge: '≈ {ratio}x official',
        promoBar: 'Official list equiv. {price} / {unit} input',
        promoEnds: 'Until {date}',
        setChatModel: 'Use for chat',
        currentChatModel: '✓ Active model',
        setChatNeedLogin: 'Sign in to Tako before using Tako models',
        setChatDone: 'Active chat model set to {model}',
        setChatFallback: 'Copied {model}; select it in the model picker',
        favAdd: 'Favorite',
        favAdded: 'Favorited',
        favAddToast: 'Favorited {model} (saved to pinned config)',
        favRemoveToast: 'Removed {model} from favorites',
        copyModelId: 'Copy ID',
        copiedModelId: 'Copied model ID {model}',
        plazaShort: 'Plaza ↗',
        colModel: 'Model',
        colBilling: 'Billing',
        colRealized: '7d realized',
        colStdLoad: 'Std load',
        colCacheHit: 'Cache hit',
        colVsOfficial: 'vs Official',
        colActions: 'Actions',
        noRealizedShort: 'No data',
        emptySearchTitle: 'No results for "{q}"',
        emptySearchDesc: 'Search matches model ID, vendor, and description. Only chat models appear here; visit Tako web plaza for image/speech.',
        emptyFilterTitle: 'No models match current filters',
        emptyFilterDesc: 'Try broadening vendor or capability filters',
        drawerFullPrice: 'Full pricing ({cur}, {unit})',
        drawerOfficialRef: 'Official {price}',
        drawerRealized7d: '7-day realized',
        drawerCacheHit: 'Cache hit {hit}',
        drawerInDsh: 'In DSH',
        drawerEffort: 'Reasoning effort',
        drawerChannelsCount: '{count} ch',
        drawerContext: '{ctx} context',
        // update
        updateCard: 'Update',
        updateAvailable: 'Update available:',
        updateCommand: 'Upgrade command (restart dsh after upgrading):',
        upToDate: 'Up to date: {version}',
        verUpToDate: 'Up to date',
        checkUpdate: 'Check updates',
        pluginVersion: 'dsh-tako {version}',
        copy: 'Copy',
        copied: 'Copied',
        updateFailed: 'Could not check for updates',
        updateNow: 'Update now',
        updating: 'Updating…',
        updateInstalled: 'Installed {version}. Restart dsh to load it.',
        updateInstallFailed: 'Update failed',
        // services
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
        keyPlaintextHost: 'Plaintext stays on the host only',
        // legacy catalog toolbar keys
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
        noticeSameOrigin: 'Synced with Tako site',
        noticeEmpty: 'No announcements',
        noticeExpand: 'Expand',
        noticeCollapse: 'Collapse',
        noticeHistory: 'History ({count})',
        noticeHistoryHide: 'Hide history',
        // model card meta
        cardChannels: 'channels',
        cardEndpoints: 'endpoints',
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
        colStatus: 'Status',
        statusSuccess: 'OK',
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
        pinTitle: 'Favorite (pin to top)',
        unpinTitle: 'Remove favorite',
        pinFailed: 'Could not save favorites',
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
        configPinnedField: 'Pinned / favorite models (comma-separated)',
        configSearchProvider: 'Web search',
        configSearchHint: 'Auto-set on sign-in without overwriting user choice',
        configSearchTako: 'Tako',
        configSearchDefault: 'Official default',
        configOverrides: 'Model overrides (read-only)',
        configCatalogSection: 'Catalog sync',
      },
    }

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
    let boundT = fallbackT

    const loopback = () => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(window.location.hostname)
      || window.__DSH_TAKO_PROFILE__ === true
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

    // ---------------------------------------------------------------- unified money & preferences

    /** Convert Tako internal USD to actual CNY (`¥1 = $3` internal credit). */
    const usdToCny = usd => typeof usd === 'number' && Number.isFinite(usd) ? usd / INTERNAL_USD_PER_CNY : null

    /**
     * Single price formatter aligned with Tako Plaza spec §3.1.
     * Takes a CNY actual-spend figure; currency/unit conversion happens only here.
     */
    function money(cny, options) {
      if (cny === null || cny === undefined || !Number.isFinite(cny)) return null
      const opts = options || {}
      const perToken = opts.perToken !== false
      const cur = opts.cur || 'cny'
      const unit = opts.unit || 'M'
      let v = cur === 'usd' ? cny * INTERNAL_USD_PER_CNY : cny
      if (perToken && unit === 'K') v = v / 1000
      const sym = cur === 'usd' ? '$' : '¥'
      let s
      if (v === 0) s = '0'
      else if (Math.abs(v) >= 100) s = v.toFixed(0)
      else if (Math.abs(v) >= 1) s = (+v.toFixed(2)).toString()
      else s = (+v.toPrecision(3)).toString()
      if (s.includes('e')) s = v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
      return sym + s
    }

    /** Convenience wrapper for catalog/pricing USD figures. */
    const moneyFromUsd = (usd, opts) => money(usdToCny(usd), opts)

    /**
     * Account / wallet / quota amount formatter: fixed decimals (default 2, 3 for per-request logs),
     * unaffected by the /1K token unit toggle.
     */
    function amt(cny, cur, digits) {
      if (cny === null || cny === undefined || !Number.isFinite(cny)) return '—'
      const c = cur || 'cny'
      const d = typeof digits === 'number' ? digits : 2
      const v = c === 'usd' ? cny * INTERNAL_USD_PER_CNY : cny
      return (c === 'usd' ? '$' : '¥') + v.toFixed(d)
    }
    const amtFromUsd = (usd, cur, digits) => amt(usdToCny(usd), cur, digits)
    const unitTxt = prefs => `${prefs.currency === 'usd' ? '$' : '¥'} / ${prefs.tokenUnit === 'K' ? '1K' : '1M'} tokens`

    /** Shared in-memory prefs so Models, Console and Footer stay synchronized instantly. */
    let sharedPrefs = { ...DEFAULT_PREFS }
    const normalizePrefs = raw => {
      if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
      return {
        priceMode: raw.priceMode === 'avg' ? 'avg' : 'detail',
        currency: raw.currency === 'usd' ? 'usd' : 'cny',
        tokenUnit: raw.tokenUnit === 'K' ? 'K' : 'M',
        layout: raw.layout === 'table' ? 'table' : 'card',
        sort: ['rec', 'price', 'disc', 'name'].includes(raw.sort) ? raw.sort : 'rec',
      }
    }
    const publishPrefs = next => {
      sharedPrefs = next
      try {
        window.dispatchEvent(new CustomEvent('dsh-tako-prefs', { detail: next }))
      } catch {
        try { window.dispatchEvent(new Event('dsh-tako-prefs')) } catch {}
      }
    }

    function useTakoPrefs(loadFromHost) {
      const [prefs, setPrefs] = useState(() => ({ ...sharedPrefs }))
      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        const onSync = event => {
          const detail = event && event.detail ? normalizePrefs(event.detail) : { ...sharedPrefs }
          if (alive.current) setPrefs(detail)
        }
        window.addEventListener('dsh-tako-prefs', onSync)
        return () => { alive.current = false; window.removeEventListener('dsh-tako-prefs', onSync) }
      }, [])
      useEffect(() => {
        if (loadFromHost !== true) return
        void (async () => {
          try {
            const result = await call('GET', CONFIG_ROUTE)
            if (!alive.current || !result || result.ok !== true || !result.config || !result.config.ui) return
            const next = normalizePrefs(result.config.ui)
            publishPrefs(next)
          } catch { /* older host or offline */ }
        })()
      }, [loadFromHost])
      const updatePrefs = patch => {
        const next = normalizePrefs({ ...sharedPrefs, ...patch })
        publishPrefs(next)
        if (loadFromHost !== false) {
          void call('POST', CONFIG_ROUTE, { set: { ui: next } }).catch(() => {})
        }
      }
      return [prefs, updatePrefs]
    }

    /** Host protocol check for Settings -> Models card. */
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
            if (alive) timer = setTimeout(probe, 2000)
          }
        }
        void probe()
        return () => { alive = false; clearTimeout(timer) }
      }, [])
      return version
    }

    // ---------------------------------------------------------------- browser sign-in

    function useTakoLogin() {
      const [state, setState] = useState({ status: 'idle' })
      const timer = useRef(undefined)
      const alive = useRef(true)
      const controller = useRef(undefined)
      const invalidate = () => {
        if (timer.current !== undefined) clearTimeout(timer.current)
        controller.current?.abort()
      }
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; invalidate() }
      }, [])

      const poll = (id, request) => {
        timer.current = setTimeout(async () => {
          if (!alive.current || request.signal.aborted) return
          try {
            const next = await call('GET', `${ROUTE}?id=${encodeURIComponent(id)}`, undefined, request.signal)
            if (!alive.current || request.signal.aborted) return
            if (next.status === 'pending') { setState(next); poll(id, request); return }
            const settled = next.status === 'idle' ? { status: 'error', code: 'failed', message: 'sign-in no longer pending' } : next
            setState(settled)
            if (settled.status === 'success') notifyCredential()
          } catch (error) {
            if (alive.current && !request.signal.aborted) setState({ status: 'error', code: 'failed', message: String(error && error.message || error) })
          }
        }, POLL_MS)
      }

      const start = async () => {
        if (!alive.current) return
        invalidate()
        const request = new AbortController()
        controller.current = request
        const tab = window.open('about:blank', '_blank')
        setState({ status: 'starting' })
        try {
          const started = await call('POST', ROUTE, { action: 'start' }, request.signal)
          if (!alive.current || request.signal.aborted) {
            if (tab) tab.close()
            return
          }
          if (started.status !== 'pending') {
            if (tab) tab.close()
            setState(started)
            return
          }
          if (tab) {
            try { tab.opener = null } catch {}
            tab.location.href = started.url
          } else if (typeof started.url === 'string' && started.url !== '') {
            window.open(started.url, '_blank')
          }
          setState(started)
          poll(started.id, request)
        } catch (error) {
          if (tab) tab.close()
          if (alive.current && !request.signal.aborted) setState({ status: 'error', code: 'failed', message: String(error && error.message || error) })
        }
      }
      const cancel = async () => {
        invalidate()
        const request = new AbortController()
        controller.current = request
        try { await call('POST', ROUTE, { action: 'cancel' }, request.signal) } catch {}
        if (alive.current && !request.signal.aborted) setState({ status: 'idle' })
      }

      const clearSuccess = () => { if (state.status === 'success') setState({ status: 'idle' }) }
      const busy = state.status === 'starting' || state.status === 'pending'
      return { state, start, cancel, clearSuccess, busy }
    }

    function LoginProgress(props) {
      const state = props.state
      const t = props.t ?? fallbackT
      const children = []
      const note = (key, text, tone) => children.push(h('div', {
        key,
        role: tone === 'error' ? 'alert' : 'status',
        style: {
          fontSize: '0.85em',
          opacity: tone === 'muted' ? 0.72 : 1,
          color: tone === 'error' ? 'var(--tk-err,var(--dsw-alias-state-error-primary))'
            : tone === 'ok' ? 'var(--tk-save,var(--dsw-alias-state-success-primary))' : 'inherit',
          overflowWrap: 'anywhere',
        },
      }, text))
      if (state.status === 'pending') {
        note('wait', t('waiting'), 'muted')
        children.push(h('a', { key: 'link', href: state.url, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: '0.85em', color: 'var(--tk-brand,#2f7cf6)' } }, t('openLink')))
      } else if (state.status === 'success') {
        const who = [state.user, state.plan].filter(Boolean).join(' · ')
        note('ok', `${t('success')}${who ? `（${who}）` : ''} — ${state.key} → ${state.credential}`, 'ok')
      } else if (state.status === 'error') {
        if (state.code !== 'cancelled') note('err', state.code === 'denied' ? t('denied') : state.code === 'timeout' ? t('timeout') : `${t('failed')}: ${state.message}`, 'error')
      }
      if (!loopback()) note('remote', t('remote'), 'muted')
      return children.length === 0 ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, children)
    }

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
            props.onSaved?.()
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
        props.hideLabel === true ? null : h('div', { key: 'label', style: { fontSize: '0.85em', opacity: 0.72 } }, t('keyOrPaste')),
        h('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            key: 'input',
            type: 'password',
            value,
            placeholder: t('keyPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            'data-testid': props.inputTestId || 'dsh-tako-paste-key-input',
            onChange: event => setValue(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') void save() },
            className: 'tk-input',
            style: { minWidth: '200px', flex: '1 1 200px' },
          }),
          h('button', {
            key: 'save',
            type: 'button',
            disabled: busy || value.trim() === '',
            onClick: save,
            'data-testid': props.saveTestId || 'dsh-tako-paste-key-save',
            className: 'tk-btn',
          }, busy ? t('keySaving') : t('keySave'))),
      ]
      if (note !== undefined) {
        children.push(h('div', {
          key: 'note',
          role: note.tone === 'error' ? 'alert' : 'status',
          'data-testid': 'dsh-tako-key-note',
          style: {
            fontSize: '0.85em',
            overflowWrap: 'anywhere',
            color: note.tone === 'error' ? 'var(--tk-err,var(--dsw-alias-state-error-primary))' : 'var(--tk-save,var(--dsw-alias-state-success-primary))',
          },
        }, note.text))
      }
      return h('div', { 'data-testid': props.wrapTestId || 'dsh-tako-paste-key', style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, children)
    }

    function TakoSignIn(props) {
      const provider = props.provider
      const t = props.t ?? fallbackT
      const login = useTakoLogin()
      const consoleApiVersion = useConsoleApiVersion()
      if (provider === undefined || provider.provider !== PROVIDER) return null
      ensureTakoTheme()
      const children = [
        h('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            disabled: login.busy,
            onClick: login.start,
            'data-testid': 'dsh-tako-sign-in',
            className: 'tk-btn tk-btn-pri',
          }, props.keyConfigured ? t('signInAgain') : t('signIn')),
          login.busy ? h('button', { type: 'button', onClick: login.cancel, className: 'tk-btn' }, t('cancel')) : null),
      ]
      const progress = LoginProgress({ state: login.state, t })
      if (progress !== null) children.push(h('div', { key: 'progress' }, progress))
      if (consoleApiVersion === CONSOLE_API_VERSION) children.push(h(PasteKeyRow, { key: 'paste', t }))
      else if (consoleApiVersion === 0) children.push(h('div', {
        key: 'restart-required', role: 'alert', 'data-testid': 'dsh-tako-sign-in-restart-required',
        style: { fontSize: '0.85em', color: 'var(--dsw-alias-state-warn-primary,#d97706)' },
      }, t('consoleRestartRequired')))
      return h('div', { 'data-dsh-tako': 'sign-in', className: 'dsh-tako-root', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } }, children)
    }

    // ---------------------------------------------------------------- brand mark & icons

    // DSH loads this as a classic script, so the mark is an inlined PNG data URL.
    const TAKO_MARK_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAAXNSR0IArs4c6QAAAHhlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAQCgAwAEAAAAAQAAAQAAAAAAVGUufgAAAAlwSFlzAAALEwAACxMBAJqcGAAALdBJREFUeAHtnQmUXNV557/3Xi29SN2t1oYkJEDCILMji8V27GRwyLFZDQ4DdmIntscYxp7J5ByfM4mTeDy2Y8/JyXjIOWPWAXMgwWCNN2zwTObkeAsGDBKYHQFCaEN7q1u91fLem///VlerulXV9Wp5r15Vf/eo1LXcd5ffvd937/3uJqJOCSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSiBphOwmh5iGwQ4/OnrBr2EvTqVcFZlXPckR6wVSPYSX6Qff1OAkvRE5iWbNii+upJoi/go3xwezuI1jMI96Iq/P2FZO9y8u8P2ZEf/3ZsO1xV4Gz80Lyr5xI2fWJOxcxfb4l/silyIyrAW4r00YdmJhG2JZQEDaofP/9R1PAGUeEG9o7jzvic5z8uj6A9A6W9LiGx2xXosLf5vum9/cHunw+hYBTBy8x+fblveBz3fvxqvDWnH6Xcg6C4KPO/5gu9U3Du9dgfMH4XARt1gY+BYNuqIL+gZjqCh2AJN8RPx5JG+O7/zSsDg2spbRykA/wsf7x0dcy9Dpj4BQb+kO+H0uOz3eZ4R+LYqGU1sSwlQISRtGwrBkgk3P26J/QvL9u+d8POPLrt102hLE9fEyDtCARy5+WOLLPH/BJn5dwnbPhOKXLKuCn0T68m8DorKIAVlwD5jzvNf9n3/rqPjmftOvO8Hh9odTFsrgD03XtmzMNHzKfGtP0s5zqns2rO1V6cEwiLAXkESLcyk621D5/KWidHEPSfcf/9YWPGFHW7bKoCRm/7oCsf2/gta/I0q+GFXEw1/NgEqAtoM0CPY4on/5b5bv/Pj2X7a4XPbKYCDN123KmUlvoqE/ykKwMqgq69OCbSKQMqB0RA9T8wk3ZvJTv7N4v/1/V2tSks98baVAjj82Y9eie7XLemEvXYix5kbdUqg9QQoRN3JBO1Ob+Zc988X3fHQj1qfqmApaAsF8PSNNybXWSNfQrfrL2GPcXScH6xw1Ve0BDgswGoSN+fJf9t9KP+VMzdt4qKjWLvYK4A9N350yQJH7upy7A/D8KLTebGuTpo4zhigrspk3v3RWMb9zIpvbzoQZyqxVgCY3luLyZfvdCWcC8fR5VenBNqFQE8iQSXwtOd5Nwzc+dAbcU13bBXAoc9ed0bKTnwfRpbTJ/JYwKtOCbQZASxEk4znbc3lstcuvut7L8Yx+bFUAEf//fXvFN/+CcZUayddFf44VhxNUzACXY7DtSnbxMtfufCOTS8Feyo6X7FTAOz2OyKPwtp/ugp/dBVBYwqPAJVA1nO3emJ/aOC2B7aFF1PtIdNsGRs38rlrFovvPZRyVPhjUyiakIYJsCHDZrTTLNRtU8cbDrF5AcRGAfiY6vPd9N09CWejjvmbV8AaUjwIsE53JxIbXTd1N+t6PFKFXZBxScgRzPPD2n/1uBr84lIkmo4mExjP5wWzA1ezrjc56LqDi4UN4PBN11+RtpwfuuI5WFWpTgl0LAHuVLXFcl3Xv7r/zgcfaXVGW64ADnzqhpXptDyGgxhO1hV+ra4OGn8UBLhiEOdVbM9k5L1L73lwTxRxVoqj5UOARNL/RpeTUOGvVEL6fccRYEPHOp9IyddbnbmW9gAO33zD5WnLfjjvebb2/FtdFTT+KAlQ8LCV3cu7+Sv77/juo1HGXRpXy3oAsIT2WL7/t1g7rcJfWiL6fl4QYINXqPvW31IWWpXplimAEXv4U7CInovDF1uVd41XCbSUAOs+thGfN+KMfLJVCWnJEIBn+Il4m5OWfYoa/lpV9BpvHAjQIJjz3TdFnHdhleBQ1GlqSQ/Ad/0/wUYJFf6oS1vjix0BNoA9TuIU33M/0YrERa4AeHQ3Rv2fzfO8bnVKQAnwXEEeKXbTXshG1DgiVwDDI9nLsC56vXb9oy5qjS+uBCgLlIneo7kPRZ3GSBUA2nzcryB/2hLDQ9RkNT4lUAMByoRr+Z80MlLDc416jVQWRz5z/Wl+wnoGkfbokt9Gi06f7yQCXCIMmRjPuf75S+96aGtUeYu0B+DackW3k1Dhj6p0NZ62IcAGEdPi2AxrXR5loiNTAOzawF3JixfVRUSArHlTkoeLsDHn7Ls4Sh070syL74uv4nf8a77D2gyuz+CzWl4RFRaQF1hfRVmJKtLIIjp843VrLNt5Hpct9vFmXnVNJkCmuPkY99YhYFyAjZNprWRarHSX2F1dYnV1m/dWCt8lk2LxCGu+6CDoPl+5nPjZjPjYpeJnJsSbnMDfSXyXNQqEF6hDiSN4PMe/6ppKgCcKQzaGxz33nJV3btrR1MArBIbr0KNxvp24uNux+3TlXxN5U2gh9FhNDQGHoC/sF2dgkTiLloizsE+snh6xUhB+HEklfNGVCm5RD5fKclE5s/VnbwDKwBsfE/foiLhHDos7dEg8vPepHKbinlYkhRj0/zoJsGHkNfbQAhchiM5SAFjw/x5etayuQQJFoXcSRtgTy1eKs/QECP2g2N1YUo7vjZvqEUy/r2fJtZ2AEkE8vQvEWbaiEC6UAnsG3tBhye9/27zckWHTe5jRqyj41v9rJEAZwb/34LFNNT5al/dIegBf/jIm//b6G/NoMdTVQQDCzC46BczuH5DkqjWSXLkaCmBQJJlCgGjK2WJT6CGgzXMIj70EhivHyo6KxoZSSJx4kkguK+7wkOT27JTc7h3iDR+ZTuuM3kbzEtXRIRkZsa2NIM7mkuBDdZE0ycOfvm5Qks4LGOOsUCNgDeVJwUfLzTF8YvkqSZ1yKlr75ejWp1E1IJBmLjX0OlI9wVP2BNoP3AP7JPvmG5J/e5d4sB+Y4Yf2/KoznPLBHkDe998esOwzrQj2BkTSA/AS9mpomqVq/AtYD0yLD8Hv7pXUmlMkferpYvdh/xTV9dTYPGBI0XhjmthDwfAjgZ5JYsVq9ASGJLttq2TfwpH4E2PovcAGoYqganlQRigrY+KvhufQNwdFogB8sdekbSuRZUVRNycBTsPZ6W5Jrz1NUqeuh2Gvb6q1b4Nt0xwqTNkaOFTp2nCxpE47Q7Kvv2KUAW0HVBLqKhNgfw47BBOu567B2+cq+2zOL5GUhmP7axJoAVQBzFFomKsXMEqvO13S68/GWJ87pqEwmzqmnyP+Zv9klD2uwuhZIF3nXSipte+QzMvPS3b7G8hXIa/NjrJTwuMWYWyWowII3UWiAJCLE0LPSbtGMNXdTyxZLl3nbJDECasKRrd2FfzZ5UBbBW515hRl90Xvk+RJa2Xy+S2Sh61AhwWzYR37jEPypqZdjn0XxrtIFAC6NUsiMGiGwSfcMNkSJpLSdea5ptXnAp1iFzrciFsQ+tTwjwqud/Eyyb76gky+/IJIPmt6Pi1IUayjtHxZHEUCI1EAmMzoi4GtOgqegePgWD+BBTtd77oYFn4oe46dp8bPgQNpR4/II2cG0mdvEAdrGCafflzyQwfVNlBSlpj74VpOGH/Cd1NrQUOPiJPV6khgylBGI1/vJR+UxDKMjrAGvzDXPk8QkQHynMCUZu+/+aAxeBq7AL9XZwhACWCuN3wXSQ8A0xqxuQstfKRzxMDxsOVI1/kbJX36WfCICj8fWv1KSNgbSKWk+8L3GaPn5HNbgAQ9Ie41mOcuKpmJRAGw2s/z8izMk7OyX/BeYwgzrf68hwIAptXHGvh3nmNWF0489ZjZfDTf9xdEJTORKIB5X89h7LOwqKfn3b+L8f7KQpd/3kOZBQA2keSatWbH4vjjvxAfi4c4LaouXALa1wqXr5nz5rr53t+5pCD8nTK9FwY3GkahIHvf9wH0BhYW1guEEY+GOU1AFcA0ihDeYOrLtPzvvUScJcsw3m/mRp0Q0huHIMHIWbxUesDM6sEhuVPTh3FIWiemQRVAWKUKg5+Fa4973/N7qNAUfhi31AUjAFZUAr3v/j0zJFAlEAxbPb5UAdRDrdozNGxh/Np94e8U9tFry1+N2PG/syeAMwi6L3xv4TATnSI8nlETvlEF0ASIxwWBytp97gWSPPFk7fYfB6eGL6AEyLD7vAswWaBrBGogF9irKoDAqIJ55Aq/FLbvchecjvmDMZvTF3m+4wyzSYps1TWXgCqAZvLEdJ/Z1HPuRsxvYyZXXXMIgGXXeRsNW7NisDmhaiggoAqgWdUAXVQLx3N1Y21/4cQe7bI2Cy0XC5GpYcsj0HQ40DS0qgCahBK3u0r6jHPV4t8knscFY2YGlhnGZK2uOQRUATSDI7v+S1dImuN+rZzNIFo+DCpZME7whGLlXJ5Rjd+qAqgR2PHe0dXHMVc8zEMSWFmt3dPjETXrG7IF4y5sJS4cf67DrEbRqgJokCBP7U1hDfv0nv4Gw9PHqxAAb7LmYalkr64xAqoAGuGHFskc4PnOs7Xlb4Rjrc+CexrMyV57XLXCm+lfFcBMHjV9YguUPHntsQM8a3paPddNAPsD7H5cNYHzBbUXUDdF86AqgHr5sfXHhR1pHN2tc/71QmzgOawNIHuWgfYC6ueoCqBOdpyKSqxco61/nfwafoy9AFyEyjLQacH6aaoCqJMdL7jgWffqWkgAkwCptaeaQ0ZbmIq2jloVQD3Fh9bfWbRYEtiyqtt86wHYpGfYC8NWa16HrusC6mOqCqAObtyZllx9sjnTv47H9ZFmEsC9CkncUqy7BeuDqgqgZm6FdenJFSeq8a9mdiE8AGMgr0o3+y/Cv007hAy0NkhVALXyx5XczsBg4dJOPa6qVnrN909jIC5QZZkUrktvfhSdHKIqgBpL10eFS/JkX73ltkZyIXpHWSSxOpBlo642AqoAauNlLM4ObrRB/7/GJ9V7eATQK8PlqrxyTF1tBFQB1MILxj+rq1uc/gF0N1vQ2iB+Ey/j5oufW+3ikCawYJmwbGLBpNVlUkP8ejFIDbC44s/BNddWKuLVZ9z6yksyuntEWMm565DHY01OiEzgxU0xuFNerIguYCoKPVvcnqk0cUjEOw6ZJr6Kaa6Fb71+kR4L+wJYNnleKILr19QFI6AKIBgn44tTTTZbf1b8KM6nYyvPuLDaTVZi1gHGLl4nPu2YhtGjIm/vFtmLVy5XUATTHkJ4wzTxGnNc8y0r8FqACzxK7SF5pOHoCNK0C2nac0w5hZCUGUGCE8vG37db76GbAWbuD6oA5uYz81f0uE33P4qGlq16X78ILxFdBAt3OUfB619UeK1aLfLqiyJDhwq9hXL+G/2OrToWQMnpZ0IZIW3lHBUU/fCF6Tl5BWkaOVJQZOX8N/E7h7xiMCpqYpZCD0ptADUgthxb7J4F4Y8z2cpyleGGiyoL/+x0UyDPu1CEp+VQeTTbMUyGzTgqCf/sODk1twH+mRfmKVSH3hmuE7M4FFIXmIDSCowKHu0ErqvCmJdj4LAcBYXd6rPPx0L3Gq+Ip23gzPMKSqOZAsew2KIzbMZRi2MemBfmqZlpmp0G2gFYNqXDkdl+9PNxBFQBHIekwhesYKj8Fru4YSoAtmDs9tcq/MVkU0DXnz0lqM1QVAiDeV6PNNUq/MU0MS/MU5itsymfpCmjUMunmKcO+asKoIaCNAqABrCwHMfY7GYPorVtxNFYyPG324RuN8MoGiAbSRPztOyEwuxAI+HM8SyVM8tIXXACSisoK7b6sDSbxSbNaFjLxWtBH69aU+6X47579rnn5enNm2XJ4sWy4fzzZM1qCHypowLYvaPx3goFimEFcE/85il54cUXZfny5bJxw/my4gQIfKlj3va9XfpN896jTEzZcNbEWAKjsNQ2L/mtCkkVQC3kKaBmkikEDUAFwzEspxkDuGTCkX/41q1YBjApg4OL5N9ee418/uabpatrym7AMTdfw7DA19v15pid6WE4AZwLQ+Hf/Y9bsFzCl6VLl8gnPvZR+cynPgm9OTUvzxkLXvk9PhbCmgVqAAg9y4jFo/IfoMRQNQL5Uk+GgLEwh1WxqAB60XUvCksV5u9cv15OXbdOUqmkjI+Py2133S1f/trXsBYHawPoKAy01jPceh2fZRgBFxidf+456ImcaNI0PDwsf3/LP8jffRMKoZgG5q03xFkUI/9apWspbqVVAy0fKwFDm2emkHRjlV8FNzyMxTUlbveePbJ33z407piaxKunp1u+98OH5ceP/vSYL64cbNTNEcYRCHmp2/bmdjl0aMikh61+N/Jz3z/9k/ziV/96zBvDKyqEY9825x0QmjJqTmjzIhRVALUUs5nGYosaUjegQuvPFvQrX/+G3HH3PfLWjh2y+dln5Ytf+rIcOXLECBuzYKGVdrBO4bv/+3vHegEVwqsly5V6JOxp/MVf/4088NB3kaad8viTT8qXvvo1yWQmTVqKafLA7CGkidSMa0aaimHN+MsyQSymjGb8oB/mIKA2gDngzPiJ3WBULh9WcbPUfLpGz/DV2IcKVvujR4/KFgj9w48+Knffey+ELCvZbBYrcmfOSCRgsNu2fbvs279fVq3ElmWMyRt2nJko4/YfOCBbnnlWfvbLX0l/Xx9sEROIDkd0zbLC8/MrW7cKhwQD/RhONCNNZdJDnWyOCGf4AYcs5YKZb99pD6CGEvexzp2vUBwbMG6iKeNGx8Yg9BlJp1LG6MdWdbbw8zH2AqgYRkaOFkKpEF6ZKCp/xc1GZRyVUg69gBSU0PiUn9nCz8eYpkn8PoY8GMc0Ma8hOB/p8aPYoxFC2lsVpCqAoOTZwrCCccNNGC0MrddjENwyXdgezA6k02ljTKNA8VXJUTEsWABLO91RjNHn8FvwNMf/fJYbe8qM2XthzKPw09lzpIkdJaadeeBuShkdRZpCqHZIA8uGZRSWgjGZ7bD/QiiJDiM0nR0IA7qXvtluWlkAp73X+obCNg7h4MaZWY5dbFr8py38s34vfuTvtMKfgHl4M9XGnYJ2A2nls6NQAJy2m+WWL1sqa9asqZ4mCOW6dWsL3X8aDSeoABpI06x0TH+kAmDZmB5ACOFPR9RZb1QB1FCevIDCM8JQZwVjxS++SuMtfkcbwO6dpb+Y92zx//DaDx/3/ewv2CW/9uqrCsOD3TsK24Mbag6RXvZ49hyfJvY0rv3wVWYYMDsdsz9fd801hV4L08Q8FvNb6rH4Hf/W5Szxxkb1WLAa2akCqBGYW6aFDhqEh/F5Hq1g9uBBycCIZl54n4M1352cxBoAFMd+rJQbHjouyEsvuUSuw2KfMcz50wZQ6jhLwDH2H3zgEvkIhM202FQkmB5s2DEMhsXeySz3kauvlg9e+vsm7um5/ik/TCPT+pEPf1gu/f0PFBYkMW8Ij3llnjMlHMiEbMioXp3ljsyclpyVXP1YhoDOApSBUukrjL7FQ8Wt6RIKtGi0Thshp7GszHjao/DDqGZjFV8S6/jtV18qbKPlJpwpx7n+v/7Lv5CFCxeaaTUa4YquB/PtN1z3h/Kfv/AFSXNc/sIzaLkhSM1QAGyRGRb39Z+3EWE6xWix4Ccl3/jqV2TRokXy8E8eMQuSij8ynX90w/Xy5//xP4hDhYWzCjzkPzcyIh4MmuWcSz7Il4P8JAdwxBenDMvwKvcsy8TDqkeWkbrgBCKhNXTTDT/qSThXTeTLTykFT26LfaIy2ljIsuAPrhILhq0glZMn1WYPHUSlZ8tWBTfCZ6VPYWmvzXXzFbbfvvb66/LrJ54UTsUNQvguuvACOeuMMwpwXvwtuuw7ZghqU6hxeo1p4lXoZRTLiy+9LE889Rs5fHhIli1dKu+++CI57dRTC8ry+WfE27VTskOHC1N1ATjYUC6pJUuC7e+nksX6g9F//jGUzHh1zk0BEl4g3VjmPZ53H150+4NXhxdLIWTtAdRCGBXNmxwXd2RIEstWQgFUUWjw76JrHkj4mQ5WZAhaHs+k9u9Fy/ubwjbcBVgiXOLeAcHia4ZjxX/lBZGD+5ov/IyIrTEVSw6t92k4EYhr+kvcmWe8U/ia4WiEZJpwSlGe43MqEeSxqiNnDAXILgEDaFVFi1kFF60/yyZQ+FUTMH88qAKosaxZid2D+yXBM/FmDsXLhmTGtGV/qfyll+NUFgQFLaY8/URhOy7P38OJNzNaX3aPOTbfi7H17rdE0AqWdtErx1DnL+z+H4CC4Vh71Uk4FxBbl3lCUqlQs7sPYTdnAu7ZVRg+UKA5PVejC8wOsxUsE5YNL21VF5yA0grOyvjkGDMPgUuvPyfQk/XsTzdjXwoVX1x4tP0NkV0QcApb8dQbtqZs9akAaKlnt7xkfB4ocfV4Yhw01L3xqsiObYU0cX0/ewicgoPhz6SJAm/ShHTB2fjdZTprcIHZYWiZ37dHx/81sC16VQVQJBH0Lyq1iy6th/lxm4dQssWr5NBAJxYsEBq3CgtUINBzObboEPokDGhG+Kc+G+Hi+1G0vEdhhMTbgq0L4VHIKHyzHZUHf2P6+Gw9rlIY/J5xMmzOimBINJ0m/oYu+Yw04bsE8uRmMXzAVuEZPYZy6UJ6Kfxkd2wTQTmP+A559NAjcdlbYn7V1URAidWEC55Rmb0sprF4DDcr+pyuUJHTMGbZRaMhhbFUIIufWelhwU/hgA+7q8K9A4yPLTCFj38rVXiTxqyMvbUNygctcjkFMWe68SOe4bMMozA1B8Eu55iG0jSVY4K8MU/MG/No8l/MdzHM4mf6BSsyK/QAqigvxJfDsegsk6qKpRiX/p0moD2AaRTB31iodPmd2yV96vrqD6FCs9KnYRnn/LfpDaArPH2PHYTVRmvHqS8KSU1TX5Vih1BO4Hz8fU/+UtKLlsri8y6QrqUnoPXFsIGCNpdDeijQkwf2yqFnn5LM0EFZftH7pPekdWYl5FyPzvkb4nVwqYm9NGU4cErQ2AWm0sOzFsiJHBwqQKajWloZIYYd+V3b4b2aMp4zdfP2R1UA9RQ9Kmv+0AFxDx80d9JVXRcwVZFN5UYFZ9e5uHDGrOtnK0pHf0EqfcF35f8RPgW+d+UaGUdPZd/jP5f+detl4brTIFxTa/JL46KwmRcX6YzL0Tewe++NV9CqZhDG6inlMcdQp3JKZv6COCnoiV7MIPBVyoHLjotCXJq2mSHM/ARF5cIoybKo2Bua+YR+mkVAFcAsIEE/ctdZ9s3XpNtcFBrwqaJwQ9hmbOgpfh8wmKreEB4FfdlF75cjrzwvI9telaGXfyujaCkXrD5ZupevkiTG1/aUxdyDoTGHTTrsNYyiZ5PDJiIbrfEATvIdwAnDxrLOjTzNcsX8NsoBz2e3vwbrf16t/3WWjSqAOsFZaH1ysMynISC8n94YxOoMK5THILAcTiw6awMEfqUMb31JJtCtP/zis+LgvQPLvUO7BJyLlXkc77tY8Wdj9WEPpjj7Mddvhg3mFKQmCn+zMouehAcDJMuAZaGuPgKqAOrjZrrMHva2ZzEd1nX+RQglhkLClhaLlSjIXbidZxJz5WO7d0jm8AFcogmBp4EQji18Egd/LhhcKj1Y7de9ZFnBsFfhMBDzUKv/w3CB7FkGOvdff2GoAqifnWl5sttflxSMgTZPzuW0WBzdlCB34c6BruUrsG8eq+xgkPS4xh/OTqaM4c3CXzPtRv9xFn62/pgOzb75urb+DdY3NZ02AhBjUK49z3C5a9GA1Uh4YT9LoeZqOVxxlujFgR647osvvud35riuOAt+kQ9YZ7A5SZf+FoHU/1cVQP3szJMcf7IX4Ia1Br/B9JV/fGq2gT0WvoxRrsr0YPmAov+Wln+wJnMd+zeOXxVAowzRC+BRVJPPbYl3t7nRfMblefRQyDq0o9niks+I0qEKoAmgaW3nysDs61gfP+tU3CYEr0EUCYAtDX9kbRZMFb/Xv3UTUAVQN7qZD3KByyQO4nAPHypY0Gf+rJ8aJcCuP9iSsbmhqdHw9HlDQBVAsyoCDYLYjju5Bdt3uYMPn9U1iQBZginZmtOTlG2TwKKtalpIGpDpluawLXXyedgD0CNQ1yQC7F2BKdlq179JTKeC0VraXJ5mUUpm64sYq27FjjpdZtEwXjAkSzLVBT8N0zwuAFUAxyFpxhe4DeeZJ3FwyC5VAo3ghPCTIVliTNVISPpsBQKqACqAaehrjFE5TTX+xK/E5U61evbjN5SADniY5xFgyTIZ6pRfeOWpCiAsthi3+rhEZPzXP8NR4jgxR5VAcNJg5eFuhPHHfmYYqj0lOLpafaoCqJVYLf7ZiuG02rFf/HOhJ6CGwer0wIi9prGfgxnYqeKsjqwRH6oAGqE317NTS2wT2IXnYL09t636vBBDp7AqU+PQCYeQkBWZkZ1ZphzXTVaVc9I2v6iZOoyiwnJVp3+RpM/ZKAnsvjPn4M1Ydx9GpB0QJvYk0NLfdfYGM43KsT9P+838drO5i8GcPdgB2YxTFlQBNLs0IOjOwKD0vP/SwhZh3obEI7zptPUvcJjrfzLi5iSza9GRJE4wYm9g/Jf/T1zaUnQYNRe9mn/TIUDNyKo8gHF/14aLxeYlHuYyjDl22bGiz+cKzbybnYiVmIIPGJIlmao9oBKn+r9XBVA/u+OfRKuVwBmBCZ7Ay0sy5nKo/Fke241TeswGonnVO0Arj409zHuWl4tUO0sBLMk0sWT5sd7UXGz1t8AEVAEERlXdo4/jdNhdDdSqs9Kj9Rv92f+RzMvPF1rC+TBVaPLo40CP55H3/1vId5BeEPw4g4tBeI4eVfUiUh+zCKgNYBaQRj+aY7UCBQKDVxrn36OLO7EFqwb37JSuc941dcw4D+nAq5McezjmMI/9WNe/2VzmwbV9VgoMAgp1cLadBC7cvKgCCJdv9dAhGNzemt+7R8Yw/51cexpOGj7LXEM+9/i4etCx8YE8mqPTXn1RctjPT+u+2dSj03stLyIdArS8CKYSgK4xb7fNvPQc1r7jWvBOsgkgL8xT5sXfmjyqMS8ulQ6dsvgkRVNCoWfLyIsuOs3xclTT6neSYuuAQlIFEMtC5Oi4w5wKfiwLVBVALIulxkTRih6lgDGuIJb7GrOh3qMnoAogeuZNjZFda16Q6eM4MiOUPJSUU23NUgpFYWeYDBvhMi73wH5h3Oram4DOArRz+UE4/eykjP3qX8SCcNrYf8B1CM6iQSxD7sNMQjf2IeC2HwovV9zNuequBASFni9Y6Sns5irvsaPiDh3G6xC2Nx82xrwFl16O8LHiMWi4JVHo23gQUAUQj3KoPxVTwurh7AFvbFRyu3dgWhHCi0s+bVz+aaWhBPCXl5gmcElo1Su/MFef3/+2ue2Iwu/j5iNeE871Cj4UgrnVGHGaNQyMW11bE1AF0NbFV5J4CiO659MiCWH1xnH55xgUA4Q3ueokEdz6W9UhHG9kGEt038RNwageDLcYNocVdNriFzh0wP+qADqgECtmYUp4a55+w3PmmaLAV4xAf2h3AmoEbPcS1PQrgQYIqAJoAJ4+qgTanYAqgHYvQU2/EmiAgCqABuDpo0qg3QmoAmj3EtT0K4EGCKgCaACePqoE2p2AKoB2L0FNvxJogIAqgAbg6aNKoN0JqAJo9xLU9CuBBgioAmgAnj6qBNqdgCqAdi9BTb8SaICAKoAG4OmjSqDdCagCaPcS1PQrgQYIqAJoAJ4+qgTanYAqgGaXYC1n3Xfa5R/1sKyFQS1s60nLPHxGFUCTC90dHUGIAa6vwp577+iIOWWnyUlom+B4whAZmANHqqbalwLbqh7VQw0EVAHUAKuaV4vHae17W3wczWUO5az0AA/qwO04heO75m8R8EYkMiCLOZUA/JEp2ZKxuuYRmL+1r3kMj4XEVh1n802+8GzhOwr6bMfvnIRkXntZ3EO4GXg+n7qDvJMBWZBJWSVgGOJmITAl27J+ZjPWz4EJ6JFggVEF88ijtLLbtpqTeLvO3iBWFy6/LJ6hx8qM8/kyL/1WJp/bgsqs+pcMJp/bbOCmTzujcPR4CS9/chKXiW4xTM0xZcGKQX0FJKAKICComryhZctufcmcrptcfbI4A4NG2L2jw5Lb9Za4B9HyUxmY1q2mkDvPMxlA4CeffcqwSZ54ktgL+/GdJy6OH8/t3I5jyIeMQu28zLc+R6oAwioD9AS84SMyObQFjVyhpfdRqS22+tW6/bSMB7AjmqR79BjUczMziziLLXW1YE0S57jufEoZUjHmD+wtMGKuYCQ07HivgbpQCKgCCAXrVKAQ9KLw8xsryF2sEAYz1nVhGOO4eC4hQ/i8dtvPZqPtTSCNjJPHjpvWGrcaV3QU7nwu2PidvEoYlbKrGL7+0BABHYQ2hC+EhynUOJc/j+u+ql6jDeHKo4vMljJqxzjzGM5UHcag9c4f3GfyVLXnE3UmNL4Sdasw4kOAY2JYvWkAqyg0uLTD3btHsttfL5zhH3HqjbHzzddMGsydgeXihzIzRrwXnpm7J1PuWf0uEgLaA4gEc42RQHA4Hh5//OfijWJNAW/o4TjYvArv87t3yNgTvxSfc+hB3FxDidnPB1ydx7iZhvzunTPSZtKJNHujR00e3IMHKiuy2XHr50gJoDapiyUBdp337JLRI49Ics0pkliyDBeAJs2YP//2LiyggdB5GHtDWVR3PlbcDdMIUd3Bj1mdF8SwyBYec/Nj//ovkly5WhIrTsSFpD24NTiHbv9+yeF6Mf5edShTPVXqIyQCqgBCAtuUYKEE/MkJXNT5vGRpTMMMgrGMM3D2BgIJP4fpWHH39m5J47JPKpGKhkUa9zDsyEHBmNmKIJlgGtC7oLDzPkFjuEMPwsd3ZtUe06kutgSCNB+xTfy8SBiE0uJsAJfAmvf4W6tQQUjd4SFz4695lspktuN3CDfzygvweySwcpkOBs+ahToMB2k1aS4Xz/QD+iYOBLQHEIdSiCANbJkzLz1nWuX0+rNEkiU9AQoqxvP8PfMy/Wi7EEGRxCIKVQCxKIYIEkEh5+wClt3m9uwwdgWnb8BE7I4cQRd+e2GFIoVfW+4ICiQeUUSiADhKjEd253kqKNjoqruHDhojXbGlN3YFrlCsdWgxz3GGmf2oZCYSBQDpDzhXFSZSDXuaAFr5GSvuHFQ3dbEiEJXMRFXyWKuqTgkogaAEYPrNBPXbiL9IFAB6nsPofKpTAkogAAEIP8bMPo+WCt1FogCwUv0QLEuhZ0YjUAKdQgDScjCKvESiADCe2RtFZjQOJdAxBHwrEpmJxAgonrUjb0W/Y61jKoNmZF4RyGGnpWt5O6LIdCQ9AOxw35H1vLwOAqIoUo2jnQlQRvKen0tZducoADvv7cQw4ICtC0zauW5q2iMgQBnBToqDebF2RhBdNOcB9N29aQgZeyNhax8gikLVONqXgJER33qj/7YHsCEjfBfREACzGp487XC1mToloAQqEqCM2Jb/FJpKdJrDd5FJJA7E/LVby6EU4eddY1ACsSNAGclb/uNRJSwyBYBLoJ6cdN0RtQNEVbQaT7sRoGxkXHe427KeiCrtkSmARXdu2oluzZakbjWNqmw1njYjYGTDsrZ03/rgrqiSHpkC4JgGg5qHHZ0JiKpsNZ42I0DZoIxENf4nnsgUACNzXP+R8Xx+XCcDSEOdEjhGgN1/Ixue9cixb8N/F6kCWHjXQ6+hI/DzFI+3UqcElMA0gRS3aFvys747Hnh9+ssI3kSqAEzXxpN7I5nfiACeRqEEmkWAMoGzVO+NsvvPtEeqABjhZF/q0UzefSWph1AQhzolIDT+wfr/8uTC5E+jxhG5Ajjh7+8fw17n2xNqDIy6rDW+mBKgAkDLfztlI+okRq4AmEGcF3/fhOu+qVOCURe3xhc3ApQBGP+2+ZZ9fyvS1hIFMHDbA0Oe739T9wa0osg1zjgRoAx4lnyTMtGKdLVEATCjk17/PRO5/LNpPYm2FeWuccaAAOv+OGRg0u37dquS0zIFsPLOO8ethPNX6AlAAapTAvOLAOs86z7sYX9FWWhV7lumAJjh/m898Gje8+7v5u236pTAPCLAOo+6f9/gHd99tJXZbqkCYMazWfnihJvfrgbBVlYDjTtKAlz0wzqf8BJfjDLecnG1XAEsvefBPa4rn8dtsq4uES5XRPpdJxFgHUe3P++67ud77/zHt1udt5YrAAIYvPPBR3Ke/w01CLa6Omj8YRNgHc+irg/euSnSNf+V8hULBcDEDfh9XxnPuz/qUXtApbLS79ucAOs2uv4/HPD6vhqXrMTKAD/yuWsW+176p12Oc8FE3o0LI02HEmiYQHfC4XLfp8TOfKjvWz/ARTnxcLHpARAHwUxK7oaM670KJRAPQpoKJdAgAdblLOq0h7odJ+FntmKlAJig5bd9b1vW8q7BPQLbVAmQiLp2JsA6jIs+tomXv3YAdTtueYmdAiCgJbc+9LJleVfkfO8Vdp3UKYF2JMC6C+P2q1kvf+XCOza9FMc8xFIBENRCKAHXTlyG4cBvepK6UCiOlUfTVJkADX5o+Z8cl8xli2Mq/Ex9bBUAEzfwP+9/c9SVy3Ga8A96oE31RGFSURdnAqyjrKuosz/0rOTlHNLGOb2x71//980vjH/k/PT3B2TQdyx5b8Kybb1fIM5Vav6mjatZ8S8P+9XX+9y+z3fdfs9o3GnEahqwGqzDN11/RdKyb0knnHXYSRjN1SnVEqW/z3sCFKJuDFMzeQ/7+v3/1Hfrd37cLlBiPQSYDXHw9od+kvHzvzvp5u/Bkko/rceKzUaknyMmwDqIbr8/mfPuzfi597eT8BNVW/UASsuWvQGcLvylpG1dgOuUaXAp/VnfK4FQCbC7z8M8UO82Z135r4N3tE+rXwqmbRUAM7Hnxit7Fjq9n4Qe+7OU47wD2ytVEZSWrr5vOgEKPhodGPm8NyzLumXsqPPtE+6P/iy/ZmWsrRVAEcKRmz+2CMbXT1i+95mk7ZzJ80ax8ooHLhS96F8lUDcBWvZT6OqzOqGReQl9zbskm7+v/+5Nh+sONCYPdoQCKLLc+/GP9/YucC/Dhss/RiF9oNuxe10UGocHqgyKlPRvEAIUerb2vK4LB9iOQVB+bvly34Sdf3TZrZtib90Pkkf66SgFUJrpkc9df5rtOx+C4F8FHbAhZVsDvHvdxe0LtBlQIWj/oJTY/H1PIaDAc0xfrCNYgDaCq3qewVc/Ft/5Sd9t//hqJxLqWAVQWliHb7xuDS4iucgT+2L0Di6E/K9DxpdCwydY6BjL8ZQGHtRQ+pi+71ACKPFC04fizqNBwHAxjyqwH9ndJr612be8x3zfemrR7Q9u71AE09maFwpgOrdTb4Y/fd2gm0qc6Ii3Ch2Bk1EhVqAuLMHP/dABKVSGJIYQ85LNbFad8hnz3Th0SnIo1SzyNIzCPeiKvz9h22+5rrfDzns7O2FM3ynlpflQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAm1N4P8DCcVHyxq+iEcAAAAASUVORK5CYII='

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

    function TakoModelsIcon(props) {
      const s = props.size || 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z' }),
        h('path', { d: 'M4 7.5L12 12l8-4.5M12 12v9' }))
    }

    const Icon = {
      search: (sz = 14) => h('svg', { width: sz, height: sz, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', 'aria-hidden': true },
        h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.5-3.5' })),
      star: (filled) => filled
        ? h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
          h('path', { d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' }))
        : h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' })),
      grid: () => h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', 'aria-hidden': true },
        h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }),
        h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 })),
      list: () => h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', 'aria-hidden': true },
        h('path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' })),
      chev: () => h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.4', 'aria-hidden': true },
        h('path', { d: 'm6 9 6 6 6-6' })),
      filter: (sz = 14) => h('svg', { width: sz, height: sz, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', 'aria-hidden': true },
        h('path', { d: 'M3 5h18l-7 8v6l-4-2v-4z' })),
    }

    const mono = { fontFamily: 'var(--tk-mono,"JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace)', fontVariantNumeric: 'tabular-nums' }
    const muted = { color: 'var(--tk-ink-500,var(--dsw-alias-label-tertiary))' }
    const rowStyle = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }

    const VENDOR_PALETTE = {
      DeepSeek: { c: '#4d6bfe', l: 'D' },
      Anthropic: { c: '#d97757', l: 'A' },
      OpenAI: { c: '#10a37f', l: 'O' },
      Google: { c: '#4285f4', l: 'G' },
      Moonshot: { c: '#16161a', l: 'K' },
      Alibaba: { c: '#ff6a00', l: 'Q' },
      '智谱': { c: '#3859ff', l: 'Z' },
      xAI: { c: '#444444', l: 'X' },
      Xiaomi: { c: '#ff6900', l: 'M' },
      '腾讯混元': { c: '#006eff', l: 'H' },
      '字节跳动': { c: '#2d6cff', l: 'B' },
      Cognition: { c: '#0ea5e9', l: 'C' },
      Tako: { c: '#ef5a4c', l: 'T' },
      MiniMax: { c: '#f97316', l: 'M' },
      Mistral: { c: '#f59e0b', l: 'M' },
      Meta: { c: '#0866ff', l: 'M' },
    }

    function vendorStyle(name, fallbackId) {
      if (name && VENDOR_PALETTE[name]) return VENDOR_PALETTE[name]
      const label = (name || fallbackId || '?').trim()
      let hash = 0
      for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
      const hues = ['#2f7cf6', '#0f9f6e', '#7c3aed', '#d97706', '#0ea5e9', '#ec4899', '#6366f1']
      return { c: hues[hash % hues.length], l: label.slice(0, 1).toUpperCase() || '?' }
    }

    function VendorLogo(props) {
      const info = vendorStyle(props.vendor, props.fallback)
      return h('span', { className: props.className || 'tk-vlogo', style: { background: info.c }, 'aria-hidden': true }, info.l)
    }

    // ---------------------------------------------------------------- theme stylesheet (DSH alias-mapped + plaza semantic tokens)

    function ensureTakoTheme() {
      if (typeof document.getElementById !== 'function') return
      const css = [
        '.dsh-tako-root{',
        '--tk-brand:#2f7cf6;--tk-brand-600:#1f66db;--tk-brand-50:#eef4ff;--tk-brand-100:#dbe7ff;',
        '--tk-ink-900:var(--dsw-alias-label-primary,#0f172a);',
        '--tk-ink-700:var(--dsw-alias-label-secondary,#334155);',
        '--tk-ink-500:var(--dsw-alias-label-tertiary,#64748b);',
        '--tk-ink-400:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,#94a3b8));',
        '--tk-ink-300:var(--dsw-alias-label-dimmed,#cbd5e1);',
        '--tk-line:var(--dsw-alias-border-l2,#e6eaf0);',
        '--tk-line-soft:var(--dsw-alias-border-l1,#eef1f5);',
        '--tk-bg:var(--dsw-alias-bg-base,#f6f8fb);',
        '--tk-card:var(--dsw-alias-settings-card-fill,#ffffff);',
        '--tk-panel:var(--dsw-alias-bg-module-platform,#fafbfd);',
        '--tk-hover:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.04));',
        '--tk-side:var(--dsw-alias-bg-base,#f1f3f7);',
        '--tk-mask:var(--dsw-alias-bg-mask-1,rgba(15,23,42,.32));',
        '--tk-save:#0f9f6e;--tk-save-bg:#e8f7f0;--tk-save-line:#bfe8d5;',
        '--tk-promo:#e8590c;--tk-promo-bg:#fff4ea;--tk-promo-line:#ffd8b5;',
        '--tk-dyn:#7c3aed;--tk-dyn-bg:#f3edff;',
        '--tk-warn:var(--dsw-alias-state-warn-primary,#d97706);--tk-warn-bg:#fff7e6;',
        '--tk-err:var(--dsw-alias-state-error-primary,#dc2626);--tk-err-bg:#fdecec;',
        '--tk-r-sm:8px;--tk-r-md:12px;--tk-r-lg:16px;--tk-r-pill:999px;',
        '--tk-sh-1:0 1px 2px rgba(15,23,42,.04),0 1px 1px rgba(15,23,42,.03);',
        '--tk-sh-2:0 8px 24px -8px rgba(15,23,42,.12),0 2px 6px rgba(15,23,42,.05);',
        '--tk-sh-pop:0 16px 40px -12px rgba(15,23,42,.22),0 2px 8px rgba(15,23,42,.06);',
        '--tk-mono:"JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace;',
        '--tk-sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",Roboto,sans-serif;',
        'color:var(--tk-ink-900);font-family:var(--tk-sans);box-sizing:border-box;',
        '}',
        '.dsh-tako-root *,.dsh-tako-root *::before,.dsh-tako-root *::after{box-sizing:border-box}',
        'body[data-ds-dark-theme] .dsh-tako-root,html[data-theme="dark"] .dsh-tako-root{',
        '--tk-brand:#5b9bff;--tk-brand-600:#7fb0ff;--tk-brand-50:rgba(91,155,255,.14);--tk-brand-100:rgba(91,155,255,.28);',
        '--tk-ink-900:var(--dsw-alias-label-primary,#eef2f7);',
        '--tk-ink-700:var(--dsw-alias-label-secondary,#c2cbd7);',
        '--tk-ink-500:var(--dsw-alias-label-tertiary,#8b96a6);',
        '--tk-ink-400:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,#657082));',
        '--tk-ink-300:var(--dsw-alias-label-dimmed,#424b59);',
        '--tk-line:var(--dsw-alias-border-l2,#252b36);',
        '--tk-line-soft:var(--dsw-alias-border-l1,#1f242e);',
        '--tk-bg:var(--dsw-alias-bg-base,#111419);',
        '--tk-card:var(--dsw-alias-settings-card-fill,#171b22);',
        '--tk-panel:var(--dsw-alias-bg-layer-2,#1f242d);',
        '--tk-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05));',
        '--tk-side:var(--dsw-alias-bg-base,#151820);',
        '--tk-mask:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.55));',
        '--tk-save:#34d399;--tk-save-bg:rgba(52,211,153,.12);--tk-save-line:rgba(52,211,153,.3);',
        '--tk-promo:#fb923c;--tk-promo-bg:rgba(251,146,60,.12);--tk-promo-line:rgba(251,146,60,.35);',
        '--tk-dyn:#a78bfa;--tk-dyn-bg:rgba(167,139,250,.14);',
        '--tk-warn:var(--dsw-alias-state-warn-primary,#fbbf24);--tk-warn-bg:rgba(251,191,36,.12);',
        '--tk-err:var(--dsw-alias-state-error-primary,#f87171);--tk-err-bg:rgba(248,113,113,.12);',
        '--tk-sh-1:0 1px 2px rgba(0,0,0,.3);--tk-sh-2:0 8px 24px -8px rgba(0,0,0,.6);',
        '--tk-sh-pop:0 16px 40px -12px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.04);',
        '}',
        '.tk-num{font-family:var(--tk-mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}',
        '.tk-mwrap{position:relative;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;overflow:hidden;container-type:inline-size;container-name:plug;background:var(--tk-bg)}',
        '.tk-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}',
        '.tk-page{padding:18px 24px 48px;max-width:1160px;margin:0 auto;font-size:14px;line-height:1.5}',
        '.tk-phead{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}',
        '.tk-phead h1{margin:0;font-size:20px;font-weight:650;letter-spacing:-.01em;line-height:1.25}',
        '.tk-phead .sub{font-size:12px;color:var(--tk-ink-500)}',
        // common controls
        '.tk-seg{display:inline-flex;background:var(--tk-bg);border:1px solid var(--tk-line);border-radius:10px;padding:3px;gap:2px;flex:none}',
        '.tk-seg button{border:0;background:none;padding:4px 11px;border-radius:7px;color:var(--tk-ink-500);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer;line-height:1.4}',
        '.tk-seg button:hover{color:var(--tk-ink-900)}',
        '.tk-seg button.on{background:var(--tk-card);color:var(--tk-ink-900);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.1),0 0 0 1px rgba(15,23,42,.04)}',
        '.tk-seg.icon button{padding:4px 7px;display:grid;place-items:center}',
        '.tk-dd{position:relative;flex:none}',
        '.tk-ddbtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--tk-line);background:var(--tk-card);border-radius:10px;font:inherit;font-size:13px;color:var(--tk-ink-700);white-space:nowrap;cursor:pointer}',
        '.tk-ddbtn:hover{border-color:var(--tk-ink-300)}',
        '.tk-ddbtn .cur{font-weight:700;color:var(--tk-ink-900)}',
        '.tk-pop{position:absolute;right:0;top:calc(100% + 6px);min-width:244px;max-width:calc(100vw - 32px);background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-md);box-shadow:var(--tk-sh-pop);padding:6px;z-index:40}',
        '.tk-pop h6{margin:6px 8px 4px;font-size:11px;color:var(--tk-ink-400);font-weight:600}',
        '.tk-pi{display:flex;align-items:flex-start;gap:10px;width:100%;border:0;background:none;padding:7px 8px;border-radius:8px;text-align:left;cursor:pointer;color:inherit;font:inherit}',
        '.tk-pi:hover{background:var(--tk-hover)}',
        '.tk-pi .rd{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--tk-ink-300);flex:none;margin-top:2px}',
        '.tk-pi.on .rd{border:5px solid var(--tk-brand)}',
        '.tk-pi b{display:block;font-weight:600;font-size:13px}.tk-pi span{display:block;font-size:12px;color:var(--tk-ink-500)}',
        '.tk-pop hr{border:0;border-top:1px solid var(--tk-line-soft);margin:4px 0}',
        '.tk-pop .tk-seg{margin:4px 8px 8px;display:flex}.tk-pop .tk-seg button{flex:1}',
        '.tk-btn{border:1px solid var(--tk-line);background:var(--tk-card);color:var(--tk-ink-900);border-radius:9px;padding:5px 12px;font:inherit;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;cursor:pointer;text-decoration:none;line-height:1.4}',
        '.tk-btn:hover{border-color:var(--tk-ink-300);background:var(--tk-hover)}',
        '.tk-btn:disabled{opacity:.5;cursor:default}',
        '.tk-btn-pri{background:var(--tk-brand);color:#fff;border-color:var(--tk-brand)}',
        '.tk-btn-pri:hover{background:var(--tk-brand-600);border-color:var(--tk-brand-600);color:#fff}',
        '.tk-btn-sm{padding:3px 9px;font-size:12px;border-radius:8px}',
        '.tk-btn-cur{background:var(--tk-brand-50);color:var(--tk-brand-600);border-color:var(--tk-brand-100);font-weight:600}',
        '.tk-btn-cur:hover{background:var(--tk-brand-50);border-color:var(--tk-brand-100)}',
        '.tk-btn-danger{color:var(--tk-err);border-color:var(--tk-err)}',
        '.tk-btn-active{background:var(--tk-brand-50);color:var(--tk-brand-600);border-color:var(--tk-brand-100);font-weight:600}',
        '.tk-iconbtn{width:28px;height:28px;border-radius:8px;border:1px solid var(--tk-line);background:var(--tk-card);display:inline-grid;place-items:center;color:var(--tk-ink-400);flex:none;cursor:pointer;padding:0}',
        '.tk-iconbtn:hover{color:var(--tk-brand);border-color:var(--tk-brand-100)}',
        '.tk-iconbtn.fav{color:#f59e0b;border-color:#fde68a;background:rgba(245,158,11,.1)}',
        '.tk-link{background:none;border:0;color:var(--tk-brand);font:inherit;font-size:12px;padding:2px 4px;cursor:pointer;text-decoration:none}',
        '.tk-link:hover{text-decoration:underline}',
        '.tk-input{font:inherit;font-size:13px;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--tk-line);background:var(--tk-bg);color:var(--tk-ink-900);min-width:0;outline:none}',
        '.tk-input:focus{border-color:var(--tk-brand);background:var(--tk-card);box-shadow:0 0 0 3px var(--tk-brand-50)}',
        '.tk-input:disabled{opacity:.5}',
        '.tk-select{font:inherit;font-size:12px;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--tk-line);background:var(--tk-card);color:var(--tk-ink-900);outline:none}',
        // model directory (flat full-width layout — NO permanent left filter column per shiroha's decision)
        '.tk-search{position:relative;flex:1 1 240px;max-width:420px;min-width:160px;margin-left:auto}',
        '.tk-search input{width:100%;height:34px;border:1px solid var(--tk-line);border-radius:10px;padding:0 48px 0 34px;background:var(--tk-card);color:var(--tk-ink-900);outline:none;font:inherit;font-size:13px}',
        '.tk-search input:focus{border-color:var(--tk-brand);box-shadow:0 0 0 3px var(--tk-brand-50)}',
        '.tk-search .ic{position:absolute;left:11px;top:10px;color:var(--tk-ink-400);pointer-events:none;display:inline-flex}',
        '.tk-search kbd{position:absolute;right:9px;top:7px;font:11px var(--tk-mono);color:var(--tk-ink-500);border:1px solid var(--tk-line);border-radius:5px;padding:1px 5px;background:var(--tk-bg);pointer-events:none}',
        '.tk-chatnow{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--tk-ink-500);border:1px solid var(--tk-line);background:var(--tk-card);border-radius:10px;padding:0 10px;height:34px;white-space:nowrap;max-width:260px}',
        '.tk-chatnow b{font:600 12px var(--tk-mono);color:var(--tk-ink-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.tk-chatnow .dot{width:7px;height:7px;border-radius:50%;background:var(--tk-save);flex:none}',
        '.tk-toolbar{display:flex;align-items:center;gap:8px;background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-lg);padding:6px 8px 6px 10px;box-shadow:var(--tk-sh-1);position:sticky;top:0;z-index:20;flex-wrap:wrap}',
        '.tk-count{font-weight:600;white-space:nowrap;font-size:13px}.tk-count small{color:var(--tk-ink-400);font-weight:400;font-family:var(--tk-mono)}',
        '.tk-tb-r{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}',
        '.tk-quick{display:flex;gap:6px;align-items:center;padding:12px 0 2px;overflow-x:auto;scrollbar-width:none}',
        '.tk-qchip{flex:none;border:1px solid var(--tk-line);background:var(--tk-card);border-radius:var(--tk-r-pill);padding:3px 11px;font:inherit;font-size:12.5px;color:var(--tk-ink-700);display:inline-flex;gap:5px;align-items:center;cursor:pointer;line-height:1.5}',
        '.tk-qchip:hover{border-color:var(--tk-ink-300)}',
        '.tk-qchip.on{background:var(--tk-ink-900);border-color:var(--tk-ink-900);color:var(--tk-card)}',
        '.tk-qchip .dot{width:6px;height:6px;border-radius:50%;background:var(--tk-promo)}',
        '.tk-active-f{display:flex;gap:6px;flex-wrap:wrap;padding:8px 0 0;align-items:center}',
        '.tk-af{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;background:var(--tk-brand-50);color:var(--tk-brand-600);border-radius:var(--tk-r-pill);padding:2px 8px 2px 10px;border:0;cursor:pointer}',
        '.tk-legend{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--tk-ink-500);padding:8px 0 10px;flex-wrap:wrap}',
        '.tk-legend .sep{width:1px;height:12px;background:var(--tk-line)}',
        '.tk-warnchip{color:var(--tk-promo);background:var(--tk-promo-bg);border:1px solid var(--tk-promo-line);border-radius:6px;padding:1px 7px;font-weight:600;font-size:12px;display:inline-flex;align-items:center}',
        // filter popover drawer (on-demand, never takes a permanent column)
        '.tk-filter-drawer{position:absolute;top:0;left:0;bottom:0;width:min(272px,86%);background:var(--tk-card);border-right:1px solid var(--tk-line);z-index:52;box-shadow:var(--tk-sh-pop);display:flex;flex-direction:column;overflow:hidden}',
        '.tk-filter-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--tk-line-soft);font-weight:600;font-size:14px}',
        '.tk-filter-b{flex:1;overflow-y:auto;padding:8px 10px 18px}',
        '.tk-sec{padding:4px 2px;border-top:1px solid var(--tk-line-soft)}.tk-sec:first-of-type{border-top:0}',
        '.tk-sec-t{padding:8px 6px 4px;font-size:12px;color:var(--tk-ink-500);font-weight:600}',
        '.tk-opt{display:flex;align-items:center;gap:8px;width:100%;padding:5px 6px;border:0;background:none;border-radius:var(--tk-r-sm);text-align:left;color:var(--tk-ink-700);font:inherit;font-size:13px;cursor:pointer}',
        '.tk-opt:hover{background:var(--tk-hover)}',
        '.tk-opt.on{background:var(--tk-brand-50);color:var(--tk-brand-600);font-weight:600}',
        '.tk-opt .cnt{margin-left:auto;font:12px var(--tk-mono);color:var(--tk-ink-400)}',
        '.tk-chk{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--tk-ink-300);flex:none;display:grid;place-items:center}',
        '.tk-opt.on .tk-chk{background:var(--tk-brand);border-color:var(--tk-brand)}',
        '.tk-opt.on .tk-chk::after{content:"";width:7px;height:4px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}',
        '.tk-rdo{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--tk-ink-300);flex:none}',
        '.tk-opt.on .tk-rdo{border:4.5px solid var(--tk-brand)}',
        '.tk-vdot{width:16px;height:16px;border-radius:5px;flex:none;display:inline-grid;place-items:center;font:700 10px var(--tk-sans);color:#fff}',
        // full-width model card grid
        '.tk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:14px}',
        '.tk-card{background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-lg);padding:15px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--tk-sh-1);transition:border-color .15s,box-shadow .15s;position:relative;min-width:0;cursor:pointer}',
        '.tk-card:hover{box-shadow:var(--tk-sh-2);border-color:var(--tk-ink-300)}',
        '.tk-card.has-promo{border-color:var(--tk-promo-line)}',
        '.tk-card.is-cur{border-color:var(--tk-brand);box-shadow:0 0 0 3px var(--tk-brand-50)}',
        '.tk-ch{display:flex;gap:10px;align-items:flex-start}',
        '.tk-vlogo{width:34px;height:34px;border-radius:10px;flex:none;display:inline-grid;place-items:center;font:700 14px var(--tk-sans);color:#fff}',
        '.tk-ct{min-width:0;flex:1}',
        '.tk-mname{font:600 14.5px var(--tk-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.02em;color:var(--tk-ink-900)}',
        '.tk-msub{font-size:12px;color:var(--tk-ink-500);display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:1px}',
        '.tk-msub .ds{width:3px;height:3px;border-radius:50%;background:var(--tk-ink-300)}',
        '.tk-badges{display:flex;gap:6px;flex-wrap:wrap;min-height:24px;align-items:center}',
        '.tk-b{display:inline-flex;align-items:center;gap:4px;font-size:12px;border-radius:6px;padding:1px 7px;line-height:20px;white-space:nowrap}',
        '.tk-b-save{background:var(--tk-save-bg);color:var(--tk-save);border:1px solid var(--tk-save-line)}',
        '.tk-b-save b{font-family:var(--tk-mono);font-weight:700}',
        '.tk-b-promo{background:var(--tk-promo-bg);color:var(--tk-promo);border:1px solid var(--tk-promo-line);font-weight:600}',
        '.tk-b-dyn{background:var(--tk-dyn-bg);color:var(--tk-dyn)}',
        '.tk-b-call{background:var(--tk-bg);color:var(--tk-ink-700);border:1px solid var(--tk-line)}',
        '.tk-b-free{background:var(--tk-brand-50);color:var(--tk-brand-600);border:1px solid var(--tk-brand-100);font-weight:600}',
        '.tk-b-err{background:var(--tk-err-bg);color:var(--tk-err)}',
        // single unified price panel per card
        '.tk-price{background:var(--tk-panel);border:1px solid var(--tk-line-soft);border-radius:var(--tk-r-md);padding:11px 13px;min-height:82px;display:flex;flex-direction:column;justify-content:center}',
        '.tk-p3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
        '.tk-pc label{display:block;font-size:11px;color:var(--tk-ink-400);margin-bottom:1px}',
        '.tk-pc .v{font:600 15px var(--tk-mono);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tk-pc .v.na{color:var(--tk-ink-300);font-weight:400}',
        '.tk-pc.cache .v{color:var(--tk-ink-700)}',
        '.tk-pfoot{display:flex;justify-content:space-between;align-items:center;margin-top:7px;font-size:11px;color:var(--tk-ink-400);gap:8px}',
        '.tk-pfoot .unit{font-family:var(--tk-mono)}',
        '.tk-pmain{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}',
        '.tk-pmain .big{font:700 22px var(--tk-mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.2}',
        '.tk-pmain .u{font:12px var(--tk-mono);color:var(--tk-ink-500)}',
        '.tk-pmain .k{font-size:11px;color:var(--tk-ink-500);background:var(--tk-card);border:1px solid var(--tk-line);border-radius:4px;padding:0 5px;margin-left:auto}',
        '.tk-psub{font-size:12px;color:var(--tk-ink-500);margin-top:3px}',
        '.tk-psub .tk-num{color:var(--tk-ink-700)}',
        '.tk-pstrike{font:12px var(--tk-mono);color:var(--tk-ink-400);text-decoration:line-through}',
        '.tk-promo-bar{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tk-promo);background:var(--tk-promo-bg);border-radius:8px;padding:5px 10px;margin-top:-4px}',
        '.tk-promo-bar .end{margin-left:auto;opacity:.85}',
        '.tk-desc{color:var(--tk-ink-700);font-size:13px;line-height:1.55;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:40px}',
        '.tk-cf{display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:10px;border-top:1px dashed var(--tk-line);font-size:12px;color:var(--tk-ink-500)}',
        '.tk-cap{background:var(--tk-bg);border-radius:5px;padding:0 7px;color:var(--tk-ink-700);white-space:nowrap;line-height:20px}',
        '.tk-cf .ctx{font-family:var(--tk-mono);color:var(--tk-ink-400);white-space:nowrap}',
        '.tk-cf .act{margin-left:auto}',
        // table view
        '.tk-tablewrap{background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-lg);overflow-x:auto;box-shadow:var(--tk-sh-1)}',
        '.tk-table{border-collapse:collapse;width:100%}',
        '.tk-table.mt{min-width:760px}',
        '.tk-table th{position:sticky;top:0;background:var(--tk-panel);text-align:left;font-size:12px;color:var(--tk-ink-500);font-weight:600;padding:9px 12px;border-bottom:1px solid var(--tk-line);white-space:nowrap}',
        '.tk-table th.r,.tk-table td.r{text-align:right}',
        '.tk-table th .unit{display:block;font:400 11px var(--tk-mono);color:var(--tk-ink-400)}',
        '.tk-table td{padding:10px 12px;border-bottom:1px solid var(--tk-line-soft);vertical-align:middle;font-size:13px}',
        '.tk-table tr:last-child td{border-bottom:0}',
        '.tk-table tbody tr:hover td{background:var(--tk-hover)}',
        '.tk-tn{display:flex;gap:9px;align-items:center;min-width:0}',
        '.tk-tn .tk-vlogo{width:26px;height:26px;border-radius:8px;font-size:12px}',
        '.tk-table .tk-mname{font-size:13px}',
        '.tk-table .v{font:600 13px var(--tk-mono);font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.tk-table .v.na{color:var(--tk-ink-300);font-weight:400}',
        '.tk-table .sub{display:block;font-size:11px;color:var(--tk-ink-400);font-family:var(--tk-sans);font-weight:400}',
        '.tk-table td.span-call{text-align:center}',
        '.tk-acts{display:flex;gap:6px;justify-content:flex-end;align-items:center}',
        // empty state & drawer & toast
        '.tk-empty{background:var(--tk-card);border:1px dashed var(--tk-ink-300);border-radius:var(--tk-r-lg);padding:44px 24px;text-align:center;color:var(--tk-ink-500)}',
        '.tk-empty .ill{width:60px;height:60px;margin:0 auto 12px;border-radius:18px;background:var(--tk-brand-50);display:grid;place-items:center;color:var(--tk-brand)}',
        '.tk-empty h3{margin:0 0 6px;color:var(--tk-ink-900);font-size:15px}',
        '.tk-empty p{margin:0 0 14px;font-size:13px}',
        '.tk-mask{position:absolute;inset:0;background:var(--tk-mask);z-index:50}',
        '.tk-drawer{position:absolute;top:0;right:0;bottom:0;width:min(400px,92%);background:var(--tk-card);border-left:1px solid var(--tk-line);z-index:51;box-shadow:var(--tk-sh-pop);display:flex;flex-direction:column}',
        '.tk-drawer .dh{padding:16px 18px 12px;border-bottom:1px solid var(--tk-line-soft);display:flex;gap:10px;align-items:flex-start}',
        '.tk-drawer .db{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px}',
        '.tk-drawer .df{padding:12px 18px;border-top:1px solid var(--tk-line-soft);display:flex;gap:8px;flex-wrap:wrap}',
        '.tk-kv{display:grid;grid-template-columns:88px 1fr;gap:7px 10px;font-size:13px;margin:0}',
        '.tk-kv dt{color:var(--tk-ink-500)}.tk-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}',
        '.tk-dtitle{font-size:12px;color:var(--tk-ink-500);font-weight:600;margin-bottom:6px}',
        '.tk-effort{display:flex;gap:4px;flex-wrap:wrap}.tk-effort span{font:12px var(--tk-mono);border:1px solid var(--tk-line);border-radius:6px;padding:0 7px;color:var(--tk-ink-700)}',
        '.tk-toast{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);background:var(--tk-ink-900);color:var(--tk-card);font-size:13px;padding:8px 14px;border-radius:10px;box-shadow:var(--tk-sh-pop);z-index:80;pointer-events:none;max-width:90%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // console view
        '.tk-hero{display:flex;flex-direction:column;gap:8px;background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-lg);padding:14px 16px;box-shadow:var(--tk-sh-1)}',
        '.tk-hero-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
        '.tk-hero h1{margin:0;font-size:18px;font-weight:650;line-height:1.25}',
        '.tk-hero .meta{font-size:12px;color:var(--tk-ink-500);display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px}',
        '.tk-hero-r{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.tk-pill{display:inline-flex;align-items:center;font-size:11px;padding:0 8px;line-height:19px;border-radius:999px;border:1px solid var(--tk-brand-100);color:var(--tk-brand-600);background:var(--tk-brand-50);font-weight:600;white-space:nowrap}',
        '.tk-pill.grey{border-color:var(--tk-line);color:var(--tk-ink-500);background:var(--tk-bg)}',
        '.tk-pill.ok{border-color:var(--tk-save-line);color:var(--tk-save);background:var(--tk-save-bg)}',
        '.tk-stat-dot{width:7px;height:7px;border-radius:50%;background:var(--tk-save);display:inline-block}',
        '.tk-subtabs{display:flex;gap:2px;border-bottom:1px solid var(--tk-line);margin:16px 0 14px;overflow-x:auto;align-items:center}',
        '.tk-subtabs button{border:0;background:none;padding:7px 12px;font:inherit;font-size:13px;color:var(--tk-ink-500);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;cursor:pointer}',
        '.tk-subtabs button:hover{color:var(--tk-ink-900)}',
        '.tk-subtabs button.on{color:var(--tk-ink-900);font-weight:600;border-bottom-color:var(--tk-brand)}',
        '.tk-kpis,.dsh-tako-stamps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}',
        '.dsh-tako-stamps-3{grid-template-columns:repeat(3,minmax(0,1fr))}',
        '.tk-kpi{background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-lg);padding:13px 15px;box-shadow:var(--tk-sh-1);min-width:0}',
        '.tk-kpi label{font-size:12px;color:var(--tk-ink-500);display:flex;justify-content:space-between;gap:6px}',
        '.tk-kpi .n{font:700 22px var(--tk-mono);letter-spacing:-.02em;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tk-kpi .s{font-size:12px;color:var(--tk-ink-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
        '.tk-kpi.main{border-color:var(--tk-brand-100);background:linear-gradient(180deg,var(--tk-brand-50),var(--tk-card) 70%)}',
        '.tk-kpi.low{border-color:color-mix(in srgb,var(--tk-warn) 45%,var(--tk-line))}',
        '.tk-box{background:var(--tk-card);border:1px solid var(--tk-line);border-radius:var(--tk-r-lg);padding:14px 16px;box-shadow:var(--tk-sh-1);min-width:0}',
        '.tk-box-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
        '.tk-box-h b{font-size:14px}.tk-box-h .r{margin-left:auto;display:flex;gap:6px;align-items:center}',
        '.tk-box-h small{color:var(--tk-ink-400);font-size:12px}',
        '.tk-row2{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:12px;margin-top:12px}',
        '.tk-meter{margin-top:6px}.tk-meter+.tk-meter{margin-top:14px}',
        '.tk-meter .top{display:flex;align-items:baseline;gap:8px;font-size:13px;flex-wrap:wrap}',
        '.tk-meter .top b{font:700 18px var(--tk-mono)}',
        '.tk-meter .top .l{color:var(--tk-ink-700);font-weight:600}',
        '.tk-meter .top .r{margin-left:auto;color:var(--tk-ink-500);font-size:12px;font-family:var(--tk-mono)}',
        '.dsh-tako-bar{height:8px;border-radius:99px;background:var(--tk-line-soft);overflow:hidden;margin:6px 0 4px}',
        '.dsh-tako-bar>i{display:block;height:100%;border-radius:inherit;background:var(--tk-brand);transition:width .2s}',
        '.dsh-tako-bar>i[data-tone="warn"]{background:var(--tk-warn)}',
        '.dsh-tako-bar>i[data-tone="error"]{background:var(--tk-err)}',
        '.tk-meter .foot{font-size:12px;color:var(--tk-ink-400);display:flex;justify-content:space-between;gap:8px}',
        '.tk-alert{display:flex;gap:8px;align-items:center;font-size:12.5px;border-radius:10px;padding:8px 12px;margin-top:12px;flex-wrap:wrap}',
        '.tk-alert.warn{background:var(--tk-warn-bg);color:var(--tk-warn)}',
        '.tk-alert.err{background:var(--tk-err-bg);color:var(--tk-err)}',
        '.tk-alert .tk-btn{margin-left:auto}',
        '.tk-chart{display:flex;align-items:flex-end;gap:10px;height:132px;padding:6px 2px 0;border-bottom:1px solid var(--tk-line)}',
        '.tk-chart .c{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px;min-width:0}',
        '.tk-chart .c i{display:block;width:100%;max-width:30px;min-height:3px;border-radius:5px 5px 2px 2px;background:var(--tk-brand-100);transition:background .15s}',
        '.tk-chart .c:hover i,.tk-chart .c.today i{background:var(--tk-brand)}',
        '.tk-chart .c span{font:11px var(--tk-mono);color:var(--tk-ink-500);white-space:nowrap}',
        '.tk-chart-x{display:flex;gap:10px;padding:4px 2px 0}.tk-chart-x span{flex:1;text-align:center;font-size:11px;color:var(--tk-ink-400)}',
        '.tk-share{display:inline-block;width:56px;height:5px;border-radius:9px;background:var(--tk-line-soft);vertical-align:middle;margin-right:6px;overflow:hidden}',
        '.tk-share i{display:block;height:100%;background:var(--tk-brand)}',
        // notices (compact site-parity + history toggle)
        '.dsh-tako-notices{display:flex;flex-direction:column;gap:6px}',
        '.dsh-tako-notice-item{border:1px solid var(--tk-line);border-radius:10px;padding:8px 12px;font-size:13px;background:var(--tk-card);transition:border-color .15s}',
        '.dsh-tako-notice-item:hover{border-color:var(--tk-ink-300)}',
        '.dsh-tako-notice-item>summary{display:flex;gap:10px;align-items:center;cursor:pointer;list-style:none;user-select:none}',
        '.dsh-tako-notice-item>summary::-webkit-details-marker{display:none}',
        '.dsh-tako-notice-item[open]>summary{margin-bottom:6px}',
        '.dsh-tako-notice-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--tk-brand)}',
        '.dsh-tako-notice-dot[data-tone="info"]{background:var(--tk-brand)}',
        '.dsh-tako-notice-dot[data-tone="success"]{background:var(--tk-save)}',
        '.dsh-tako-notice-dot[data-tone="warn"]{background:var(--tk-warn)}',
        '.dsh-tako-notice-dot[data-tone="error"]{background:var(--tk-err)}',
        '.dsh-tako-notice-preview{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
        '.dsh-tako-notice-date{flex:none;font:11px var(--tk-mono);color:var(--tk-ink-400)}',
        '.dsh-tako-notice-body{font-size:13px;line-height:1.6;overflow-wrap:anywhere;color:var(--tk-ink-700);padding-top:4px}',
        '.dsh-tako-notice-body h4{margin:6px 0 2px;font-size:13px;font-weight:600;color:var(--tk-ink-900)}',
        '.dsh-tako-notice-body ul{margin:2px 0;padding-left:18px}',
        '.dsh-tako-notice-body code{font-family:var(--tk-mono);font-size:12px;background:var(--tk-hover);padding:0 4px;border-radius:4px}',
        '.dsh-tako-notice-body a{color:var(--tk-brand)}',
        '.dsh-tako-notice-history{display:flex;justify-content:flex-end;margin-top:4px}',
        '.dsh-tako-notice-history>button{font:inherit;font-size:11px;padding:3px 10px;border:1px solid var(--tk-line);border-radius:999px;background:transparent;color:var(--tk-ink-500);cursor:pointer}',
        '.dsh-tako-notice-history>button:hover{border-color:var(--tk-brand);color:var(--tk-brand)}',
        '.dsh-tako-notice-read{opacity:.72}',
        // fields, signin, footer version line
        '.tk-verline{display:flex;gap:10px;align-items:center;justify-content:center;font-size:12px;color:var(--tk-ink-400);margin-top:18px;flex-wrap:wrap}',
        '.tk-field{display:flex;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid var(--tk-line-soft);font-size:13px;flex-wrap:wrap}',
        '.tk-field:last-of-type{border-bottom:0}',
        '.tk-field>label{width:220px;flex:none;color:var(--tk-ink-500)}',
        '.tk-field>.v{flex:1;min-width:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.tk-code{font-family:var(--tk-mono);font-size:12px;padding:8px 10px;border-radius:8px;background:var(--tk-panel);border:1px solid var(--tk-line-soft);overflow:auto;white-space:pre;max-height:160px;width:100%}',
        '.tk-signin{text-align:center;padding:40px 20px;display:flex;flex-direction:column;align-items:center}',
        '.tk-signin h3{margin:12px 0 4px;font-size:17px;font-weight:650}',
        '.tk-signin p{color:var(--tk-ink-500);margin:0 0 16px;font-size:13px;max-width:460px}',
        '.tk-links{display:flex;flex-wrap:wrap;gap:8px}',
        // responsive container breakpoint (960x700 & narrow viewports, zero horizontal overflow)
        '@container plug (max-width:860px){',
        '.tk-page{padding:14px 16px 36px}',
        '.tk-count small{display:none}',
        '.tk-ddbtn .lbl{display:none}',
        '.tk-chatnow .lbl{display:none}',
        '.tk-grid{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}',
        '.tk-kpis,.dsh-tako-stamps{grid-template-columns:repeat(2,minmax(0,1fr))}',
        '.tk-row2{grid-template-columns:1fr}',
        '.tk-field>label{width:100%}',
        '}',
        '@container plug (max-width:480px){',
        '.tk-grid{grid-template-columns:1fr}',
        '.tk-kpis,.dsh-tako-stamps,.dsh-tako-stamps-3{grid-template-columns:1fr}',
        '}',
        // sidebar footer quota card (4 states x 3 widths: 240px / 208px / 56px)
        '.tk-qwrap{width:100%;container-type:inline-size;container-name:qfoot}',
        '.dsh-tako-footer{display:flex;flex-direction:column;gap:7px;width:100%;border:1px solid var(--tk-line);background:var(--tk-card);color:var(--tk-ink-900);border-radius:12px;padding:9px 10px;text-align:left;box-shadow:var(--tk-sh-1);cursor:pointer;transition:border-color .15s,box-shadow .15s;font:inherit}',
        '.dsh-tako-footer:hover{border-color:var(--tk-brand-100);box-shadow:var(--tk-sh-2)}',
        '.dsh-tako-footer.low{border-color:color-mix(in srgb,var(--tk-warn) 45%,var(--tk-line))}',
        '.dsh-tako-footer .r1{display:flex;align-items:center;gap:6px;min-width:0}',
        '.dsh-tako-footer .r1 .nm{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsh-tako-footer .r1 .w{margin-left:auto;font:600 13px var(--tk-mono);white-space:nowrap}',
        '.dsh-tako-footer .r1 .w.warn{color:var(--tk-warn)}',
        '.dsh-tako-footer .r2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
        '.tk-qm{min-width:0}',
        '.tk-qm .t{display:flex;justify-content:space-between;font-size:11px;color:var(--tk-ink-500);line-height:14px;gap:4px}',
        '.tk-qm .t b{font:600 11px var(--tk-mono);color:var(--tk-ink-700);white-space:nowrap}',
        '.tk-qm .t b.warn{color:var(--tk-warn)}.tk-qm .t b.err{color:var(--tk-err)}',
        '.tk-qm .dsh-tako-bar{height:4px;margin:3px 0 0}',
        '.dsh-tako-footer .r3{font-size:11px;color:var(--tk-ink-400);display:flex;justify-content:space-between;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsh-tako-footer .r3.warn{color:var(--tk-warn)}',
        '.dsh-tako-footer.out .r1 .nm{color:var(--tk-brand-600)}',
        '.dsh-tako-footer.out .hint{font-size:11px;color:var(--tk-ink-500)}',
        '.tk-pill-short{display:none}',
        '@container qfoot (max-width:200px){',
        '.tk-pill-full{display:none}.tk-pill-short{display:inline-flex}',
        '.tk-rem-word{display:none}',
        '.dsh-tako-footer .r3.low-line{display:none}',
        '}',
        '.tk-qrail{position:relative;width:40px;height:40px;border-radius:12px;border:1px solid var(--tk-line);background:var(--tk-card);display:grid;place-items:center;margin:0 auto;padding:0;cursor:pointer}',
        '.tk-qrail:hover{border-color:var(--tk-brand-100);box-shadow:var(--tk-sh-2)}',
        '.tk-qrail svg{position:absolute;inset:3px;width:32px;height:32px}',
        '.tk-qrail .badge{position:absolute;right:-3px;top:-3px;width:10px;height:10px;border-radius:50%;border:2px solid var(--tk-side);background:var(--tk-warn)}',
      ].join('')
      let style = document.getElementById('dsh-tako-theme')
      if (style === null) {
        style = document.createElement('style')
        style.id = 'dsh-tako-theme'
        document.head.appendChild(style)
      }
      if (style.textContent !== css) style.textContent = css
    }

    // ---------------------------------------------------------------- shared helpers

    const takoOrigin = status => {
      const origin = status !== undefined && typeof status.origin === 'string' ? status.origin.replace(/\/+$/, '') : ''
      return origin === '' ? DEFAULT_TAKO_ORIGIN : origin
    }

    const compactContext = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const scaled = (n, suffix) => `${Math.round(n * 100) / 100}${suffix}`
      if (Math.abs(value) >= 1_000_000) return scaled(value / 1_000_000, 'M')
      if (Math.abs(value) >= 1_000) return scaled(value / 1_000, 'K')
      return value.toLocaleString()
    }

    const compactTokens = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 1_000_000 * 10) / 10}M`
      if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000 * 10) / 10}K`
      return String(value)
    }

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

    function clickSidebarPanel(label) {
      if (typeof document.querySelectorAll !== 'function') return false
      const buttons = document.querySelectorAll('nav button[aria-label]')
      for (const button of buttons) {
        if (button.getAttribute('aria-label') === label) {
          button.click()
          return true
        }
      }
      return false
    }

    function openTakoConsole(t) {
      return clickSidebarPanel((t || boundT)('panel'))
    }

    function openTakoModels(t) {
      return clickSidebarPanel((t || boundT)('modelsPanel'))
    }

    function hasPlanQuota(plan) {
      if (!plan) return false
      return (plan.windowCostLimit || 0) > 0 || (plan.weeklyCostLimit || 0) > 0
    }

    function windowHoursText(plan) {
      const mins = plan && plan.windowMinutes > 0 ? plan.windowMinutes : 300
      const hours = mins / 60
      return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10)
    }

    function windowLabel(plan, t) {
      return t('windowHours', { hours: windowHoursText(plan) })
    }

    function remainingShare(used, limit) {
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return undefined
      const spent = typeof used === 'number' && Number.isFinite(used) ? used : 0
      return Math.max(0, Math.min(1, (limit - spent) / limit))
    }

    function quotaTone(share) {
      if (share === undefined) return undefined
      if (share < 0.1) return 'error'
      if (share < 0.3) return 'warn'
      return undefined
    }

    function remainingPercentText(used, limit) {
      const share = remainingShare(used, limit)
      if (share === undefined) return '—'
      return `${Math.round(share * 100)}%`
    }

    function QuotaBar(used, limit, extraClass) {
      const share = remainingShare(used, limit)
      if (share === undefined) return null
      const percent = Math.round(share * 100)
      const tone = quotaTone(share)
      return h('div', {
        className: extraClass === undefined ? 'dsh-tako-bar' : `dsh-tako-bar ${extraClass}`,
        role: 'progressbar',
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
      }, h('i', { 'data-tone': tone, style: { width: `${percent}%` } }))
    }

    function formatResetHint(value) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const ms = value > 1e12 ? value : value * 1000
        const diffMin = Math.max(0, Math.round((ms - Date.now()) / 60000))
        if (diffMin >= 1440) return `${Math.floor(diffMin / 1440)}d ${Math.floor((diffMin % 1440) / 60)}h`
        if (diffMin >= 60) return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`
        return `${diffMin}m`
      }
      return undefined
    }

    function shortPlanName(planName) {
      if (typeof planName !== 'string') return ''
      const first = planName.trim().split(/\s+/)[0] || planName.trim()
      return first.length > 8 ? first.slice(0, 8) : first
    }

    function copyTextSafe(text) {
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(text).then(() => true, () => false)
        }
      } catch {}
      return Promise.resolve(false)
    }

    /** Each view publishes only its latest status read; replacement and unload abort older reads. */
    function useStatusReader(onStatus, onError) {
      const controller = useRef(undefined)
      const mounted = useRef(true)
      const invalidate = () => { controller.current?.abort() }
      useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false; invalidate() }
      }, [])
      const load = async () => {
        if (!mounted.current) return
        invalidate()
        const request = new AbortController()
        controller.current = request
        try {
          const next = await call('GET', STATUS_ROUTE, undefined, request.signal)
          if (!request.signal.aborted) onStatus(next)
        } catch (error) {
          if (!request.signal.aborted) onError(error)
        }
      }
      return { load, invalidate }
    }

    function useStatusRefresh(load) {
      useEffect(() => {
        const refresh = () => { void load() }
        window.addEventListener('dsh-tako-credential', refresh)
        window.addEventListener('focus', refresh)
        refresh()
        return () => {
          window.removeEventListener('dsh-tako-credential', refresh)
          window.removeEventListener('focus', refresh)
        }
      }, [])
    }

    // ---------------------------------------------------------------- View 3: Sidebar Footer Quota Card (4 states x 3 widths)

    function TakoFooter(props) {
      const wide = props.wide === true
      const t = props.t ?? fallbackT
      const [status, setStatus] = useState(undefined)
      const { load } = useStatusReader(setStatus, () => { setStatus({ configured: false }) })
      const [prefs] = useTakoPrefs(status !== undefined && status.consoleApiVersion === CONSOLE_API_VERSION)
      useEffect(() => { ensureTakoTheme() }, [])
      useStatusRefresh(load)

      const configured = status !== undefined && status.configured === true
      const plan = configured ? status.plan : undefined
      const onPlan = hasPlanQuota(plan)
      const planName = configured && status.me && status.me.planName ? status.me.planName : undefined
      const walletUsd = configured && typeof status.me?.quotaRemainUsd === 'number' ? status.me.quotaRemainUsd : undefined
      const walletCny = usdToCny(walletUsd)
      const walletText = walletCny !== null ? amt(walletCny, prefs.currency) : '—'
      const walletLow = walletCny !== null && walletCny < LOW_WALLET_CNY

      const w5Share = onPlan ? remainingShare(plan.windowCost, plan.windowCostLimit) : undefined
      const wkShare = onPlan ? remainingShare(plan.weeklyCost, plan.weeklyCostLimit) : undefined
      const minShare = w5Share !== undefined && wkShare !== undefined
        ? Math.min(w5Share, wkShare)
        : (w5Share !== undefined ? w5Share : wkShare)
      const planLow = onPlan && minShare !== undefined && minShare < 0.3
      const anyLow = planLow || walletLow
      // Preserve e2e contract: 'plan' when plan windows are healthy, 'low' when any plan window <30%,
      // 'balance' when wallet-only, 'empty' when signed out.
      const quotaAttr = !configured ? 'empty' : onPlan ? (planLow ? 'low' : 'plan') : 'balance'

      // Collapsed 56px sidebar rail mode
      if (!wide) {
        if (!configured) {
          return h('div', { className: 'dsh-tako-root' },
            h('button', {
              type: 'button',
              className: 'tk-qrail',
              'data-testid': 'dsh-tako-footer',
              'data-tako-quota': 'empty',
              'data-tako-low': 'false',
              title: t('footerSignIn'),
              onClick: () => { openTakoConsole(t) },
            }, TakoMark(22)))
        }
        const ringColor = minShare === undefined ? 'var(--tk-brand)'
          : minShare < 0.1 ? 'var(--tk-err)'
          : minShare < 0.3 ? 'var(--tk-warn)'
          : 'var(--tk-brand)'
        const C = 2 * Math.PI * 15.5
        const tipParts = []
        if (onPlan && w5Share !== undefined) tipParts.push(`${windowLabel(plan, t)} ${t('footerRemain')} ${Math.round(w5Share * 100)}%`)
        if (onPlan && wkShare !== undefined) tipParts.push(`${t('weeklyShort')} ${t('footerRemain')} ${Math.round(wkShare * 100)}%`)
        tipParts.push(`${t('walletBalance')} ${walletText}`)
        return h('div', { className: 'dsh-tako-root' },
          h('button', {
            type: 'button',
            className: 'tk-qrail',
            'data-testid': 'dsh-tako-footer',
            'data-tako-quota': quotaAttr,
            'data-tako-low': String(anyLow),
            title: tipParts.join(' · '),
            onClick: () => { openTakoConsole(t) },
          },
            h('svg', { viewBox: '0 0 34 34', 'aria-hidden': true },
              h('circle', { cx: 17, cy: 17, r: 15.5, fill: 'none', stroke: 'var(--tk-line-soft)', strokeWidth: '2.5' }),
              minShare !== undefined
                ? h('circle', {
                    cx: 17, cy: 17, r: 15.5, fill: 'none', stroke: ringColor, strokeWidth: '2.5',
                    strokeLinecap: 'round', strokeDasharray: `${(C * minShare).toFixed(2)} ${C.toFixed(2)}`,
                    transform: 'rotate(-90 17 17)',
                  })
                : null),
            TakoMark(20),
            anyLow ? h('span', { className: 'badge', 'aria-hidden': true }) : null))
      }

      // Expanded 240px / compact 208px sidebar mode (container query switches automatically)
      if (status === undefined) {
        return h('div', { className: 'dsh-tako-root tk-qwrap' },
          h('button', {
            type: 'button',
            className: 'dsh-tako-footer',
            'data-testid': 'dsh-tako-footer',
            'data-tako-quota': 'empty',
            onClick: () => { openTakoConsole(t) },
          },
            h('div', { className: 'r1' }, TakoMark(20), h('span', { className: 'nm' }, 'Tako'), h('span', { className: 'w', style: muted }, '…'))))
      }

      if (!configured) {
        return h('div', { className: 'dsh-tako-root tk-qwrap' },
          h('button', {
            type: 'button',
            className: 'dsh-tako-footer out',
            'data-testid': 'dsh-tako-footer',
            'data-tako-quota': 'empty',
            'data-tako-low': 'false',
            onClick: () => { openTakoConsole(t) },
          },
            h('div', { className: 'r1' },
              TakoMark(20),
              h('span', { className: 'nm' }, t('footerSignIn')),
              h('span', { style: { marginLeft: 'auto', color: 'var(--tk-brand)' } }, '→')),
            h('div', { className: 'hint' }, t('footerSignInHint'))))
      }

      const miniMeter = (label, used, limit) => {
        const share = remainingShare(used, limit)
        const tone = quotaTone(share)
        const cls = tone === 'error' ? 'err' : tone === 'warn' ? 'warn' : ''
        return h('div', { className: 'tk-qm' },
          h('div', { className: 't' },
            h('span', null, label),
            h('b', { className: cls },
              h('span', { className: 'tk-rem-word' }, `${t('footerRemainShort')} `),
              remainingPercentText(used, limit))),
          QuotaBar(used, limit))
      }

      const resetHint = onPlan ? formatResetHint(plan.windowResetAt) : undefined
      const lowWindowLabel = w5Share !== undefined && (wkShare === undefined || w5Share <= wkShare)
        ? windowLabel(plan, t) : t('weeklyShort')

      return h('div', { className: 'dsh-tako-root tk-qwrap' },
        h('button', {
          type: 'button',
          className: `dsh-tako-footer${anyLow ? ' low' : ''}`,
          'data-testid': 'dsh-tako-footer',
          'data-tako-quota': quotaAttr,
          'data-tako-low': String(anyLow),
          title: t('panel'),
          onClick: () => { openTakoConsole(t) },
        },
          h('div', { className: 'r1' },
            TakoMark(20),
            h('span', { className: 'nm' }, 'Tako'),
            onPlan && planName
              ? [
                  h('span', { key: 'pf', className: 'tk-pill tk-pill-full', style: { fontSize: '10px', padding: '0 6px' } }, planName),
                  h('span', { key: 'ps', className: 'tk-pill tk-pill-short', style: { fontSize: '10px', padding: '0 6px' } }, shortPlanName(planName)),
                ]
              : h('span', { className: 'tk-pill grey', style: { fontSize: '10px', padding: '0 6px' } }, t('paygoBadge')),
            h('span', { className: `w${walletLow ? ' warn' : ''}`, title: t('walletBalanceTitle') }, `${walletLow ? '⚠ ' : ''}${walletText}`)),
          onPlan
            ? h('div', { className: 'r2' },
                miniMeter(windowLabel(plan, t), plan.windowCost, plan.windowCostLimit),
                miniMeter(t('weeklyShort'), plan.weeklyCost, plan.weeklyCostLimit))
            : h('div', { className: 'r3' }, h('span', null, t('footerPaygoHint'))),
          planLow
            ? h('div', { className: 'r3 warn low-line' },
                h('span', null, resetHint ? `${t('footerLowWarn', { window: lowWindowLabel })} · ${resetHint}` : t('footerLowWarn', { window: lowWindowLabel })))
            : null))
    }

    // ---------------------------------------------------------------- View 1: Model Directory (full-width flat layout)

    const CAP_KEYS = [
      ['reasoning', 'capReasoning'],
      ['vision', 'capVision'],
      ['code', 'capCode'],
      ['tools', 'capTools'],
      ['longContext', 'capLongContext'],
    ]

    function normalizeModelRow(model, card) {
      const ctx = (card && card.contextWindow) || model.contextWindow
      const vision = card ? card.vision === true : (model.input || []).includes('image')
      const reasoning = card ? card.reasoning === true : model.reasoningEfforts !== false
      const tags = (card && Array.isArray(card.tags)) ? card.tags : []
      let billingType = card && card.billingType ? card.billingType : 'token'
      if (!card || !card.billingType) {
        if (tags.includes('免费')) billingType = 'free'
      }
      const capabilities = card && Array.isArray(card.capabilities) ? card.capabilities.slice() : []
      if (capabilities.length === 0) {
        if (reasoning) capabilities.push('reasoning')
        if (vision) capabilities.push('vision')
        if (typeof ctx === 'number' && ctx >= 1_000_000) capabilities.push('longContext')
      }
      const inputUsd = card && typeof card.inputPriceUsdPerMillion === 'number' ? card.inputPriceUsdPerMillion
        : (card && typeof card.standardPriceUsdPerMillion === 'number' && billingType === 'token' ? card.standardPriceUsdPerMillion : undefined)
      const outputUsd = card && typeof card.outputPriceUsdPerMillion === 'number' ? card.outputPriceUsdPerMillion
        : (inputUsd !== undefined && card && typeof card.outputRatio === 'number' ? inputUsd * card.outputRatio : undefined)
      const cacheUsd = card && typeof card.cachePriceUsdPerMillion === 'number' ? card.cachePriceUsdPerMillion : undefined
      const callUsd = card && typeof card.callPriceUsd === 'number' ? card.callPriceUsd : undefined
      const stdUsd = card && typeof card.standardPriceUsdPerMillion === 'number' ? card.standardPriceUsdPerMillion : inputUsd
      const realizedUsd = card && typeof card.realizedPriceUsdPerMillion === 'number' ? card.realizedPriceUsdPerMillion : undefined
      const hitRate = card && typeof card.cacheHitRate === 'number' ? card.cacheHitRate : undefined
      const vendorName = (card && (card.vendorName || card.vendor)) || inferClientVendor(model.id)
      const channelLabel = (card && card.channelTag) || (card && Array.isArray(card.channels) && card.channels[0] ? card.channels[0].name : undefined)
      // Strict gate: free and per-call models NEVER show a discount ratio.
      const officialRatio = (billingType === 'token' || billingType === 'dynamic')
        && card && typeof card.officialRatio === 'number' && card.officialRatio > 0 && card.officialRatio < 0.99
        ? card.officialRatio : undefined
      return {
        id: model.id,
        model,
        card,
        vendorName,
        channelLabel,
        description: (card && card.description) || '',
        ctx,
        ctxText: compactContext(ctx),
        vision,
        reasoning,
        billingType,
        capabilities,
        inputUsd,
        cacheUsd,
        outputUsd,
        callUsd,
        stdUsd,
        realizedUsd,
        hitRate,
        officialInputUsd: card && card.officialInputPriceUsdPerMillion,
        officialOutputUsd: card && card.officialOutputPriceUsdPerMillion,
        officialRatio,
        promo: card && card.promo,
        endpoints: (card && Array.isArray(card.endpoints)) ? card.endpoints : [],
        channels: (card && Array.isArray(card.channels)) ? card.channels : [],
        channelCount: card && typeof card.channelCount === 'number' ? card.channelCount : 0,
        efforts: model.reasoningEfforts === false ? []
          : (model.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? Object.keys(model.reasoningEfforts) : ['off', 'low', 'high', 'max']),
      }
    }

    function inferClientVendor(id) {
      const lower = String(id || '').toLowerCase()
      if (lower.startsWith('deepseek')) return 'DeepSeek'
      if (lower.startsWith('claude')) return 'Anthropic'
      if (/^(gpt|o\d|o-|codex)/.test(lower)) return 'OpenAI'
      if (/^(gemini|gemma)/.test(lower)) return 'Google'
      if (/^(kimi|k3\b)/.test(lower)) return 'Moonshot'
      if (lower.startsWith('glm')) return '智谱'
      if (/^(grok|composer)/.test(lower)) return 'xAI'
      if (lower.startsWith('qwen')) return 'Alibaba'
      if (lower.startsWith('mimo')) return 'Xiaomi'
      if (lower.startsWith('tako')) return 'Tako'
      return 'Tako'
    }

    function ModelBadges(props) {
      const row = props.row
      const t = props.t
      const list = []
      if (row.officialRatio !== undefined) {
        const fold = +(row.officialRatio * 10).toFixed(1)
        list.push(h('span', { key: 'disc', className: 'tk-b tk-b-save', 'data-testid': `dsh-tako-discount-${row.id}` },
          t('discountBadge', { ratio: row.officialRatio.toFixed(2), fold: String(fold) })))
      }
      if (row.billingType === 'dynamic') list.push(h('span', { key: 'dyn', className: 'tk-b tk-b-dyn' }, t('billDynamic')))
      else if (row.billingType === 'call') list.push(h('span', { key: 'call', className: 'tk-b tk-b-call' }, t('billCallBadge')))
      else if (row.billingType === 'free') list.push(h('span', { key: 'free', className: 'tk-b tk-b-free' }, t('billFree')))
      if (row.promo) list.push(h('span', { key: 'promo', className: 'tk-b tk-b-promo' }, `🔥 ${row.promo.label}`))
      return h('div', { className: 'tk-badges' }, list)
    }

    function ModelPricePanel(props) {
      const row = props.row
      const prefs = props.prefs
      const t = props.t
      const opts = { cur: prefs.currency, unit: prefs.tokenUnit, perToken: true }
      const unitShort = prefs.tokenUnit === 'K' ? '1K' : '1M'

      if (row.billingType === 'call') {
        const callPrice = moneyFromUsd(row.callUsd, { cur: prefs.currency, perToken: false }) || '—'
        return h('div', { className: 'tk-price', 'data-testid': `dsh-tako-price-${row.id}` },
          h('div', { className: 'tk-pmain' },
            h('span', { className: 'big' }, callPrice),
            h('span', { className: 'u' }, t('perCall')),
            h('span', { className: 'k' }, t('billCallFixed'))),
          h('div', { className: 'tk-psub' }, t('billCallHint')))
      }

      if (prefs.priceMode === 'avg') {
        if (row.billingType === 'free') {
          return h('div', { className: 'tk-price', 'data-testid': `dsh-tako-price-${row.id}` },
            h('div', { className: 'tk-pmain' },
              h('span', { className: 'big' }, money(0, opts)),
              h('span', { className: 'u' }, `/ ${unitShort}`),
              h('span', { className: 'k' }, t('billFree'))),
            h('div', { className: 'tk-psub' }, t('freeNoChargeHint')))
        }
        const hasRealized = typeof row.realizedUsd === 'number' && row.realizedUsd > 0
        const hasStd = typeof row.stdUsd === 'number' && row.stdUsd >= 0
        const primary = hasRealized ? moneyFromUsd(row.realizedUsd, opts) : (hasStd ? moneyFromUsd(row.stdUsd, opts) : null)
        if (primary === null) {
          return h('div', { className: 'tk-price', 'data-testid': `dsh-tako-price-${row.id}` },
            h('div', { className: 'tk-pmain' }, h('span', { className: 'big', style: muted }, '—')),
            h('div', { className: 'tk-psub' }, t('priceNoData')))
        }
        const stdText = hasStd ? moneyFromUsd(row.stdUsd, opts) : '—'
        const hitText = typeof row.hitRate === 'number' ? `${Math.round(row.hitRate * 100)}%` : undefined
        return h('div', { className: 'tk-price', 'data-testid': `dsh-tako-price-${row.id}` },
          h('div', { className: 'tk-pmain' },
            h('span', { className: 'big' }, primary),
            h('span', { className: 'u' }, `/ ${unitShort}`),
            h('span', { className: 'k' }, hasRealized ? t('priceRealizedTag') : t('priceStdTag'))),
          h('div', { className: 'tk-psub' },
            hasRealized
              ? (hitText ? t('priceRealizedSub', { std: stdText, hit: hitText }) : t('priceRealizedSubNoHit', { std: stdText }))
              : t('priceNewNoRealized')))
      }

      // Breakdown (detail) view: 3 equal columns Input / Cache read / Output + single footer unit line
      const pIn = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.inputUsd, opts)
      const pCache = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.cacheUsd, opts)
      const pOut = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.outputUsd, opts)
      const origPrice = row.promo && typeof row.promo.originalInputPriceUsdPerMillion === 'number'
        ? moneyFromUsd(row.promo.originalInputPriceUsdPerMillion, opts) : null

      return h('div', { className: 'tk-price', 'data-testid': `dsh-tako-price-${row.id}` },
        h('div', { className: 'tk-p3' },
          h('div', { className: 'tk-pc' }, h('label', null, t('priceInput')), h('div', { className: `v${pIn === null ? ' na' : ''}` }, pIn ?? '—')),
          h('div', { className: 'tk-pc cache' }, h('label', null, t('priceCache')), h('div', { className: `v${pCache === null ? ' na' : ''}` }, pCache ?? '—')),
          h('div', { className: 'tk-pc' }, h('label', null, t('priceOutput')), h('div', { className: `v${pOut === null ? ' na' : ''}` }, pOut ?? '—'))),
        h('div', { className: 'tk-pfoot' },
          h('span', { className: 'unit' }, unitTxt(prefs)),
          origPrice !== null ? h('span', null, h('span', { className: 'tk-pstrike' }, t('priceOrig', { price: origPrice }))) : null))
    }

    function ModelPromoBar(props) {
      const row = props.row
      const prefs = props.prefs
      const t = props.t
      if (!row.promo) return null
      const refUsd = row.officialInputUsd ?? row.promo.originalInputPriceUsdPerMillion
      const refStr = refUsd !== undefined ? moneyFromUsd(refUsd, { cur: prefs.currency, unit: prefs.tokenUnit, perToken: true }) : null
      const unitShort = prefs.tokenUnit === 'K' ? '1K' : '1M'
      if (refStr === null && !row.promo.endsAt) return null
      return h('div', { className: 'tk-promo-bar' },
        refStr !== null ? h('span', null, t('promoBar', { price: refStr, unit: unitShort })) : h('span', null, row.promo.label),
        row.promo.endsAt ? h('span', { className: 'end' }, t('promoEnds', { date: row.promo.endsAt })) : null)
    }

    function capLabel(cap, t) {
      const entry = CAP_KEYS.find(([k]) => k === cap)
      return entry ? t(entry[1]) : cap
    }

    /**
     * Model Catalog View (View 1):
     * Per shiroha's explicit decision ("模型列表不要单独拆一列，直接放出来展示"),
     * the permanent 196px left filter column is removed; model cards/table span
     * 100% of the main viewport width, while vendor/capability/billing filters
     * open cleanly from the toolbar Filter button + quick filter bar.
     */
    function ModelCatalogView(props) {
      const t = props.t ?? fallbackT
      const catalog = props.catalog
      const status = props.status
      const origin = props.origin ?? takoOrigin(status)
      const prefs = props.prefs
      const updatePrefs = props.updatePrefs
      const pinned = Array.isArray(props.pinned) ? props.pinned : []
      const activeModel = props.activeModel

      const [query, setQuery] = useState('')
      const [quick, setQuick] = useState('all')
      const [vendors, setVendors] = useState([])
      const [caps, setCaps] = useState([])
      const [bill, setBill] = useState('all')
      const [vendorAll, setVendorAll] = useState(false)
      const [openMenu, setOpenMenu] = useState(null) // 'cur' | 'sort' | null
      const [filterOpen, setFilterOpen] = useState(false)
      const [drawerId, setDrawerId] = useState(null)
      const [toastText, setToastText] = useState(undefined)
      const searchRef = useRef(null)
      const toastTimer = useRef(undefined)

      const showToast = msg => {
        setToastText(msg)
        if (toastTimer.current !== undefined) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastText(undefined), 2200)
      }
      useEffect(() => () => { if (toastTimer.current !== undefined) clearTimeout(toastTimer.current) }, [])

      useEffect(() => {
        const onKey = event => {
          if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k') {
            event.preventDefault()
            searchRef.current?.focus?.()
          }
          if (event.key === 'Escape') {
            setDrawerId(null)
            setFilterOpen(false)
            setOpenMenu(null)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const models = catalog && Array.isArray(catalog.models) ? catalog.models : []
      const cards = catalog && Array.isArray(catalog.cards) ? catalog.cards : []
      const cardsById = new Map(cards.map(c => [c.id, c]))
      const rows = models.map((m, idx) => ({ ...normalizeModelRow(m, cardsById.get(m.id)), order: idx }))
      const rowsById = new Map(rows.map(r => [r.id, r]))

      const toggleIn = (list, setList, value) => {
        setList(list.includes(value) ? list.filter(x => x !== value) : [...list, value])
      }
      const clearFilters = () => { setVendors([]); setCaps([]); setBill('all'); setQuick('all'); setQuery('') }

      // Filter counts across full catalog
      const vendorCountsMap = {}
      for (const r of rows) vendorCountsMap[r.vendorName] = (vendorCountsMap[r.vendorName] || 0) + 1
      const vendorCounts = Object.entries(vendorCountsMap).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      const capCount = c => rows.filter(r => r.capabilities.includes(c)).length
      const billCounts = [
        ['all', t('billAll'), rows.length],
        ['token', t('billToken'), rows.filter(r => r.billingType === 'token' || r.billingType === 'dynamic').length],
        ['call', t('billCall'), rows.filter(r => r.billingType === 'call').length],
        ['free', t('billFree'), rows.filter(r => r.billingType === 'free').length],
      ].filter(b => b[2] > 0)

      const needle = query.trim().toLowerCase()
      const filtered = rows.filter(r => {
        if (needle !== '' && !(r.id.toLowerCase().includes(needle) || r.vendorName.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle))) return false
        if (vendors.length > 0 && !vendors.includes(r.vendorName)) return false
        for (const c of caps) if (!r.capabilities.includes(c)) return false
        if (bill === 'token' && !(r.billingType === 'token' || r.billingType === 'dynamic')) return false
        if (bill === 'call' && r.billingType !== 'call') return false
        if (bill === 'free' && r.billingType !== 'free') return false
        if (quick === 'fav' && !pinned.includes(r.id)) return false
        if (quick === 'promo' && !r.promo) return false
        if (quick === 'cheap' && !(r.officialRatio !== undefined && r.officialRatio <= 0.1)) return false
        if (quick === 'code' && !r.capabilities.includes('code')) return false
        if (quick === 'long' && !r.capabilities.includes('longContext')) return false
        if (quick === 'vision' && !r.capabilities.includes('vision')) return false
        return true
      })

      const primarySortPrice = r => {
        if (r.billingType === 'free') return 0
        if (r.billingType === 'call') return r.callUsd ?? 1e9
        if (prefs.priceMode === 'avg') return r.realizedUsd ?? r.stdUsd ?? 1e9
        return r.inputUsd ?? 1e9
      }
      const sorted = filtered.slice()
      if (prefs.sort === 'rec') {
        sorted.sort((a, b) => {
          const pa = pinned.indexOf(a.id)
          const pb = pinned.indexOf(b.id)
          const ra = pa === -1 ? 1e6 : pa
          const rb = pb === -1 ? 1e6 : pb
          return (ra - rb) || (a.order - b.order)
        })
      } else if (prefs.sort === 'price') {
        sorted.sort((a, b) => primarySortPrice(a) - primarySortPrice(b) || a.id.localeCompare(b.id))
      } else if (prefs.sort === 'disc') {
        sorted.sort((a, b) => (a.officialRatio ?? 99) - (b.officialRatio ?? 99) || a.id.localeCompare(b.id))
      } else if (prefs.sort === 'name') {
        sorted.sort((a, b) => a.id.localeCompare(b.id))
      }

      const handleFav = async (event, id) => {
        if (event && event.stopPropagation) event.stopPropagation()
        if (!props.onTogglePin) return
        const wasFav = pinned.includes(id)
        const ok = await props.onTogglePin(id)
        if (ok !== false) showToast(wasFav ? t('favRemoveToast', { model: id }) : t('favAddToast', { model: id }))
      }

      const handleSelectChat = async (event, id) => {
        if (event && event.stopPropagation) event.stopPropagation()
        if (!status || status.configured !== true) {
          showToast(t('setChatNeedLogin'))
          return
        }
        if (props.onSelectChat) {
          const outcome = await props.onSelectChat(id)
          if (outcome === 'saved') { showToast(t('setChatDone', { model: id })); return }
          if (outcome === 'not-configured') { showToast(t('setChatNeedLogin')); return }
        }
        await copyTextSafe(id)
        showToast(t('setChatFallback', { model: id }))
      }

      const handleCopyId = async id => {
        await copyTextSafe(id)
        showToast(t('copiedModelId', { model: id }))
      }

      const chatBtn = (row, sm, primary) => {
        const isCur = activeModel === row.id
        const cls = isCur
          ? `tk-btn${sm ? ' tk-btn-sm' : ''} tk-btn-cur`
          : `tk-btn${sm ? ' tk-btn-sm' : ''}${primary ? ' tk-btn-pri' : ''}`
        return h('button', {
          type: 'button',
          className: cls,
          'data-testid': `dsh-tako-use-${row.id}`,
          onClick: event => {
            if (isCur) { event.stopPropagation(); return }
            void handleSelectChat(event, row.id)
          },
        }, isCur ? t('currentChatModel') : t('setChatModel'))
      }

      const favBtn = row => {
        const isFav = pinned.includes(row.id)
        return h('button', {
          type: 'button',
          className: `tk-iconbtn${isFav ? ' fav' : ''}`,
          'data-active': String(isFav),
          'data-testid': `dsh-tako-pin-${row.id}`,
          title: isFav ? t('unpinTitle') : t('pinTitle'),
          onClick: event => { void handleFav(event, row.id) },
        }, Icon.star(isFav))
      }

      const activeFilterCount = vendors.length + caps.length + (bill !== 'all' ? 1 : 0)
      const refreshSummary = catalog
        ? h(Countdown, { nextSyncAt: catalog.nextSyncAt, lastSyncAt: catalog.lastSyncAt, refreshIntervalMs: catalog.refreshIntervalMs, t })
        : '…'

      const quickItems = [
        ['all', t('quickAll')],
        ['fav', t('quickFav')],
        ['promo', [h('span', { key: 'd', className: 'dot' }), t('quickPromo')]],
        ['cheap', t('quickCheap')],
        ['code', t('quickCode')],
        ['long', t('quickLong')],
        ['vision', t('quickVision')],
      ]

      const sortLabels = { rec: t('sortRec'), price: t('sortPrice'), disc: t('sortDisc'), name: t('sortName') }
      const activeChips = [
        ...vendors.map(v => ({ key: `v:${v}`, label: v, remove: () => toggleIn(vendors, setVendors, v) })),
        ...caps.map(c => ({ key: `c:${c}`, label: capLabel(c, t), remove: () => toggleIn(caps, setCaps, c) })),
        ...(bill !== 'all' ? [{ key: `b:${bill}`, label: bill === 'token' ? t('billToken') : bill === 'call' ? t('billCall') : t('billFree'), remove: () => setBill('all') }] : []),
      ]

      // Render main list (cards or table) — full width, flat, all models visible directly
      let listNode
      if (catalog === undefined) {
        listNode = h('div', { className: 'tk-empty' }, h('p', null, props.error ? `${t('loadFailed')}: ${props.error}` : '…'))
      } else if (rows.length === 0) {
        listNode = h('div', { className: 'tk-empty', 'data-testid': 'dsh-tako-catalog-empty' },
          h('h3', null, t('catalogEmpty')),
          catalog.lastError ? h('p', null, `${t('catalogFailed')} · ${t('catalogAttempts', { count: catalog.attempts ?? 0 })}`) : null)
      } else if (sorted.length === 0) {
        listNode = needle !== ''
          ? h('div', { className: 'tk-empty', 'data-testid': 'dsh-tako-catalog-nomatch' },
              h('div', { className: 'ill' }, Icon.search(26)),
              h('h3', null, t('emptySearchTitle', { q: query.trim() })),
              h('p', null, t('emptySearchDesc')),
              h('button', { type: 'button', className: 'tk-btn', onClick: () => setQuery('') }, t('clearSearch')))
          : h('div', { className: 'tk-empty', 'data-testid': 'dsh-tako-catalog-nomatch' },
              h('div', { className: 'ill' }, Icon.filter(26)),
              h('h3', null, t('emptyFilterTitle')),
              h('p', null, t('emptyFilterDesc')),
              h('button', { type: 'button', className: 'tk-btn tk-btn-pri', onClick: clearFilters }, t('filterResetAll')))
      } else if (prefs.layout === 'table') {
        const avg = prefs.priceMode === 'avg'
        const sym = prefs.currency === 'usd' ? '$' : '¥'
        const unitShort = prefs.tokenUnit === 'K' ? '1K' : '1M'
        const headers = avg
          ? [t('colRealized'), t('colStdLoad'), t('colCacheHit')]
          : [t('priceInput'), t('priceCache'), t('priceOutput')]
        const opts = { cur: prefs.currency, unit: prefs.tokenUnit, perToken: true }
        listNode = h('div', { className: 'tk-tablewrap', 'data-testid': 'dsh-tako-catalog-table' },
          h('table', { className: 'tk-table mt' },
            h('thead', null, h('tr', null,
              h('th', null, t('colModel')),
              h('th', null, t('colBilling')),
              ...headers.map((label, idx) => h('th', { key: label, className: 'r' }, label, h('span', { className: 'unit' }, avg && idx === 2 ? '%' : `${sym} / ${unitShort}`))),
              h('th', null, t('colVsOfficial')),
              h('th', { className: 'r' }, t('colActions')))),
            h('tbody', null, sorted.map(row => {
              let priceCells
              if (row.billingType === 'call') {
                priceCells = [h('td', { key: 'call', className: 'span-call', colSpan: 3 },
                  h('span', { className: 'v' }, `${moneyFromUsd(row.callUsd, { cur: prefs.currency, perToken: false }) || '—'} ${t('perCall')}`),
                  ' ',
                  h('span', { className: 'sub', style: { display: 'inline' } }, `· ${t('billCallFixed')}`))]
              } else if (avg) {
                const realStr = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.realizedUsd, opts)
                const stdStr = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.stdUsd, opts)
                const hitStr = typeof row.hitRate === 'number' ? `${Math.round(row.hitRate * 100)}%` : null
                priceCells = [
                  h('td', { key: 'r1', className: 'r' },
                    h('span', { className: `v${realStr === null ? ' na' : ''}` }, realStr ?? '—'),
                    realStr === null ? h('span', { className: 'sub' }, t('noRealizedShort')) : null),
                  h('td', { key: 'r2', className: 'r' }, h('span', { className: `v${stdStr === null ? ' na' : ''}` }, stdStr ?? '—')),
                  h('td', { key: 'r3', className: 'r' }, h('span', { className: `v${hitStr === null ? ' na' : ''}` }, hitStr ?? '—')),
                ]
              } else {
                const pIn = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.inputUsd, opts)
                const pCache = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.cacheUsd, opts)
                const pOut = row.billingType === 'free' ? money(0, opts) : moneyFromUsd(row.outputUsd, opts)
                priceCells = [pIn, pCache, pOut].map((val, idx) => h('td', { key: `d${idx}`, className: 'r' }, h('span', { className: `v${val === null ? ' na' : ''}` }, val ?? '—')))
              }
              return h('tr', {
                key: row.id,
                'data-model': row.id,
                'data-testid': `dsh-tako-modelrow-${row.id}`,
                style: { cursor: 'pointer' },
                onClick: () => setDrawerId(row.id),
              },
                h('td', null, h('div', { className: 'tk-tn' },
                  h(VendorLogo, { vendor: row.vendorName, fallback: row.id }),
                  h('div', { style: { minWidth: 0 } },
                    h('div', { className: 'tk-mname', title: row.id }, row.id),
                    h('span', { className: 'sub' }, `${row.vendorName} · ${row.ctxText}`)))),
                h('td', null,
                  row.billingType === 'call' ? h('span', { className: 'tk-b tk-b-call' }, t('billCallShort'))
                    : row.billingType === 'free' ? h('span', { className: 'tk-b tk-b-free' }, t('billFree'))
                    : row.billingType === 'dynamic' ? h('span', { className: 'tk-b tk-b-dyn' }, t('billDynamic'))
                    : h('span', { style: { color: 'var(--tk-ink-500)', fontSize: '12px' } }, t('billToken')),
                  row.promo ? ' ' : null,
                  row.promo ? h('span', { className: 'tk-b tk-b-promo' }, '🔥') : null),
                ...priceCells,
                h('td', null, row.officialRatio !== undefined
                  ? h('span', { className: 'tk-b tk-b-save' }, h('b', null, `${row.officialRatio.toFixed(2)}x`))
                  : h('span', { style: { color: 'var(--tk-ink-300)' } }, '—')),
                h('td', null, h('div', { className: 'tk-acts' }, favBtn(row), chatBtn(row, true, false))))
            }))))
      } else {
        listNode = h('div', { className: 'tk-grid', 'data-testid': 'dsh-tako-catalog-grid' },
          sorted.map(row => {
            const visibleCaps = row.capabilities.filter(c => c !== 'longContext')
            const shownCaps = visibleCaps.slice(0, 2)
            const extraCaps = visibleCaps.length > 2 ? visibleCaps.length - 2 : 0
            return h('div', {
              key: row.id,
              className: `tk-card${row.promo ? ' has-promo' : ''}${activeModel === row.id ? ' is-cur' : ''}`,
              'data-model': row.id,
              'data-pinned': String(pinned.includes(row.id)),
              'data-current': String(activeModel === row.id),
              'data-testid': `dsh-tako-modelcard-${row.id}`,
              onClick: () => setDrawerId(row.id),
            },
              h('div', { className: 'tk-ch' },
                h(VendorLogo, { vendor: row.vendorName, fallback: row.id }),
                h('div', { className: 'tk-ct' },
                  h('div', { className: 'tk-mname', title: row.id }, row.id),
                  h('div', { className: 'tk-msub' },
                    row.vendorName,
                    row.channelLabel ? [h('span', { key: 'ds', className: 'ds' }), row.channelLabel] : null)),
                favBtn(row)),
              h(ModelBadges, { row, t }),
              h(ModelPricePanel, { row, prefs, t }),
              h(ModelPromoBar, { row, prefs, t }),
              h('p', { className: 'tk-desc', title: row.description }, row.description || `${row.vendorName} · ${row.ctxText}`),
              h('div', { className: 'tk-cf' },
                ...shownCaps.map(c => h('span', { key: c, className: 'tk-cap' }, capLabel(c, t))),
                extraCaps > 0 ? h('span', { className: 'tk-cap' }, `+${extraCaps}`) : null,
                h('span', { className: 'ctx' }, row.ctxText),
                h('span', { className: 'act' }, chatBtn(row, true, false))))
          }))
      }

      // Details drawer
      const drawerRow = drawerId ? rowsById.get(drawerId) : undefined
      const drawerNode = drawerRow ? [
        h('div', { key: 'dmask', className: 'tk-mask', onClick: () => setDrawerId(null) }),
        h('aside', { key: 'drawer', className: 'tk-drawer', 'data-testid': 'dsh-tako-model-drawer' },
          h('div', { className: 'dh' },
            h(VendorLogo, { vendor: drawerRow.vendorName, fallback: drawerRow.id }),
            h('div', { className: 'tk-ct' },
              h('div', { className: 'tk-mname', style: { whiteSpace: 'normal', wordBreak: 'break-all' } }, drawerRow.id),
              h('div', { className: 'tk-msub' },
                drawerRow.vendorName,
                drawerRow.channelLabel ? [h('span', { key: 'd1', className: 'ds' }), drawerRow.channelLabel] : null,
                h('span', { className: 'ds' }),
                t('drawerContext', { ctx: drawerRow.ctxText }))),
            h('button', { type: 'button', className: 'tk-iconbtn', 'aria-label': t('cancel'), onClick: () => setDrawerId(null) }, '✕')),
          h('div', { className: 'db' },
            h(ModelBadges, { row: drawerRow, t }),
            h(ModelPricePanel, { row: drawerRow, prefs, t }),
            h(ModelPromoBar, { row: drawerRow, prefs, t }),
            drawerRow.description ? h('p', { style: { margin: 0, fontSize: '13px', color: 'var(--tk-ink-700)', lineHeight: 1.65 } }, drawerRow.description) : null,
            (drawerRow.billingType === 'token' || drawerRow.billingType === 'dynamic')
              ? h('div', null,
                  h('div', { className: 'tk-dtitle' }, t('drawerFullPrice', { cur: prefs.currency === 'usd' ? t('curUsdShort') : t('curCnyShort'), unit: unitTxt(prefs) })),
                  h('dl', { className: 'tk-kv' },
                    h('dt', null, t('priceInput')),
                    h('dd', { className: 'tk-num' },
                      moneyFromUsd(drawerRow.inputUsd, { cur: prefs.currency, unit: prefs.tokenUnit }) ?? '—',
                      drawerRow.officialInputUsd !== undefined
                        ? h('span', { style: { color: 'var(--tk-ink-400)', marginLeft: '10px' } },
                            t('drawerOfficialRef', { price: moneyFromUsd(drawerRow.officialInputUsd, { cur: prefs.currency, unit: prefs.tokenUnit }) }))
                        : null),
                    h('dt', null, t('priceCache')),
                    h('dd', { className: 'tk-num' }, moneyFromUsd(drawerRow.cacheUsd, { cur: prefs.currency, unit: prefs.tokenUnit }) ?? '—'),
                    h('dt', null, t('priceOutput')),
                    h('dd', { className: 'tk-num' },
                      moneyFromUsd(drawerRow.outputUsd, { cur: prefs.currency, unit: prefs.tokenUnit }) ?? '—',
                      drawerRow.officialOutputUsd !== undefined
                        ? h('span', { style: { color: 'var(--tk-ink-400)', marginLeft: '10px' } },
                            t('drawerOfficialRef', { price: moneyFromUsd(drawerRow.officialOutputUsd, { cur: prefs.currency, unit: prefs.tokenUnit }) }))
                        : null),
                    h('dt', null, t('drawerRealized7d')),
                    h('dd', { className: 'tk-num' }, drawerRow.realizedUsd !== undefined
                      ? `${moneyFromUsd(drawerRow.realizedUsd, { cur: prefs.currency, unit: prefs.tokenUnit })}${typeof drawerRow.hitRate === 'number' ? ` · ${t('drawerCacheHit', { hit: `${Math.round(drawerRow.hitRate * 100)}%` })}` : ''}`
                      : '—')))
              : null,
            h('div', null,
              h('div', { className: 'tk-dtitle' }, t('drawerInDsh')),
              h('dl', { className: 'tk-kv' },
                h('dt', null, 'Provider'), h('dd', { className: 'tk-num' }, 'providers.tako (OpenAI /v1)'),
                h('dt', null, t('drawerEffort')),
                h('dd', null, drawerRow.efforts.length > 0
                  ? h('div', { className: 'tk-effort' }, drawerRow.efforts.map(e => h('span', { key: e }, e)))
                  : h('span', { style: muted }, '—')),
                h('dt', null, t('filterCapability')), h('dd', null, drawerRow.capabilities.map(c => capLabel(c, t)).join(' · ') || '—'),
                h('dt', null, t('cardEndpoints')), h('dd', { className: 'tk-num' }, drawerRow.endpoints.join(' · ') || 'openai'),
                h('dt', null, t('cardChannels')),
                h('dd', null, drawerRow.channels.length > 0
                  ? `${drawerRow.channels.map(c => c.tag ? `${c.name} (${c.tag})` : c.name).slice(0, 3).join(' · ')}${drawerRow.channelCount > 3 ? ` +${drawerRow.channelCount - 3}` : ''}`
                  : (drawerRow.channelCount > 0 ? t('drawerChannelsCount', { count: drawerRow.channelCount }) : '—'))))),
          h('div', { className: 'df' },
            chatBtn(drawerRow, false, true),
            h('button', { type: 'button', className: 'tk-btn', onClick: event => { void handleFav(event, drawerRow.id) } },
              Icon.star(pinned.includes(drawerRow.id)), pinned.includes(drawerRow.id) ? t('favAdded') : t('favAdd')),
            h('button', { type: 'button', className: 'tk-btn', onClick: () => { void handleCopyId(drawerRow.id) } }, t('copyModelId')),
            h('a', {
              className: 'tk-btn',
              style: { marginLeft: 'auto' },
              href: `${origin}/pricing?search=${encodeURIComponent(drawerRow.id)}`,
              target: '_blank',
              rel: 'noopener noreferrer',
            }, t('plazaShort'))))]
        : null

      // On-demand Filter Drawer (no permanent left column)
      const shownVendors = vendorAll ? vendorCounts : vendorCounts.slice(0, 5)
      const filterDrawerNode = filterOpen ? [
        h('div', { key: 'fmask', className: 'tk-mask', onClick: () => setFilterOpen(false) }),
        h('aside', { key: 'fdrawer', className: 'tk-filter-drawer', 'data-testid': 'dsh-tako-filter-drawer' },
          h('div', { className: 'tk-filter-h' },
            h('span', null, t('filterBtn')),
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              activeFilterCount > 0 ? h('button', { type: 'button', className: 'tk-link', onClick: clearFilters }, t('filterClear')) : null,
              h('button', { type: 'button', className: 'tk-link', onClick: () => setFilterOpen(false) }, t('filterDone')))),
          h('div', { className: 'tk-filter-b' },
            h('div', { className: 'tk-sec' },
              h('div', { className: 'tk-sec-t' }, t('filterVendor')),
              shownVendors.map(([v, count]) => h('button', {
                key: v, type: 'button',
                className: `tk-opt${vendors.includes(v) ? ' on' : ''}`,
                onClick: () => toggleIn(vendors, setVendors, v),
              }, h('span', { className: 'tk-chk' }), h(VendorLogo, { vendor: v, className: 'tk-vdot' }), v, h('span', { className: 'cnt' }, count))),
              vendorCounts.length > 5 ? h('button', {
                type: 'button', className: 'tk-link', style: { padding: '6px' },
                onClick: () => setVendorAll(!vendorAll),
              }, vendorAll ? t('filterVendorCollapse') : t('filterVendorExpand', { count: vendorCounts.length })) : null),
            h('div', { className: 'tk-sec' },
              h('div', { className: 'tk-sec-t' }, t('filterCapability')),
              CAP_KEYS.filter(([k]) => capCount(k) > 0).map(([k, lKey]) => h('button', {
                key: k, type: 'button',
                className: `tk-opt${caps.includes(k) ? ' on' : ''}`,
                onClick: () => toggleIn(caps, setCaps, k),
              }, h('span', { className: 'tk-chk' }), t(lKey), h('span', { className: 'cnt' }, capCount(k))))),
            h('div', { className: 'tk-sec' },
              h('div', { className: 'tk-sec-t' }, t('filterBilling')),
              billCounts.map(([k, label, count]) => h('button', {
                key: k, type: 'button',
                className: `tk-opt${bill === k ? ' on' : ''}`,
                onClick: () => setBill(bill === k ? 'all' : k),
              }, h('span', { className: 'tk-rdo' }), label, h('span', { className: 'cnt' }, count))))))]
        : null

      return h('div', { className: 'dsh-tako-root tk-mwrap', 'data-testid': props.embedded ? 'dsh-tako-tabpanel-models' : 'dsh-tako-models-page', onClick: () => { if (openMenu) setOpenMenu(null) } },
        h('div', { className: 'tk-scroll' },
          h('div', { className: 'tk-page' },
            // Page header
            h('div', { className: 'tk-phead' },
              props.onBackToConsole ? h('button', { type: 'button', className: 'tk-btn tk-btn-sm', onClick: props.onBackToConsole }, t('backToConsole')) : null,
              TakoMark(28),
              h('div', null,
                h('h1', null, t('modelsPanel')),
                h('div', { className: 'sub' }, t('modelsSub', { count: rows.length }), ' · ', refreshSummary)),
              h('div', { className: 'tk-search' },
                h('span', { className: 'ic' }, Icon.search(14)),
                h('input', {
                  ref: searchRef,
                  type: 'search',
                  value: query,
                  placeholder: t('searchModelsPlaceholder'),
                  'data-testid': 'dsh-tako-catalog-search',
                  onChange: event => setQuery(event.target.value),
                }),
                h('kbd', null, '⌘K')),
              h('div', { className: 'tk-chatnow', title: activeModel || t('notSelected'), 'data-testid': 'dsh-tako-active-model' },
                h('span', { className: 'dot' }),
                h('span', { className: 'lbl' }, t('currentChatLabel')),
                h('b', null, activeModel || t('notSelected')))),
            // Sticky streamlined toolbar (Filter drawer trigger + 1 seg + 2 dropdowns + 1 icon group; NO sync button here)
            h('div', { className: 'tk-toolbar' },
              h('button', {
                type: 'button',
                className: `tk-btn tk-btn-sm${activeFilterCount > 0 ? ' tk-btn-active' : ''}`,
                'data-testid': 'dsh-tako-filter-toggle',
                onClick: event => { event.stopPropagation(); setFilterOpen(true) },
              }, Icon.filter(13), activeFilterCount > 0 ? `${t('filterBtn')} · ${activeFilterCount}` : t('filterBtn')),
              h('span', { className: 'tk-count', 'data-testid': 'dsh-tako-catalog-count' },
                t('modelsCount', { count: sorted.length }), ' ', h('small', null, `/ ${rows.length}`)),
              h('div', { className: 'tk-tb-r' },
                h('div', { className: 'tk-seg' },
                  h('button', { type: 'button', className: prefs.priceMode === 'detail' ? 'on' : '', 'data-testid': 'dsh-tako-pmode-detail', onClick: () => updatePrefs({ priceMode: 'detail' }) }, t('priceDetail')),
                  h('button', { type: 'button', className: prefs.priceMode === 'avg' ? 'on' : '', 'data-testid': 'dsh-tako-pmode-avg', onClick: () => updatePrefs({ priceMode: 'avg' }) }, t('priceAvg'))),
                h('div', { className: 'tk-dd', onClick: event => event.stopPropagation() },
                  h('button', {
                    type: 'button', className: 'tk-ddbtn', 'data-testid': 'dsh-tako-cur-menu',
                    onClick: () => setOpenMenu(openMenu === 'cur' ? null : 'cur'),
                  },
                    h('span', { className: 'cur' }, prefs.currency === 'usd' ? '$' : '¥'),
                    h('span', { className: 'lbl' }, prefs.currency === 'usd' ? t('curUsdShort') : t('curCnyShort')),
                    ` · /${prefs.tokenUnit === 'K' ? '1K' : '1M'} `, Icon.chev()),
                  openMenu === 'cur' ? h('div', { className: 'tk-pop', 'data-testid': 'dsh-tako-cur-popover' },
                    h('h6', null, t('currencyTitle')),
                    h('button', { type: 'button', className: `tk-pi${prefs.currency === 'cny' ? ' on' : ''}`, 'data-testid': 'dsh-tako-cur-cny', onClick: () => { updatePrefs({ currency: 'cny' }); setOpenMenu(null) } },
                      h('span', { className: 'rd' }), h('span', null, h('b', null, t('curCnyTitle')), h('span', null, t('curCnyDesc')))),
                    h('button', { type: 'button', className: `tk-pi${prefs.currency === 'usd' ? ' on' : ''}`, 'data-testid': 'dsh-tako-cur-usd', onClick: () => { updatePrefs({ currency: 'usd' }); setOpenMenu(null) } },
                      h('span', { className: 'rd' }), h('span', null, h('b', null, t('curUsdTitle')), h('span', null, t('curUsdDesc')))),
                    h('hr', null),
                    h('h6', null, t('tokenUnitTitle')),
                    h('div', { className: 'tk-seg' },
                      h('button', { type: 'button', className: prefs.tokenUnit === 'M' ? 'on' : '', 'data-testid': 'dsh-tako-unit-M', onClick: () => updatePrefs({ tokenUnit: 'M' }) }, t('per1M')),
                      h('button', { type: 'button', className: prefs.tokenUnit === 'K' ? 'on' : '', 'data-testid': 'dsh-tako-unit-K', onClick: () => updatePrefs({ tokenUnit: 'K' }) }, t('per1K')))) : null),
                h('div', { className: 'tk-dd', onClick: event => event.stopPropagation() },
                  h('button', {
                    type: 'button', className: 'tk-ddbtn', 'data-testid': 'dsh-tako-sort-menu',
                    onClick: () => setOpenMenu(openMenu === 'sort' ? null : 'sort'),
                  }, '⇅ ', h('span', { className: 'lbl' }, sortLabels[prefs.sort] || t('sortRec')), ' ', Icon.chev()),
                  openMenu === 'sort' ? h('div', { className: 'tk-pop', style: { minWidth: '208px' } },
                    [['rec', 'sortRec', 'sortRecDesc'], ['price', 'sortPrice', 'sortPriceDesc'], ['disc', 'sortDisc', 'sortDiscDesc'], ['name', 'sortName', 'sortNameDesc']].map(([k, bk, sk]) =>
                      h('button', { key: k, type: 'button', className: `tk-pi${prefs.sort === k ? ' on' : ''}`, onClick: () => { updatePrefs({ sort: k }); setOpenMenu(null) } },
                        h('span', { className: 'rd' }), h('span', null, h('b', null, t(bk)), h('span', null, t(sk)))))) : null),
                h('div', { className: 'tk-seg icon' },
                  h('button', { type: 'button', className: prefs.layout === 'card' ? 'on' : '', title: t('viewCard'), 'data-testid': 'dsh-tako-layout-card', onClick: () => updatePrefs({ layout: 'card' }) }, Icon.grid()),
                  h('button', { type: 'button', className: prefs.layout === 'table' ? 'on' : '', title: t('viewTable'), 'data-testid': 'dsh-tako-layout-table', onClick: () => updatePrefs({ layout: 'table' }) }, Icon.list())))),
            // Quick filter strip
            h('div', { className: 'tk-quick' },
              quickItems.map(([k, label]) => h('button', {
                key: k, type: 'button',
                className: `tk-qchip${quick === k ? ' on' : ''}`,
                'data-testid': `dsh-tako-quick-${k}`,
                onClick: () => setQuick(quick === k ? 'all' : k),
              }, label))),
            // Active filter chips
            activeChips.length > 0 ? h('div', { className: 'tk-active-f' },
              activeChips.map(c => h('button', { key: c.key, type: 'button', className: 'tk-af', onClick: c.remove }, c.label, ' ×')),
              activeChips.length >= 2 ? h('button', { type: 'button', className: 'tk-link', onClick: clearFilters }, t('filterClear')) : null) : null,
            // Legend row (mandatory orange warning when Internal USD is active)
            h('div', { className: 'tk-legend' },
              prefs.currency === 'usd'
                ? h('span', { className: 'tk-warnchip', 'data-testid': 'dsh-tako-usd-warning' }, t('usdWarnChip'))
                : h('span', null, t('cnyNote')),
              h('span', { className: 'sep' }),
              h('span', null, t('discountNote')),
              h('span', { className: 'sep' }),
              h('span', null, prefs.priceMode === 'avg' ? t('legendAvg') : t('legendDetail'))),
            // Full-width flat model list (no left filter rail column)
            listNode)),
        filterDrawerNode,
        drawerNode,
        toastText !== undefined ? h('div', { className: 'tk-toast', role: 'status', 'data-testid': 'dsh-tako-toast' }, toastText) : null)
    }

    /** Standalone "Tako Models" panel (sidebar.panellist id `tako-models`, main key `tako-models`). */
    function TakoModelsPage(props) {
      const t = props.t ?? fallbackT
      const [status, setStatus] = useState(undefined)
      const [catalog, setCatalog] = useState(undefined)
      const [catalogError, setCatalogError] = useState(undefined)
      const [pinned, setPinned] = useState([])
      const [activeModel, setActiveModel] = useState(undefined)
      const [prefs, updatePrefs] = useTakoPrefs(catalog !== undefined && catalog.consoleApiVersion === CONSOLE_API_VERSION)
      const alive = useRef(true)
      useEffect(() => { alive.current = true; ensureTakoTheme(); return () => { alive.current = false } }, [])

      const { load: loadStatus } = useStatusReader(next => { setStatus(next) }, () => {})
      useStatusRefresh(loadStatus)

      useEffect(() => {
        let disposed = false
        let timer
        const load = async () => {
          try {
            const next = await call('GET', CATALOG_ROUTE)
            if (disposed || !alive.current) return
            setCatalog(next)
            setCatalogError(undefined)
            if (next && typeof next.nextSyncAt === 'number') {
              timer = setTimeout(load, Math.min(2147483647, Math.max(5000, next.nextSyncAt - Date.now() + 250)))
            }
          } catch (error) {
            if (!disposed && alive.current) setCatalogError(String(error && error.message || error))
          }
        }
        void load()
        return () => { disposed = true; clearTimeout(timer) }
      }, [])

      useEffect(() => {
        if (!catalog || catalog.consoleApiVersion !== CONSOLE_API_VERSION) return
        void (async () => {
          try {
            const cfg = await call('GET', CONFIG_ROUTE)
            if (alive.current && cfg && cfg.ok === true && cfg.config && Array.isArray(cfg.config.pinned)) setPinned(cfg.config.pinned)
          } catch {}
        })()
        void (async () => {
          try {
            const m = await call('GET', ACTIVE_MODEL_ROUTE)
            if (alive.current && m && m.ok === true && m.provider === PROVIDER && typeof m.model === 'string') setActiveModel(m.model)
          } catch {}
        })()
      }, [catalog && catalog.consoleApiVersion])

      const onTogglePin = async id => {
        const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [...pinned, id]
        setPinned(next)
        try {
          const result = await call('POST', CONFIG_ROUTE, { set: { pinned: next } })
          if (!result || result.ok !== true) { if (alive.current) setPinned(pinned); return false }
          return true
        } catch {
          if (alive.current) setPinned(pinned)
          return false
        }
      }

      const onSelectChat = async id => {
        try {
          const result = await call('POST', ACTIVE_MODEL_ROUTE, { model: id })
          if (result && result.ok === true) {
            if (alive.current) setActiveModel(id)
            return 'saved'
          }
          if (result && result.code === 'not-configured') return 'not-configured'
        } catch {}
        return 'fallback'
      }

      return h(ModelCatalogView, {
        t, status, catalog, error: catalogError, origin: takoOrigin(status),
        prefs, updatePrefs, pinned, activeModel, onTogglePin, onSelectChat,
      })
    }

    // ---------------------------------------------------------------- announcements (markdown-lite + history toggle)

    const stripMarkdown = text => String(text ?? '').replace(/^[#>\-*+\s]+/gm, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim()

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

    const mdLite = text => {
      const blocks = []
      let bullets = []
      const flushBullets = () => {
        if (bullets.length === 0) return
        blocks.push(h('ul', { key: blocks.length }, bullets))
        bullets = []
      }
      for (const line of String(text ?? '').split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') { flushBullets(); continue }
        const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
        if (heading !== null) { flushBullets(); blocks.push(h('h4', { key: blocks.length }, mdInline(heading[2]))); continue }
        const bullet = /^[-*·]\s+(.*)$/.exec(trimmed)
        if (bullet !== null) {
          bullets.push(h('li', { key: bullets.length }, mdInline(bullet[1])))
          continue
        }
        flushBullets()
        blocks.push(h('p', { key: blocks.length, style: { margin: '2px 0' } }, mdInline(trimmed)))
      }
      flushBullets()
      return blocks
    }

    const NOTICE_TONES = { ongoing: 'info', success: 'success', warning: 'warn', error: 'error' }
    const noticeId = item => item.id !== undefined ? String(item.id) : String(item.publishDate ?? '') + ':' + String(item.content ?? '').slice(0, 40)
    const NOTICE_DISMISSED_KEY = 'dsh-tako.notices.dismissed'
    const noticeStorage = () => {
      try {
        const storage = typeof window === 'object' && window !== null ? window.localStorage : undefined
        if (storage === undefined || typeof storage.getItem !== 'function') return undefined
        return storage
      } catch { return undefined }
    }
    const loadDismissedNotices = () => {
      try {
        const parsed = JSON.parse(noticeStorage()?.getItem(NOTICE_DISMISSED_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch { return [] }
    }
    const saveDismissedNotices = ids => {
      try { noticeStorage()?.setItem(NOTICE_DISMISSED_KEY, JSON.stringify(ids.slice(-200))) } catch {}
    }

    function NoticeItem(props) {
      const t = props.t ?? fallbackT
      const item = props.item
      const preview = stripMarkdown(item.content).split('\n').filter(line => line !== '')[0] ?? ''
      const date = item.publishDate !== undefined ? String(item.publishDate).slice(0, 10) : item.date
      return h('details', {
        className: 'dsh-tako-notice-item' + (props.read === true ? ' dsh-tako-notice-read' : ''),
        'data-testid': 'dsh-tako-notice-item',
      },
        h('summary', null,
          h('span', { className: 'dsh-tako-notice-dot', 'data-tone': NOTICE_TONES[item.type], 'aria-hidden': true }),
          h('span', { className: 'dsh-tako-notice-preview' }, preview),
          date === undefined ? null : h('span', { className: 'dsh-tako-notice-date' }, date),
          props.onDismiss ? h('button', {
            type: 'button',
            className: 'tk-btn tk-btn-sm',
            style: { marginLeft: '4px', padding: '1px 7px', fontSize: '11px' },
            'data-testid': 'dsh-tako-notice-dismiss',
            onClick: event => { event.preventDefault(); event.stopPropagation(); props.onDismiss(item) },
          }, t('noticeDismiss')) : null),
        h('div', { className: 'dsh-tako-notice-body', 'data-testid': 'dsh-tako-notice-body' }, mdLite(item.content)))
    }

    function NoticeList(props) {
      const t = props.t ?? fallbackT
      const items = (props.notice && props.notice.announcements) || []
      const dismissed = props.dismissed || []
      const valid = items.filter(item => !!item)
      const unread = valid.filter(item => dismissed.includes(noticeId(item)) === false)
      const newest = unread[0]
      const historyCount = valid.length - (newest === undefined ? 0 : 1)
      const historyOpen = props.historyOpen === true
      const history = historyOpen ? valid.filter(item => item !== newest) : []
      if (newest === undefined && historyCount === 0) return h('div', { style: { ...muted, fontSize: '13px' } }, t('noticeEmpty'))
      return h('div', { className: 'dsh-tako-notices', 'data-testid': 'dsh-tako-notice' },
        newest === undefined ? null : h(NoticeItem, { key: noticeId(newest), item: newest, t, onDismiss: props.onDismiss }),
        historyCount > 0
          ? h('div', { className: 'dsh-tako-notice-history' },
              h('button', {
                type: 'button',
                'data-testid': 'dsh-tako-notice-history-toggle',
                'aria-expanded': String(historyOpen),
                onClick: () => props.onToggleHistory && props.onToggleHistory(),
              }, historyOpen ? t('noticeHistoryHide') : t('noticeHistory', { count: historyCount })))
          : null,
        history.map(item => h(NoticeItem, { key: noticeId(item), item, t, read: true, onDismiss: props.onDismiss })))
    }

    // ---------------------------------------------------------------- update footer & services

    function UpdateFooter(props) {
      const t = props.t ?? fallbackT
      const [update, setUpdate] = useState(undefined)
      const [updateError, setUpdateError] = useState(undefined)
      const [copied, setCopied] = useState(false)
      const [installing, setInstalling] = useState(false)
      const [installError, setInstallError] = useState(undefined)
      const alive = useRef(true)
      const commandText = useRef(undefined)
      useEffect(() => () => { alive.current = false }, [])

      const check = async () => {
        try {
          const next = await call('GET', UPDATE_ROUTE)
          if (!alive.current) return
          setUpdate(next)
          setUpdateError(undefined)
        } catch (error) {
          if (alive.current) setUpdateError(String(error && error.message || error))
        }
      }
      useEffect(() => { void check() }, [])

      const copyCommand = async () => {
        if (await copyTextSafe(UPGRADE_COMMAND)) { setCopied(true); return }
        const node = commandText.current
        const selection = node ? window.getSelection() : null
        if (!selection) return
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

      const installedVersion = update === undefined ? '' : (update.installed || update.latest || update.current || '')
      const showInstalled = update !== undefined && (update.pendingRestart === true || (update.ok === true && update.skipped === false))
      const showUpToDate = update !== undefined && (update.upToDate === true || (update.ok === true && update.skipped === true && update.pendingRestart !== true))

      if (update === undefined) {
        return h('div', { className: 'tk-verline', 'data-dsh-tako-card': 'update' },
          h('span', { role: 'status' }, updateError === undefined ? '…' : t('updateFailed')))
      }
      if (update.checkError !== undefined) {
        return h('div', { className: 'tk-verline', 'data-dsh-tako-card': 'update' },
          h('span', { role: 'status', title: String(update.checkError) }, `${t('pluginVersion', { version: update.current || '' })} · ${t('updateFailed')}`),
          h('button', { type: 'button', className: 'tk-link', onClick: () => { void check() } }, t('checkUpdate')))
      }
      if (showInstalled) {
        return h('div', { className: 'tk-verline', 'data-dsh-tako-card': 'update' },
          h('span', { role: 'status', style: { color: 'var(--tk-save)' } }, t('updateInstalled', { version: installedVersion })))
      }
      if (showUpToDate) {
        return h('div', { className: 'tk-verline', 'data-dsh-tako-card': 'update' },
          h('span', { role: 'status' }, `${t('pluginVersion', { version: update.current })} · ${t('verUpToDate')}`),
          h('span', null, '·'),
          h('button', { type: 'button', className: 'tk-link', onClick: () => { void check() } }, t('checkUpdate')))
      }
      // Update available: expand actionable card
      return h('section', { className: 'tk-box', 'data-dsh-tako-card': 'update', style: { marginTop: '14px' } },
        h('div', { className: 'tk-box-h' },
          h('b', null, t('updateAvailable')),
          h('span', { className: 'tk-pill' }, update.latest),
          h('span', { className: 'r' },
            h('button', {
              type: 'button',
              className: 'tk-btn tk-btn-sm tk-btn-pri',
              'data-testid': 'dsh-tako-console-update-now',
              disabled: installing,
              onClick: install,
            }, installing ? t('updating') : t('updateNow')))),
        installError !== undefined ? h('div', { role: 'alert', style: { fontSize: '12px', color: 'var(--tk-err)', marginBottom: '8px' } }, `${t('updateInstallFailed')}: ${installError}`) : null,
        h('div', { style: { fontSize: '12px', color: 'var(--tk-ink-500)', marginBottom: '6px' } }, t('updateCommand')),
        h('div', { style: rowStyle },
          h('code', {
            ref: commandText,
            'data-testid': 'dsh-tako-upgrade-command',
            style: { ...mono, fontSize: '12px', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--tk-line)', background: 'var(--tk-panel)', overflowX: 'auto' },
          }, UPGRADE_COMMAND),
          h('button', { type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-console-copy-upgrade', onClick: copyCommand }, copied ? t('copied') : t('copy'))))
    }

    function ServicesLinks(props) {
      const t = props.t ?? fallbackT
      const origin = props.origin
      const items = [
        ['serviceConsole', '/dashboard'],
        ['servicePricing', '/pricing'],
        ['serviceWallet', '/wallet'],
        ['serviceSubscriptions', '/subscriptions'],
        ['serviceDocs', '/docs'],
      ]
      return h('div', { className: 'tk-links', 'data-dsh-tako-card': 'services' },
        items.map(([key, path]) => h('a', {
          key, href: origin + path, target: '_blank', rel: 'noopener noreferrer', className: 'tk-btn tk-btn-sm',
        }, t(key), ' ↗')))
    }

    // ---------------------------------------------------------------- View 2: Console subtabs

    const LOG_TYPE_KEYS = { 1: 'logTypeTopup', 3: 'logTypeManage', 4: 'logTypeSystem', 5: 'logTypeError', 6: 'logTypeRefund', 7: 'logTypeLogin' }
    const logTypeLabel = (type, t) => {
      const key = LOG_TYPE_KEYS[type]
      return key === undefined ? String(type ?? '—') : t(key)
    }

    function buildDailyBars(logs, t) {
      if (!Array.isArray(logs) || logs.length === 0) return []
      const now = new Date()
      const buckets = []
      for (let offset = 6; offset >= 0; offset--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const label = offset === 0 ? t('todayLabel') : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        buckets.push({ key, label, usd: 0, today: offset === 0 })
      }
      const byKey = new Map(buckets.map(b => [b.key, b]))
      let any = false
      for (const row of logs) {
        if (typeof row.quota !== 'number' || !Number.isFinite(row.quota) || row.quota <= 0) continue
        const ms = typeof row.createdAt === 'number' ? (row.createdAt > 1e12 ? row.createdAt : row.createdAt * 1000) : NaN
        if (!Number.isFinite(ms)) continue
        const d = new Date(ms)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const b = byKey.get(key)
        if (b) { b.usd += row.quota / 500000; any = true }
      }
      return any ? buckets : []
    }

    function PlanMeter(props) {
      const t = props.t
      const cur = props.cur
      const share = remainingShare(props.used, props.limit)
      const pct = share !== undefined ? Math.round(share * 100) : 0
      const tone = quotaTone(share)
      const toneColor = tone === 'error' ? 'var(--tk-err)' : tone === 'warn' ? 'var(--tk-warn)' : undefined
      const availUsd = typeof props.limit === 'number' && typeof props.used === 'number' ? Math.max(0, props.limit - props.used) : undefined
      return h('div', { className: 'tk-meter' },
        h('div', { className: 'top' },
          h('span', { className: 'l' }, props.label),
          h('b', { 'data-testid': props.testId, style: toneColor ? { color: toneColor } : undefined }, remainingPercentText(props.used, props.limit)),
          h('span', { style: { color: 'var(--tk-ink-500)', fontSize: '12px' } }, t('quotaRemaining')),
          h('span', { className: 'r' }, t('quotaUsedOf', { used: amtFromUsd(props.used, cur), limit: amtFromUsd(props.limit, cur) }))),
        QuotaBar(props.used, props.limit),
        h('div', { className: 'foot' },
          h('span', null, props.resetHint || ''),
          h('span', { className: 'tk-num' }, availUsd !== undefined ? t('quotaAvailAmount', { amount: amtFromUsd(availUsd, cur) }) : '')))
    }

    function OverviewTab(props) {
      const t = props.t ?? fallbackT
      const status = props.status
      const usage = props.usage
      const logs = props.logs
      const cur = props.prefs.currency
      const origin = props.origin ?? DEFAULT_TAKO_ORIGIN
      const configured = status !== undefined && status.configured === true
      const plan = configured ? status.plan : undefined
      const onPlan = hasPlanQuota(plan)
      const planName = configured && status.me && status.me.planName ? status.me.planName : undefined

      const walletUsd = configured && typeof status.me?.quotaRemainUsd === 'number' ? status.me.quotaRemainUsd : undefined
      const walletCny = usdToCny(walletUsd)
      const walletLow = walletCny !== null && walletCny < LOW_WALLET_CNY

      const dailyUsd = usage && typeof usage.dailyCostUsd === 'number' ? usage.dailyCostUsd : undefined
      const tokenUsedUsd = usage && usage.token && typeof usage.token.usedUsd === 'number'
        ? usage.token.usedUsd : (configured && typeof status.me?.quotaUsedUsd === 'number' ? status.me.quotaUsedUsd : undefined)
      const usageModels = usage && Array.isArray(usage.models) ? usage.models : []
      const reqCountFromModels = usageModels.reduce((sum, m) => sum + (typeof m.requests === 'number' ? m.requests : 0), 0)
      const reqCount = reqCountFromModels > 0 ? reqCountFromModels : (Array.isArray(logs) ? logs.length : undefined)
      const errLogs = Array.isArray(logs) ? logs.filter(l => l.type === 5).length : 0
      const successRate = Array.isArray(logs) && logs.length > 0 ? `${(((logs.length - errLogs) / logs.length) * 100).toFixed(1)}%` : undefined

      const bars = buildDailyBars(logs, t)
      const barsTotalUsd = bars.reduce((s, b) => s + b.usd, 0)
      const barsMaxUsd = bars.reduce((m, b) => Math.max(m, b.usd), 0)

      // Top models: top 4 + collapse rest into "Other N models"
      const sortedModels = usageModels.slice().sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0))
      const top4 = sortedModels.slice(0, 4)
      const restModels = sortedModels.slice(4)
      const topDisplay = restModels.length > 0
        ? [...top4, {
            model: t('topModelsOther', { count: restModels.length }),
            requests: restModels.reduce((s, m) => s + (m.requests || 0), 0),
            costUsd: restModels.reduce((s, m) => s + (m.costUsd || 0), 0),
          }]
        : top4
      const topMaxUsd = topDisplay.reduce((m, r) => Math.max(m, r.costUsd || 0), 0)

      const w5Share = onPlan ? remainingShare(plan.windowCost, plan.windowCostLimit) : undefined
      const w5AlmostOut = onPlan && w5Share !== undefined && w5Share < 0.1

      return h('div', { 'data-testid': 'dsh-tako-tabpanel-overview', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        cur === 'usd' ? h('div', null, h('span', { className: 'tk-warnchip', 'data-testid': 'dsh-tako-usd-warning' }, t('usdWarnChip'))) : null,
        // 4 KPI row (4 cols -> 2x2 <=860px)
        h('div', { className: 'tk-kpis dsh-tako-stamps' },
          h('div', { className: `tk-kpi main${walletLow ? ' low' : ''}` },
            h('label', null, t('walletBalanceTitle'), walletLow ? h('span', { style: { color: 'var(--tk-warn)' } }, t('walletLow')) : null),
            h('div', { className: 'n', 'data-testid': 'dsh-tako-quota-remain', style: walletLow ? { color: 'var(--tk-warn)' } : undefined }, amtFromUsd(walletUsd, cur)),
            h('div', { className: 's tk-num' }, walletCny !== null
              ? (cur === 'cny' ? t('internalEquiv', { amount: amt(walletCny, 'usd') }) : t('cnyEquiv', { amount: amt(walletCny, 'cny') }))
              : '—')),
          h('div', { className: 'tk-kpi' },
            h('label', null, t('usageToday')),
            h('div', { className: 'n', 'data-testid': 'dsh-tako-overview-daily' }, dailyUsd !== undefined ? amtFromUsd(dailyUsd, cur) : '—'),
            h('div', { className: 's' }, cur === 'usd' ? t('curUsdShort') : t('curCnyShort'))),
          h('div', { className: 'tk-kpi' },
            h('label', null, t('kpiTotalUsed')),
            h('div', { className: 'n' }, tokenUsedUsd !== undefined ? amtFromUsd(tokenUsedUsd, cur) : '—'),
            h('div', { className: 's' }, usage && usage.token && usage.token.unlimitedQuota ? t('usageUnlimited') : (usage && usage.token && typeof usage.token.grantedUsd === 'number' ? `${t('usageGranted')} ${amtFromUsd(usage.token.grantedUsd, cur)}` : '—'))),
          h('div', { className: 'tk-kpi' },
            h('label', null, t('kpiRecentReq')),
            h('div', { className: 'n' }, reqCount !== undefined ? reqCount.toLocaleString() : '—'),
            h('div', { className: 's' }, successRate !== undefined ? t('kpiSuccessRate', { rate: successRate }) : '—'))),
        // Row 1: Plan quota / PayGo + Recent Spend chart
        h('div', { className: 'tk-row2' },
          onPlan
            ? h('section', { className: 'tk-box', 'data-dsh-tako-card': 'quota' },
                h('div', { className: 'tk-box-h' },
                  h('b', null, t('planQuotaTitle')),
                  planName ? h('span', { className: 'tk-pill' }, planName) : null,
                  h('span', { className: 'r' },
                    h('a', { className: 'tk-btn tk-btn-sm', href: origin + '/subscriptions', target: '_blank', rel: 'noopener noreferrer' }, t('managePlan'), ' ↗'))),
                (plan.windowCostLimit || 0) > 0 ? h(PlanMeter, {
                  label: t('windowHoursLong', { hours: windowHoursText(plan) }),
                  used: plan.windowCost, limit: plan.windowCostLimit,
                  resetHint: formatResetHint(plan.windowResetAt),
                  cur, t, testId: 'dsh-tako-quota-window',
                }) : null,
                (plan.weeklyCostLimit || 0) > 0 ? h(PlanMeter, {
                  label: t('thisWeek'),
                  used: plan.weeklyCost, limit: plan.weeklyCostLimit,
                  resetHint: formatResetHint(plan.weeklyResetAt),
                  cur, t, testId: 'dsh-tako-quota-week',
                }) : null,
                w5AlmostOut ? h('div', { className: 'tk-alert warn', role: 'status' },
                  h('span', null, `⚠ ${t('planWindowWarn', { hours: windowHoursText(plan) })}`),
                  h('a', { className: 'tk-btn tk-btn-sm', href: origin + '/wallet', target: '_blank', rel: 'noopener noreferrer' }, t('topUp'))) : null,
                status && status.planError ? h('div', { style: { ...muted, fontSize: '12px', marginTop: '8px' } }, status.planError) : null)
            : h('section', { className: 'tk-box', 'data-dsh-tako-card': 'quota' },
                h('div', { className: 'tk-box-h' },
                  h('b', null, t('paygoTitle')),
                  h('span', { className: 'tk-pill grey' }, t('noPlanBadge'))),
                h('p', { style: { margin: '0 0 12px', fontSize: '13px', color: 'var(--tk-ink-500)' } }, t('paygoDesc')),
                h('div', { style: rowStyle },
                  h('a', { className: 'tk-btn tk-btn-pri tk-btn-sm', href: origin + '/wallet', target: '_blank', rel: 'noopener noreferrer' }, t('topUp')),
                  h('a', { className: 'tk-btn tk-btn-sm', href: origin + '/subscriptions', target: '_blank', rel: 'noopener noreferrer' }, t('learnPlans')))),
          h('section', { className: 'tk-box', 'data-dsh-tako-card': 'spend' },
            h('div', { className: 'tk-box-h' },
              h('b', null, t('spendChartTitle')),
              h('small', null, cur === 'usd' ? t('curUsdShort') : t('curCnyShort')),
              bars.length > 0 ? h('span', { className: 'r tk-num', style: { fontSize: '12px', color: 'var(--tk-ink-500)' } }, t('spendChartSum', { amount: amtFromUsd(barsTotalUsd, cur) })) : null),
            bars.length > 0
              ? [
                  h('div', { key: 'ch', className: 'tk-chart' }, bars.map(b => {
                    const pct = barsMaxUsd > 0 ? Math.max(4, Math.round((b.usd / barsMaxUsd) * 100)) : 4
                    const showLabel = b.today || (b.usd === barsMaxUsd && b.usd > 0)
                    return h('div', { key: b.key, className: `c${b.today ? ' today' : ''}`, title: `${b.label} · ${amtFromUsd(b.usd, cur)}` },
                      h('span', null, showLabel ? amtFromUsd(b.usd, cur).replace(/\.00$/, '') : ''),
                      h('i', { style: { height: `${pct}%` } }))
                  })),
                  h('div', { key: 'cx', className: 'tk-chart-x' }, bars.map(b => h('span', { key: b.key }, b.label))),
                ]
              : h('div', { style: { padding: '20px 0', color: 'var(--tk-ink-500)', fontSize: '13px' } },
                  h('div', { style: { marginBottom: '12px' } }, t('spendChartEmpty')),
                  h(ServicesLinks, { origin, t })))),
        // Row 2: Top models + Announcements
        h('div', { className: 'tk-row2' },
          h('section', { className: 'tk-box', 'data-dsh-tako-card': 'topmodels' },
            h('div', { className: 'tk-box-h' },
              h('b', null, t('topModelsTitle')),
              h('small', null, t('topModelsToday')),
              props.onOpenUsage ? h('span', { className: 'r' }, h('button', { type: 'button', className: 'tk-link', onClick: props.onOpenUsage }, t('allUsage'))) : null),
            topDisplay.length > 0
              ? h('table', { className: 'tk-table' },
                  h('thead', null, h('tr', null, h('th', null, t('colModel')), h('th', { className: 'r' }, t('logsColRequest')), h('th', { className: 'r' }, t('logsColCost')))),
                  h('tbody', null, topDisplay.map(row => h('tr', { key: row.model },
                    h('td', null, h('span', { className: 'tk-num', style: { fontSize: '12.5px' } }, row.model)),
                    h('td', { className: 'r tk-num' }, row.requests ?? 0),
                    h('td', { className: 'r' },
                      h('span', { className: 'tk-share' }, h('i', { style: { width: `${topMaxUsd > 0 ? Math.round(((row.costUsd || 0) / topMaxUsd) * 100) : 0}%` } })),
                      h('span', { className: 'tk-num', style: { fontWeight: 600 } }, amtFromUsd(row.costUsd, cur)))))))
              : h('div', { style: { ...muted, fontSize: '13px', padding: '12px 0' } }, t('topModelsEmpty'))),
          h('section', { className: 'tk-box', 'data-dsh-tako-card': 'notices' },
            h('div', { className: 'tk-box-h' },
              h('b', null, t('noticeTitle')),
              h('small', null, t('noticeSameOrigin'))),
            props.notice && props.notice.ok === true && Array.isArray(props.notice.announcements)
              ? h(NoticeList, {
                  notice: props.notice, dismissed: props.dismissed || [],
                  onDismiss: props.onDismiss, historyOpen: props.noticeHistoryOpen,
                  onToggleHistory: props.onToggleNoticeHistory, t,
                })
              : h('div', { style: { ...muted, fontSize: '13px' } }, t('noticeEmpty')))),
        // Always expose Tako service quick links cleanly
        bars.length > 0 ? h('section', { className: 'tk-box' },
          h('div', { className: 'tk-box-h', style: { marginBottom: '8px' } }, h('b', null, t('servicesCard'))),
          h(ServicesLinks, { origin, t })) : null)
    }

    function UsageTab(props) {
      const t = props.t ?? fallbackT
      const cur = props.prefs.currency
      const [usage, setUsage] = useState(props.initialUsage)
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
        children.push(h('div', { key: 'err', role: 'alert', className: 'tk-box', style: { color: 'var(--tk-err)', fontSize: '13px' } }, `${t('loadFailed')}: ${error}`))
      } else if (usage === undefined) {
        children.push(h('div', { key: 'load', className: 'tk-box', style: muted }, '…'))
      } else {
        const token = usage.token || {}
        const tokenBody = []
        if (usage.tokenError) {
          tokenBody.push(h('div', { key: 'te', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-usage-tokenerror' }, usage.tokenError))
        } else {
          if (token.unlimitedQuota !== true && typeof token.grantedUsd === 'number' && token.grantedUsd > 0) {
            const share = remainingShare(token.usedUsd, token.grantedUsd)
            tokenBody.push(h('div', { key: 'bar', className: 'dsh-tako-bar', style: { marginBottom: '12px' } },
              h('i', { 'data-tone': quotaTone(share), style: { width: `${Math.round((share ?? 0) * 100)}%` } })))
          }
          tokenBody.push(h('div', { key: 'grid', className: 'dsh-tako-stamps dsh-tako-stamps-3' },
            h('div', null,
              h('div', { style: { fontSize: '12px', color: 'var(--tk-ink-500)' } }, t('usageGranted')),
              h('div', { className: 'tk-num', style: { fontSize: '18px', fontWeight: 700 } }, token.unlimitedQuota === true ? t('usageUnlimited') : amtFromUsd(token.grantedUsd, cur))),
            h('div', null,
              h('div', { style: { fontSize: '12px', color: 'var(--tk-ink-500)' } }, t('usageUsed')),
              h('div', { className: 'tk-num', style: { fontSize: '18px', fontWeight: 700 } }, amtFromUsd(token.usedUsd, cur))),
            h('div', null,
              h('div', { style: { fontSize: '12px', color: 'var(--tk-ink-500)' } }, token.unlimitedQuota === true ? t('usageExpires') : t('usageAvailable')),
              h('div', { className: 'tk-num', style: { fontSize: '18px', fontWeight: 700 } },
                token.unlimitedQuota === true
                  ? (!token.expiresAt || token.expiresAt <= 0 ? t('usageNever') : fmtFullTime(token.expiresAt * 1000))
                  : amtFromUsd(token.availableUsd, cur)))))
        }
        children.push(h('section', { key: 'token', className: 'tk-box', 'data-dsh-tako-card': 'token' },
          h('div', { className: 'tk-box-h' },
            h('b', null, t('usageTokenCard')),
            props.maskedKey ? h('small', { className: 'tk-num' }, props.maskedKey) : null,
            h('span', { className: 'r', style: { fontSize: '12px', color: 'var(--tk-ink-500)' } },
              `${t('usageToday')} `,
              h('b', { className: 'tk-num', 'data-testid': 'dsh-tako-usage-daily', style: { color: 'var(--tk-ink-900)' } },
                usage.statsError ? '—' : amtFromUsd(usage.dailyCostUsd, cur)))),
          usage.statsError ? h('div', { style: { ...muted, fontSize: '12px', marginBottom: '8px' }, 'data-testid': 'dsh-tako-usage-statserror' }, usage.statsError) : null,
          ...tokenBody))

        const models = Array.isArray(usage.models) ? usage.models : []
        children.push(h('section', { key: 'models', className: 'tk-box', 'data-dsh-tako-card': 'permodel' },
          h('div', { className: 'tk-box-h' }, h('b', null, t('usagePerModel'))),
          usage.modelStatsError
            ? h('div', { style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-usage-modelerror' }, usage.modelStatsError)
            : models.length === 0
              ? h('div', { style: { ...muted, fontSize: '13px' } }, t('topModelsEmpty'))
              : h('div', { className: 'tk-tablewrap', style: { border: 0, boxShadow: 'none' } },
                  h('table', { className: 'tk-table' },
                    h('thead', null, h('tr', null,
                      h('th', null, t('colModel')),
                      h('th', { className: 'r' }, t('logsColRequest')),
                      h('th', { className: 'r' }, t('logsColIn')),
                      h('th', { className: 'r' }, t('logsColOut')),
                      h('th', { className: 'r' }, t('logsColCost')))),
                    h('tbody', null, models.map(row => h('tr', { key: row.model, 'data-model': row.model },
                      h('td', { className: 'tk-num' }, row.model),
                      h('td', { className: 'r tk-num' }, row.requests ?? 0),
                      h('td', { className: 'r tk-num' }, compactTokens(row.inputTokens)),
                      h('td', { className: 'r tk-num' }, compactTokens(row.outputTokens)),
                      h('td', { className: 'r tk-num', style: { fontWeight: 600 } }, amtFromUsd(row.costUsd, cur)))))))))
      }
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-usage', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, children)
    }

    function RequestsTab(props) {
      const t = props.t ?? fallbackT
      const cur = props.prefs.currency
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
      const models = props.catalog && Array.isArray(props.catalog.models) ? props.catalog.models : []
      return h('section', { className: 'tk-box', 'data-dsh-tako-card': 'logs', 'data-testid': 'dsh-tako-tabpanel-requests' },
        h('div', { className: 'tk-box-h' },
          h('b', null, t('tabRequests')),
          h('span', { className: 'r' },
            h('select', {
              className: 'tk-select',
              value: model,
              'data-testid': 'dsh-tako-logs-model',
              onChange: event => { setModel(event.target.value); void load(event.target.value) },
            },
              h('option', { value: '' }, t('logsModel')),
              models.map(m => h('option', { key: m.id, value: m.id }, m.id))),
            h('button', { type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-logs-refresh', disabled: refreshing, onClick: () => { void load() } }, refreshing ? t('logsLoading') : t('logsRefresh')))),
        error !== undefined
          ? h('div', { role: 'alert', style: { ...muted, fontSize: '13px' }, 'data-testid': 'dsh-tako-logs-error' }, error === 'not-configured' ? t('logsNeedLogin') : `${t('loadFailed')}: ${error}`)
          : logs === undefined
            ? h('div', { style: muted }, t('logsLoading'))
            : logs.length === 0
              ? h('div', { style: muted, 'data-testid': 'dsh-tako-logs-empty' }, t('logsEmpty'))
              : h('div', { className: 'tk-tablewrap', style: { border: 0, boxShadow: 'none' } },
                  h('table', { className: 'tk-table', 'data-testid': 'dsh-tako-logs-table' },
                    h('thead', null, h('tr', null,
                      h('th', null, t('logsColTime')), h('th', null, t('logsColModel')),
                      h('th', { className: 'r' }, t('logsColIn')), h('th', { className: 'r' }, t('logsColOut')),
                      h('th', { className: 'r' }, t('logsColCost')), h('th', { className: 'r' }, t('logsColDuration')),
                      h('th', null, t('colStatus')), h('th', null, t('logsColRequest')))),
                    h('tbody', null, logs.map(row => {
                      const costUsd = typeof row.quota === 'number' && Number.isFinite(row.quota) && row.quota > 0 ? row.quota / 500000 : undefined
                      return h('tr', { key: row.id ?? row.requestId },
                        h('td', { className: 'tk-num', style: muted }, fmtDateTime(typeof row.createdAt === 'number' ? row.createdAt * 1000 : row.createdAt)),
                        h('td', { className: 'tk-num', title: row.modelName }, row.modelName || '—'),
                        h('td', { className: 'r tk-num' }, compactTokens(row.promptTokens)),
                        h('td', { className: 'r tk-num' }, compactTokens(row.completionTokens)),
                        h('td', { className: 'r tk-num', style: { fontWeight: 600 } }, costUsd !== undefined ? amtFromUsd(costUsd, cur, 3) : '—'),
                        h('td', { className: 'r tk-num' }, typeof row.useTime === 'number' ? `${row.useTime}s` : '—'),
                        h('td', null, row.type === 5
                          ? h('span', { className: 'tk-b tk-b-err' }, logTypeLabel(row.type, t))
                          : row.type !== undefined && row.type !== 2
                            ? h('span', { className: 'tk-b tk-b-call' }, logTypeLabel(row.type, t))
                            : h('span', { className: 'tk-b tk-b-save' }, t('statusSuccess'))),
                        h('td', { className: 'tk-num', style: muted, title: row.requestId }, typeof row.requestId === 'string' ? row.requestId.slice(0, 8) : '—'))
                    })))))
    }

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

      return h('div', { 'data-dsh-tako-card': 'key', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { style: rowStyle },
          h('input', {
            type: reveal ? 'text' : 'password',
            value,
            placeholder: t('keyPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            'data-testid': 'dsh-tako-key-input',
            onChange: event => setValue(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') void save() },
            className: 'tk-input',
            style: { flex: '1 1 200px', fontFamily: 'var(--tk-mono)', fontSize: '12px' },
          }),
          h('button', { type: 'button', className: 'tk-btn tk-btn-sm', onClick: () => setReveal(!reveal), 'data-testid': 'dsh-tako-key-toggle' }, reveal ? t('keyHide') : t('keyShow')),
          h('button', {
            type: 'button',
            className: 'tk-btn tk-btn-sm tk-btn-pri',
            disabled: busy || value.trim() === '',
            onClick: save,
            'data-testid': 'dsh-tako-key-save',
          }, busy ? t('keySaving') : t('keySave'))),
        configured || props.onCopyDiag ? h('div', { style: { ...rowStyle, marginTop: '4px' } },
          props.onCopyDiag ? h('button', { type: 'button', className: 'tk-btn tk-btn-sm', onClick: props.onCopyDiag }, props.diagCopied ? t('diagCopied') : t('diagCopy')) : null,
          configured ? h('button', {
            type: 'button', className: 'tk-btn tk-btn-sm tk-btn-danger', disabled: busy,
            onClick: clear, 'data-testid': 'dsh-tako-key-clear',
          }, busy ? t('keyClearing') : t('keyClear')) : null) : null,
        note !== undefined ? h('div', {
          role: note.tone === 'error' ? 'alert' : 'status',
          'data-testid': 'dsh-tako-key-note',
          style: { fontSize: '12px', color: note.tone === 'error' ? 'var(--tk-err)' : note.tone === 'ok' ? 'var(--tk-save)' : 'var(--tk-ink-500)' },
        }, note.text) : null)
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
          } catch {}
        })()
      }, [])
      const status = props.status
      const token = usage === undefined ? undefined : usage.token
      const limits = token && token.modelLimitsEnabled === true ? Object.keys(token.modelLimits || {}) : []
      return h('div', { 'data-testid': 'dsh-tako-tabpanel-key', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('section', { className: 'tk-box' },
          h('div', { className: 'tk-box-h' },
            h('b', null, t('keyCard')),
            h('span', { className: `tk-pill${props.configured ? '' : ' grey'}` }, props.configured ? t('keyConfigured') : t('keyMissing'))),
          props.configured ? h('div', { className: 'tk-field' },
            h('label', null, t('keyCard')),
            h('div', { className: 'v' },
              h('span', { className: 'tk-num' }, status && status.maskedKey ? status.maskedKey : '—'),
              h('span', { style: { fontSize: '12px', color: 'var(--tk-ink-400)' } }, t('keyPlaintextHost')))) : null,
          h('div', { className: 'tk-field' },
            h('label', null, t('keySource')),
            h('div', { className: 'v' }, `dsh · ${(status && status.credential) || 'TAKO_API_KEY'}`)),
          h('div', { className: 'tk-field' },
            h('label', null, t('endpointLabel')),
            h('div', { className: 'v tk-num', 'data-testid': 'dsh-tako-console-endpoint' }, `${takoOrigin(status)}/v1`)),
          token && token.name ? h('div', { className: 'tk-field' }, h('label', null, t('keyName')), h('div', { className: 'v' }, token.name)) : null,
          token ? h('div', { className: 'tk-field' }, h('label', null, t('keyExpires')),
            h('div', { className: 'v' }, !token.expiresAt || token.expiresAt <= 0 ? t('usageNever') : fmtFullTime(token.expiresAt * 1000))) : null,
          props.configured ? h('div', { className: 'tk-field' },
            h('label', null, t('keyModels')),
            h('div', { className: 'v' }, limits.length === 0 ? t('usageNoLimits') : limits.map(id => h('span', { key: id, className: 'tk-cap tk-num' }, id)))) : null,
          h('div', { style: { marginTop: '12px' } },
            h(KeyEditor, { status, t, onChanged: props.onKeyChanged, onCopyDiag: props.onCopyDiag, diagCopied: props.diagCopied }))))
    }

    function ConfigTab(props) {
      const t = props.t ?? fallbackT
      const catalog = props.catalog
      const [config, setConfig] = useState(undefined)
      const [error, setError] = useState(undefined)
      const [form, setForm] = useState(undefined)
      const [saving, setSaving] = useState(false)
      const [note, setNote] = useState(undefined)
      const [syncBusy, setSyncBusy] = useState(false)
      const [syncNote, setSyncNote] = useState(undefined)
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

      const triggerSync = async () => {
        setSyncBusy(true)
        setSyncNote(undefined)
        try {
          const result = await call('POST', SYNC_ROUTE, {})
          if (!alive.current) return
          if (!result || result.ok !== true) setSyncNote(t('syncFailed'))
          else props.onRefreshCatalog?.()
        } catch (err) {
          if (alive.current) setSyncNote(`${t('syncFailed')}: ${String(err && err.message || err)}`)
        } finally {
          if (alive.current) setSyncBusy(false)
        }
      }

      const field = (key, label, input) => h('div', { key, className: 'tk-field', 'data-field': key }, h('label', null, label), h('div', { className: 'v' }, input))
      const text = (key, label, dataTest) => field(key, label, h('input', {
        className: 'tk-input',
        style: { flex: '1 1 200px', fontFamily: 'var(--tk-mono)', fontSize: '12px' },
        value: form === undefined ? '' : form[key],
        disabled: config === undefined || config.writable === false,
        'data-testid': dataTest,
        onChange: event => setForm({ ...form, [key]: event.target.value }),
      }))

      const syncErrLabel = catalog && catalog.lastError ? ({
        'directory-unavailable': 'catalogDirectoryError',
        'settings-not-ready': 'catalogSettingsError',
        'write-failed': 'catalogWriteError',
        'runtime-transaction': 'catalogTransactionError',
        'read-only': 'catalogReadOnlyError',
        'empty-catalog': 'catalogEmptyError',
      }[catalog.lastError.code] || 'catalogFailed') : undefined

      const children = []
      if (error !== undefined) {
        children.push(h('div', { key: 'err', role: 'alert', className: 'tk-box', style: { color: 'var(--tk-err)', fontSize: '13px' } }, `${t('loadFailed')}: ${error}`))
      } else if (form === undefined) {
        children.push(h('div', { key: 'load', className: 'tk-box', style: muted }, '…'))
      } else {
        const readOnly = config === undefined || config.writable === false
        if (readOnly) children.push(h('div', { key: 'ro', className: 'tk-box', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-config-readonly' }, t('configReadOnly')))
        children.push(h('section', { key: 'form', className: 'tk-box', 'data-dsh-tako-card': 'config' },
          h('div', { className: 'tk-box-h' }, h('b', null, t('tabConfig'))),
          text('refreshMinutes', t('configRefresh'), 'dsh-tako-config-refresh'),
          text('retryDelays', t('configRetryDelays'), 'dsh-tako-config-retry'),
          text('defaultContextWindow', t('configDefaultCtx'), 'dsh-tako-config-ctx'),
          text('include', t('configInclude'), 'dsh-tako-config-include'),
          text('exclude', t('configExclude'), 'dsh-tako-config-exclude'),
          text('pinned', t('configPinnedField'), 'dsh-tako-config-pinned'),
          field('claude', ' ', h('label', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center', fontSize: '13px', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox', checked: form.includeClaudeCodeOnly, disabled: readOnly, 'data-testid': 'dsh-tako-config-claude',
              onChange: event => setForm({ ...form, includeClaudeCodeOnly: event.target.checked }),
            }), t('configClaudeOnly'))),
          field('search', t('configSearchProvider'), [
            h('select', {
              key: 'sel', className: 'tk-select', value: form.searchProvider, disabled: readOnly, 'data-testid': 'dsh-tako-config-search',
              onChange: event => setForm({ ...form, searchProvider: event.target.value }),
            },
              h('option', { value: 'tako' }, t('configSearchTako')),
              h('option', { value: 'deepseek-official' }, t('configSearchDefault'))),
            h('span', { key: 'hint', style: { fontSize: '12px', color: 'var(--tk-ink-400)' } }, t('configSearchHint')),
          ]),
          config && config.config && config.config.overrides !== undefined && Object.keys(config.config.overrides).length > 0
            ? field('overrides', t('configOverrides'), h('pre', { className: 'tk-code' }, JSON.stringify(config.config.overrides, null, 2)))
            : null,
          !readOnly ? h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center' } },
            h('button', { type: 'button', className: 'tk-btn tk-btn-sm tk-btn-pri', disabled: saving, 'data-testid': 'dsh-tako-config-save', onClick: () => { void save() } }, saving ? t('configSaving') : t('configSave')),
            note !== undefined ? h('span', { role: 'status', style: { fontSize: '12px', color: 'var(--tk-ink-500)' }, 'data-testid': 'dsh-tako-config-note' }, note) : null) : null))
      }

      // Catalog sync controls (moved out of model directory toolbar into Settings per spec §2)
      children.push(h('section', { key: 'sync', className: 'tk-box', 'data-dsh-tako-card': 'catalog-sync' },
        h('div', { className: 'tk-box-h' },
          h('b', null, t('configCatalogSection')),
          catalog ? h('small', null, t('modelsCount', { count: (catalog.models || []).length }), ' · ',
            h(Countdown, { nextSyncAt: catalog.nextSyncAt, lastSyncAt: catalog.lastSyncAt, refreshIntervalMs: catalog.refreshIntervalMs, t })) : null,
          h('span', { className: 'r' },
            props.onRefreshCatalog ? h('button', { type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-catalog-refresh', onClick: props.onRefreshCatalog }, t('catalogReadAgain')) : null,
            h('button', { type: 'button', className: 'tk-btn tk-btn-sm', disabled: syncBusy, 'data-testid': 'dsh-tako-catalog-sync', onClick: () => { void triggerSync() } }, syncBusy ? t('syncWorking') : t('syncNow')))),
        syncErrLabel ? h('div', { role: 'status', style: { fontSize: '12px', color: 'var(--tk-warn)' } },
          `${t(syncErrLabel)} · ${t('catalogAttempts', { count: catalog.attempts ?? 0 })}`) : null,
        syncNote ? h('div', { role: 'status', style: { ...muted, fontSize: '12px' }, 'data-testid': 'dsh-tako-catalog-syncnote' }, syncNote) : null))

      return h('div', { 'data-testid': 'dsh-tako-tabpanel-config', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, children)
    }

    // ---------------------------------------------------------------- View 2: Tako Console Page

    const CONSOLE_TABS = [
      ['overview', 'tabOverview'],
      ['usage', 'tabUsage'],
      ['requests', 'tabRequests'],
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
      const [dismissedNotice, setDismissedNotice] = useState(() => loadDismissedNotices())
      const [diagCopied, setDiagCopied] = useState(false)
      const [noticeHistoryOpen, setNoticeHistoryOpen] = useState(false)
      const login = useTakoLogin()
      const [usage, setUsage] = useState(undefined)
      const [recentLogs, setRecentLogs] = useState(undefined)
      const [pinned, setPinned] = useState([])
      const [activeModel, setActiveModel] = useState(undefined)
      const protocolOk = catalog !== undefined && catalog.consoleApiVersion === CONSOLE_API_VERSION
      const [prefs, updatePrefs] = useTakoPrefs(protocolOk)

      const alive = useRef(true)
      const catalogRequest = useRef(undefined)
      const catalogController = useRef(undefined)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; catalogController.current?.abort() }
      }, [])

      const { load: loadStatus, invalidate: invalidateStatus } = useStatusReader(next => {
        setStatus(next)
        setStatusError(undefined)
      }, error => { setStatusError(String(error && error.message || error)) })

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

      useStatusRefresh(loadStatus)

      // Gate 0.6+ routes behind protocolOk so older Hosts never receive 404 probes
      useEffect(() => {
        if (!protocolOk) return
        void (async () => {
          try {
            const result = await call('GET', NOTICE_ROUTE)
            if (alive.current) setNotice(result)
          } catch {
            if (alive.current) setNotice({ ok: false })
          }
        })()
        void (async () => {
          try {
            const cfg = await call('GET', CONFIG_ROUTE)
            if (alive.current && cfg && cfg.ok === true && cfg.config && Array.isArray(cfg.config.pinned)) setPinned(cfg.config.pinned)
          } catch {}
        })()
        void (async () => {
          try {
            const m = await call('GET', ACTIVE_MODEL_ROUTE)
            if (alive.current && m && m.ok === true && m.provider === PROVIDER && typeof m.model === 'string') setActiveModel(m.model)
          } catch {}
        })()
      }, [protocolOk])

      useEffect(() => {
        if (!protocolOk || !status || status.configured !== true) {
          setUsage(undefined)
          setRecentLogs(undefined)
          return
        }
        void (async () => {
          try {
            const u = await call('GET', USAGE_ROUTE)
            if (alive.current && u && u.ok === true) setUsage(u)
          } catch {}
        })()
        void (async () => {
          try {
            const l = await call('GET', LOGS_ROUTE)
            if (alive.current && l && l.ok === true && Array.isArray(l.logs)) setRecentLogs(l.logs)
          } catch {}
        })()
      }, [protocolOk, status && status.configured, status && status.maskedKey])

      useEffect(() => {
        let disposed = false
        let timer
        let pendingReads = 0
        const poll = async () => {
          const next = await loadCatalog()
          if (disposed) return
          const unsettled = !next || next.status === 'syncing' || next.status === 'retrying' || next.lastSyncAt === null
          if (unsettled) {
            if (++pendingReads < 30) timer = setTimeout(poll, 2000)
            else if (typeof next?.nextSyncAt === 'number') {
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

      useEffect(() => { if (login.state.status === 'success') setLogoutNote(undefined) }, [login.state.status])

      const logout = async () => {
        invalidateStatus()
        setBusyLogout(true)
        setLogoutNote(undefined)
        try {
          const result = await call('POST', LOGOUT_ROUTE, {})
          if (!alive.current) return
          if (result.ok !== true) throw new Error(result.error || result.message || t('failed'))
          if (result.action === 'revoked') setLogoutNote(t('logoutRevoked'))
          else if (result.action === 'removed') setLogoutNote(result.warning === undefined ? t('logoutRemoved') : `${t('logoutRemoved')}: ${result.warning}`)
          else if (result.action === 'external') setLogoutNote(t('logoutExternal'))
          else setLogoutNote(t('logoutNone'))
          if (result.action !== 'external') login.clearSuccess()
          notifyCredential()
        } catch (error) {
          if (alive.current) setLogoutNote(`${t('failed')}: ${String(error && error.message || error)}`)
        } finally {
          if (alive.current) setBusyLogout(false)
        }
      }

      ensureTakoTheme()
      const origin = takoOrigin(status)
      const configured = status !== undefined && status.configured === true
      const me = status === undefined || status.me === null || status.me === undefined ? undefined : status.me
      const planName = me && me.planName ? me.planName : undefined
      const userName = me && me.userName ? me.userName : (configured ? t('signedIn') : t('consoleTitle'))

      const diagnostics = () => [
        'dsh-tako console diagnostics',
        `endpoint: ${status && status.origin ? status.origin : '?'}`,
        `configured: ${status === undefined ? '?' : status.configured}`,
        `key: ${status && status.maskedKey ? status.maskedKey : '(none)'}`,
        `credential: ${status && status.credential ? status.credential : '(unknown)'}`,
        `account: ${me && me.userName ? me.userName : '(none)'}${planName ? ` (${planName})` : ''}`,
        `catalog: ${catalog === undefined ? 'unloaded' : `${catalog.status || '?'} · ${(catalog.models || []).length} models · last ${fmtFullTime(catalog.lastSyncAt)}`}`,
        `catalog error: ${catalogError || (catalog && catalog.lastError ? catalog.lastError.message : '(none)')}`,
        `status error: ${statusError || '(none)'}`,
        `notice: ${notice === undefined ? 'unloaded' : notice.ok === true ? `${(notice.announcements || []).length}` : 'failed'}`,
      ].join('\n')

      const copyDiagnostics = async () => {
        await copyTextSafe(diagnostics())
        setDiagCopied(true)
        setTimeout(() => { if (alive.current) setDiagCopied(false) }, 2000)
      }

      const onKeyChanged = () => { login.clearSuccess(); notifyCredential() }
      const dismissNotice = item => {
        const next = [...(Array.isArray(dismissedNotice) ? dismissedNotice : []), noticeId(item)]
        saveDismissedNotices(next)
        setDismissedNotice(next)
      }

      const onTogglePin = async id => {
        const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [...pinned, id]
        setPinned(next)
        try {
          const result = await call('POST', CONFIG_ROUTE, { set: { pinned: next } })
          if (!result || result.ok !== true) { if (alive.current) setPinned(pinned); return false }
          return true
        } catch {
          if (alive.current) setPinned(pinned)
          return false
        }
      }

      const onSelectChat = async id => {
        try {
          const result = await call('POST', ACTIVE_MODEL_ROUTE, { model: id })
          if (result && result.ok === true) { if (alive.current) setActiveModel(id); return 'saved' }
          if (result && result.code === 'not-configured') return 'not-configured'
        } catch {}
        return 'fallback'
      }

      const jumpToModels = () => {
        if (!openTakoModels(t)) setTab('models')
      }

      const currencySeg = h('div', { className: 'tk-seg' },
        h('button', { type: 'button', className: prefs.currency === 'cny' ? 'on' : '', 'data-testid': 'dsh-tako-console-cur-cny', onClick: () => updatePrefs({ currency: 'cny' }) }, `¥ ${t('curCnyShort')}`),
        h('button', { type: 'button', className: prefs.currency === 'usd' ? 'on' : '', 'data-testid': 'dsh-tako-console-cur-usd', onClick: () => updatePrefs({ currency: 'usd' }) }, `$ ${t('curUsdShort')}`))

      const protocolPending = catalog === undefined
      const legacyHost = catalog !== undefined && catalog.consoleApiVersion !== CONSOLE_API_VERSION

      // Embedded models sub-view (fallback when host lacks separate `tako-models` sidebar button or direct tab='models')
      if (tab === 'models' && protocolOk) {
        return h('div', { className: 'dsh-tako-root tk-mwrap', 'data-testid': 'dsh-tako-console-page' },
          h(ModelCatalogView, {
            embedded: true, t, status, catalog, error: catalogError, origin,
            prefs, updatePrefs, pinned, activeModel, onTogglePin, onSelectChat,
            onBackToConsole: () => setTab('overview'),
          }))
      }

      // Legacy / protocol-pending safe shell (never calls 0.6+ routes)
      if (protocolPending || legacyHost) {
        const legacyChildren = [
          h('div', { key: 'hero', className: 'tk-hero', 'data-dsh-tako-card': 'account' },
            h('div', { className: 'tk-hero-row' },
              TakoMark(40),
              h('div', { style: { minWidth: 0 } },
                h('h1', null, userName),
                h('div', { className: 'meta' },
                  configured ? [h('span', { key: 'd', className: 'tk-stat-dot' }), t('connected')] : t('signedOut'),
                  planName ? h('span', { className: 'tk-pill' }, planName) : null,
                  status && status.maskedKey ? h('span', { className: 'tk-num', 'data-testid': 'dsh-tako-console-key' }, status.maskedKey) : null)),
              h('div', { className: 'tk-hero-r' },
                !configured
                  ? h('button', { type: 'button', className: 'tk-btn tk-btn-sm tk-btn-pri', 'data-testid': 'dsh-tako-console-sign-in', disabled: login.busy, onClick: login.start }, t('signIn'))
                  : [
                      h('button', { key: 'again', type: 'button', className: 'tk-btn tk-btn-sm', disabled: login.busy, onClick: login.start }, t('signInAgain')),
                      h('button', { key: 'out', type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-console-sign-out', disabled: busyLogout, onClick: logout }, busyLogout ? t('signOutWorking') : t('signOut')),
                    ])),
            LoginProgress({ state: login.state, t }),
            logoutNote !== undefined ? h('div', { role: 'status', style: { fontSize: '12px' } }, logoutNote) : null),
        ]
        if (legacyHost) {
          legacyChildren.push(h('div', {
            key: 'restart-required', role: 'alert', className: 'tk-alert warn',
            'data-testid': 'dsh-tako-console-restart-required',
          }, t('consoleRestartRequired')))
        } else if (catalogError !== undefined) {
          legacyChildren.push(h('div', { key: 'cat-err', role: 'alert', className: 'tk-alert err' },
            `${t('loadFailed')}: ${catalogError}`,
            h('button', { type: 'button', className: 'tk-btn tk-btn-sm', onClick: () => { void loadCatalog() } }, t('retry'))))
        }
        legacyChildren.push(h('section', { key: 'services', className: 'tk-box', style: { marginTop: '12px' } },
          h('div', { className: 'tk-box-h' }, h('b', null, t('servicesCard'))),
          h(ServicesLinks, { origin, t })))
        legacyChildren.push(h(UpdateFooter, { key: 'update', t }))
        return h('div', { className: 'dsh-tako-root tk-mwrap', 'data-testid': 'dsh-tako-console-page' },
          h('div', { className: 'tk-scroll' }, h('div', { className: 'tk-page' }, legacyChildren)))
      }

      // Signed-out centered sign-in card (spec §3)
      if (status !== undefined && !configured) {
        return h('div', { className: 'dsh-tako-root tk-mwrap', 'data-testid': 'dsh-tako-console-page' },
          h('div', { className: 'tk-scroll' },
            h('div', { className: 'tk-page' },
              h('div', { className: 'tk-phead' },
                TakoMark(28),
                h('div', null, h('h1', null, t('consoleTitle')), h('div', { className: 'sub' }, t('signedOut'))),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' } },
                  currencySeg,
                  h('button', { type: 'button', className: 'tk-btn tk-btn-sm', onClick: jumpToModels }, t('gotoModels')))),
              h('div', { className: 'tk-box tk-signin', 'data-dsh-tako-card': 'account' },
                TakoMark(52),
                h('h3', null, t('signinTitle')),
                h('p', null, t('signinDesc')),
                h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
                  h('button', {
                    type: 'button',
                    className: 'tk-btn tk-btn-pri',
                    'data-testid': 'dsh-tako-console-sign-in',
                    disabled: login.busy,
                    onClick: login.start,
                  }, t('signIn')),
                  login.busy ? h('button', { type: 'button', className: 'tk-btn', onClick: login.cancel }, t('cancel')) : null),
                h('div', { style: { width: '100%', maxWidth: '440px', marginTop: '18px' } },
                  h(PasteKeyRow, {
                    t, hideLabel: true,
                    inputTestId: 'dsh-tako-key-input',
                    saveTestId: 'dsh-tako-key-save',
                    wrapTestId: 'dsh-tako-console-paste-key',
                    onSaved: onKeyChanged,
                  })),
                h('p', { style: { margin: '14px 0 0', fontSize: '12px' } }, t('signinRemoteHint')),
                h('div', { style: { marginTop: '10px', width: '100%', maxWidth: '460px', textAlign: 'left' } },
                  LoginProgress({ state: login.state, t }),
                  logoutNote !== undefined ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '6px' } }, logoutNote) : null)),
              h(UpdateFooter, { t }))))
      }

      // Signed-in console view (Hero + Subtabs + Content + Version footer)
      const hero = h('div', { className: 'tk-hero', 'data-dsh-tako-card': 'account' },
        h('div', { className: 'tk-hero-row' },
          TakoMark(40),
          h('div', { style: { minWidth: 0 } },
            h('h1', null, userName),
            h('div', { className: 'meta' },
              configured ? [h('span', { key: 'd', className: 'tk-stat-dot' }), t('connected')] : t('accountCard'),
              configured ? (planName ? h('span', { className: 'tk-pill' }, planName) : h('span', { className: 'tk-pill grey' }, t('paygoBadge'))) : null,
              status && status.maskedKey ? h('span', { className: 'tk-num', 'data-testid': 'dsh-tako-console-key' }, status.maskedKey) : null)),
          h('div', { className: 'tk-hero-r' },
            currencySeg,
            configured
              ? [
                  h('button', { key: 'again', type: 'button', className: 'tk-btn tk-btn-sm', disabled: login.busy, onClick: login.start }, t('signInAgain')),
                  h('button', { key: 'diag', type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-copy-diagnostics', onClick: () => { void copyDiagnostics() } }, diagCopied ? t('diagCopied') : t('diagCopy')),
                  h('button', { key: 'out', type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-console-sign-out', disabled: busyLogout, onClick: logout }, busyLogout ? t('signOutWorking') : t('signOut')),
                ]
              : [
                  h('button', { key: 'diag', type: 'button', className: 'tk-btn tk-btn-sm', 'data-testid': 'dsh-tako-copy-diagnostics', onClick: () => { void copyDiagnostics() } }, diagCopied ? t('diagCopied') : t('diagCopy')),
                  h('button', { key: 'in', type: 'button', className: 'tk-btn tk-btn-sm tk-btn-pri', 'data-testid': 'dsh-tako-console-sign-in', disabled: login.busy, onClick: login.start }, t('signIn')),
                ])),
        status && status.meError ? h('div', { role: 'status', style: { fontSize: '12px', color: 'var(--tk-warn)' } }, `${t('whoamiFailed')}: ${status.meError}`) : null,
        LoginProgress({ state: login.state, t }),
        logoutNote !== undefined ? h('div', { role: 'status', style: { fontSize: '12px' } }, logoutNote) : null)

      const subtabs = h('div', { className: 'tk-subtabs', role: 'tablist' },
        CONSOLE_TABS.map(([id, key]) => h('button', {
          key: id,
          type: 'button',
          role: 'tab',
          className: tab === id ? 'on' : '',
          'data-active': String(tab === id),
          'data-testid': `dsh-tako-tab-${id}`,
          onClick: () => setTab(id),
        }, t(key))),
        h('button', {
          type: 'button',
          style: { marginLeft: 'auto', color: 'var(--tk-brand)', fontWeight: 500 },
          'data-testid': 'dsh-tako-goto-models',
          onClick: jumpToModels,
        }, t('gotoModels')))

      let bodyNode = null
      if (tab === 'overview') {
        bodyNode = h(OverviewTab, {
          t, status, usage, logs: recentLogs, prefs, origin, notice,
          dismissed: dismissedNotice, onDismiss: dismissNotice,
          noticeHistoryOpen, onToggleNoticeHistory: () => setNoticeHistoryOpen(!noticeHistoryOpen),
          onOpenUsage: () => setTab('usage'),
        })
      } else if (tab === 'usage') {
        bodyNode = h(UsageTab, { t, prefs, initialUsage: usage, maskedKey: status && status.maskedKey })
      } else if (tab === 'requests') {
        bodyNode = h(RequestsTab, { t, prefs, catalog })
      } else if (tab === 'key') {
        bodyNode = h(KeyTab, { t, status, configured, onKeyChanged, onCopyDiag: () => { void copyDiagnostics() }, diagCopied })
      } else if (tab === 'config') {
        bodyNode = h(ConfigTab, { t, catalog, onRefreshCatalog: () => { void loadCatalog() } })
      }

      return h('div', { className: 'dsh-tako-root tk-mwrap', 'data-testid': 'dsh-tako-console-page' },
        h('div', { className: 'tk-scroll' },
          h('div', { className: 'tk-page' },
            hero,
            statusError !== undefined ? h('div', { role: 'alert', className: 'tk-alert err' },
              `${t('loadFailed')}: ${statusError}`,
              h('button', { type: 'button', className: 'tk-btn tk-btn-sm', onClick: () => { void loadStatus(); void loadCatalog() } }, t('retry'))) : null,
            subtabs,
            bodyNode,
            h(UpdateFooter, { t }))))
    }

    // ---------------------------------------------------------------- Cordis browser plugin registration

    return {
      inject: ['slots'],
      apply(ctx) {
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
          key: MODELS_PANEL_ID,
          locale: NS,
        }, TakoModelsPage))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, TakoConsolePage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: MODELS_PANEL_ID,
          order: 19,
          label: () => boundT('modelsPanel'),
          locale: NS,
        }, TakoModelsIcon))
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
