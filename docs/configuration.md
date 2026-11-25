# 配置与部署

## 同源安装

默认构建不写入后端域名。通过 CF-Server-Monitor 的自定义主题功能安装时，页面使用当前监控站点的公开 API；管理入口指向 `/admin#/admin`，由内置主题接管。

安装 URL：`https://github.com/Versior/Aether-Monitor/tree/build`。固定版本时使用 `build` 分支的完整提交 SHA：`https://github.com/Versior/Aether-Monitor/tree/<commit>`。

## 独立静态托管

1. 复制 `.env.example` 为 `.env`，将 `API_BASE` 设置为自己的 CF-Server-Monitor 源站 origin。
2. 运行 `npm run build`，将 `dist/` 的内容部署到静态服务。构建时会注入 `meta[name="apiBase"]`。
3. 在后端配置 `CORS_ALLOWED_ORIGINS`，加入主题页面的 origin。仅包含协议、主机与端口，不包含路径。
4. 自己设置 CSP 时，允许 API origin 的 HTTPS/WSS 请求，以及国旗／系统图标所在的 API 源站。

跨域登录状态受到浏览器同源存储与 Cookie 策略限制。私有站点优先使用宿主的同源主题安装方式；静态托管推荐用于公开站点。

开发时设置 `API_BASE` 会读取配置中的真实后端并关闭本地示例。浏览器直接请求该后端，需要允许本地 origin `http://127.0.0.1:5175`。不要在 `API_BASE` 中放 JWT、密码或其他凭据。

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
| `background` | `project`（项目背景）、`default`（纯色背景） | `project` |
| `cardOpacity` | 40–100；卡片背景不透明度百分比 | 100 |
| `panelBlur` | 0–20；半透明卡片背景模糊像素 | 12 |

页头的“主题设置”提供项目背景与纯色背景两个可见选项，并可调整透明度、模糊、配色、卡片信息和地球动效。项目背景兼容宿主桌面背景及手机 `body::after` 背景；纯色背景关闭图片与环境光效果，底色跟随深浅色。文字保持不透明。

浏览器保存的选择优先于站点默认值。沿用 `orbit-preferences` 存储键，保留已有用户的选择；旧 `theme_options.orbit` 配置仍可读取。“恢复站点默认”会清除个人偏好。主题只读取服务端配置，个人设置不写管理后台。

HTML 在主脚本加载前恢复保存的配色与首屏底色，页面组件在首次渲染时使用同一份个人偏好，无需等待配置接口。跟随系统模式继续响应系统配色变化。

浏览器启用“减少动态效果”时暂停自动动效。WebGL 不可用、纹理加载失败或上下文丢失时显示明确提示。

## 访客网络

同源安装时，在宿主 **后台 → 外观设置 → CSP API 域名白名单** 中加入 `https://api.ipquery.io`；有其他域名时用英文逗号分隔。独立托管时，将同一地址加入 `connect-src`。启用后，页面会向 IPQuery 发送访客出口 IP 获取风险评分。国旗和系统图标从 API 源站读取；如果独立静态部署，`img-src` 需要允许该源站。

访客网络数据并非服务器 IP 清单。VPS 的 `ip_v4`、`ip_v6` 是 Agent 上报的协议支持标记，主题不把它们作为真实服务器地址。

## 网站标识与线路标签

页头显示后台设置的 `site_title`，图标使用宿主注入 HTML 的 favicon。未设置自定义图标时使用 CF-Server-Monitor 项目的透明默认图标，标签页和页头使用同一素材。

线路来自后台节点的「标签」字段，沿用宿主的逗号分隔规则，例如 `CN2 GIA,CMI`。旧的 `线路-CN2 GIA` 写法也会显示为 `CN2 GIA`。卡片、列表、详情和线路筛选使用同一组标签，自动去除首尾空白及重复项。

手动标签为空且宿主未提供有效自动检测结果时不显示线路。主题不会根据国家、服务器名称或三网延迟推断线路。

国家码在节点与访客数据入口去除空白并统一大写；`cn`、`CHN`、`China`、`中国`统一识别为 `CN`。中国归属亚太。美国节点优先使用明确的“美西／美东”标签或分组，其次识别水牛城（美东）、圣何塞与洛杉矶（美西）；其他美国节点保持北美。接口未提供服务器城市时，这些名称规则只用于展示分区。

延迟低于 160 ms 显示绿色，160–239.9 ms 显示橙色，240 ms 及以上显示红色，沿用宿主阈值。离线、禁用或缺失指标不显示延迟状态色。

访客国家已识别且开启 `visitorFlow` 时，地球光点从不同国家的服务器位置流向绿色访客定位点；同国家不重复连线。关闭汇聚或访客地区未知时显示服务器之间的连线。连线是国家级展示动效，不代表实际测量链路。

## 发布结构

`main` 分支保存源码与文档，`build` 分支的根目录只保存：

```text
index.html
assets/
```

发布 ZIP 使用同一份构建产物。更新源码后运行 `npm ci && npm test && npm run package`，验证页面，再将产物发布到 `build` 分支。这些命令只测试和生成主题产物，不更改线上监控站点。

## 常见问题

**安装后显示旧页面**：确认使用 `build` 分支或对应提交，而不是 `main`。固定到提交的安装地址不会自动跟随分支更新；选择新版本后再应用。

**国旗／系统图标不显示**：检查 API 源站的 `/flags/`、`/os-icons/` 是否可访问，以及静态资源 CSP 是否允许该源站。

**风险检测失败**：确认 `connect-src` 允许 IPQuery。纯净度查询与节点数据分别请求；外部服务失败会显示错误，重试前清除上次结果。

**节点数据读取失败**：可以点击“重新连接”。若仍失败，请记录提示中的接口、状态码和 Ray ID（如有），便于在 Worker 日志中查找。

**三网或价格没有显示**：检查宿主的展示开关和实际 Agent 数据。主题尊重这些开关。

**本地示例没有真实后台**：示例仅提供主题所用的读取接口与模拟推送。管理端使用正式 CF-Server-Monitor。

## 自动线路检测接口

配套 Worker 支持 `route_report` 时，主题在没有手动标签时展示未过期的自动线路结果，网络详情可展开 ASN 和 IP 段匹配证据。已观测到的骨干线路直接显示名称；仅观测到国际网络时显示“经 TATA”等标签，仍不能确认中国骨干。需要在 VPS 安装检测脚本并升级 Worker 数据库，步骤见 [CF-Server-Monitor 自动线路检测](https://github.com/Versior/CF-Server-Monitor/blob/main/docs/route-detection.md)。普通宿主没有该字段时继续显示后台标签。检测只表示到配置目标的单向路径，不认证 GIA/GT。

`163` 对应 AS4134，`CN2` 对应 AS4809；新版也可用实际回应的 IP 段辅助匹配，来源在详情中标明。`*` 表示该跳未返回 ASN；有缺失跳时，没有观测到 CN2 不能证明整条路径没有经过 CN2。进一步确认需要服务器上的完整路由输出，不应根据节点名称覆盖自动结果。

新版配套脚本支持 CTGNET、CUG、CMIN2 和常见国际网络，并在 ASN 缺失时用已回应的 IPv4 接口段辅助识别。匹配来源、实际使用协议与尝试次数会单独显示；明确的 ASN 与接口段提示保持区分。旧报告没有这些字段时仍可查看。本次覆盖率升级不要求再次升级数据库，但 VPS 需要通过统一安装入口更新检测脚本与规则表。
