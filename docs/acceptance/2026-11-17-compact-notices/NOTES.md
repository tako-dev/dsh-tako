# 公告区紧凑化验收记录（Issue #17）

工单: ticket/054ab521 · 仓库: tako-dev/dsh-tako · 验收日期: 2026-11-17 (CST)
预览方式: `python3 -m http.server 8413` + `preview/console.html`（修复后）/ `preview/console-before.html`（HEAD 修复前快照），真实 Chrome（Chromium 149）经 agent-browser 截图。

## 变更点 1：默认只展示最新 1 条未读公告

- 改了哪：`client/client.js` `NoticeList` 重写——未读公告只渲染最新一条为单行紧凑摘要，`dismissed` 状态从 `localStorage` (`dsh-tako.notices.dismissed`) 懒加载。
- 怎么验：signed-in 场景注入 11 条公告，Overview 首屏只剩 1 条 + "历史公告 (10)" 按钮。
- 截图：`before-1440.png`（11 条平铺，卡片挤出首屏）→ `after-1440.png`（1 条 + 折叠入口，账户/额度卡片回到首屏）；移动端 `before-390.png` → `after-390.png`。
- 验的时刻：2026-11-17 16:05 CST，1440×900 与 390×844 视口。

## 变更点 2：历史公告折叠开关

- 改了哪：新增 `历史公告 (N)` / `History (N)` 胶囊按钮（`data-testid="dsh-tako-notice-history-toggle"`，`aria-expanded`），展开后历史项加 `dsh-tako-notice-read` 降透明度；展开态文案 `收起历史` / `Hide history`。
- 怎么验：点击开关展开/收起，真实浏览器 DOM 断言 `aria-expanded` 翻转。
- 截图：`after-1440-history-open.png`、`after-390-history-open.png`。
- 验的时刻：2026-11-17 16:07 CST。

## 变更点 3："知道了" 持久化不再占位

- 改了哪：dismiss 写入 `localStorage` JSON 数组（上限 200 条，private mode try/catch 降级）；下次挂载经 `useState` 惰性初始化读回，已读 id 永不占用纵向空间。
- 怎么验：真实浏览器点 "知道了" 后 `localStorage.getItem('dsh-tako.notices.dismissed')` → `["11"]`，重载页面该公告进入历史折叠区；单测 `client-locale.test.ts` 覆盖跨挂载持久化与多条折叠。
- 截图：`after-1440-dismissed.png`（dismiss 最新一条后历史展开态）。
- 验的时刻：2026-11-17 16:08 CST。

## 自动化验证

- `npm test`（vitest）：245/245 通过，含新增 2 个用例（多条折叠/pin 最新未读、localStorage 跨挂载持久化）。
- `npm run typecheck`：通过。

## 没验

- 未在真实宿主（dsh 插件宿主注入 `client.js` 的运行时）内回归；预览页用 fixture 桩 `/api/tako.*`，宿主侧行为依赖 `consoleApiVersion >= 2` 门控。
- dark 模式与 EN 文案仅做了字典完整性单测（`EXPECTED_KEYS` 校验），未逐项截图。
