# ProxyNexus

ProxyNexus 集中维护 Clash / Mihomo 客户端使用的配置覆写脚本：

- [`clash_override.js`](clash_override.js)：通用版 JavaScript 覆写脚本（桌面端及分享通用），通过 `main(config)` 保留全部服务分流并将 Tailscale 设为直连/排除，便于与官方 Tailscale App 共存。
- [`clash_override_mobile.js`](clash_override_mobile.js)：手机端专用版 JavaScript 覆写脚本，保留全部分流与测速规则的同时改为注入 Mihomo 内置 `type: tailscale` 出站（默认将 `TAILSCALE_AUTH_KEY` 留空，支持日志链接授权或临时填入一次性 key 上线后再清空），免除手机端双 VPN 冲突。

脚本面向支持 Mihomo 配置结构、JavaScript 覆写接口和 HTTP rule-provider 的客户端。客户端及内核版本可能影响具体支持情况；导入后应在客户端检查生成的配置与规则提供者状态。

## 处理流程

脚本按顺序完成以下工作：

1. 从 `config.proxies` 读取当前配置中的静态节点，并按节点名称筛选候选集。
2. 为 APNs、OpenAI/ChatGPT、Google/Gemini、Claude、X/Grok、Meta/Muse 和 GitHub 创建服务测速组。
3. 保留机场已有的 `♻️ 自动选择` 组（并将原配置策略组与 `proxy-providers` 中已知明文 `http://` `generate_204` 测速地址自动升级为 `https://`）；缺少时才用 `https://www.gstatic.com/generate_204` 创建普通自动组，并在找到“手动选择”组时加入该组。
4. 注册服务规则集，并把服务规则放在原配置规则之前。
5. 在原配置未启用 `sniffer` 时补齐默认域名嗅探配置，防止纯 IP 连接绕过域名规则。
6. 将更新后的配置返回给客户端。

## 服务分流

| 服务组 | 测速网址 | 候选节点 | 静态兜底域名 | 远程规则集 |
| --- | --- | --- | --- | --- |
| `APNs_Auto` | `https://captive.apple.com/hotspot-detect.html`（预期 HTTP 200） | 名称标记为美国、日本、新加坡、香港的通用服务候选 | `push.apple.com`、`push.apple.com.cn` 及模块列出的其他域名和 IP 网段 | — |
| `ChatGPT_Auto` | `https://chatgpt.com/` | AI 候选 | `openai.com`、`chatgpt.com` | `openai.mrs` |
| `Google_Auto` | `https://www.google.com/` | 未标记 IPv6/V6 的 AI 候选：原配置自带 `♻️ 自动选择` 时仅保留美国，否则保留美国、日本、新加坡、台湾 | `gemini.google.com`、`generativelanguage.googleapis.com`、`cloudcode-pa.googleapis.com`、`daily-cloudcode-pa.googleapis.com`、`aicode.googleapis.com`、`google.com`、`google.com.hk` | `google-gemini.mrs`、`google.mrs` |
| `Claude_Auto` | `https://claude.ai/` | AI 候选 | `claude.ai`、`anthropic.com` | `anthropic.mrs` |
| `SpaceX_Auto` | `https://x.com/` | AI 候选 | `grok.com`、`x.ai`、`grok.x.com`、`x.com`、`twitter.com`、`twimg.com`、`t.co` | `xai.mrs`、`x.mrs`、`twitter.mrs` |
| `Meta_Auto` | `https://meta.ai/` | AI 候选中名称标记为美国或新加坡的节点 | `meta.ai`、`muse.ai` | `facebook.mrs`、`instagram.mrs`、`threads.mrs`、`whatsapp.mrs`、`messenger.mrs`、`meta.mrs`、`oculus.mrs` |
| `GitHub_Auto` | `https://github.com/` | 通用服务候选，允许香港 | `github.com`、`githubusercontent.com` | `github.mrs` |

Google 组会排除节点名称中明确标记为 `IPv6` 或独立 `V6` 的节点；这是名称标签筛选，不等于检测了节点的真实出口 IP 协议。ChatGPT 与 OpenAI 已共用 `ChatGPT_Auto`；Gemini 与 Google 共用 `Google_Auto`；X 与 Grok 共用 `SpaceX_Auto`。原配置自带 `♻️ 自动选择` 时，`Google_Auto` 只保留名称标记为美国的候选节点；否则保留美国、日本、新加坡、台湾（此区分基于原配置策略组名称特征，并非检测订阅来源或真实出口归属地）。自动测速组的切换容差统一设为 `200ms`。`SpaceX_Auto` 沿用 AI 候选并以 X 网址测速；香港节点因此不进入该合并组。Meta AI、Muse、Facebook、Instagram、Threads、WhatsApp、Messenger 和 Oculus/Quest 共用美国和新加坡节点组 `Meta_Auto`。测速只探测表中的网址，不代表该组内每个服务的登录状态、API 可用性或账号地区资格都已验证。

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

