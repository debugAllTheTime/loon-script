/*
 * Claude iOS 会话重置脚本 (Loon)
 * 移植自: github.com/durianh96/fix-claude-ios-session (原版用 Mac + mitmproxy)
 *
 * 作用（与原版一致）:
 *   1) 请求阶段: 从发往 Claude / Anthropic 域名的 Cookie 头里删除 sessionKey、routingHint，
 *      让服务器把这次请求当成「未登录」，从而让卡死的本地登录态恢复成登出/干净状态。
 *   2) 响应阶段: 注入 Max-Age=0 的 Set-Cookie，主动让 iOS 端清掉这两个旧 cookie。
 *
 * 重要: 这是个「一次性重置开关」。开启 → 强退并重开 Claude（会变成登出状态）→
 *       关闭本脚本/插件 → 再正常重新登录。若一直开着，你将无法登录。
 *
 * 这是清理「你自己设备上损坏的本地会话」，不是绕过任何账号限制。
 */

var COOKIE_NAMES = ["sessionKey", "routingHint"];
var CLAUDE_DOMAINS = ["claude.ai", "claude.com", "anthropic.com"];

function isClaudeHost(host) {
  host = (host || "").toLowerCase();
  for (var i = 0; i < CLAUDE_DOMAINS.length; i++) {
    var d = CLAUDE_DOMAINS[i];
    // 精确匹配域名本身，或匹配其子域 (xxx.domain)
    if (host === d || host.slice(-(d.length + 1)) === "." + d) return true;
  }
  return false;
}

function hostFromUrl(url) {
  var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/:?#]+)/i.exec(url || "");
  return m ? m[1] : "";
}

// 在 headers 对象里按名字找到真实 key（HTTP 头名大小写不敏感）
function findHeaderKey(headers, name) {
  name = name.toLowerCase();
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === name) return keys[i];
  }
  return null;
}

var host = hostFromUrl($request.url);

if (!isClaudeHost(host)) {
  // 不是目标域名，原样放行
  $done({});
} else if (typeof $response === "undefined") {
  // ============ 请求阶段：剥离指定 cookie ============
  var reqHeaders = $request.headers;
  var cookieKey = findHeaderKey(reqHeaders, "cookie");

  if (!cookieKey) {
    $done({});
  } else {
    var stripped = reqHeaders[cookieKey]
      .split(";")
      .map(function (s) { return s.trim(); })
      .filter(function (s) {
        if (!s) return false;
        for (var i = 0; i < COOKIE_NAMES.length; i++) {
          if (s.indexOf(COOKIE_NAMES[i] + "=") === 0) return false;
        }
        return true;
      })
      .join("; ");

    if (stripped) {
      reqHeaders[cookieKey] = stripped;
    } else {
      delete reqHeaders[cookieKey];
    }
    // 注意：回传的是「修改后的完整请求头对象」，其它 cookie / 头部都保留
    $done({ headers: reqHeaders });
  }
} else {
  // ============ 响应阶段：让旧 cookie 过期 ============
  var respHeaders = $response.headers;

  // 用两个大小写不同的 key，促使 Loon 输出两条独立的 Set-Cookie
  // （一条 Set-Cookie 只能作废一个 cookie；HTTP 头名大小写不敏感，到了客户端都是 Set-Cookie）
  respHeaders["Set-Cookie"] =
    COOKIE_NAMES[0] + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
  respHeaders["set-cookie"] =
    COOKIE_NAMES[1] + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";

  $done({ headers: respHeaders });
}
