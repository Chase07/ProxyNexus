/**
 * ============================================================
 * Clash for macOS（Hako）/ Clash Verge Rev / ProjectClash / FlClash 通用扩展脚本
 * ============================================================
 *
 *【当前两家机场的不同处理方式】
 *
 * 云：
 * 没有“♻️ 自动选择”组。
 * 自动创建该组，并包含全部静态代理节点。
 * 同时将其加入“🔰 手动选择”作为第一个选项。
 *
 * PAOLUZ：
 * 已经自带“♻️ 自动选择”组。
 * 直接保留机场原有的测速组及候选节点。
 * 不重复创建；仅将已知明文 http:// 测速地址（如 gstatic/cloudflare generate_204）升级为 https://。
 *
 *【服务专用代理组】
 *
 * ChatGPT/OpenAI、Claude：
 * 各自使用对应网站测速和服务规则集。
 * 排除香港、纯联通、指定地区、高倍率节点。
 * 测速只检查探测网址的 HTTP 状态和延迟，
 * 不验证登录态、API 可用性或账号地区资格。
 *
 * Google（含 Gemini / Antigravity）与 YouTube：
 * YouTube 单独使用 YouTube_Auto（youtube.mrs + 静态核心视频域名），避免视频流量占用 GCP 落地。
 * 未启用 GCP-落地 时，Google 与 Gemini 共用 Google_Auto；原配置自带“♻️ 自动选择”（PAOLUZ）时候选限定美国，
 * 否则（云）限定美国、日本、新加坡、台湾，并均排除名称标记为 IPv6/V6 的节点。
 * 启用 GCP-落地（顶部填入 GCP_SS_SERVER 与 GCP_SS_PASSWORD）后，将注入 Shadowsocks-2022 节点 GCP-落地
 * （通过 dialer-proxy 经独立 GCP_前置 select 组中转），并创建 AI_GCP_Exit 组接管 OpenAI/ChatGPT、
 * Anthropic/Claude、Gemini/Antigravity 及 Google 搜索/账号核心域名；其余 google.mrs 流量仍走 Google_Auto。
 *
 *【留空模板约定】
 *
 * GCP_SS_SERVER 与 GCP_SS_PASSWORD 默认留空，公开脚本不含真实服务器 IP 或密钥。
 * 任一留空时不生成 GCP-落地 节点，所有 AI 规则自动回退原服务测速组。
 *
 * X 与 Grok：
 * 共用 SpaceX_Auto，使用 X 网站测速并合并两类域名规则。
 *
 * Meta 旗下产品与 Muse：
 * Meta AI、Facebook、Instagram、Threads、WhatsApp、Messenger、Oculus/Quest
 * 使用 MetaCubeX 对应远程域名集，并与 Muse 共用美国和新加坡节点组 Meta_Auto。
 * meta.ai 和 muse.ai 保留静态后缀规则。
 *
 * GitHub：
 * 单独测速。
 * 允许香港，其他筛选条件不变。
 *
 *【兼容范围】
 *
 * Clash for macOS（Hako 客户端）：macOS
 * Clash Verge Rev：Windows / macOS
 * ProjectClash：macOS
 * FlClash：Android / macOS
 *
 * 只处理当前订阅 config.proxies 中的静态节点。
 * 不会把不同机场的节点合并成一个订阅。
 *
 * ============================================================
 */

