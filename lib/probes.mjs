// Optional live checks against a deployed URL. Uses global fetch (Node 18+).
import { VERSION } from "./version.mjs";
function norm(u) {
  if (!u) return null;
  u = u.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}
async function get(url, { method = "GET", timeout = 8000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { method, redirect: "follow", signal: ac.signal, headers: { "user-agent": `ship-kit-scan/${VERSION}` } });
    const ct = res.headers.get("content-type") || "";
    let body = "";
    if (res.ok && (ct.includes("text") || ct.includes("xml") || ct.includes("html") || ct.includes("json") || ct === "")) {
      body = (await res.text()).slice(0, 20000);
    }
    return { ok: res.ok, status: res.status, headers: res.headers, body, finalUrl: res.url || url };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "timeout" : (e && e.message) || "error" };
  } finally { clearTimeout(t); }
}

// sign-in pages a private app bounces anonymous visitors to
const LOGIN_PATH = /\/(login|log-in|signin|sign-in|sign_in|auth|sso|session\/new|account\/login|users\/sign_in)(\/|$)/i;
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return ""; } };
// did the response actually come from the path we asked for, or from a redirect target
// (for example the login page, which must not be mistaken for robots.txt)?
const servedAt = (r, path) => !r.error && pathOf(r.finalUrl).replace(/\/+$/, "") === path.replace(/\/+$/, "");

export async function runProbes(rawUrl, log = () => {}) {
  const base = norm(rawUrl);
  if (!base) return null;
  const out = { base };
  log("  probing " + base);

  let home = await get(base);
  if (home.error && home.error !== "timeout") { // TLS/connection failure
    out.https = false; out.reachable = false; return out;
  }
  out.reachable = !home.error;
  if (home.error) out.https = null;
  else if (/^https:/i.test(home.finalUrl)) out.https = true;
  else {
    // served over plain http: does an https version exist at all?
    const secure = await get(base.replace(/^http:/i, "https:"));
    out.https = false;
    out.httpsAvailable = !secure.error;
    if (!secure.error) home = secure;
  }

  if (home.headers) {
    const h = {};
    for (const k of ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy"]) {
      const v = home.headers.get(k); if (v) h[k] = v;
    }
    out.headers = h;
  }
  if (home.body) out.og = /property=["']og:image["']|name=["']og:image["']/i.test(home.body);

  // private-app signals: anonymous visitors get bounced to sign-in, or the site opts out of indexing
  const homePath = pathOf(home.finalUrl || "");
  if (LOGIN_PATH.test(homePath)) out.homeLoginPath = homePath;
  const robotsTag = home.headers && home.headers.get("x-robots-tag");
  if (robotsTag && /noindex/i.test(robotsTag)) out.noindexHeader = true;

  // exposed config files
  out.envPaths = [];
  for (const p of ["/.env", "/.env.local", "/.env.production", "/.git/config"]) {
    const r = await get(base + p, { timeout: 6000 });
    const looksSecret = r.ok && r.body && servedAt(r, p) && (/^\s*[A-Z0-9_]+\s*=/m.test(r.body) || /\[core\]|\[remote/.test(r.body)) && !/<html|<!doctype/i.test(r.body);
    out.envPaths.push({ path: p, exposed: !!looksSecret });
  }

  const robots = await get(base + "/robots.txt", { timeout: 6000 });
  out.robots = !!(robots.ok && robots.body && servedAt(robots, "/robots.txt") && !/<html|<!doctype/i.test(robots.body));
  if (out.robots) out.robotsBlocksAll = /user-agent:\s*\*/i.test(robots.body) && /^\s*disallow:\s*\/\s*$/im.test(robots.body);

  const sm = await get(base + "/sitemap.xml", { timeout: 6000 });
  out.sitemap = !!(sm.ok && sm.body && servedAt(sm, "/sitemap.xml") && /<urlset|<sitemapindex/i.test(sm.body));

  const nf = await get(base + "/shipkit-nonexistent-" + Math.floor(Date.now() % 1e6), { timeout: 6000 });
  out.notFound = nf.status === 404;
  const nfPath = pathOf(nf.finalUrl || "");
  if (!out.notFound && LOGIN_PATH.test(nfPath)) out.notFoundLoginPath = nfPath;

  return out;
}