1. 通用版 [`clash_override.js`](clash_override.js) 为嘉信域名与 Tailscale 直连规则；手机端版 [`clash_override_mobile.js`](clash_override_mobile.js) 为 Tailscale 内置出站规则（置于全部规则最前面）与嘉信直连规则。
2. 各服务的静态规则和远程 `RULE-SET` 引用，顺序与 `serviceDefinitions` 一致。
3. 原配置中的规则（手机端版会按去空白精确去重已注入的 Tailscale 规则）。

Tailscale 接入提供两套免密钥方案，分别对应桌面端与手机端：

- **通用版（[`clash_override.js`](clash_override.js)，桌面端配合官方 Tailscale App）**：生成 `100.64.0.0/10`、`fd7a:115c:a1e0::/48`、MagicDNS 域名 `ts.net` 以及 Tailscale 进程名（`io.tailscale.ipn.macsys.network-extension`、`IPNExtension`、`Tailscale`、`tailscaled`）的 `DIRECT` 规则，让 Tailscale 守护进程自身流量走直连（不影响浏览器访问网页登录）。当原配置已存在 `tun` 对象时，脚本会向 `tun.route-exclude-address` 合并追加 `100.64.0.0/10` 与 `fd7a:115c:a1e0::/48`（不改变 `tun.enable`）；当已存在 `dns` 对象且 `fake-ip-filter-mode` 未设置或为 `blacklist` 时，会向 `dns.fake-ip-filter` 合并追加 `+.ts.net`。部分 GUI 客户端会在覆写脚本之后以界面全局 TUN/DNS 设置覆盖 `tun` / `dns` 字段，启用 TUN 模式后需在客户端界面确认路由排除并在系统侧实测生效。
- **手机端专用版（[`clash_override_mobile.js`](clash_override_mobile.js)，免与官方 Tailscale App VPN 冲突）**：在保留全部服务分流与测速策略的基础上，非破坏性追加 Mihomo 内置 `type: tailscale` 节点（`name: "Tailscale"`、`hostname: "phone-clash"`、`ephemeral: false`、`udp: true`；顶部预留 `TAILSCALE_AUTH_KEY = ""`，仅非空时才写入 `auth-key`），同时从自动测速与服务测速候选集中排除该节点；从 `tun.route-exclude-address` 中剔除 `100.64.0.0/10` 与 `fd7a:115c:a1e0::/48` 以免手机 TUN 流量绕过内置出站；并将 `DOMAIN-SUFFIX,ts.net,Tailscale`、`IP-CIDR,100.64.0.0/10,Tailscale,no-resolve` 与 `IP-CIDR6,fd7a:115c:a1e0::/48,Tailscale,no-resolve` 插在全部规则最前面。当 `config.dns` 处于黑名单或默认 `fake-ip-filter-mode` 时，脚本会合并追加 `+.tailscale.com` 与 `+.tailscale.io` 到 `dns.fake-ip-filter`（避免 `tsnet` 的控制面/DERP 域名在 `fake-ip` 模式下解析出 `198.18.x.x` 假 IP）；当 `TAILSCALE_USE_MAGIC_DNS = true`（默认）时，还会确保 `dns.enable = true`、合并 `"+.ts.net": "ts://Tailscale"` 到 `dns.nameserver-policy` 并合并 `+.ts.net` 到 `dns.fake-ip-filter`。若客户端不支持 `ts://Tailscale`，把顶部 `TAILSCALE_USE_MAGIC_DNS` 设为 `false` 即可降级为仅靠 `IP-CIDR` 走内网 IP（如 `http://100.x.x.x:<端口>`）直连。
- **免密钥授权与排错验证**：[`clash_override_mobile.js`](clash_override_mobile.js) 默认将 `TAILSCALE_AUTH_KEY` 留空且不包含个人 Tailnet 信息，可直接通过仓库 Raw URL 订阅更新；首次授权时既可以触发 Tailscale 流量后在客户端 `info` 日志点开登录链接，也可以在本地副本中临时填入一次性 `auth-key`、待 Tailscale 后台上线后清空变量或切回留空版远程脚本（只要 `hostname` 与客户端 `state-dir` 缓存不变即可保持在线，建议同时在 Tailscale 管理后台开启 `Disable key expiry`）。若客户端启用了内置 DNS 界面覆写（如 FlClash 的 DNS 覆写），会覆盖脚本写入的 `fake-ip-filter`，需确认面板侧的 `fake-ip-filter` 同样包含 `+.tailscale.com`、`+.tailscale.io` 与 `+.ts.net`（且不要把 Mihomo 自身 DNS 监听端口如 `127.0.0.1:7874` 配入上游 `nameserver` / `proxy-server-nameserver`）。若日志报 `unsupported proxy type: tailscale`，说明该客户端内核编译未包含 Tailscale 支持（需 Mihomo 支持 `with_gvisor` 且未加 `no_tailscale`，例如 iOS Stash 等不支持的客户端需更换或改回通用版）。生效后可在手机浏览器访问对应设备 MagicDNS（如 `https://<设备名>.<你的tailnet>.ts.net`）或内网 IP（`http://100.x.x.x:<端口>`），并在目标电脑运行 `tailscale status` 确认设备在线。
- **桌面端（FlClash + T3 Code）跨机直连排障**：桌面端同时使用 FlClash 系统代理、环境变量 `NO_PROXY` 与 T3 Code 跨机直连时的分层排查与 `t3 pair --tailscale` 纯本地配对指南见 [T3 Code + Tailscale + Clash/FlClash 跨机直连与排障指南](docs/t3-tailscale-troubleshooting.md)。

