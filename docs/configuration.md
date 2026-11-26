# 配置与部署

## 同源安装

默认构建不写入后端域名。通过 CF-Server-Monitor 的自定义主题功能安装时，页面使用当前监控站点的公开 API；管理入口指向 `/admin#/admin`，由内置主题接管。

安装 URL：`https://github.com/Versior/Aether-Monitor/tree/build`。固定版本时使用 `build` 分支的完整提交 SHA：`https://github.com/Versior/Aether-Monitor/tree/<commit>`。

## 独立静态托管

1. 复制 `.env.example` 为 `.env`，将 `API_BASE` 设置为自己的 CF-Server-Monitor 源站 origin。支持英文逗号分隔多个 origin，各站只订阅自己的节点。
2. 运行 `npm run build`，将 `dist/` 的内容部署到静态服务。构建时会注入 `meta[name="apiBase"]`。
3. 在后端配置 `CORS_ALLOWED_ORIGINS`，加入主题页面的 origin。仅包含协议、主机与端口，不包含路径。
4. 自己设置 CSP 时，允许 API origin 的 HTTPS/WSS 请求，以及国旗／系统图标所在的 API 源站。

每个后端都要配置 CORS。**私有站点优先用同源安装**：在 Worker 后台登录后，独立静态站无法直接读取它的登录状态。不要把 JWT 写进 URL、`.env` 或构建配置。

静态页首次访问要求登录的主站或节点详情时，会跳到对应 Worker 的 `/admin#/admin`。返回或刷新后，同一标签页不会为该 Worker 再次自动跳转；点击“在源站查看”可使用源站的登录状态继续查看。详情链接保留节点 ID，不转发多站参数或凭据。

开发时设置 `API_BASE` 会读取配置中的真实后端并关闭本地示例。浏览器直接请求该后端，需要允许本地 origin `http://127.0.0.1:5175`。不要在 `API_BASE` 中放 JWT、密码或其他凭据。

## 监控请求与历史

每个站点首次读 `/api/config`，首页读一次 `/api/servers`，此后的实时更新来自 WebSocket，没有定时 REST 轮询。页面隐藏时关闭连接并保留读数；恢复可见时按当前页面补一次快照。达到站点设置的实时连接时限后，须手动继续。

首次在线数取自该 Worker 返回的统计。之后用同一站的时间判断五分钟离线和重新上线；若旧宿主没有提供可用的服务端时钟，保留最后的统计，避免因访客电脑时钟偏差而误判。

首页打开详情弹窗复用列表连接。直接打开某个节点的详情只读取该节点与 `/api/history/all`，并只订阅该节点。详情默认显示最近 10 分钟；可切换为 30 分钟或 1、6、12、24、48、96、168 小时，未登录最多 24 小时。切换时只读历史；延迟与丢包曲线共用这份数据。

Versior 配套 Worker 的单节点响应在 `sysConfig` 中返回 `show_price`、`show_expire`、`show_tf` 和 `show_three_net_details`；原版宿主的详情响应可能只有 `long_history_points`。冷启动无法确认开关时只展示基础资源，不为了猜开关额外读取全站列表。如需被隐藏的网络、流量或账单面板，先进入首页取得本站开关，再打开详情。

## 主题选项

主题读取 `/api/config` 的 `theme_options.aether`：

```json
{
  "aether": {
    "layout": "compact",
    "view": "card",
    "appearance": "dark",
    "globe": true,
    "motion": true,
    "visitorFlow": true,
    "visitorLookup": true,
    "background": "project",
    "cardOpacity": 100,
    "panelBlur": 12
  }
}
```

| 选项 | 可用值 | 默认 |
| --- | --- | --- |
| `layout` | `compact`、`full` | `compact` |
| `view` | `card`、`table`、`network` | `card` |
| `appearance` | `auto`、`dark`、`light` | `auto` |
| `globe` | `true`、`false` | `true` |
| `motion` | `true`、`false` | `true` |
| `visitorFlow` | `true`、`false`；节点向访客国家汇聚 | `true` |
| `visitorLookup` | `true` 提供手动检测入口；`false` 隐藏入口，禁用 trace／IPQuery | `true` |
| `background` | `project`（项目背景）、`default`（纯色背景） | `project` |
| `cardOpacity` | 40–100；卡片背景不透明度百分比 | 100 |
| `panelBlur` | 0–20；半透明卡片背景模糊像素 | 12 |

