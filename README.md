# ProxyNexus

ProxyNexus 集中维护 Clash / Mihomo 客户端使用的配置覆写脚本。当前脚本为 [`clash_override.js`](clash_override.js)，通过 `main(config)` 修改配置并返回结果。

脚本面向支持 Mihomo 配置结构、JavaScript 覆写接口和 HTTP rule-provider 的客户端。客户端及内核版本可能影响具体支持情况；导入后应在客户端检查生成的配置与规则提供者状态。

## 处理流程

脚本按顺序完成以下工作：

1. 从 `config.proxies` 读取当前配置中的静态节点，并按节点名称筛选候选集。
2. 为 APNs、OpenAI/ChatGPT、Google/Gemini、Claude、X/Grok、Meta/Muse 和 GitHub 创建服务测速组。
3. 保留机场已有的 `♻️ 自动选择` 组；缺少时才用 `https://www.gstatic.com/generate_204` 创建普通自动组，并在找到“手动选择”组时加入该组。
4. 注册服务规则集，并把服务规则放在原配置规则之前。
5. 在原配置未启用 `sniffer` 时补齐默认域名嗅探配置，防止纯 IP 连接绕过域名规则。
6. 将更新后的配置返回给客户端。

## 服务分流

| 服务组 | 测速网址 | 候选节点 | 静态兜底域名 | 远程规则集 |
| --- | --- | --- | --- | --- |
| `APNs_Auto` | `https://captive.apple.com/hotspot-detect.html`（预期 HTTP 200） | 名称标记为美国、日本、新加坡、香港的通用服务候选 | `push.apple.com`、`push.apple.com.cn` 及模块列出的其他域名和 IP 网段 | — |
| `ChatGPT_Auto` | `https://chatgpt.com/` | AI 候选 | `openai.com`、`chatgpt.com` | `openai.mrs` |
| `Google_Auto` | `https://www.google.com/` | 未标记 IPv6/V6 的 AI 候选：原配置自带 `♻️ 自动选择` 时仅保留美国、日本，否则保留美国、日本、新加坡、台湾 | `gemini.google.com`、`generativelanguage.googleapis.com`、`cloudcode-pa.googleapis.com`、`daily-cloudcode-pa.googleapis.com`、`aicode.googleapis.com`、`google.com`、`google.com.hk` | `google-gemini.mrs`、`google.mrs` |
| `Claude_Auto` | `https://claude.ai/` | AI 候选 | `claude.ai`、`anthropic.com` | `anthropic.mrs` |
| `SpaceX_Auto` | `https://x.com/` | AI 候选 | `grok.com`、`x.ai`、`grok.x.com`、`x.com`、`twitter.com`、`twimg.com`、`t.co` | `xai.mrs`、`x.mrs`、`twitter.mrs` |
| `Meta_Auto` | `https://meta.ai/` | AI 候选中名称标记为美国或新加坡的节点 | `meta.ai`、`muse.ai` | `facebook.mrs`、`instagram.mrs`、`threads.mrs`、`whatsapp.mrs`、`messenger.mrs`、`meta.mrs`、`oculus.mrs` |
| `GitHub_Auto` | `https://github.com/` | 通用服务候选，允许香港 | `github.com`、`githubusercontent.com` | `github.mrs` |

Google 组会排除节点名称中明确标记为 `IPv6` 或独立 `V6` 的节点；这是名称标签筛选，不等于检测了节点的真实出口 IP 协议。ChatGPT 与 OpenAI 已共用 `ChatGPT_Auto`；Gemini 与 Google 共用 `Google_Auto`；X 与 Grok 共用 `SpaceX_Auto`。原配置自带 `♻️ 自动选择` 时，`Google_Auto` 只保留名称标记为美国、日本的候选节点；否则保留美国、日本、新加坡、台湾（此区分基于原配置策略组名称特征，并非检测订阅来源或真实出口归属地）。自动测速组的切换容差统一设为 `200ms`。`SpaceX_Auto` 沿用 AI 候选并以 X 网址测速；香港节点因此不进入该合并组。Meta AI、Muse、Facebook、Instagram、Threads、WhatsApp、Messenger 和 Oculus/Quest 共用美国和新加坡节点组 `Meta_Auto`。测速只探测表中的网址，不代表该组内每个服务的登录状态、API 可用性或账号地区资格都已验证。