function main(config) {
  // ==========================================================
  // 第一层：常用参数
  // ==========================================================

  // 服务专用组最高允许的流量倍率。
  // 例如 [2.5] 可以进入，[4.0] 不可以。
  // 此限制不作用于普通“♻️ 自动选择”。
  const MAX_MULTIPLIER = 3.0;

  // 没有倍率标签时暂按 1 倍处理。
  // 不代表机场真实的计费倍率。
  const DEFAULT_MULTIPLIER = 1.0;

  // 服务专用组每 5 分钟测速一次。
  const SERVICE_TEST_INTERVAL = 300;

  // 云的普通自动组：每 15 分钟测速一次。
  // 用较长周期减少手机与电脑上的测速开销。
  const NORMAL_TEST_INTERVAL = 900;

  // 自动测速切换容差，单位毫秒。
  // 适当放宽以减少网页浏览与 AI 使用时的频繁切节点。
  const TEST_TOLERANCE = 200;

  // 单次测速超时，单位毫秒。
  const TEST_TIMEOUT = 5000;

  // 服务网站测速认可的 HTTP 状态码。
  const SERVICE_STATUS = "200/301/302";

  // 服务域名规则集使用 Mihomo MRS 格式，每天更新一次。
  const RULE_PROVIDER_BASE_URL =
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite";
  const RULE_PROVIDER_INTERVAL = 86400;

  // GCP Shadowsocks-2022 落地节点（默认留空模板；填入服务器 IP 与密码后自动启用）。
  // 公开仓库切勿写入真实服务器 IP 或密钥。
  const GCP_PROXY_NAME = "GCP-落地";
  const GCP_RELAY_GROUP_NAME = "GCP_前置";
  const AI_GCP_GROUP_NAME = "AI_GCP_Exit";
  const GCP_SS_SERVER = "";
  const GCP_SS_PORT = 38443;
  const GCP_SS_CIPHER = "2022-blake3-aes-128-gcm";
  const GCP_SS_PASSWORD = "";
  // 留空时自动创建独立的 GCP_前置 select 组（含 ♻️ 自动选择 与机场节点）；
  // 也可改为已有代理组或节点名作为 dialer-proxy。
  const GCP_DIALER_PROXY = "";

  // ==========================================================
  // 第二层：筛选正则表达式
  // ==========================================================
  //
  // 本层用于 AI / Google / X-Grok / Meta / GitHub 服务专用组。
  //
  // 普通自动选择组不经过这些筛选，
  // 因为它的目的是提供完整的节点自动选择功能。

  // 2.1 香港节点识别
  //
  // AI 组排除香港。
  // GitHub 允许香港。
  //
  // 只根据节点名称判断，不检测真实出口 IP。
  const HK = /香港|港岛|九龙|🇭🇰|Hong[\s_-]*Kong|\bHK\d*\b|\bHKG\b/i;

  // 2.2 指定地区排除
  //
  // 排除不打算用于服务专用组测速的地区。
  //
  // 日本、台湾、新加坡、美国、韩国、
  // 马来西亚、德国等不在这个黑名单中。
  //
  // 德国 GIA、美国 GIA 等线路可以保留。
  //
  // 英文全称使用单词边界，避免把城市名和两字母缩写误判为国家。
  // 要恢复一个地区，只需从正则里移除它。

  const REMOTE_REGION =
    /印度|\bindia\b|法国|\bfrance\b|澳大利亚|澳洲|\baustralia\b|英国|\bunited[\s_-]*kingdom\b|\bgreat[\s_-]*britain\b|\bengland\b|加拿大|\bcanada\b|荷兰|\bnetherlands\b|\bholland\b|印尼|印度尼西亚|\bindonesia\b|乌克兰|\bukraine\b|以色列|\bisrael\b|爱尔兰|\bireland\b|俄罗斯|\brussia\b|阿根廷|\bargentina\b|南非|\bsouth[\s_-]*africa\b|尼日利亚|\bnigeria\b|土耳其|\bturkey\b|\btürkiye\b|🇮🇳|🇫🇷|🇦🇺|🇬🇧|🇨🇦|🇳🇱|🇮🇩|🇺🇦|🇮🇱|🇮🇪|🇷🇺|🇦🇷|🇿🇦|🇳🇬|🇹🇷/i;

  // 2.3 机场信息类节点
  //
  // 例如剩余流量、到期提醒、官网说明等。
  //
  // 不让这些名称进入服务自动测速组。

  const INFO = /剩余|到期|套餐|流量|官网|客服|订阅信息|续费|重置|机上\s*Wi[-]?Fi|免认证/i;

  // 2.4 纯联通线路
  //
  // 联通优化 → 排除
  // 电信+联通优化 → 保留
  // 移动联通优化 → 保留
  // 三网优化 → 保留
  //
  // 只排除名称明确显示的纯联通线路。

  function isUnicomOnly(name) {
    return /联通/.test(name) && !/移动|电信|三网/.test(name);
  }

  // 2.5 美国节点识别
  //
  // Meta AI、Muse 组使用美国和新加坡；Google 组按是否自带“♻️ 自动选择”筛选美国或美/日/新/台。
  //
  // 只根据节点名称判断，不检测真实出口 IP。
  //
  // 例如：
  // 美国 A01 → 命中
  // 🇺🇸 美国 → 命中
  // United States 01 → 命中
  // USA01 / US01 → 命中

  const US = /美国|🇺🇸|United[\s_-]*States|\bUSA\d*\b|\bUS\d*\b/i;
  const IPV6_NODE = /IPv6|(?:^|[^A-Za-z0-9])V6(?:$|[^A-Za-z0-9])/i;
  const JAPAN = /日本|🇯🇵|Japan|\bJP\d*\b|\bJPN\b|东京|大阪|Tokyo|Osaka|Nagoya|Yokohama|Sapporo/i;
  const SINGAPORE = /新加坡|🇸🇬|Singapore|\bSG\d*\b|\bSIN\d*\b/i;
  const TAIWAN = /台湾|臺灣|🇹🇼|Taiwan|\bTW\d*\b|\bTWN\b|台北|高雄|Taipei|Kaohsiung/i;

  // ==========================================================
  // 第三层：读取节点倍率
  // ==========================================================

  /**
   * 从名称解析倍率。
   *
   * 示例：
   *
   * [0.5] -> 0.5
   * [2.5] -> 2.5
   * [5x] -> 5
   * [10.0] -> 10
   * (2x) -> 2
   * 倍率2.5 -> 2.5
   *
   * 没有倍率标签时返回 DEFAULT_MULTIPLIER。
   *
   * 这个函数不会向机场查询真实计费规则。
   */

  function getMultiplier(name) {
    const patterns = [
      // [2.5]、[5x]、(2x)
      /[\[【(（]\s*(\d+(?:\.\d+)?)\s*(?:[xX×]|倍)?\s*[\]】)）]/,

      // 倍率2.5、rate: 2.5
      /(?:倍率|rate)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,

      // 2倍、0.5x
      /(?:^|[\s_-])(\d+(?:\.\d+)?)\s*(?:倍|[xX×])(?=$|[\s_-])/i
    ];

    for (const pattern of patterns) {
      const found = name.match(pattern);

      if (found) {
        const value = Number(found[1]);
        if (Number.isFinite(value)) {
          return value;
        }
      }
    }

    return DEFAULT_MULTIPLIER;
  }

  // ==========================================================
  // 第四层：读取并筛选当前订阅节点
  // ==========================================================

  // 4.1 获取普通自动选择组的候选节点
  //
  // 保留所有正常节点：
  // - 不限制地区（香港也允许）
  // - 不限制运营商（联通也允许）
  // - 不限制流量倍率
  //
  // 仅排除机场信息类、官网入口等特殊节点。
  //
  // 例如：
  // 1 官网 tcp.bet → 排除
  // 剩余流量 100GB → 排除
  // 套餐到期提醒 → 排除
  // 日本 A01 移动优化 → 保留
  // 香港 A02 联通优化 → 保留

  const rawNodes = Array.isArray(config.proxies) ? config.proxies : [];

  const allNames = [
    ...new Set(
      rawNodes
        .filter(
          (node) =>
            node &&
            typeof node.name === "string" &&
            node.name !== GCP_PROXY_NAME &&
            !INFO.test(node.name)
        )
        .map((node) => node.name)
    )
  ];

  // 4.2 GitHub 和 X 的候选节点基线。
  //
  // 排除：
  // 指定地区
  // 纯联通
  // 机场信息
  // 超过 3 倍
  //
  // 但允许香港。

  const generalServiceNames = allNames.filter(
    (name) =>
      !INFO.test(name) &&
      !isUnicomOnly(name) &&
      !REMOTE_REGION.test(name) &&
      getMultiplier(name) <= MAX_MULTIPLIER
  );

  // 4.3 AI 专用节点。
  //
  // 在通用服务候选基础上进一步排除香港。
  //
  // ChatGPT、Claude 和 X/Grok 使用同一份基础候选列表，
  // 但测速网址彼此不同。

  const aiNames = generalServiceNames.filter((name) => !HK.test(name));

  // APNs 自动组只用名称标记为美国、日本、新加坡、香港的节点。
  const apnsNames = generalServiceNames.filter(
    (name) => US.test(name) || JAPAN.test(name) || SINGAPORE.test(name) || HK.test(name)
  );

  // 4.4 识别原配置是否已自带普通自动选择组，并筛选 Meta AI / Muse 与 Google 候选节点。
  //
  // 仅依据原配置 proxy-groups 是否存在同名“♻️ 自动选择”组做区分，不读取外部订阅来源。
  const AUTO_NAME = "♻️ 自动选择";
  const oldGroups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  const existingAuto = oldGroups.find((group) => group && group.name === AUTO_NAME);

  // Meta AI / Muse 只保留美国和新加坡节点。
  const metaNames = aiNames.filter((name) => US.test(name) || SINGAPORE.test(name));

  // Google 组不使用名称明确标记为 IPv6 / V6 的节点。
  // 这里只能识别节点名称标签，无法判断未标注节点的真实出口协议。
  // 原配置自带“♻️ 自动选择”（PAOLUZ）时仅保留美国，否则（云）保留美国、日本、新加坡、台湾。
  const googleNames = aiNames.filter(
    (name) =>
      !IPV6_NODE.test(name) &&
      (existingAuto
        ? US.test(name)
        : US.test(name) || JAPAN.test(name) || SINGAPORE.test(name) || TAIWAN.test(name))
  );

  // ==========================================================
  // 第五层：创建服务自动测速组
  // ==========================================================

  /**
   * makeTestGroup()
   *
   * name：
   * 代理组名称。
   *
   * url：
   * 测速目标网址。
   *
   * names：
   * 经过筛选的候选节点数组。
   *
   * expectedStatus：
   * 认可的 HTTP 响应状态码。
   *
   * interval：
   * 测速周期。
   *
   * 当没有合格节点时，创建 REJECT 组。
   * 不会自动放宽筛选条件。
   */

  function makeTestGroup(name, url, names, expectedStatus, interval) {
    if (names.length === 0) {
      return {
        name,
        type: "select",
        proxies: ["REJECT"]
      };
    }

    return {
      name,

      type: "url-test",

      proxies: names,

      url,

      interval,

      tolerance: TEST_TOLERANCE,

      timeout: TEST_TIMEOUT,

      "expected-status": expectedStatus,

      // 不活跃时允许跳过周期测速。
      lazy: true
    };
  }

  const gcpServer = typeof GCP_SS_SERVER === "string" ? GCP_SS_SERVER.trim() : "";
  const gcpPassword = typeof GCP_SS_PASSWORD === "string" ? GCP_SS_PASSWORD.trim() : "";
  const gcpCipher =
    typeof GCP_SS_CIPHER === "string" && GCP_SS_CIPHER.trim() !== ""
      ? GCP_SS_CIPHER.trim()
      : "2022-blake3-aes-128-gcm";
  const gcpPortNum = Number(GCP_SS_PORT);
  const gcpPort =
    Number.isInteger(gcpPortNum) && gcpPortNum > 0 && gcpPortNum <= 65535 ? gcpPortNum : 38443;
  const gcpCustomDialer = typeof GCP_DIALER_PROXY === "string" ? GCP_DIALER_PROXY.trim() : "";
  const hasGcpExit = gcpServer !== "" && gcpPassword !== "";
  const aiGcpTarget = hasGcpExit ? AI_GCP_GROUP_NAME : null;

  // 每项把策略组、测速目标、候选节点、规则集和静态兜底放在一起，
  // 避免新增服务时只加了分组或分流规则中的一部分。
  // YouTube_Auto 置于 AI 与 Google 规则之前，防止视频流量落入 GCP 落地。

  const serviceDefinitions = [
    {
      name: "APNs_Auto",
      url: "https://captive.apple.com/hotspot-detect.html",
      candidates: apnsNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: [
        "DOMAIN-SUFFIX,push.apple.com",
        "DOMAIN-SUFFIX,push.apple.com.cn",
        "DOMAIN-SUFFIX,akadns.net",
        "DOMAIN-KEYWORD,apple.com.edgekey.net",
        "IP-CIDR,17.249.0.0/16,no-resolve",
        "IP-CIDR,17.252.0.0/16,no-resolve",
        "IP-CIDR,17.57.144.0/22,no-resolve",
        "IP-CIDR,17.188.128.0/18,no-resolve",
        "IP-CIDR,17.188.20.0/23,no-resolve",
        "IP-CIDR6,2620:149:a44::/48,no-resolve",
        "IP-CIDR6,2403:300:a42::/48,no-resolve",
        "IP-CIDR6,2403:300:a51::/48,no-resolve",
        "IP-CIDR6,2a01:b740:a42::/48,no-resolve"
      ]
    },

    {
      name: "YouTube_Auto",
      url: "https://www.youtube.com/",
      candidates: generalServiceNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: [
        "DOMAIN-SUFFIX,youtube.com",
        "DOMAIN-SUFFIX,googlevideo.com",
        "DOMAIN-SUFFIX,ytimg.com",
        "DOMAIN-SUFFIX,youtu.be"
      ],
      ruleSets: [{ name: "proxynexus_youtube", file: "youtube.mrs" }]
    },

    {
      name: "ChatGPT_Auto",
      target: aiGcpTarget,
      url: "https://chatgpt.com/",
      candidates: aiNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: [
        "DOMAIN-SUFFIX,openai.com",
        "DOMAIN-SUFFIX,chatgpt.com",
        "DOMAIN-SUFFIX,oaistatic.com",
        "DOMAIN-SUFFIX,oaiusercontent.com"
      ],
      ruleSets: [{ name: "proxynexus_openai", file: "openai.mrs" }]
    },

    {
      name: "Google_Auto",
      url: "https://www.google.com/",
      candidates: googleNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      priorityTarget: aiGcpTarget,
      priorityRules: [
        "DOMAIN-SUFFIX,gemini.google.com",
        "DOMAIN-SUFFIX,aistudio.google.com",
        "DOMAIN-SUFFIX,makersuite.googleapis.com",
        "DOMAIN-SUFFIX,bard.google.com",
        "DOMAIN-SUFFIX,deepmind.google",
        "DOMAIN-SUFFIX,antigravity.google",
        "DOMAIN-SUFFIX,antigravity.google.com",
        "DOMAIN-SUFFIX,antigravity-unleash.goog",
        "DOMAIN-SUFFIX,generativelanguage.googleapis.com",
        "DOMAIN-SUFFIX,cloudcode-pa.googleapis.com",
        "DOMAIN-SUFFIX,daily-cloudcode-pa.googleapis.com",
        "DOMAIN-SUFFIX,aicode.googleapis.com",
        "DOMAIN-SUFFIX,businessaicode.googleapis.com",
        "DOMAIN-SUFFIX,cloudaicompanion.googleapis.com",
        "DOMAIN,oauth2.googleapis.com",
        "DOMAIN,www.google.com",
        "DOMAIN,google.com",
        "DOMAIN,www.google.com.hk",
        "DOMAIN,google.com.hk",
        "DOMAIN-SUFFIX,accounts.google.com",
        "DOMAIN-SUFFIX,consent.google.com"
      ],
      priorityRuleSets: [{ name: "proxynexus_gemini", file: "google-gemini.mrs" }],
      rules: ["DOMAIN-SUFFIX,google.com", "DOMAIN-SUFFIX,google.com.hk"],
      ruleSets: [{ name: "proxynexus_google", file: "google.mrs" }]
    },

    {
      name: "Claude_Auto",
      target: aiGcpTarget,
      url: "https://claude.ai/",
      candidates: aiNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: ["DOMAIN-SUFFIX,claude.ai", "DOMAIN-SUFFIX,anthropic.com"],
      ruleSets: [{ name: "proxynexus_anthropic", file: "anthropic.mrs" }]
    },

    {
      name: "SpaceX_Auto",
      url: "https://x.com/",
      candidates: aiNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: [
        "DOMAIN-SUFFIX,grok.com",
        "DOMAIN-SUFFIX,x.ai",
        "DOMAIN-SUFFIX,grok.x.com",
        "DOMAIN-SUFFIX,x.com",
        "DOMAIN-SUFFIX,twitter.com",
        "DOMAIN-SUFFIX,twimg.com",
        "DOMAIN-SUFFIX,t.co"
      ],
      ruleSets: [
        { name: "proxynexus_xai", file: "xai.mrs" },
        { name: "proxynexus_x", file: "x.mrs" },
        { name: "proxynexus_twitter", file: "twitter.mrs" }
      ]
    },

    {
      name: "Meta_Auto",
      url: "https://meta.ai/",
      candidates: metaNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: ["DOMAIN-SUFFIX,meta.ai", "DOMAIN-SUFFIX,muse.ai"],
      ruleSets: [
        { name: "proxynexus_meta_facebook", file: "facebook.mrs" },
        { name: "proxynexus_meta_instagram", file: "instagram.mrs" },
        { name: "proxynexus_meta_threads", file: "threads.mrs" },
        { name: "proxynexus_meta_whatsapp", file: "whatsapp.mrs" },
        { name: "proxynexus_meta_messenger", file: "messenger.mrs" },
        { name: "proxynexus_meta", file: "meta.mrs" },
        { name: "proxynexus_meta_oculus", file: "oculus.mrs" }
      ]
    },

    {
      name: "GitHub_Auto",
      url: "https://github.com/",
      candidates: generalServiceNames,
      expectedStatus: SERVICE_STATUS,
      interval: SERVICE_TEST_INTERVAL,
      rules: ["DOMAIN-SUFFIX,github.com", "DOMAIN-SUFFIX,githubusercontent.com"],
      ruleSets: [{ name: "proxynexus_github", file: "github.mrs" }]
    }
  ];

  const dedicatedGroups = serviceDefinitions.map((service) =>
    makeTestGroup(
      service.name,
      service.url,
      service.candidates,
      service.expectedStatus,
      service.interval
    )
  );

  // ==========================================================
  // 第六层：处理普通“♻️ 自动选择”
  // ==========================================================
  //
  // 这是本次针对“云”订阅优化的重点。
  //
  // 云：
  // 没有自动选择 → 创建一个。
  //
  // PAOLUZ：
  // 已经有自动选择 → 保留原版。
  //
  // 不根据机场名字硬编码判断，
  // 而是检查当前配置中是否已经存在自动组。

  // 6.1 获取机场原有的代理组。
  // 删除与我们专用组同名的旧定义，
  // 避免重复创建。

  // 清理已合并组的旧名称，避免反复覆写时残留重复组。
  const retiredGroupNames = ["Gemini_Auto", "Grok_Auto", "X_Auto", "Muse_Auto", "X_Grok_Auto"];

  const dedicatedNames = new Set([
    ...dedicatedGroups.map((group) => group.name),
    ...retiredGroupNames,
    AI_GCP_GROUP_NAME,
    GCP_RELAY_GROUP_NAME
  ]);

  const keptGroups = oldGroups.filter((group) => group && !dedicatedNames.has(group.name));

  // 6.2 复用第四层检查结果 existingAuto，避免重复扫描原策略组。
  // AUTO_NAME 不在 dedicatedNames 中，因此 keptGroups 中会保留它。
  // 若原配置测速地址使用已知明文 HTTP generate_204，则自动升级为 HTTPS。

  const PLAINTEXT_TEST_URL =
    /^http:\/\/((?:www\.)?gstatic\.com\/generate_204|cp\.cloudflare\.com\/generate_204)(?:[?#].*)?$/i;

  /**
   * 将已知明文 HTTP generate_204 测速地址升级为 HTTPS，
   * 避免 Mihomo 开启统一延迟（连续两次 HEAD 请求）时因明文测速异常报错弹窗。
   */
  function upgradePlaintextTestUrl(url) {
    if (typeof url !== "string") {
      return url;
    }

    const trimmed = url.trim();
    if (PLAINTEXT_TEST_URL.test(trimmed)) {
      return trimmed.replace(/^http:\/\//i, "https://");
    }

    return url;
  }

  keptGroups.forEach((group) => {
    if (typeof group.url === "string") {
      group.url = upgradePlaintextTestUrl(group.url);
    }
  });

  if (
    config["proxy-providers"] &&
    typeof config["proxy-providers"] === "object" &&
    !Array.isArray(config["proxy-providers"])
  ) {
    Object.values(config["proxy-providers"]).forEach((provider) => {
      if (
        provider &&
        typeof provider === "object" &&
        !Array.isArray(provider) &&
        provider["health-check"] &&
        typeof provider["health-check"] === "object" &&
        !Array.isArray(provider["health-check"]) &&
        typeof provider["health-check"].url === "string"
      ) {
        provider["health-check"].url = upgradePlaintextTestUrl(provider["health-check"].url);
      }
    });
  }

  const addedGroups = [];

  if (!existingAuto) {
    // 当前机场没有“♻️ 自动选择”。
    //
    // 为云订阅建立一个真正的自动测速组。
    //
    // 使用全部静态节点：
    // 不限制地区
    // 不排除香港
    // 不排除纯联通
    // 不限制倍率
    //
    // 使用 1800 秒周期与 lazy 模式，
    // 尽量降低后台测速频率。

    addedGroups.push(
      makeTestGroup(
        AUTO_NAME,
        "https://www.gstatic.com/generate_204",
        allNames,
        "204",
        NORMAL_TEST_INTERVAL
      )
    );
  }

  // 如果已经存在“♻️ 自动选择”，
  // 则不重新创建，保留其原有节点名单与测速周期等参数（仅将已知明文 http:// 测速地址升级为 https://）。

  // ==========================================================
  // 第七层：合并所有代理组
  // ==========================================================
  //
  // 最终顺序：
  //
  // ① 启用 GCP-落地 时的 AI_GCP_Exit 与 GCP_前置 组
  // ② 各服务专用组
  // ③ 原机场的所有其他代理组
  // ④ 仅在缺失时新增的普通自动组
  //
  // 云新建的自动组排在底部，
  // 但可以从“手动选择”内部直接选到它。

  const manualGroup = keptGroups.find(
    (group) =>
      group.type === "select" && typeof group.name === "string" && group.name.includes("手动选择")
  );

  // 规则集下载优先走“手动选择”；若订阅无同名组（例如 PAOLUZ 主组为“🦊 PAOLUZ”），
  // 则回退到原配置首个可用的代理 select 组，避免退回 DIRECT 导致直连 GitHub 拉取失败。
  // 不直接把 url-test 组作为规则集下载代理；Mihomo 曾报告该用法会拉取失败。
  const allNameSet = new Set(allNames);
  const NON_PROXY_SELECT =
    /广告|拦截|屏蔽|拒|阻断|直连|绕过|国内|白名单|黑名单|Block|Reject|Direct|AdBlock|Hijacking/i;
  const BUILTIN_NON_PROXY_TARGETS = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS"]);

  function isUsableProxySelectGroup(group) {
    return (
      group &&
      group.type === "select" &&
      typeof group.name === "string" &&
      group.name.trim() !== "" &&
      !NON_PROXY_SELECT.test(group.name) &&
      Array.isArray(group.proxies) &&
      group.proxies.length > 0 &&
      !BUILTIN_NON_PROXY_TARGETS.has(group.proxies[0])
    );
  }

  const ruleProviderProxyGroup =
    manualGroup ||
    keptGroups.find(
      (group) =>
        isUsableProxySelectGroup(group) &&
        group.proxies.some((item) => item === AUTO_NAME || allNameSet.has(item))
    ) ||
    keptGroups.find((group) => isUsableProxySelectGroup(group));

  const RULE_PROVIDER_PROXY = ruleProviderProxyGroup ? ruleProviderProxyGroup.name : "DIRECT";

  if (manualGroup && !existingAuto) {
    const choices = Array.isArray(manualGroup.proxies) ? manualGroup.proxies : [];

    manualGroup.proxies = [AUTO_NAME, ...choices.filter((name) => name !== AUTO_NAME)];
  }

  const gcpGroups = [];
  if (hasGcpExit) {
    const gcpDialerProxy = gcpCustomDialer !== "" ? gcpCustomDialer : GCP_RELAY_GROUP_NAME;
    const hasGcpProxy = rawNodes.some((node) => node && node.name === GCP_PROXY_NAME);

    if (!hasGcpProxy) {
      config.proxies = [
        ...rawNodes,
        {
          name: GCP_PROXY_NAME,
          type: "ss",
          server: gcpServer,
          port: gcpPort,
          cipher: gcpCipher,
          password: gcpPassword,
          udp: true,
          "dialer-proxy": gcpDialerProxy
        }
      ];
    }

    gcpGroups.push({
      name: AI_GCP_GROUP_NAME,
      type: "select",
      proxies: [GCP_PROXY_NAME, "Google_Auto", "ChatGPT_Auto", "Claude_Auto"]
    });

    if (gcpCustomDialer === "") {
      const relayChoices = [
        ...(allNames.length === 0 && ruleProviderProxyGroup ? [ruleProviderProxyGroup.name] : []),
        AUTO_NAME,
        ...allNames.filter((name) => name !== AUTO_NAME && name !== GCP_PROXY_NAME)
      ];
      gcpGroups.push({
        name: GCP_RELAY_GROUP_NAME,
        type: "select",
        proxies: [...new Set(relayChoices)]
      });
    }
  }

  config["proxy-groups"] = [...gcpGroups, ...dedicatedGroups, ...keptGroups, ...addedGroups];

  // ==========================================================
  // 第八层：服务域名分流
  // ==========================================================
  //
  // 专用规则放在机场原有规则前面，
  // 优先命中我们自己创建的自动组。
  //
  // Google 与 Gemini、X 与 Grok 共用各自的策略组，
  // 远程规则集和静态兜底规则都指向同一组。
  //
  // 主要服务的扩展域名由 MetaCubeX MRS 规则集维护，
  // 优先经“手动选择”或原配置首个可用代理 select 组下载；每天检查更新。
  // 少量核心域名保留静态兜底，规则集暂时不可用时仍可路由。
  // 最终仍应检查客户端生成的有效配置和连接记录。

  const existingRuleProviders = config["rule-providers"];
  const addedRuleProviders = {};

  const serviceRules = [];

  function appendServiceRule(rule, targetGroup) {
    const ruleParts = rule.split(",");
    serviceRules.push(
      [ruleParts[0], ruleParts[1], targetGroup, ...ruleParts.slice(2)].join(",")
    );
  }

  function appendServiceRuleSet(ruleSet, targetGroup) {
    addedRuleProviders[ruleSet.name] = {
      type: "http",
      behavior: "domain",
      format: "mrs",
      url: RULE_PROVIDER_BASE_URL + "/" + ruleSet.file,
      interval: RULE_PROVIDER_INTERVAL,
      proxy: RULE_PROVIDER_PROXY
    };

    serviceRules.push("RULE-SET," + ruleSet.name + "," + targetGroup);
  }

  serviceDefinitions.forEach((service) => {
    const priorityTarget = service.priorityTarget || service.name;
    const defaultTarget = service.target || service.name;

    (service.priorityRules || []).forEach((rule) => appendServiceRule(rule, priorityTarget));
    (service.priorityRuleSets || []).forEach((ruleSet) =>
      appendServiceRuleSet(ruleSet, priorityTarget)
    );
    (service.rules || []).forEach((rule) => appendServiceRule(rule, defaultTarget));
    (service.ruleSets || []).forEach((ruleSet) => appendServiceRuleSet(ruleSet, defaultTarget));
  });

  config["rule-providers"] = {
    ...(existingRuleProviders && typeof existingRuleProviders === "object"
      ? existingRuleProviders
      : {}),
    ...addedRuleProviders
  };

  // ==========================================================
  // 8.1 嘉信理财 Schwab：强制直连
  // ==========================================================
  //
  // 嘉信网站不走代理。
  // DIRECT 规则必须放在其他分流规则之前。
  //
  // DOMAIN-SUFFIX 同时匹配主域名及其子域名。
  //
  // 例如：
  // www.schwab.com → DIRECT
  // client.schwab.com → DIRECT
  // schwab.com.hk → DIRECT

  const schwabDirectRules = [
    "DOMAIN-SUFFIX,schwab.com,DIRECT",
    "DOMAIN-SUFFIX,schwab.com.cn,DIRECT",
    "DOMAIN-SUFFIX,schwab.com.hk,DIRECT",
    "DOMAIN-SUFFIX,schwab.co.uk,DIRECT"
  ];

  // ==========================================================
  // 8.2 Tailscale：强制直连（兼顾 TUN 模式）
  // ==========================================================
  //
  // 避免开启代理客户端 TUN 模式时劫持 Tailscale 隧道流量、
  // MagicDNS 或后台打洞包。

  const tailscaleDirectRules = [
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "IP-CIDR6,fd7a:115c:a1e0::/48,DIRECT,no-resolve",
    "DOMAIN-SUFFIX,ts.net,DIRECT",
    "PROCESS-NAME,io.tailscale.ipn.macsys.network-extension,DIRECT",
    "PROCESS-NAME,IPNExtension,DIRECT",
    "PROCESS-NAME,Tailscale,DIRECT",
    "PROCESS-NAME,tailscaled,DIRECT"
  ];

  const tailscaleExcludeCidrs = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"];

  if (config.tun && typeof config.tun === "object" && !Array.isArray(config.tun)) {
    const existingExcludes = Array.isArray(config.tun["route-exclude-address"])
      ? config.tun["route-exclude-address"]
      : [];

    config.tun["route-exclude-address"] = [
      ...new Set([...existingExcludes, ...tailscaleExcludeCidrs])
    ];
  }

  if (
    config.dns &&
    typeof config.dns === "object" &&
    !Array.isArray(config.dns) &&
    (!config.dns["fake-ip-filter-mode"] || config.dns["fake-ip-filter-mode"] === "blacklist")
  ) {
    const existingFakeIpFilters = Array.isArray(config.dns["fake-ip-filter"])
      ? config.dns["fake-ip-filter"]
      : [];

    config.dns["fake-ip-filter"] = [...new Set([...existingFakeIpFilters, "+.ts.net"])];
  }

  // ==========================================================
  // 8.3 默认开启域名嗅探（Sniffer）
  // ==========================================================
  //
  // 仅在原配置未启用 sniffer 时补齐默认配置，
  // 防止 TUN 模式下未携带域名的纯 IP 连接绕过域名规则。

  const existingSniffer =
    config.sniffer && typeof config.sniffer === "object" && !Array.isArray(config.sniffer)
      ? config.sniffer
      : null;

  if (!existingSniffer || existingSniffer.enable !== true) {
    config.sniffer = {
      enable: true,
      "force-dns-mapping": true,
      "parse-pure-ip": true,
      "override-destination": true,
      sniff: {
        HTTP: {
          ports: ["80", "8080-8880"],
          "override-destination": true
        },
        TLS: {
          ports: ["443", "8443"]
        },
        QUIC: {
          ports: ["443", "8443"]
        }
      },
      "skip-domain": ["Mijia Cloud", "+.push.apple.com"]
    };
  }

  // ==========================================================
  // 8.4 合并最终分流规则
  // ==========================================================
  //
  // 优先级：
  //
  // ① 嘉信与 Tailscale 直连规则
  // ② APNs / YouTube / ChatGPT / Google（含 Gemini 与 Antigravity） / Claude / X（含 Grok） / Meta（含 Muse） / GitHub
  // ③ 机场原有规则
  //
  // Mihomo 从上到下依次匹配规则。
  // 嘉信域名与 Tailscale 流量优先 DIRECT。

  const originalRules = Array.isArray(config.rules) ? config.rules : [];

  config.rules = [
    ...new Set([...schwabDirectRules, ...tailscaleDirectRules, ...serviceRules, ...originalRules])
  ];

  // ==========================================================
  // 第九层：返回最终配置
  // ==========================================================

  return config;
}