当原配置未提供 `sniffer` 或 `sniffer.enable` 不为 `true` 时，脚本会默认写入启用配置（开启 `force-dns-mapping`、`parse-pure-ip`、`override-destination`，嗅探 HTTP `80`/`8080-8880`、TLS `443`/`8443` 与 QUIC `443`/`8443`，并在 `skip-domain` 中保留 `Mijia Cloud` 与 `+.push.apple.com`）；若原配置已启用 `sniffer`，则保持原配置不变。部分客户端界面覆写可能会覆盖 `sniffer` 字段，生效情况需以客户端日志为准。

当原配置保留的策略组 `url` 或 `proxy-providers` 的 `health-check.url` 使用明文 `http://www.gstatic.com/generate_204`、`http://gstatic.com/generate_204` 或 `http://cp.cloudflare.com/generate_204` 时，脚本会自动将其升级为对应的 `https://` 地址，以避免 Mihomo 开启统一延迟（同一连接连续两次 `HEAD` 请求）时因明文测速被劫持或连接提前关闭而报错弹窗；策略组其余参数与节点名单保持不变，非目标 HTTP 地址不做改写，脚本也仍不展开 `proxy-providers`。

Google 的 `google-gemini.mrs` 与 `google.mrs` 都指向 `Google_Auto`；Chrome 搜索和 Gemini 等 Google 域名共用这个组。X、Twitter 与 Grok 的静态规则和三个远程规则集都指向 `SpaceX_Auto`，所以 `grok.x.com` 与 `x.com` 的规则匹配顺序不会把它们分到不同组。

## 节点筛选边界

- 脚本只从 `config.proxies` 读取静态节点，不展开 `proxy-providers`。
- 地区、运营商和倍率都根据节点名称判断，不检查节点的真实出口 IP 或机场计费信息。
- 没有倍率标记的节点暂按 `1.0` 倍处理。
- 普通自动组只排除机场信息类节点；服务组还会排除纯联通、指定地区和超过 `3.0` 倍的节点。AI 候选额外排除香港；Meta AI（含 Muse 域名）只保留美国和新加坡标记节点；Google 排除名称标记为 IPv6/V6 的节点，并在原配置自带 `♻️ 自动选择` 时只保留美国标记节点，否则保留美国、日本、新加坡、台湾标记节点；APNs 使用美国、日本、新加坡、香港标记节点；X/Grok 共用 AI 候选。
- 若某服务筛选后没有候选节点，该服务组会使用 `REJECT`，不会自动放宽筛选条件。

## 修改脚本时

- 新增或调整服务时，检查 `serviceDefinitions` 中的组名、测速地址、候选集、静态兜底域名和 `ruleSets` 是否一致。
- 静态域名写在 `rules`；只有上游存在合适规则文件时才添加 `ruleSets`。
- 修改 `RULE_PROVIDER_BASE_URL` 会影响所有远程规则集；修改单项 `file` 只影响该项对应的远程文件。
- 修改完成后，在目标客户端检查生成的 `rule-providers`、实际命中的规则及连接出口。

## 上游资料

- [MetaCubeX meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite)
- [Mihomo rule-provider 配置说明](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/rule-providers/index.md)