APNs 使用独立的 `APNs_Auto`，从名称标记为美国、日本、新加坡、香港的通用服务候选中测速。Mihomo URL-test 使用 HTTP `HEAD` 请求，因此测速目标采用支持 `HEAD` 的 Apple 连通性页面 `captive.apple.com/hotspot-detect.html`，预期状态为 HTTP 200。这只测 Apple 网站 HTTPS 443 的延迟，不验证设备侧 APNs 长连接。规则完整包含用户提供的 APNs 模块中的 3 条域名规则和 Apple 公布的 5 段 IPv4、4 段 IPv6 地址段，并额外覆盖日志中观测到的 `push.apple.com.cn`。其中 `akadns.net` 和 `apple.com.edgekey.net` 的匹配范围比 `push.apple.com` 更宽，可能让非推送的 Apple 相关流量也命中 `APNs_Auto`，需结合客户端活动记录验证。APNs 是设备共享的推送连接，命中后所有使用 APNs 的应用通知都会走 `APNs_Auto`，无法按应用单独分流。要影响 iPhone 推送，必须在承载 iPhone 流量的 Clash 客户端加载此脚本；仅在 Mac 加载不会改变 iPhone 的 APNs 路径。

Meta 产品远程集合包含 Facebook、Instagram、Threads、WhatsApp、Messenger、Meta 与 Oculus/Quest。集合内容由 MetaCubeX 的 geosite 库维护；它不是 Meta 官方域名清单，无法保证包含每个产品的所有新域名。已观测到的 `meta.ai` 与 `muse.ai` 使用静态 `DOMAIN-SUFFIX` 规则兜底；发现其他遗漏域名时，应先看连接日志，再补充到对应静态规则或上游规则集。

## 静态规则与远程规则集

每个服务定义里的 `rules` 是脚本直接生成的静态规则。例如：

```js
rules: ["DOMAIN-SUFFIX,gemini.google.com"]
```

生成时脚本会附上目标策略组，得到 `DOMAIN-SUFFIX,gemini.google.com,Google_Auto`。静态规则作为核心域名的兜底，不依赖远程规则集下载成功。

`ruleSets` 指定要加载的远程文件，以及该规则集在当前配置中的名称。例如：

```js
ruleSets: [{ name: "proxynexus_gemini", file: "google-gemini.mrs" }]
```

`name` 是配置内的 provider 名称；`file` 是上游仓库里的文件名。脚本把 `RULE_PROVIDER_BASE_URL` 和 `file` 拼接为下载地址，并生成类似 `RULE-SET,proxynexus_gemini,Google_Auto` 的路由规则。

当前基础地址指向 MetaCubeX 的 geosite MRS 文件目录：

```text
https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite
```

例如 Gemini 规则集地址为：

```text
https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google-gemini.mrs
```

这些域名分类由 MetaCubeX 的开源规则库维护，不是相应服务厂商的官方域名清单，也不是客户端通过 DNS 自动发现的结果。脚本将 provider 设置为 `behavior: domain`、`format: mrs`，更新间隔为 `86400` 秒。下载优先使用配置中名称包含“手动选择”的 `select` 组；找不到时自动回退到原配置中首个可用的代理 `select` 组（避开广告过滤、屏蔽及默认直连/拒绝类组，优先匹配包含 `♻️ 自动选择` 或静态节点的组）；仍不存在时回退 `DIRECT`。

配置规则按以下顺序合并：

