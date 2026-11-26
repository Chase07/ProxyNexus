# GCP 落地节点基本信息与运维备忘

本文记录 ProxyNexus 所配套 GCP 落地服务器的基础环境信息、防火墙结构及端口变更速查命令，方便后续直接核对与维护，无需每次重新登录控制台查找路径。

> 安全约定：本文不包含真实公网 IP（`<GCP_PUBLIC_IP>`）、内网 IP（`<GCP_INTERNAL_IP>`）、GCP 项目 ID（`<GCP_PROJECT_ID>`）、Shadowsocks-2022 密钥（`<GCP_SS_PASSWORD>`）或任何个人账号凭据。

---

## 一、实例与服务基本信息

| 项目 | 当前值 | 说明 |
| --- | --- | --- |
| 实例名称 | `gcp-exit-node` | Compute Engine 虚拟机 |
| 可用区（Zone） | `us-west1-b` | 登录 SSH 时需指定该 zone |
| 机型 / 系统 | `e2-micro` / Debian GNU/Linux（`6.1-cloud-amd64`，`x86_64`） | — |
| 代理服务 | `shadowsocks-rust.service` | Unit 文件：`/etc/systemd/system/shadowsocks-rust.service` |
| 服务端程序 | `/usr/local/bin/ssserver` | 以 `root` 用户运行（绑定 `443` 特权端口无需额外 `CAP_NET_BIND_SERVICE`） |
| 配置文件 | `/etc/shadowsocks-rust/config.json` | 变更前建议保留 `.bak` 备份 |
| 加密算法 | `2022-blake3-aes-128-gcm` | 与 [`clash_override.js`](../clash_override.js)、[`clash_override_mobile.js`](../clash_override_mobile.js) 的 `GCP_SS_CIPHER` 一致 |
| 当前入口端口 | `443`（TCP + UDP） | 监听 `0.0.0.0:443`；原 `38443` 因部分机场限制出站 TCP 端口（如仅放行 `443`/`80` 等）已迁移 |

---

## 二、防火墙与端口状态

1. **GCP VPC 防火墙**
   - 规则名称：`allow-ss-exit`（`INGRESS`，`TARGET_TAGS: ['ss-exit']`）
   - 当前放行：`tcp:443`、`udp:443`
   - 协议说明：常规网页、API 请求与节点测速走 **TCP**；客户端开启 `udp: true` 后的 HTTP/3（QUIC）等 UDP 流量走 **UDP**，两者共用 `443` 端口互不冲突，需同时放行。
2. **虚拟机本机防火墙**
   - 未安装 `ufw`；`iptables` 默认 `INPUT` 策略为 `ACCEPT`，无本机端口拦截。
3. **本机端口占用情况**
   - `443` 端口未部署 Nginx / Caddy / Apache 等 Web 服务，由 `ssserver` 独占监听。

---

## 三、常用排查与端口变更命令

### 1. 在 GCP Cloud Shell（管理终端）操作

> 注意：打开网页端 Cloud Shell（提示符为 `...@cloudshell`）时仍在管理容器内，需通过 `gcloud compute ssh` 进入 `gcp-exit-node` 才能查看服务端口。

```bash
# 查看实例与当前状态
gcloud compute instances list

# 查看项目 VPC 防火墙规则
gcloud compute firewall-rules list --format="table(name,direction,allowed,targetTags)"

# 登录 GCP 落地虚拟机
gcloud compute ssh gcp-exit-node --zone=us-west1-b

# 更新放行端口（例如改到新端口时）
gcloud compute firewall-rules update allow-ss-exit --allow=tcp:<新端口>,udp:<新端口>
```

### 2. 在 `gcp-exit-node` 虚拟机内部操作

```bash
# 检查目标端口监听情况与占用进程（确认 TCP + UDP 均已监听）
sudo ss -tulnp | grep ':443\b'

# 检查当前配置文件端口（避免打印包含密钥的完整文件）
sudo grep -n '"server_port"' /etc/shadowsocks-rust/config.json

# 查看 / 重启服务
sudo systemctl status shadowsocks-rust --no-pager
sudo systemctl restart shadowsocks-rust
```

### 3. 修改入口端口时的联动清单

1. 先登录 `gcp-exit-node` 确认目标端口空闲，修改 `/etc/shadowsocks-rust/config.json` 中的 `"server_port"` 并重启 `shadowsocks-rust`。
2. 在 Cloud Shell 更新 `allow-ss-exit` 防火墙规则，同时放行新端口的 `tcp` 和 `udp`。
3. 在客户端脚本 [`clash_override.js`](../clash_override.js) 与 [`clash_override_mobile.js`](../clash_override_mobile.js) 中同步修改 `GCP_SS_PORT`，并在客户端重新加载脚本验证 `GCP-落地`。

---

## 四、链路使用备忘

- 两份覆写脚本中 `GCP-落地` 默认通过 `GCP_前置`（`dialer-proxy`）经机场节点中转至 GCP，避免裸 Shadowsocks-2022 长期直接过跨境链路触发端口限速或阻断；同时在实测中，国内直连 `us-west1` 可能出现偶发高延迟抖动，由低延迟亚洲节点中转通常更稳。
- 切换不同机场订阅时若 `GCP-落地` 持续超时，优先排查两处：
  1. 目标机场节点是否限制了出站端口（切换至 `443` 后通常可通用）；
  2. `GCP_前置` 默认指向 `♻️ 自动选择` 时，是否因刚切换订阅首节点尚未测完而暂时经过高延迟远距离节点。
