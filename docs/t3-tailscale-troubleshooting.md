# T3 Code + Tailscale + Clash/FlClash 跨机直连与排障指南

本文记录在 Windows 与 macOS 之间使用官方 Tailscale App、FlClash（Mihomo 内核）和 T3 Code 进行跨机互连时遇到的典型故障原因、系统代理绕过要点及纯本地直连配对流程。

> 注：本文仅包含通用原理与排查方法，不包含个人 Tailnet 域名、真实内网 IP 或任何账号凭据。

---

## 一、排障分层模型（从底向上）

当 T3 Code 桌面端提示远程设备“正在重新连接 / 没有响应”时，按以下 4 层逐层定位，避免把鉴权或系统代理问题误判为 Tailscale 不通：

### 1. Tailscale 隧道层
- **症状**：桌面托盘图标可能看似正常，或远程端完全无响应，但命令侧实际已停。
- **检查**：
  ```bash
  tailscale status
  tailscale ping <peer-hostname>
  tailscale serve status
  ```
- **常见情况**：
  - `tailscale status` 返回 `Tailscale is stopped.`（服务进程在跑但隧道已断开），需在托盘点击 Connect 或执行 `tailscale up`。
  - 确认目标设备在线且尽量为 `active; direct`（直连）或稳定的 DERP 中继。
  - 若使用 `https://<设备名>.<tailnet>.ts.net/`，目标机器需已通过 `tailscale serve` 将 `/` 转发到 `http://127.0.0.1:3773`。

### 2. 端口与服务监听层
- **检查**：从本机**绕过代理**直接探活目标机器：
  ```bash
  curl.exe -v --noproxy '*' http://100.x.x.x:3773/.well-known/t3/environment
  curl.exe -v --noproxy '*' https://<设备名>.<tailnet>.ts.net/.well-known/t3/environment
  ```
- 若返回 `HTTP 200` 且包含目标 `environmentId`，说明 Tailscale 隧道、端口监听与 `tailscale serve` 均正常。

### 3. 系统代理与环境变量绕过层（FlClash）
即使 [`clash_override.js`](../clash_override.js) 中配置了 `tailscaleDirectRules`（`100.64.0.0/10`、`fd7a:115c:a1e0::/48`、`DOMAIN-SUFFIX,ts.net` 均 `DIRECT`），如果系统代理层没有绕过，流量仍会**先进入 `127.0.0.1:7890`**，再由 Mihomo 吐回直连。一旦遇到 FlClash 重载、切配置、代理连接超时或 DNS/Fake-IP 异常，长连接（尤其是 WebSocket）就会超时断连。

**必须区分两套代理入口：**

1. **客户端系统代理绕过列表（Bypass / `ProxyOverride`）**
   - **一定要在 FlClash 客户端界面（设置 → 系统代理 → 绕过列表）中添加**，不要只改操作系统注册表或系统网络设置——FlClash 在重启或重新开关“系统代理”时，会用自身保存的 `bypassDomain` 覆写系统 `ProxyOverride`。
   - **Windows `ProxyOverride` 语法限制**：不支持 `100.64.0.0/10` CIDR 写法，也不建议写宽泛的 `100.*`（会误放行 `100.0.0.0/8` 公网 IP）。应添加 `*.ts.net` 以及 `100.100.100.100` 和各台 Tailscale 设备的精确 IP。
   - **macOS**：可在 FlClash 绕过列表中添加 `*.ts.net` 与 `100.64.0.0/10`（或各设备精确 IP）。

2. **环境变量代理（`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`）**
   - 若本机同时设置了 `HTTP_PROXY`、`HTTPS_PROXY` 及 `NODE_USE_ENV_PROXY=1`，Electron / Node.js 应用（含 T3 Code）和 `curl` 会优先读取它们。
   - **实测兼容性踩坑（Windows Node.js `24.16.0` + `NODE_USE_ENV_PROXY=1`）**：
     - `curl.exe` 支持 `NO_PROXY` 中的 `100.64.0.0/10` CIDR；
     - **Node.js 24 内置环境代理既不支持 `NO_PROXY` 中的 CIDR（`100.64.0.0/10`），也不支持 IP 通配符（`100.x.*`）**，只识别域名后缀（如 `.ts.net`）和**精确 IP**。
   - 因此 `NO_PROXY` 应同时包含：`.ts.net`、`100.64.0.0/10`、`fd7a:115c:a1e0::/48` 以及各设备精确 IP（修改用户环境变量后需完全重启已打开的 T3 Code 和终端才会生效）。

