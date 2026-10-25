# dsh-tako

[中文](#中文) | [English](#english)

## 中文

让官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) CLI（`@deepseek-ai/dsh`）直接使用 [Tako](https://tako.shiroha.tech) 的模型，并带上正确的上下文窗口和图片输入能力。装一个插件即可，不需要手写 provider 配置。

### 它做了什么

- 启动时读取 Tako 公开的模型目录 `GET https://tako.shiroha.tech/api/pricing`（不需要 API key），之后按间隔刷新（默认 30 分钟）。
- 只保留可以走 OpenAI 兼容接口聊天的模型：去掉生图、语音、搜索等非聊天模型、`jev-*`，以及 Tako 限定只能在 Claude Code 里用的模型。
- 上下文窗口取自目录的结构化字段；没有时取 `272K`、`1M`、`1.05M` 这类精确的容量标签（`31B` 这种参数量标签会被忽略）；都没有就用 `defaultContextWindow`。带 `Vision` 标签的模型声明支持图片输入。
- 把结果写成一个 OpenAI 兼容 provider：官方 `llm-pi-ai` 插件配置里的 `providers.tako`。之后请求、流式输出、重试、凭据都走 dsh 官方代码路径，插件本身不实现任何模型适配器。

### 安装

需要 Node.js 22+。

```sh
npm i -g @deepseek-ai/dsh

# 装进 web profile（浏览器界面）
dsh plugin --profile web add dsh-tako
```

`dsh plugin` 会调用 pnpm，需要 pnpm 在 `PATH` 上。

上面的 `dsh plugin --profile web add dsh-tako` 从 npm 安装；要锁定版本写成 `dsh-tako@0.1.0`。每个版本的 GitHub Release 也附带打包好的 `.tgz`，可以直接按 URL 安装（端到端测试验证过 http URL 安装方式）：

```sh
dsh plugin --profile web add https://github.com/tako-dev/dsh-tako/releases/download/v0.1.0/dsh-tako-0.1.0.tgz
```

从源码安装：

```sh
git clone https://github.com/tako-dev/dsh-tako && cd dsh-tako
npm ci && npm run build && npm pack
dsh plugin --profile web add ./dsh-tako-0.1.0.tgz
```

不要用 `dsh plugin add github:tako-dev/dsh-tako`：git 安装拿到的是源码，没有构建好的 `lib/`。

安装时 pnpm 可能提示 `missing peer @deepseek-ai/schemastery`，这是预期的：运行时这个 peer 由 dsh 安装本身提供。

然后配置 Tako API key，三种方式任选：

- **一键登录（推荐）**：Web 界面「设置 → 模型」的 Tako 卡片上点「通过浏览器登录 Tako」，或在终端运行 `npx dsh-tako login`，详见下面的[一键登录](#一键登录)；
- 在「设置 → 模型」编辑 **Tako**，手动粘贴 API 密钥并保存（保存在 `$DSH_HOME/.credentials.yaml`，引用名 `TAKO_API_KEY`）；
- 或者在启动前设置环境变量 `TAKO_API_KEY`。

启动：

```sh
dsh web
```

在输入框的模型选择器里会出现 **Tako** 分组。没有配置 key 时选择器里看不到 Tako 的模型（「设置 → 模型」里仍会列出 Tako，显示密钥缺失）。

`dsh plugin --profile <名字> add dsh-tako` 对任何 profile 都能装；但只装了 `dsh-base` 的自建 profile 没有界面，要用浏览器界面请装进 `web`。`headless` 等其他内置 profile 用同样的命令安装（未逐一验证）。

### 一键登录

在浏览器里登录 Tako 并确认授权，插件拿到一个新的 `cr_` key，通过 dsh 官方的凭据服务（`ctx.credentials.set`，和「设置 → 模型」保存密钥是同一条路径）写进 `$DSH_HOME/.credentials.yaml`，凭据名就是插件配置的 `apiKeyEnv`（默认 `TAKO_API_KEY`）。正在运行的 dsh 下一次请求就会用上，不用重启。key 不会出现在终端或页面上，只显示 `cr_****` 加末 4 位。

**Web 界面**：「设置 → 模型」→ Tako 卡片 →「通过浏览器登录 Tako」。会打开 Tako 授权页，确认后自动跳回，卡片显示「已登录，API key 已保存」，Tako 的状态点变绿。已有 key 时按钮变成「重新登录 Tako」。

**命令行**（不需要先启动 dsh，也适合 `acp` / `headless` 等没有界面的 profile）：

```sh
npx dsh-tako login                    # 打开浏览器登录，key 存进 dsh 凭据
npx dsh-tako login --profile acp      # 读取 acp profile 里 dsh-tako 的 baseURL / apiKeyEnv（默认 web）
npx dsh-tako login --no-open          # 不自动开浏览器，只打印授权链接
npx dsh-tako whoami                   # 查看当前 key 对应的 Tako 账号和套餐
npx dsh-tako logout                   # 在 Tako 吊销这个 key，并从 dsh 凭据里删除
```

`login` 的其他参数：`--port <端口>` 固定回调端口（1024–65535，默认随机）、`--device-name <名字>` 授权页和 Tako 令牌列表里显示的设备名（默认 `dsh-tako@<平台>`，如 `dsh-tako@darwin`）、`--base-url`、`--api-key-env`、`--dsh <路径>`（dsh 安装位置，默认找 `PATH` 上的 `dsh`，再找 npm 全局目录；也可用环境变量 `DSH_TAKO_DSH`）。CLI 用的是你本机 dsh 安装里的官方凭据模块（`@deepseek-ai/dsh-credentials-local`），所以必须能找到 dsh；`DSH_HOME` 照常生效。

流程细节：CLI 或 dsh 进程在 `127.0.0.1` 上开一个一次性回调端口（只监听本机回环地址），用 PKCE（S256）和随机 `state` 发起授权，等待 5 分钟（与 Tako 授权码有效期一致），收到 `state` 不匹配的回调会忽略并继续等待。拒绝授权、超时、换 key 失败时不写任何凭据。

注意：
- Tako 以「`tako-connect@<设备名>`」命名签发的令牌，**同名的旧令牌会被替换（吊销）**。两台同平台机器都用默认设备名登录时，后登录的会让前一台的 key 失效，请给其中一台加 `--device-name`（例如 `--device-name dsh-tako@work-mac`）。Web 界面的按钮固定使用默认设备名。
- 登录写入的是凭据文件，优先级高于同名环境变量；要改回用环境变量，运行 `dsh-tako logout` 或在「设置 → 模型」里清空。
- `dsh-tako logout` 只处理凭据文件里的 key；key 来自环境变量或 `.env` 时它不会去吊销。

#### dsh 在远程服务器上

Tako 授权后会把浏览器跳回 `http://127.0.0.1:<端口>/tako/callback`，也就是**运行浏览器的那台机器**的回环地址。dsh 在远程机器上、浏览器在本地时这一步到不了。可选做法：

1. 直接粘贴 key：在 Tako 控制台创建 key，填进「设置 → 模型」或设置 `TAKO_API_KEY`。
2. SSH 端口转发：在远程机器上固定端口登录，本地把同一端口转发过去：

   ```sh
   # 本地另开一个终端
   ssh -L 53682:127.0.0.1:53682 user@remote
   # 远程机器上
   npx dsh-tako login --no-open --port 53682
   ```

   把打印出的链接粘贴到本地浏览器打开，授权后回调经 SSH 隧道回到远程的 CLI。CLI 检测到 SSH 会话（`SSH_CONNECTION` / `SSH_TTY`）时也会打印这段提示。
3. Web 界面按钮同理：回调端口开在 dsh 主机上，只有从 dsh 主机本机打开的页面才能直接完成；通过远程地址访问 Web 界面时卡片上会提示改用以上两种方式（按钮用随机端口，需要转发时请用 CLI 的 `--port`）。

插件启动时如果 `apiKeyEnv` 在 dsh 凭据里查不到值，会记一条警告日志，提示运行 `npx dsh-tako login`（dsh 0.2.1-rc.2 的 `web` 不把插件日志打到终端，所以界面上以「设置 → 模型」的密钥缺失状态和登录按钮为准）。

### 配置项

插件配置写在 profile 的 `cordis.patch.yml` 里 `id: tako` 这一行的 `config` 下（例如 `~/.dsh/profiles/web/cordis.patch.yml`）：

```yaml
- id: tako
  name: dsh-tako
  config:
    pinned: [deepseek-v4.1-flash, gpt-5.6]
    exclude: ['grok-*']
    overrides:
      gemma-4-31b-it:
        contextWindow: 262144
```

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `baseURL` | `https://tako.shiroha.tech` | Tako 地址；聊天请求走 `<baseURL>/v1`，写成带 `/v1` 的也可以 |
| `apiKeyEnv` | `TAKO_API_KEY` | 存放 Tako API key 的凭据名（环境变量或「设置 → 模型」里保存的密钥） |
| `defaultContextWindow` | `128000` | 目录没有标注上下文的模型用这个值 |
| `refreshIntervalMs` | `1800000` | 目录刷新间隔（毫秒）；`0` 表示只在启动时刷新 |
| `pinned` | `[deepseek-v4.1-flash, deepseek-v4-pro, tako-auto]` | 在选择器里排在最前的模型，按列出顺序；其余按字母排序 |
| `include` | `[]` | 非空时只保留匹配的模型 id，支持 `*` 通配 |
| `exclude` | `[]` | 去掉匹配的模型 id，支持 `*` 通配，在 `include` 之后生效 |
| `includeClaudeCodeOnly` | `false` | 保留 Tako 限定 Claude Code 客户端的模型（在 dsh 中调用会被 Tako 拒绝） |
| `overrides` | `{}` | 按模型 id 修正 `name`、`contextWindow`、`maxTokens`、`input`（`text` / `image`） |

### 工作原理

插件只做一件事：维护 `llm-pi-ai` 设置里的 `providers.tako`，也就是「设置 → 模型」页面添加自定义 provider 时写的同一个位置。写入落在 profile 的 `cordis.patch.yml` 里，形如：

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      tako:
        displayName: Tako
        api: openai-completions
        baseURL: https://tako.shiroha.tech/v1
        apiKeyEnv: TAKO_API_KEY
        defaultContextWindow: 128000
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
            contextWindow: 1000000
            input: [text, image]
          # ...
```

- 只有内容真的变了才写；目录不变时重启或刷新都不会改动文件。
- 目录拉取失败时保留上次写入的模型列表；只有 `providers.tako` 从未存在过时才写入两个兜底模型，保证 Tako 能出现在列表里。
- profile 只读时只打警告，不写。

**`providers.tako` 归插件所有。** 在「设置 → 模型」里改 Tako 的自定义设置、删除 Tako，或者手改 `cordis.patch.yml` 里的这一段，都会在下次刷新或重启时被覆盖回来。要定制请改上面的插件配置。API key 不受影响，它存在凭据里，不在这一段。

### 卸载

1. 移除插件：

   ```sh
   dsh plugin --profile web remove dsh-tako
   ```

2. 删除插件写入的 provider：打开 profile 的 `cordis.patch.yml`，删掉 `llm-pi-ai` 行下的 `providers.tako`（如果 `providers` 下没有其他内容，可以把整个 `id: llm-pi-ai` 条目删掉）。如果写过插件配置，`id: tako` 那一条也一并删掉（不删也不影响启动，只是不再起作用）。插件移除后，也可以在「设置 → 模型」里删除 Tako。
3. 如果用一键登录保存过 key，先运行 `npx dsh-tako logout`（在 Tako 吊销并删除本地凭据）；手动保存的 key 可以在「设置 → 模型」里清空，或从 `$DSH_HOME/.credentials.yaml` 删掉 `TAKO_API_KEY`。

只做第 1 步的话，Tako 会作为一个普通的自定义 provider 留在 profile 里，但模型列表不再更新。

### 限制

- 能力信息只来自 Tako 的公开目录：只识别上下文窗口和图片输入。最大输出 token、推理等级等目录没有给出的能力用 dsh 的默认值，需要时用 `overrides` 修正。
- 所有模型都走 OpenAI 兼容的 `openai-completions` 协议。
- 默认排除 Tako 限定 Claude Code 客户端的模型，因为 Tako 会拒绝来自 dsh 的调用。
- 依赖 dsh 官方 `@deepseek-ai/dsh-llm-pi-ai` 的设置结构，在 dsh `0.2.1-rc.2` 上验证过；dsh 改动该结构时可能需要更新本插件。
- 一键登录的 Web 按钮依赖 dsh Web 客户端的模块格式和 `settings.models.provider-card` 插槽（键为 `llm-pi-ai`；该插槽每个键只渲染一个注册者，其他插件也注册同一个键时会互相替换），以及 `ctx.connection.fetch` 路由；CLI 依赖本机 dsh 安装里的 `@deepseek-ai/dsh-credentials-local`。都只在 `0.2.1-rc.2` 上验证过。

### 开发与测试

```sh
npm ci
npm run typecheck
npm test        # 单元测试（离线）
npm run e2e     # 端到端：装干净的官方 dsh，起 mock Tako，真机安装并启动 web / acp profile，跑一键登录
```

`npm run e2e`（`scripts/e2e/run.mjs`）在临时目录里装 `@deepseek-ai/dsh`（版本用 `DSH_VERSION` 指定，默认 `0.2.1-rc.2`），每个场景用全新的 `DSH_HOME` 和 `HOME`，不碰 `~/.dsh`，也不需要真实 key。它用 `npm pack` 出的 tgz 执行 `dsh plugin --profile web add`，覆盖：路由写入与模型列表、重启不重写、带假 key 时 dsh 列出 Tako 模型、经 `dsh acp` 走官方链路完成一次真实对话（断言 mock 收到 `Authorization: Bearer test-key` 和正确的 model）、目录不可达时的兜底、`exclude` / `pinned`、删除路由后重启、`dsh plugin remove`、按 http URL 安装；以及一键登录：mock 的 `/app/authorize` 模拟用户已确认（302 回 `redirect_uri` 带 code），`/api/desktop/token` 校验 PKCE verifier，`dsh-tako login --no-open` 写入凭据后 `dsh acp` 不带环境变量完成一轮对话（断言 mock 收到 `Bearer <新 key>`）、`whoami` / `logout`（吊销并删除凭据）、拒绝授权不写凭据、Web 路由 `/api/tako.login` 走同一流程并检查客户端插件包已下发。需要 pnpm 在 `PATH` 上。其他环境变量：`E2E_TGZ`（用现成的 tgz）、`E2E_DSH_DIR`（复用已装好的 dsh）、`E2E_ONLY=a,d`（只跑部分用例）、`E2E_KEEP=1`（保留 dsh 安装目录）。结束时打印临时目录和 `e2e-report.json` 路径。

CI（`.github/workflows/ci.yml`）在 push 到 `main` 和 PR 时用 Node 22 / 24 跑 `npm ci → typecheck → test → build → npm pack → e2e`。

### 发布流程（维护者）

1. 改版本：`npm version 0.1.1 --no-git-tag-version`（或手改 `package.json` 的 `version`，同步 `package-lock.json`）。
2. 提交并推到 `main`：`git commit -am "chore: release 0.1.1" && git push origin main`，等 CI 变绿。
3. 打 tag 并推送：`git tag v0.1.1 && git push origin v0.1.1`。
4. `.github/workflows/release.yml` 自动执行：校验 tag 与 `package.json` 版本一致 → 用 `npm view` 查该版本是否已在 npm → typecheck / test / build / pack / e2e → 发布 → 建 GitHub Release 并附上 tgz。
   - 未发布：`npm publish --provenance --access public`，发布的就是 e2e 测过的那个 tgz；带 `-` 的预发布版本发到 `next` dist-tag。
   - 已发布（例如重跑工作流）：比较 npm 上的 `dist.integrity` 与本次 `npm pack` 出的 tgz 的 sha512。一致就跳过 publish，继续建 Release；不一致就失败，这时要升版本重新打 tag。同一提交的 `npm pack` 是可复现的（`0.1.0` 本地重新打包与 npm 上的 integrity 一致）。
   - GitHub Release 已存在时用 `gh release upload --clobber` 覆盖附件，不会失败。

发布用 npm 的 [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（GitHub Actions OIDC），**不需要 `NPM_TOKEN`，也不要配置任何 npm token secret**。npm 包设置里的 Trusted Publisher 是：GitHub Actions，org `tako-dev`，repo `dsh-tako`，workflow `release.yml`，environment 留空；改工作流文件名或加 environment 时要同步改那里。工作流在发布前把 npm 升级到 11.5.1 以上（Node 22 自带的 npm 10 不支持 Trusted Publishing），provenance 由 OIDC 发布自动生成。GitHub Release 用工作流自带的 `GITHUB_TOKEN`。

## English

`dsh-tako` adds [Tako](https://tako.shiroha.tech) models to the official DeepSeek Harness CLI (`@deepseek-ai/dsh`) with correct context windows and image input.

It reads Tako's public model directory (`GET /api/pricing`, no key needed), keeps chat models only (drops image/speech/search models, `jev-*`, and Claude-Code-only models), sizes each model from structured fields or exact size tags (`272K`, `1M`, `1.05M`), and writes the result as an OpenAI-compatible provider at `providers.tako` in the official `llm-pi-ai` plugin's settings. Requests, streaming, retries and credentials all stay on dsh's own code path. It writes only when the value changes, and refreshes every 30 minutes by default.

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile web add dsh-tako   # or the .tgz URL attached to a GitHub Release
dsh web
```

Set the key in **Settings → Models → Tako** (stored as `TAKO_API_KEY` in `$DSH_HOME/.credentials.yaml`) or export `TAKO_API_KEY` before starting. Without a key the model picker shows no Tako models.

### One-click sign-in

Instead of pasting a key, sign in to Tako in the browser:

- **Web UI**: Settings → Models → Tako card → **通过浏览器登录 Tako / Sign in to Tako with the browser**.
- **CLI** (works for any profile, dsh need not be running):

  ```sh
  npx dsh-tako login [--profile web] [--no-open] [--port <1024-65535>] [--device-name <name>] [--base-url <url>] [--api-key-env <name>] [--dsh <path>]
  npx dsh-tako whoami     # account and plan behind the configured key
  npx dsh-tako logout     # revoke the key on Tako and delete it from dsh credentials
  ```

Both run a PKCE (S256) authorization-code flow with a one-shot listener on `127.0.0.1` (5-minute wait, `state` checked), and store the issued `cr_` key through dsh's own credential service (`ctx.credentials.set`, the same path the Models page uses) under the plugin's `apiKeyEnv`. Running dsh processes use it on the next request. The key is never printed; only `cr_****` plus the last four characters. The CLI loads `@deepseek-ai/dsh-credentials-local` from your dsh installation (found via `dsh` on `PATH`, the global npm root, `--dsh`, or `DSH_TAKO_DSH`), and reads `baseURL` / `apiKeyEnv` from the profile's `dsh-tako` config (default profile `web`).

Tako names the token `tako-connect@<device name>` and replaces an older token with the same name, so two machines on the same platform signing in with the default `dsh-tako@<platform>` revoke each other's key; pass `--device-name` on one of them.

**Remote dsh**: Tako redirects the browser to `127.0.0.1:<port>` on the machine running the browser. When dsh runs on a remote host, either paste a key (Settings → Models or `TAKO_API_KEY`), or forward a fixed port: `ssh -L 53682:127.0.0.1:53682 user@remote`, then on the remote host `npx dsh-tako login --no-open --port 53682` and open the printed URL locally. The Web button only completes when the page is opened on the dsh host itself; on a remote address the card says so.

The plugin owns `providers.tako`: edits made to it in the Models page or by hand are overwritten on the next refresh. Customize through the plugin config instead (`baseURL`, `apiKeyEnv`, `defaultContextWindow`, `refreshIntervalMs`, `pinned`, `include`, `exclude`, `includeClaudeCodeOnly`, `overrides`; see the table above).

To uninstall, run `dsh plugin --profile web remove dsh-tako` and then delete `providers.tako` under the `llm-pi-ai` entry in the profile's `cordis.patch.yml`.

Tested against `@deepseek-ai/dsh` `0.2.1-rc.2`. `dsh plugin` needs pnpm on `PATH`.

Development: `npm ci`, `npm run typecheck`, `npm test`, and `npm run e2e` (installs a clean official dsh into a temp dir with a fresh `DSH_HOME`, starts a mock Tako, installs the packed tarball, and drives real `web` and `acp` profiles, including one chat turn, `dsh-tako login` / `whoami` / `logout` against the mock's `/app/authorize` and `/api/desktop/*`, and the Web sign-in route). Releasing: bump `version`, commit and push to `main`, then push a `vX.Y.Z` tag; the Release workflow checks the tag, runs everything including e2e, publishes with npm Trusted Publishing (GitHub Actions OIDC, provenance included; no `NPM_TOKEN` secret), and creates or updates a GitHub Release with the tarball. Re-running it is safe: an already-published version is skipped when its `dist.integrity` equals the freshly packed tarball, and fails otherwise.

## License

MIT
