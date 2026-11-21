# ProxyNexus

ProxyNexus 集中维护 Clash / Mihomo 客户端使用的配置覆写脚本。当前脚本为 [`clash_override.js`](clash_override.js)，通过 `main(config)` 修改配置并返回结果。

脚本面向支持 Mihomo 配置结构、JavaScript 覆写接口和 HTTP rule-provider 的客户端。客户端及内核版本可能影响具体支持情况；导入后应在客户端检查生成的配置与规则提供者状态。

## 处理流程

脚本按顺序完成以下工作：

1. 从 `config.proxies` 读取当前配置中的静态节点，并按节点名称筛选候选集。
2. 为 ChatGPT、Gemini、Claude、Grok、X、Muse 和 GitHub 创建独立的测速组。
3. 保留机场已有的 `♻️ 自动选择` 组；缺少时才创建普通自动组，并在找到“手动选择”组时加入该组。
4. 注册服务规则集，并把服务规则放在原配置规则之前。
5. 将更新后的配置返回给客户端。

## 服务分流

| 服务组 | 候选节点 | 静态兜底域名 | 远程规则集 |
| --- | --- | --- | --- |
| `ChatGPT_Auto` | AI 候选 | `openai.com`、`chatgpt.com` | `openai.mrs` |
| `Gemini_Auto` | AI 候选 | `gemini.google.com`、`generativelanguage.googleapis.com` | `google-gemini.mrs` |
| `Claude_Auto` | AI 候选 | `claude.ai`、`anthropic.com` | `anthropic.mrs` |
| `Grok_Auto` | AI 候选 | `grok.com`、`x.ai`、`grok.x.com` | `xai.mrs` |
| `X_Auto` | 通用服务候选，允许香港 | `x.com`、`twitter.com`、`twimg.com`、`t.co` | `x.mrs`、`twitter.mrs` |
| `Muse_Auto` | AI 候选中名称标记为美国的节点 | `muse.ai` | 无 |
| `GitHub_Auto` | 通用服务候选，允许香港 | `github.com`、`githubusercontent.com` | `github.mrs` |

服务测速组使用对应网站作为测速地址。测速结果只反映探测请求的连通性、HTTP 状态和响应时间，不验证登录状态、API 可用性或账号地区资格。

## 静态规则与远程规则集

每个服务定义里的 `rules` 是脚本直接生成的静态规则。例如：

```js
rules: ["DOMAIN-SUFFIX,gemini.google.com"]
```

生成时脚本会附上目标策略组，得到 `DOMAIN-SUFFIX,gemini.google.com,Gemini_Auto`。静态规则作为核心域名的兜底，不依赖远程规则集下载成功。

`ruleSets` 指定要加载的远程文件，以及该规则集在当前配置中的名称。例如：

```js
ruleSets: [{ name: "proxynexus_gemini", file: "google-gemini.mrs" }]
```

`name` 是配置内的 provider 名称；`file` 是上游仓库里的文件名。脚本把 `RULE_PROVIDER_BASE_URL` 和 `file` 拼接为下载地址，并生成类似 `RULE-SET,proxynexus_gemini,Gemini_Auto` 的路由规则。

当前基础地址指向 MetaCubeX 的 geosite MRS 文件目录：

```text
https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite
```

例如 Gemini 规则集地址为：

```text
https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google-gemini.mrs
```

这些域名分类由 MetaCubeX 的开源规则库维护，不是相应服务厂商的官方域名清单，也不是客户端通过 DNS 自动发现的结果。脚本将 provider 设置为 `behavior: domain`、`format: mrs`，更新间隔为 `86400` 秒。下载使用配置中名称包含“手动选择”的 `select` 组；找不到该组时使用 `DIRECT`。

配置规则按以下顺序合并：

1. 嘉信域名直连规则。
2. 各服务的静态规则和远程 `RULE-SET` 引用，顺序与 `serviceDefinitions` 一致。
3. 原配置中的规则。

Grok 定义放在 X 之前，因为 `grok.x.com` 是 `x.com` 的子域，必须优先进入 `Grok_Auto`。

## 节点筛选边界

- 脚本只从 `config.proxies` 读取静态节点，不展开 `proxy-providers`。
- 地区、运营商和倍率都根据节点名称判断，不检查节点的真实出口 IP 或机场计费信息。
- 没有倍率标记的节点暂按 `1.0` 倍处理。
- 普通自动组只排除机场信息类节点；服务组还会排除纯联通、指定地区和超过 `3.0` 倍的节点。AI 组额外排除香港；Muse 再从 AI 候选中筛选美国标记。
- 若某服务筛选后没有候选节点，该服务组会使用 `REJECT`，不会自动放宽筛选条件。

## 修改脚本时

- 新增或调整服务时，检查 `serviceDefinitions` 中的组名、测速地址、候选集、静态兜底域名和 `ruleSets` 是否一致。
- 静态域名写在 `rules`；只有上游存在合适规则文件时才添加 `ruleSets`。
- 修改 `RULE_PROVIDER_BASE_URL` 会影响所有远程规则集；修改单项 `file` 只影响该项对应的远程文件。
- 修改完成后，在目标客户端检查生成的 `rule-providers`、实际命中的规则及连接出口。

## 上游资料

- [MetaCubeX meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite)
- [Mihomo rule-provider 配置说明](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/rule-providers/index.md)
