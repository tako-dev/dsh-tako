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

> 本包尚未发布到 npm。发布前可以从源码打包后按文件安装：
>
> ```sh
> git clone https://github.com/tako-dev/dsh-tako && cd dsh-tako
> pnpm install && pnpm build && npm pack
> dsh plugin --profile web add ./dsh-tako-0.1.0.tgz
> ```
>
> 不要用 `dsh plugin add github:tako-dev/dsh-tako`：git 安装拿到的是源码，没有构建好的 `lib/`。

安装时 pnpm 可能提示 `missing peer @deepseek-ai/schemastery`，这是预期的：运行时这个 peer 由 dsh 安装本身提供。

然后配置 Tako API key，两种方式任选：

- 在 Web 界面打开「设置 → 模型」，编辑 **Tako**，填入 API 密钥并保存（保存在 `$DSH_HOME/.credentials.yaml`，引用名 `TAKO_API_KEY`）；
- 或者在启动前设置环境变量 `TAKO_API_KEY`。

启动：

```sh
dsh web
```

在输入框的模型选择器里会出现 **Tako** 分组。没有配置 key 时选择器里看不到 Tako 的模型（「设置 → 模型」里仍会列出 Tako，显示密钥缺失）。

`dsh plugin --profile <名字> add dsh-tako` 对任何 profile 都能装；但只装了 `dsh-base` 的自建 profile 没有界面，要用浏览器界面请装进 `web`。`headless` 等其他内置 profile 用同样的命令安装（未逐一验证）。

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

2. 删除插件写入的 provider：打开 profile 的 `cordis.patch.yml`，删掉 `llm-pi-ai` 行下的 `providers.tako`（如果 `providers` 下没有其他内容，可以把整个 `id: llm-pi-ai` 条目删掉）。插件移除后，也可以在「设置 → 模型」里删除 Tako。
3. 如果在界面里保存过 key，可以在「设置 → 模型」里清空，或从 `$DSH_HOME/.credentials.yaml` 删掉 `TAKO_API_KEY`。

只做第 1 步的话，Tako 会作为一个普通的自定义 provider 留在 profile 里，但模型列表不再更新。

### 限制

- 能力信息只来自 Tako 的公开目录：只识别上下文窗口和图片输入。最大输出 token、推理等级等目录没有给出的能力用 dsh 的默认值，需要时用 `overrides` 修正。
- 所有模型都走 OpenAI 兼容的 `openai-completions` 协议。
- 默认排除 Tako 限定 Claude Code 客户端的模型，因为 Tako 会拒绝来自 dsh 的调用。
- 依赖 dsh 官方 `@deepseek-ai/dsh-llm-pi-ai` 的设置结构，在 dsh `0.2.1-rc.2` 上验证过；dsh 改动该结构时可能需要更新本插件。
- 尚未发布到 npm，见「安装」。

## English

`dsh-tako` adds [Tako](https://tako.shiroha.tech) models to the official DeepSeek Harness CLI (`@deepseek-ai/dsh`) with correct context windows and image input.

It reads Tako's public model directory (`GET /api/pricing`, no key needed), keeps chat models only (drops image/speech/search models, `jev-*`, and Claude-Code-only models), sizes each model from structured fields or exact size tags (`272K`, `1M`, `1.05M`), and writes the result as an OpenAI-compatible provider at `providers.tako` in the official `llm-pi-ai` plugin's settings. Requests, streaming, retries and credentials all stay on dsh's own code path. It writes only when the value changes, and refreshes every 30 minutes by default.

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile web add dsh-tako   # not on npm yet: build with `npm pack` and add the .tgz
dsh web
```

Set the key in **Settings → Models → Tako** (stored as `TAKO_API_KEY` in `$DSH_HOME/.credentials.yaml`) or export `TAKO_API_KEY` before starting. Without a key the model picker shows no Tako models.

The plugin owns `providers.tako`: edits made to it in the Models page or by hand are overwritten on the next refresh. Customize through the plugin config instead (`baseURL`, `apiKeyEnv`, `defaultContextWindow`, `refreshIntervalMs`, `pinned`, `include`, `exclude`, `includeClaudeCodeOnly`, `overrides`; see the table above).

To uninstall, run `dsh plugin --profile web remove dsh-tako` and then delete `providers.tako` under the `llm-pi-ai` entry in the profile's `cordis.patch.yml`.

Tested against `@deepseek-ai/dsh` `0.2.1-rc.2`.

## License

MIT
