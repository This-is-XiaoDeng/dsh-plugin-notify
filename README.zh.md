# dsh-plugin-notify

中文 | [English](README.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的会话状态通知插件：会话**停止**、**因错误退出**或**向你提问**时，同时推送一条 **WxPusher 消息**和一条**真正的浏览器通知**（带提示音与 `requireInteraction`）。所有设置都在原生设置页里完成（设置 → 通知）。

- **两条通道、同一份内容。** 宿主侧只检测一次状态变化，同一份负载既发 WxPusher，也发给所有打开的浏览器页面。
- **真正的系统通知。** `new Notification(...)`，带 PNG 图标、可选的 WebAudio 提示音，以及 `requireInteraction`——横幅会一直留到你手动关闭。
- **原生设置页。** 一个 `settings.section` 页面，由插件自己的 Config schema 驱动；每个字段都是 `volatile`，改完**立即生效**，不重启、不重挂插件。
- **只写密文。** WxPusher 的 `appToken` 声明为 `role('secret')`：存在 profile 里，但永远不随响应返回，编辑走按路径寻址的写入。
- **除 schema 库外零运行时依赖。** 一个宿主文件、一个客户端文件，无需构建。

## 触发事件

| 事件 | 来源 | 通知里带的信息 |
|---|---|---|
| **会话停止** | `api-session/status` → `running: false` | 折叠出的会话标题 |
| **因错误退出** | `api-session/error`、`agent/error` | 错误信息 |
| **收到提问** | `user-questions/request`（只观察，随后委派） | 第一个问题 |
| **等待授权** | `approval/request`（只观察，随后委派） | 工具名 |

两个过滤器用来降噪：

- **`minRunMs`**：短于该时长的运行不报告停止。
- **`stopDebounceMs`**：智能体进入空闲后先等这么久；如果期间又开始运行就取消报告。同一会话刚发过错误通知时，停止通知会被抑制——错误那条更精确。

`user-questions/request` 与 `approval/request` 是 Cordis 的 **waterfall** 事件：本插件只观察，并且始终用 `next()` 委派，绝不会吞掉本该交给别的应答者的请求。

## 环境要求

- 带 Web 面的 DSH 宿主（`@deepseek-ai/dsh-web-app`），也就是任何常规的 `dsh web` profile。浏览器通知流依赖 `ctx.webServer`；没有它时插件仍会推 WxPusher，只是不往浏览器发。
- Node.js ≥ 20。
- 支持 Notification API 的浏览器（Chrome、Edge、Firefox、Safari 16+）。
- 只有想推手机时才需要 [WxPusher](https://wxpusher.zjiecode.com) 账号。

## 安装

### 通过插件管理器（推荐）

在「插件」页添加包：可以是 registry 包名、git 地址，或本地 checkout 的绝对路径，然后启用它带来的 bundle：

```
dsh-plugin-notify
```

或从克隆目录安装：

```
/path/to/dsh-plugin-notify
```

插件行由 bundle 自带的 `cordis.patch.yml` 声明，不需要再改别的文件。如果 profile 已经在运行，重载（或重启）一次，让新包进入模块解析表。

### 手动装进 profile

```bash
# 在 profile 目录里，例如 ~/.dsh/profiles/web
pnpm add dsh-plugin-notify
```

再把这个 bundle 加进该 profile `package.json` 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-notify"]
    }
  }
}
```

## 配置

打开 **设置 → 通知**。页面直接写入插件所在的 profile 条目。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 两条通道的总开关。 |
| `events.stopped` | `true` | 会话停止工作时提醒。 |
| `events.error` | `true` | 会话或某一步出错时提醒。 |
| `events.question` | `true` | 智能体提问时提醒。 |
| `events.approval` | `false` | 等待授权决定时提醒。 |
| `browser.enabled` | `true` | 是否发浏览器通知。 |
| `browser.sound` | `true` | 播放两声短提示音（WebAudio，无音频文件）。 |
| `browser.requireInteraction` | `true` | 通知常驻，直到手动关闭。 |
| `browser.onlyWhenHidden` | `true` | 当前标签页可见时不打扰。 |
| `wxpusher.enabled` | `false` | 启用 WxPusher 通道。 |
| `wxpusher.appToken` | `''` | WxPusher `appToken`（**只写密文**）。 |
| `wxpusher.uids` | `[]` | 接收 UID，每行一个（`UID_xxxxxxxx`）。 |
| `wxpusher.topicIds` | `[]` | 接收主题 ID，每行一个。 |
| `wxpusher.url` | `''` | 可选；推送被点击时打开的 URL。 |
| `advanced.stopDebounceMs` | `1200` | 判定「已停止」前的空闲宽限期。 |
| `advanced.minRunMs` | `2000` | 短于该时长的运行不通知。 |
| `advanced.rootSessionsOnly` | `true` | 忽略子智能体会话。 |
| `advanced.includeSessionTitle` | `true` | 通知里带上会话标题。 |
| `advanced.maxDetailChars` | `300` | 错误/提问详情的截断长度。 |

同样的值也存在于 profile patch 里，升级不会丢：

```yaml
- id: dsh-plugin-notify
  config:
    events:
      approval: true
    wxpusher:
      enabled: true
      uids:
        - UID_xxxxxxxx