页头的“主题设置”提供项目背景与纯色背景两个可见选项，并可调整透明度、模糊、配色、卡片信息和地球动效。项目背景兼容宿主桌面背景及手机 `body::after` 背景；纯色背景关闭图片与环境光效果，底色跟随深浅色。文字保持不透明。

浏览器把个人覆盖保存在 `orbit-preferences`；未覆盖的选项跟随服务端默认，旧 `theme_options.orbit` 仍可读取。普通调整只影响本机。“恢复站点默认”只清除个人覆盖；已登录管理员可显式选择“保存为站点默认”，通过 `POST /api/theme_options` 更新 `theme_options.aether`，保留其他主题选项，多站点只写第一站。成功后清除本机覆盖；失败显示错误。

配套 Worker 在 `/api/config` 声明 `theme_options_patch: true` 时，Aether 仅提交自己的选项，数据库原子合并，其他主题同时修改的设置也会保留。在没有这项能力的原版或旧版 Worker 上，点击“保存为站点默认”会额外读取一次 `/api/config`，再合并并提交完整对象。旧接口无法原子合并，多个管理员请错开保存。

HTML 在主脚本加载前恢复保存的配色与首屏底色，页面组件在首次渲染时使用同一份个人偏好，无需等待配置接口。跟随系统模式继续响应系统配色变化。

浏览器启用“减少动态效果”时暂停自动动效。WebGL 不可用、纹理加载失败或上下文丢失时显示明确提示。

## 访客网络

页面加载后自动检测一次，底部条显示检测状态和结果；展开面板查看详细信息。收起再展开不会重复请求，检测失败后可在面板中手动重试。浏览器先尝试访问第一站的 `/cdn-cgi/trace`，再向 `https://api.ipquery.io` 查询出口 IP 的归属与风险。若 trace 不能提供地址，会在同一次检测中向 IPQuery 读取出口 IP。结果仅存在本页内存，默认脱敏；外部服务仍会收到真实出口地址。

需要这个功能时，在宿主 **后台 → 外观设置 → CSP API 域名白名单** 加入 `https://api.ipquery.io`；独立静态托管可将其写入 `CSP_API`。严格限定监控 API 时，把**站点默认** `theme_options.aether.visitorLookup` 设为 `false`：即使浏览器有旧的 `true`，也不提供入口。`visitorFlow` 只控制动画。国旗／系统图标来自节点所属 API 源站，独立静态服务的 `img-src` 需允许这些源站。

访客网络数据并非服务器 IP 清单。VPS 的 `ip_v4`、`ip_v6` 是 Agent 上报的协议支持标记，主题不把它们作为真实服务器地址。

## 网站标识与线路标签

页头显示后台设置的 `site_title`，图标使用宿主注入 HTML 的 favicon。未设置自定义图标时使用 CF-Server-Monitor 项目的透明默认图标，标签页和页头使用同一素材。

线路来自后台节点的「标签」字段，沿用宿主的逗号分隔规则，例如 `CN2 GIA,CMI`。旧的 `线路-CN2 GIA` 写法也会显示为 `CN2 GIA`。卡片、列表、详情和线路筛选使用同一组标签，自动去除首尾空白及重复项。

手动标签为空且宿主未提供有效自动检测结果时不显示线路。主题不会根据国家、服务器名称或三网延迟推断线路。

国家码在节点与访客数据入口去除空白并统一大写；`cn`、`CHN`、`China`、`中国`统一识别为 `CN`。中国归属亚太。美国节点优先使用明确的“美西／美东”标签或分组，其次识别水牛城（美东）、圣何塞与洛杉矶（美西）；其他美国节点保持北美。接口未提供服务器城市时，这些名称规则只用于展示分区。

延迟低于 160 ms 显示绿色，160–239.9 ms 显示橙色，240 ms 及以上显示红色，沿用宿主阈值。离线、禁用或缺失指标不显示延迟状态色。

访客国家已识别且开启 `visitorFlow` 时，地球光点从不同国家的服务器位置流向绿色访客定位点；同国家不重复连线。关闭汇聚或访客地区未知时显示服务器之间的连线。连线是国家级展示动效，不代表实际测量链路。

## 发布结构

`main` 保存源码。工作流在推送 `main` 或从 `main` 手动运行时测试并分别构建两个分支；每个发布提交保留对应源码提交说明和 SHA。`dist` 用于 GitHub Pages／独立静态托管，`build` 为原有同源安装 URL 保持不绑定任何 Worker 的构建。两者均以旧分支提交为父提交追加，不强推；首次创建 `dist` 时如果有旧 `build` 历史，会承接它。两个发布根目录都只包含：

```text
index.html
assets/
```

