// Optional live checks against a deployed URL. Uses global fetch (Node 18+).
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
    const res = await fetch(url, { method, redirect: "follow", signal: ac.signal, headers: { "user-agent": "ship-kit-scan/0.1" } });
    const ct = res.headers.get("content-type") || "";
    let body = "";
    if (res.ok && (ct.includes("text") || ct.includes("xml") || ct.includes("html") || ct.includes("json") || ct === "")) {
      body = (await res.text()).slice(0, 20000);
    }
    return { ok: res.ok, status: res.status, headers: res.headers, body };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "timeout" : (e && e.message) || "error" };
  } finally { clearTimeout(t); }
}

export async function runProbes(rawUrl, log = () => {}) {
  const base = norm(rawUrl);
  if (!base) return null;
  const out = { base };
  log("  probing " + base);

  const home = await get(base);
  out.https = home.error ? (home.error === "timeout" ? null : false) : true;
  if (home.error && home.error !== "timeout") { // TLS/connection failure
    out.reachable = false; return out;
  }
  out.reachable = !home.error;

  if (home.headers) {
    const h = {};
    for (const k of ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy"]) {
      const v = home.headers.get(k); if (v) h[k] = v;
    }
    out.headers = h;
  }
  if (home.body) out.og = /property=["']og:image["']|name=["']og:image["']/i.test(home.body);

  // exposed config files
  out.envPaths = [];
  for (const p of ["/.env", "/.env.local", "/.env.production", "/.git/config"]) {
    const r = await get(base + p, { timeout: 6000 });
    const looksSecret = r.ok && r.body && (/^\s*[A-Z0-9_]+\s*=/m.test(r.body) || /\[core\]|\[remote/.test(r.body)) && !/<html|<!doctype/i.test(r.body);
    out.envPaths.push({ path: p, exposed: !!looksSecret });
  }

  const robots = await get(base + "/robots.txt", { timeout: 6000 });
  out.robots = robots.ok && robots.body && !/<html|<!doctype/i.test(robots.body);
  if (out.robots) out.robotsBlocksAll = /user-agent:\s*\*/i.test(robots.body) && /^\s*disallow:\s*\/\s*$/im.test(robots.body);

  const sm = await get(base + "/sitemap.xml", { timeout: 6000 });
  out.sitemap = sm.ok && sm.body && /<urlset|<sitemapindex/i.test(sm.body);

  const nf = await get(base + "/shipkit-nonexistent-" + Math.floor(Date.now() % 1e6), { timeout: 6000 });
  out.notFound = nf.status === 404;

  return out;
}
