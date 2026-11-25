# 第三方代码与素材

## CF-Server-Monitor

来源：[huilang-me/CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)。本次对照的[主题提示词](https://github.com/huilang-me/CF-Server-Monitor/blob/1e4931fbebb8dc82f113cd2da80b962fab646a3b/theme-ai-prompt.md)和 [API 说明](https://github.com/huilang-me/CF-Server-Monitor/blob/1e4931fbebb8dc82f113cd2da80b962fab646a3b/theme-develop.md)固定到同一提交。

复用内容：`src/frontend/utils/` 下的 API、HTTP、配置、状态与账单工具，`src/frontend/router/adminEntryUrl.js`，`src/utils/traffic.js`，开发用国旗、系统图标、国家轮廓，以及本地示例的节点定义。

这些工具从主项目工作副本复制，包含本次开发已验证的修复。Aether 页面保留宿主项目名、管理入口与 Powered by 链接。

许可：MIT，Copyright (c) 2026 huilang-me。原始许可随构建放在 `assets/cf-server-monitor-LICENSE.txt`。

## 地球纹理

来源：[three.js examples/textures/planets](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)。原素材缩小为 1024 × 512 并编码成 WebP。

许可：MIT。完整说明在 `theme/public/assets/earth-textures-LICENSE.txt`，随构建打包。

## 大区归类

来源：[Unicode CLDR territoryContainment.json](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/territoryContainment.json)。亚洲与大洋洲在界面上合并显示为亚太。

许可：Unicode License V3。完整说明在 `theme/public/assets/region-data-LICENSE.txt`，随构建打包。

## 依赖与外部服务

Vue、Vite、ws 保留其 npm 包中的许可。[IPQuery](https://ipquery.io/) 是可选的浏览器查询服务，不是随主题分发的数据集。进入页面或展开面板时不会发起检测；访客阅读说明并主动点击后，浏览器才尝试读取宿主的 Cloudflare trace，再向 IPQuery 发送出口 IP。风险分与网络归属由 IPQuery 提供。站点可设置 `theme_options.aether.visitorLookup: false` 禁用此入口；本地虚构示例不向 IPQuery 发请求。

文档中的截图均使用虚构演示节点，Aether 标志为本项目绘制的 SVG。