```

### WxPusher 凭据

1. 登录 <https://wxpusher.zjiecode.com>，创建一个应用，复制它的 **appToken**。
2. 用微信扫应用二维码关注，然后在应用的用户列表里复制你的 **UID**（也可以改用**主题 ID** 推给多个订阅者）。
3. 把 appToken 和 UID 填进设置页，点 **保存**。

appToken 输入框每次加载都是空的——宿主只报告「是否已设置」。

### 浏览器权限

页面会显示当前的 `Notification.permission`。如果是 `default`，点**请求权限**；如果是 `denied`，请到浏览器的站点设置里重新允许。提示音需要页面先有过一次用户手势浏览器才允许启动 `AudioContext`——插件会挂上第一次点击/按键来解锁。

### 测试

两张卡片各自带一个测试按钮，不会再分不清测的是哪条通道：

| 卡片 | 按钮 | 行为 |
|---|---|---|
| **浏览器通知** | *发送测试通知* | 给每个已连接页面广播一帧，**并**推一条 WxPusher 消息——整条链路都测。 |
| **WxPusher 推送** | *发送测试推送* | 只推 WxPusher，不弹系统通知；`wxpusher.enabled` 还关着时也能用，方便先验证凭据再开通道。 |

各自在按钮下面报自己的结果：

```
浏览器：1 个页面收到 · WxPusher：已发送
WxPusher：未填写 appToken
WxPusher：被拒绝（appToken不正确）
浏览器：没有已连接的页面（浏览器通知可能已关闭） · WxPusher：未填写 UID 或主题 ID
```

两个按钮打的是同一个端点，只是带了不同的 `channel` 选择器——见下文。

## 实现方式

```
宿主                                    浏览器
────                                    ───────
api-session/status ─┐
api-session/error  ─┤
agent/error        ─┼─► 检测 ─► 帧 ─┬─► WxPusher HTTPS 推送
user-questions/…   ─┤                │
approval/request   ─┘                └─► GET /dsh-plugin-notify/events（SSE）
                                                     │
                                                     ▼
                                         new Notification(title, {
                                           body, icon, tag,
                                           requireInteraction, silent,
                                         })  +  WebAudio 提示音
```

- 宿主插件在 `ctx.webServer` 上注册两个精确路由：SSE 流 `/dsh-plugin-notify/events` 和测试端点 `/dsh-plugin-notify/test`。
- 客户端用 **文档相对** 路径 `dsh-plugin-notify/events` 打开 `EventSource`，因此它跟着页面被挂载在哪个前缀下解析，并沿用页面自身的鉴权。`EventSource` 会自己重连；宿主每 25 秒发一次 `: ping` 心跳。
- 设置页通过 `ctx.configForms.describe()` 解析自己的命名空间——先按条目 id 匹配，再按它认识的那份 schema 匹配——所以即使 profile 把 bundle patch 嵌进 include 组、给条目 id 加了前缀，页面依然能找到。
- 写入走 `ConfigForm.mutate()` 的**按路径寻址**操作，因此从未随响应返回过的密文字段不会被重写覆盖。

### 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/dsh-plugin-notify/events` | 通知帧的 Server-Sent Events 流。 |
| `POST` | `/dsh-plugin-notify/test` | 探测通知链路。`?channel=browser` 只广播不推送，`?channel=wxpusher` 只推送不广播，不带则两者都做。返回 `{ ok, channel, browser, wxpusher }`，没被要求的那条通道报 `skipped`。 |

## 已知限制

- WxPusher 正文用中文拼装（WxPusher 的受众在手机上）；浏览器通知通过 Harness 的 locale 服务本地化。
- 「停止」信号取自智能体进入空闲。多轮对话中途的空闲会被报告一次，这是设计如此——`stopDebounceMs` 和 `minRunMs` 是调节旋钮。
- 除 profile 配置外不做持久化：没有历史记录，也不会补发错过的通知。
- 插件没有自建 Remote 命名空间，所以浏览器半侧是通过上面两个 HTTP 路由与宿主通信，而不是走类型化的 Remote 通道。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