1. 嘉信域名与 Tailscale 直连规则。
2. 各服务的静态规则和远程 `RULE-SET` 引用，顺序与 `serviceDefinitions` 一致。
3. 原配置中的规则。

Tailscale 直连规则包含隧道网段 `100.64.0.0/10`、`fd7a:115c:a1e0::/48`、MagicDNS 域名 `ts.net` 以及 Tailscale 进程名（`io.tailscale.ipn.macsys.network-extension`、`IPNExtension`、`Tailscale`、`tailscaled`），放在服务规则和原配置规则之前；该设置会让 Tailscale 守护进程自身流量走 `DIRECT`（不影响浏览器访问网页登录）。当原配置已存在 `tun` 对象时，脚本会向 `tun.route-exclude-address` 合并追加 `100.64.0.0/10` 与 `fd7a:115c:a1e0::/48`（不改变 `tun.enable`）；当已存在 `dns` 对象且 `fake-ip-filter-mode` 未设置或为 `blacklist` 时，会向 `dns.fake-ip-filter` 合并追加 `+.ts.net`。部分 GUI 客户端会在覆写脚本之后以界面全局 TUN/DNS 设置覆盖 `tun` / `dns` 字段，启用 TUN 模式后需在客户端界面确认路由排除并在系统侧实测生效。

当原配置未提供 `sniffer` 或 `sniffer.enable` 不为 `true` 时，脚本会默认写入启用配置（开启 `force-dns-mapping`、`parse-pure-ip`、`override-destination`，嗅探 HTTP `80`/`8080-8880`、TLS `443`/`8443` 与 QUIC `443`/`8443`，并在 `skip-domain` 中保留 `Mijia Cloud` 与 `+.push.apple.com`）；若原配置已启用 `sniffer`，则保持原配置不变。部分客户端界面覆写可能会覆盖 `sniffer` 字段，生效情况需以客户端日志为准。

Google 的 `google-gemini.mrs` 与 `google.mrs` 都指向 `Google_Auto`；Chrome 搜索和 Gemini 等 Google 域名共用这个组。X、Twitter 与 Grok 的静态规则和三个远程规则集都指向 `SpaceX_Auto`，所以 `grok.x.com` 与 `x.com` 的规则匹配顺序不会把它们分到不同组。

## 节点筛选边界

- 脚本只从 `config.proxies` 读取静态节点，不展开 `proxy-providers`。
- 地区、运营商和倍率都根据节点名称判断，不检查节点的真实出口 IP 或机场计费信息。
- 没有倍率标记的节点暂按 `1.0` 倍处理。
- 普通自动组只排除机场信息类节点；服务组还会排除纯联通、指定地区和超过 `3.0` 倍的节点。AI 候选额外排除香港；Meta AI（含 Muse 域名）只保留美国和新加坡标记节点；Google 排除名称标记为 IPv6/V6 的节点，并在原配置自带 `♻️ 自动选择` 时只保留美国、日本标记节点，否则保留美国、日本、新加坡、台湾标记节点；APNs 使用美国、日本、新加坡、香港标记节点；X/Grok 共用 AI 候选。
- 若某服务筛选后没有候选节点，该服务组会使用 `REJECT`，不会自动放宽筛选条件。

## 修改脚本时

- 新增或调整服务时，检查 `serviceDefinitions` 中的组名、测速地址、候选集、静态兜底域名和 `ruleSets` 是否一致。
- 静态域名写在 `rules`；只有上游存在合适规则文件时才添加 `ruleSets`。
- 修改 `RULE_PROVIDER_BASE_URL` 会影响所有远程规则集；修改单项 `file` 只影响该项对应的远程文件。
- 修改完成后，在目标客户端检查生成的 `rule-providers`、实际命中的规则及连接出口。

## 上游资料

- [MetaCubeX meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite)
- [Mihomo rule-provider 配置说明](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/rule-providers/index.md)
