/**
* ============================================================
* Clash Verge Rev / FlClash 通用扩展脚本
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
* 不重复创建，也不覆盖它的设置。
*
*【AI 专用代理组】
*
* ChatGPT、Gemini、Claude、Grok：
* 各自使用对应网站测速。
* 排除香港、纯联通、指定地区、高倍率节点。
*
* Muse：
* 只用新加坡节点，单独测速 muse.ai。
* 在 AI 候选的基础上再过滤出新加坡。
* 账号是用新加坡住宅地址注册的，固定走新加坡。
*
* GitHub：
* 单独测速。
* 允许香港，其他筛选条件不变。
*
*【兼容范围】
*
* Clash Verge Rev：Windows / macOS
* FlClash：Android
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

// AI、GitHub 专用组最高允许的流量倍率。
// 例如 [2.5] 可以进入，[4.0] 不可以。
//
// 此限制不作用于普通“♻️ 自动选择”。

const MAX_MULTIPLIER = 3.0;

// 没有倍率标签时暂按 1 倍处理。
// 不代表机场真实的计费倍率。

const DEFAULT_MULTIPLIER = 1.0;

// AI / GitHub：每 10 分钟测速一次。
const AI_TEST_INTERVAL = 600;

// 云的普通自动组：每 30 分钟测速一次。
// 用较长周期减少手机与电脑上的测速开销。

const NORMAL_TEST_INTERVAL = 1800;

// 自动测速切换容差，单位毫秒。
const TEST_TOLERANCE = 100;

// 单次测速超时，单位毫秒。
const TEST_TIMEOUT = 5000;

// AI、GitHub 网站测速认可的 HTTP 状态码。
const AI_STATUS = "200/301/302";


// ==========================================================
// 第二层：筛选正则表达式
// ==========================================================
//
// 本层只用于 AI / GitHub 专用组。
//
// 普通自动选择组不经过这些筛选，
// 因为它的目的是提供完整的节点自动选择功能。


// 2.1 香港节点识别
//
// AI 组排除香港。
// GitHub 允许香港。
//
// 只根据节点名称判断，不检测真实出口 IP。

const HK =
/香港|港岛|九龙|🇭🇰|Hong[\s_-]*Kong|\bHK\d*\b|\bHKG\b/i;


// 2.2 指定地区排除
//
// 排除不打算用于日常 AI 自动测速的地区。
//
// 日本、台湾、新加坡、美国、韩国、
// 马来西亚、德国等不在这个黑名单中。
//
// 德国 GIA、美国 GIA 等线路可以保留。
//
// 要恢复一个地区，只需从正则里移除它。

const REMOTE_REGION =
/印度|法国|澳大利亚|澳洲|英国|加拿大|荷兰|印尼|印度尼西亚|乌克兰|以色列|爱尔兰|俄罗斯|阿根廷|南非|尼日利亚|土耳其|🇮🇳|🇫🇷|🇦🇺|🇬🇧|🇨🇦|🇳🇱|🇮🇩|🇺🇦|🇮🇱|🇮🇪|🇷🇺|🇦🇷|🇿🇦|🇳🇬|🇹🇷/i;


// 2.3 机场信息类节点
//
// 例如剩余流量、到期提醒、官网说明等。
//
// 不让这些名称进入 AI / GitHub 自动测速。

const INFO =
/剩余|到期|套餐|流量|官网|客服|订阅信息|续费|重置|机上\s*Wi[-]?Fi|免认证/i;


// 2.4 纯联通线路
//
// 联通优化 → 排除
// 电信+联通优化 → 保留
// 移动联通优化 → 保留
// 三网优化 → 保留
//
// 只排除名称明确显示的纯联通线路。

function isUnicomOnly(name) {
return (
/联通/.test(name) &&
!/移动|电信|三网/.test(name)
);
}


// 2.5 新加坡节点识别
//
// Muse 组只用新加坡。
//
// 只根据节点名称判断，不检测真实出口 IP。
//
// 例如：
// 新加坡 A01 → 命中
// 🇸🇬 新加坡 → 命中
// Singapore 01 → 命中
// SG01 / SIN01 → 命中

const SG =
/新加坡|🇸🇬|Singapore|\bSG\d*\b|\bSIN\b/i;


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

const rawNodes = Array.isArray(config.proxies)
? config.proxies
: [];

const allNames = [
...new Set(
rawNodes
.filter(node =>
node &&
typeof node.name === "string" &&
!INFO.test(node.name)
)
.map(node => node.name)
)
];


// 4.2 GitHub 候选节点。
//
// 排除：
// 指定地区
// 纯联通
// 机场信息
// 超过 3 倍
//
// 但允许香港。

const githubNames = allNames.filter(name =>

!INFO.test(name) &&
!isUnicomOnly(name) &&
!REMOTE_REGION.test(name) &&
getMultiplier(name) <= MAX_MULTIPLIER

);


// 4.3 AI 专用节点。
//
// 在 GitHub 候选基础上进一步排除香港。
//
// 四个 AI 组使用同一份候选列表，
// 但测速网址彼此不同。

const aiNames = githubNames.filter(
name =>!HK.test(name)
);


// 4.4 Muse 候选节点。
//
// 在 AI 候选基础上进一步只保留新加坡。
//
// 继承 AI 的全部筛选：
// 排除机场信息、纯联通、指定地区、
// 超过 3 倍、香港。
//
// 账号是用新加坡住宅地址注册的，
// 所以 Muse 固定走新加坡，不混其他地区。
//
// 例如：
// 新加坡 A01 移动优化 [1.0] → 保留
// 日本 A01 移动优化 → 排除
// 美国 A01 移动优化 → 排除
// 新加坡 A02 联通优化 → 排除（纯联通）

const museNames = aiNames.filter(
name => SG.test(name)
);


// ==========================================================
// 第五层：创建 AI / GitHub 自动测速组
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

function makeTestGroup(
name,
url,
names,
expectedStatus,
interval
) {

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


// 六个独立的 AI / GitHub / Muse 代理组。

const dedicatedGroups = [

makeTestGroup(
"ChatGPT_Auto",
"https://chatgpt.com/",
aiNames,
AI_STATUS,
AI_TEST_INTERVAL
),

makeTestGroup(
"Gemini_Auto",
"https://gemini.google.com/",
aiNames,
AI_STATUS,
AI_TEST_INTERVAL
),

makeTestGroup(
"Claude_Auto",
"https://claude.ai/",
aiNames,
AI_STATUS,
AI_TEST_INTERVAL
),

makeTestGroup(
"Grok_Auto",
"https://grok.com/",
aiNames,
AI_STATUS,
AI_TEST_INTERVAL
),

makeTestGroup(
"Muse_Auto",
"https://muse.ai/",
museNames,
AI_STATUS,
AI_TEST_INTERVAL
),

makeTestGroup(
"GitHub_Auto",
"https://github.com/",
githubNames,
AI_STATUS,
AI_TEST_INTERVAL
)

];


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
// 删除与我们六个专用组同名的旧定义，
// 避免重复创建。

const oldGroups = Array.isArray(
config["proxy-groups"]
)
? config["proxy-groups"]
: [];

const dedicatedNames = new Set(
dedicatedGroups.map(group => group.name)
);

const keptGroups = oldGroups.filter(
group =>
group &&
!dedicatedNames.has(group.name)
);


// 6.2 检查是否已有普通自动选择组。

const AUTO_NAME = "♻️ 自动选择";

const existingAuto = keptGroups.find(
group => group.name === AUTO_NAME
);

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
// 则不重新创建、不改变它的节点名单与测速参数。


// ==========================================================
// 第七层：合并所有代理组
// ==========================================================
//
// 最终顺序：
//
// ① 六个 AI / GitHub / Muse 专用组
// ② 原机场的所有其他代理组
// ③ 仅在缺失时新增的普通自动组
//
// 云新建的自动组排在底部，
// 但可以从“手动选择”内部直接选到它。

config["proxy-groups"] = [

...dedicatedGroups,

...keptGroups,

...addedGroups

];


// 7.1 给云的“🔰 手动选择”增加自动选项。
//
// 最终：
//
// 🔰 手动选择
// ├─ ♻️ 自动选择
// ├─ 日本 A01
// ├─ 台湾 A02
// ├─ 新加坡 A03
// └─ 其他节点……
//
// PAOLUZ 主组已经引用自动选择，
// 不需要修改。

const manualGroup = keptGroups.find(
group =>
group.type === "select" &&
typeof group.name === "string" &&
group.name.includes("手动选择")
);

if (manualGroup) {

const choices = Array.isArray(
manualGroup.proxies
)
? manualGroup.proxies
: [];

manualGroup.proxies = [

AUTO_NAME,

...choices.filter(
name => name!== AUTO_NAME
)

];

}


// ==========================================================
// 第八层：AI 和 GitHub 域名分流
// ==========================================================
//
// 专用规则放在机场原有规则前面，
// 优先命中我们自己创建的自动组。
//
// 不把整个 google.com 或 x.com
// 强制分流到 AI 组。

const serviceRules = [

// ---------------- ChatGPT / OpenAI ----------------

"DOMAIN-SUFFIX,openai.com,ChatGPT_Auto",
"DOMAIN-SUFFIX,chatgpt.com,ChatGPT_Auto",
"DOMAIN-SUFFIX,oaistatic.com,ChatGPT_Auto",
"DOMAIN-SUFFIX,oaiusercontent.com,ChatGPT_Auto",
"DOMAIN-SUFFIX,chatgptusercontent.com,ChatGPT_Auto",



// ---------------- Gemini / Google AI ----------------

// Gemini / Google AI 入口
"DOMAIN-SUFFIX,gemini.google.com,Gemini_Auto",
"DOMAIN-SUFFIX,aistudio.google.com,Gemini_Auto",
"DOMAIN-SUFFIX,ai.google.dev,Gemini_Auto",
"DOMAIN-SUFFIX,generativelanguage.googleapis.com,Gemini_Auto",

// Gemini 相关服务接口
"DOMAIN,jnn-pa.googleapis.com,Gemini_Auto",
"DOMAIN,waa-pa.clients6.google.com,Gemini_Auto",
"DOMAIN,optimizationguide-pa.googleapis.com,Gemini_Auto",



// ---------------- Claude / Anthropic ----------------

"DOMAIN-SUFFIX,claude.ai,Claude_Auto",
"DOMAIN-SUFFIX,claude.com,Claude_Auto",
"DOMAIN-SUFFIX,anthropic.com,Claude_Auto",
"DOMAIN-SUFFIX,claudeusercontent.com,Claude_Auto",


// ---------------- Grok / xAI ----------------

"DOMAIN-SUFFIX,grok.com,Grok_Auto",
"DOMAIN-SUFFIX,x.ai,Grok_Auto",
"DOMAIN-SUFFIX,grok.x.com,Grok_Auto",


// ---------------- Muse ----------------

"DOMAIN-SUFFIX,muse.ai,Muse_Auto",


// ---------------- GitHub ----------------

"DOMAIN-SUFFIX,github.com,GitHub_Auto",
"DOMAIN-SUFFIX,githubusercontent.com,GitHub_Auto",
"DOMAIN-SUFFIX,githubassets.com,GitHub_Auto",
"DOMAIN-SUFFIX,githubapp.com,GitHub_Auto",
"DOMAIN-SUFFIX,github.io,GitHub_Auto",
"DOMAIN-SUFFIX,github.community,GitHub_Auto"

];



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
// 8.2 合并最终分流规则
// ==========================================================
//
// 优先级：
//
// ① 嘉信直连规则
// ② ChatGPT / Gemini / Claude / Grok / Muse / GitHub
// ③ 机场原有规则
//
// Mihomo 从上到下依次匹配规则。
// 嘉信域名优先 DIRECT。

const originalRules = Array.isArray(config.rules)
? config.rules
: [];

config.rules = [
...new Set([
...schwabDirectRules,
...serviceRules,
...originalRules
])
];


// ==========================================================
// 第九层：返回最终配置
// ==========================================================

return config;

}