在仓库 **Settings → Secrets and variables → Actions** 配置 Pages 构建参数。以下五项会进入**公开页面**，不要放凭据：

| Secret | 用途 |
| --- | --- |
| `API_BASE` | 独立 Pages 必填：一个或多个 Worker 的 HTTP(S) origin，用英文逗号分隔；留空则请求页面自己的 origin |
| `TITLE` | 可选的 HTML 标题；读取宿主配置后优先展示 `site_title` |
| `BACKGROUND_IMAGE` | 可选的公开 HTTP(S) 背景图 URL |
| `CSP_API` | 额外允许连接的 HTTP(S) origin 列表；如需手动访客检测，加入 `https://api.ipquery.io` |
| `CSP_STATIC` | 额外允许静态资源的 HTTP(S) origin 列表 |

启用 Actions，并允许该工作流写仓库内容（`contents: write`；**Settings → Actions → General → Workflow permissions**）。首次生成分支后，在 **Settings → Pages → Deploy from a branch** 选择 **`dist` / `(root)`**。默认 `GITHUB_TOKEN` 能更新 `dist` 和 `build`；按 [GitHub 的分支发布规则](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)，它推送的提交不会触发 Pages 重建。需要让每次推送也发布 Pages 时，可为该仓库配置单独的 `PAGES_PUBLISH_TOKEN`（限当前仓库、Contents: write，其账号须有 Pages 发布资格）。这是 Git 凭据，仅作 Actions secret，**不属于静态构建参数**。分支保护应允许所选发布身份更新这两个分支。

本地使用 `npm ci && npm test && npm run package` 验证并生成 ZIP、SHA-256；不修改线上站点。`npm test` 包含本地 bare Git 回归，实际构建两种配置并验证分支历史、提交说明和重跑行为。

构建和测试使用只读仓库权限。独立的发布任务按本次构建的 artifact ID 下载两个页面，再用写凭据推送，无需运行 npm。即使 `main` 在构建期间前移，也会记录已完成的版本；如果新版本已先发布，晚到的旧产物会保留在分支历史中，页面继续使用新版本。

## 常见问题

**安装后显示旧页面**：确认使用 `build` 分支或对应提交，而不是 `main`。固定到提交的安装地址不会自动跟随分支更新；选择新版本后再应用。

**国旗／系统图标不显示**：检查 API 源站的 `/flags/`、`/os-icons/` 是否可访问，以及静态资源 CSP 是否允许该源站。

**风险检测失败**：确认 `connect-src` 允许 IPQuery。纯净度查询与节点数据分别请求；外部服务失败会显示错误，重试前清除上次结果。

**节点数据读取失败**：可以点击“重新连接”。若仍失败，请记录提示中的接口、状态码和 Ray ID（如有），便于在 Worker 日志中查找。

**三网或价格没有显示**：检查宿主的展示开关和实际 Agent 数据。主题尊重这些开关。

**本地示例没有真实后台**：示例提供虚构的节点与模拟推送；验证实际管理登录、保存站点默认或启用私有部署时使用自己的 CF-Server-Monitor。

## 自动线路检测接口

配套 Worker 支持 `route_report` 时，主题在没有手动标签时展示未过期的自动线路结果，网络详情可展开 ASN 和 IP 段匹配证据。已观测到的骨干线路直接显示名称；仅观测到国际网络时显示“经 TATA”等标签，仍不能确认中国骨干。需要在 VPS 安装检测脚本并升级 Worker 数据库，步骤见 [CF-Server-Monitor 自动线路检测](https://github.com/Versior/CF-Server-Monitor/blob/main/docs/route-detection.md)。普通宿主没有该字段时继续显示后台标签。检测只表示到配置目标的单向路径，不认证 GIA/GT。

`163` 对应 AS4134，`CN2` 对应 AS4809；新版也可用实际回应的 IP 段辅助匹配，来源在详情中标明。`*` 表示该跳未返回 ASN；有缺失跳时，没有观测到 CN2 不能证明整条路径没有经过 CN2。进一步确认需要服务器上的完整路由输出，不应根据节点名称覆盖自动结果。

新版配套脚本支持 CTGNET、CUG、CMIN2 和常见国际网络，并在 ASN 缺失时用已回应的 IPv4 接口段辅助识别。匹配来源、实际使用协议与尝试次数会单独显示；明确的 ASN 与接口段提示保持区分。旧报告没有这些字段时仍可查看。本次覆盖率升级不要求再次升级数据库，但 VPS 需要通过统一安装入口更新检测脚本与规则表。
