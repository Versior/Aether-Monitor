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
    "motion": true
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

浏览器保存的视图与配色选择优先于站点默认值。沿用 `orbit-preferences` 存储键，保留已有用户的选择；旧 `theme_options.orbit` 配置仍可读取。主题只读取配置，设置由管理后台负责。

浏览器启用“减少动态效果”时暂停自动动效。WebGL 不可用、纹理加载失败或上下文丢失时显示明确提示。

## 访客网络

允许 `https://api.ipquery.io` 出现在宿主 **CSP API 白名单** 中。国旗和系统图标从 API 源站读取；如果独立静态部署，`img-src` 需要允许该源站。

访客网络数据并非服务器 IP 清单。VPS 的 `ip_v4`、`ip_v6` 是 Agent 上报的协议支持标记，主题不把它们作为真实服务器地址。

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

**风险检测失败**：检查 CSP 白名单及浏览器网络请求。外部服务失败会显示错误，重试前清除上次结果。

**三网或价格没有显示**：检查宿主的展示开关和实际 Agent 数据。主题尊重这些开关。

**本地示例没有真实后台**：示例仅提供主题所用的读取接口与模拟推送。管理端使用正式 CF-Server-Monitor。