### 4. T3 鉴权与配对方式层（最隐蔽的断连原因）
**核心结论：如果环境条目最初是通过 T3 Connect 账号体系接入的，关掉 T3 Connect 后重连会失败。**

- **现象**：平时令牌在缓存有效期内看似正常；但只要**重启 T3 软件**或**本地令牌缓存过期**（`connection.remote_token_cache: "miss"`），客户端虽然已经测通 Tailscale 直连地址（`200 OK`），仍会执行 `exchangeDpopToken`，去请求 `relay.t3.codes` 以及对方机器的 `https://prod-*.t3coderelay.com/.well-known/t3/environment`。
- **结果**：一旦两边关闭了 T3 Connect，`*.t3coderelay.com` 隧道不可达，连接就会卡死在 `exchangeDpopToken`（日志报 `HttpClientError: Transport error`），表现为“即使 Tailscale 是通的，T3 依然连不上”。

---

## 二、彻底脱离 T3 Connect 的纯 Tailscale 直连配对步骤

若希望关闭 T3 Connect 后两边重启依然能稳定直连，必须用本地配对取代云端账号接入的旧条目（双向互连需各自配对一次）。

> 注意：切换或关闭服务时请确保当前没有正在运行的 Agent 任务，避免中断执行中的 turn。

### 1. 确保被连接端监听并可由 Tailscale 访问
- 若需通过 Tailscale HTTPS 域名（推荐）配对，目标端需正常运行 Tailscale 且支持 `tailscale serve`；若同时需要局域网端口访问，可运行：
  ```bash
  t3 up --lan
  ```
- Windows 上如 `t3` 未加入当前终端 `PATH`，使用完整路径 `C:\Users\<用户名>\.t3\bin\t3.cmd`。

### 2. 在“被连接端”生成 Tailscale 配对凭证
```bash
t3 pair --tailscale --ttl 15m
```
（也可在被连接端 T3 Code 的 **Settings → Connections** 中生成配对码/配对链接。）

### 3. 在“发起端”移除旧条目并重新配对
1. 在发起端 T3 Code 中，**先移除/忘记**之前通过 T3 Connect 账号接入的旧远程环境条目（否则旧条目仍会走云端换令牌逻辑）。
2. 通过刚生成的 `t3code://pair...` 链接（或在添加远程环境界面填入目标端 `https://<设备名>.<tailnet>.ts.net/` 或 `http://100.x.x.x:3773/` 与配对码）完成本地配对。
3. 如需反向连接（例如 Mac 连 Windows、Windows 连 Mac），对调角色重复步骤 2～3。

### 4. 关闭 T3 Connect 并重启验证
两端均确认新配对可用后，关闭两端 T3 Connect（或在 Settings 中关闭）：
```bash
t3 up --no-connect
```
随后重启两端 T3 Code，确认无需联网中继即可直接恢复在线。

---

## 三、快速日志与连接核查命令

### 检查 T3 日志中的连接报错与 RPC 状态
Windows 默认日志位于 `%USERPROFILE%\.t3\userdata\logs\server.trace.ndjson`（读取时注意过滤/脱敏任何 token 字段）：
- 关注 `ConnectionDriver.connect`、`relay.connection.attempt`、`exchangeDpopToken`：
  - 若看到 `prod-*.t3coderelay.com` 报 `Transport error`，说明连接条目仍依赖 T3 Connect 换令牌。
- 关注 `EnvironmentRpc.request`：
  - 正常连接后可看到目标 `environment.id` 持续产生 `server.reportClientActivity`、`projects.readFile` 等记录。

### 检查实际 TCP 连接去向
- **Windows**：
  ```powershell
  netstat -ano | findstr "3773 7890"
  ```
  - 通过 `t3 pair --tailscale` 连上后，可见 T3 Code 进程直接与对方 Tailscale IP 的 `443`（Tailscale Serve HTTPS）或 `3773` 建立 `ESTABLISHED` 连接，而不是全部挂在 `127.0.0.1:7890` 上。
- **验证 Windows 当前系统代理绕过与环境变量**：
  ```powershell
  [Environment]::GetEnvironmentVariable('NO_PROXY', 'User')
  (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyOverride
  $wp = [System.Net.WebRequest]::GetSystemWebProxy()
  $wp.IsBypassed([Uri]'https://<设备名>.<tailnet>.ts.net/')
  ```
