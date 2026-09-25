// Per-check detectors. Each returns {status, evidence}.
// status: "pass" | "fail" | "na" | "manual"
// Honest by design: when we cannot be sure, we return "manual" (verify yourself), never a fake pass.
import { promises as dns } from "node:dns";
import { EMAIL_API_HOST } from "./capabilities.mjs";

const P = (evidence) => ({ status: "pass", evidence });
const F = (evidence) => ({ status: "fail", evidence });
const NA = (evidence) => ({ status: "na", evidence });
const M = (evidence) => ({ status: "manual", evidence });

// live secret values that must never reach the browser bundle
const SECRET_VALUE = /(sk_live_[0-9a-zA-Z]{10,}|rk_live_[0-9a-zA-Z]{10,}|sb_secret_[0-9a-zA-Z_-]{10,}|sk-ant-[0-9a-zA-Z_-]{10,}|sk-proj-[0-9a-zA-Z_-]{10,}|gh[po]_[0-9a-zA-Z]{30,}|github_pat_[0-9a-zA-Z_]{20,}|xox[bp]-[0-9a-zA-Z-]{10,}|AKIA[0-9A-Z]{16}|service_role|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
// secret-looking env names behind a prefix that the framework bundles into client code
const PUBLIC_SECRET_NAME = /\b(NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|REACT_APP_)[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_AI_KEY|RESEND_API_KEY|SENDGRID_API_KEY|STRIPE_SECRET)/;

// A private app (login-only, invite-only) should NOT be in search results, so the
// findability checks flip: blocking crawlers is right, a sitemap is pointless, and
// unknown URLs redirecting to sign-in is normal. Returns the reason, or null.
export function privateApp(c) {
  const flag = c.profile.private;
  if (flag === false || flag === "false") return null;
  if (flag === true || flag === "true") return "You marked this as a private app";
  const p = c.probes;
  if (p && p.homeLoginPath) return `The homepage redirects to sign-in (${p.homeLoginPath})`;
  // noindex alone is not proof: a public site that shipped a staging noindex is exactly what SEO3 catches
  return null;
}

// The installed Sentry SDK and its major version, if any.
export function sentrySdk(c) {
  const name = [...(c.deps || [])].find((d) => /^@sentry\/(nextjs|node|react|browser|sveltekit|vue|astro|remix|nuxt|solidstart|angular|bun|deno|cloudflare|aws-serverless|gatsby|ember|react-native|electron|nestjs)$/.test(d));
  if (!name) return null;
  const iv = c.installedVersion ? c.installedVersion(name) : null;
  return iv ? { name, version: iv.version, major: parseInt(iv.version, 10), exact: iv.exact } : { name, version: null, major: null, exact: false };
}

// committed env templates hold names, not values (.env.example, .env.sample, .env.template, ...)
const ENV_TEMPLATE = /\.(example|sample|template|dist|defaults)$/i;

// Framework releases with published critical advisories. Keep this list short and sourced:
// each entry is [package, major, first fixed version, advisory].
export const KNOWN_VULNERABLE = [
  ["next", 15, "15.5.24", "Next.js August 2026 security release (unauthenticated RCE), nextjs.org/blog/august-2026-security-release"],
  ["next", 16, "16.3.3", "Next.js August 2026 security release (unauthenticated RCE), nextjs.org/blog/august-2026-security-release"],
];

export function semverLt(a, b) {
  const pa = String(a).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] < pb[i]; }
  return false;
}

// Which installed framework versions sit inside a known-vulnerable range.
export function vulnerableFrameworks(c) {
  const out = [];
  if (!c.installedVersion) return out;
  for (const [name, major, fixed, advisory] of KNOWN_VULNERABLE) {
    if (!c.dep(name)) continue;
    const iv = c.installedVersion(name);
    if (!iv || parseInt(iv.version, 10) !== major || !semverLt(iv.version, fixed)) continue;
    out.push({ name, version: iv.version, exact: iv.exact, source: iv.source, fixed, advisory });
  }
  return out;
}

// Does a file path look like a Terms or Privacy page? Match whole path segments so that
// "photos.tsx" is not mistaken for a ToS page.
export function isTermsPath(f) {
  return f.toLowerCase().split("/").some((seg) => /^(terms|tos)([-_.]|of|and|$)|[-_](terms|tos)([-_.]|$)|^legal[-_.]terms/.test(seg));
}
export function isPrivacyPath(f) {
  return f.toLowerCase().split("/").some((seg) => /privacy/.test(seg));
}

// SQL helpers for the RLS check: which public tables are created, and which have RLS on.
const tableName = (raw) => raw.replace(/["`]/g, "").toLowerCase();
export function rlsCoverage(sqlTexts) {
  const created = new Set(), rls = new Set();
  for (const txt of sqlTexts) {
    const sql = txt.replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi)) {
      const n = tableName(m[1]);
      if (n.includes(".") && !n.startsWith("public.")) continue; // auth.*, storage.*, private.* are not exposed via the API
      created.add(n.replace(/^public\./, ""));
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi)) {
      const n = tableName(m[1]).replace(/^public\./, "");
      created.delete(n); rls.delete(n);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+(enable|disable)\s+row\s+level\s+security/gi)) {
      const n = tableName(m[1]).replace(/^public\./, "");
      if (m[2].toLowerCase() === "enable") rls.add(n); else rls.delete(n);
    }
  }
  const missing = [...created].filter((t) => !rls.has(t));
  return { created: [...created], rls: [...rls], missing };
}

// ---- detectors keyed by check id ----
export const detectors = {

  // ---------- Foundations ----------
  F1: (c) => {
    const tracked = c.gitTracked && [...c.gitTracked].filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !ENV_TEMPLATE.test(f));
    if (tracked && tracked.length) return F(`.env is tracked by git: ${tracked.slice(0, 3).join(", ")}`);
    const ignored = c.isIgnored(".env") || c.isIgnored(".env.local");
    const hasExample = c.find(/(^|\/)\.env\..+$/).some((f) => ENV_TEMPLATE.test(f));
    if (ignored && hasExample) return P(".env is gitignored and .env.example is committed");
    if (ignored) return P(".env is gitignored (consider adding .env.example)");
    if (c.has(".gitignore")) return F(".env is not listed in .gitignore");
    return M("No .gitignore found; confirm secrets are never committed");
  },
  F4: (c) => {
    const brief = ["CLAUDE.md", "AGENTS.md", "AGENT.md", ".github/copilot-instructions.md"].find((f) => c.has(f));
    return brief ? P(`${brief} present (confirm it still matches your current stack)`) : F("No AI project brief (CLAUDE.md or AGENTS.md) at repo root");
  },
  F5: (c) => {
    const s = c.read(".claude/settings.json");
    if (!s) return M("No .claude/settings.json; add a deny-list before running auto-accept");
    if (/"deny"/.test(s) && /(rm -rf|git reset --hard|push --force|repo delete)/.test(s)) return P("deny-list with destructive commands present");
    if (/"deny"/.test(s)) return M("deny-list present; confirm it blocks rm -rf, force-push, resets, repo delete");
    return F(".claude/settings.json has no permissions.deny list");
  },
  F9: (c) => {
    const s = c.read(".claude/settings.json") || "";
    if (/AWS_PROFILE|GH_CONFIG_DIR/.test(s)) return P("cloud/git identity pinned in .claude/settings.json");
    return M("Pin AWS_PROFILE / GH_CONFIG_DIR per project; verify identity before consequential actions");
  },

  // ---------- Security ----------
  S1: (c) => {
    if (c.profile.db === "convex") return M("Convex: verify every query/mutation checks ctx.auth");
    if (c.profile.db === "firebase") return M("Firebase: verify security rules are locked, not world-readable");
    if (c.profile.db === "postgres") return M("No RLS declared: app-layer scoping is your ONLY authz. Verify every query filters by user_id and prove it adversarially");
    // Supabase exposes every public table to the browser through its REST API, so RLS is the lock on the door.
    const supabase = c.profile.db === "supabase"
      || (!c.profile.db || c.profile.db === "other") && (c.dep("@supabase/supabase-js", "@supabase/ssr") || c.find(/(^|\/)supabase\/migrations\//).length > 0);
    const sqlFiles = c.find(/\.sql$/i).filter((f) => !/legacy|archived|(^|\/)seeds?(\.sql$|\/)/i.test(f)).sort();
    const cov = rlsCoverage(sqlFiles.map((f) => c.read(f) || ""));
    if (supabase) {
      if (cov.missing.length) {
        const list = cov.missing.slice(0, 6).join(", ") + (cov.missing.length > 6 ? ` and ${cov.missing.length - 6} more` : "");
        return F(`${cov.missing.length} of ${cov.created.length} tables have no ENABLE ROW LEVEL SECURITY: ${list}`);
      }
      if (cov.created.length) return P(`RLS enabled on all ${cov.created.length} tables created in migrations (spot-check each has a policy)`);
      if (cov.rls.length) return P("RLS enabled in migrations (spot-check a policy exists per table)");
      if (sqlFiles.length) return F(`Found ${sqlFiles.length} SQL files but no "ENABLE ROW LEVEL SECURITY"`);
      return M("No SQL migrations in the repo (tables made in the Supabase dashboard?). Check every table in Table Editor shows RLS enabled with policies");
    }
    if (cov.created.length && !cov.missing.length) return P(`RLS enabled on all ${cov.created.length} tables created in migrations (spot-check each has a policy)`);
    if (cov.created.length) return M(`No RLS on ${cov.missing.length} of ${cov.created.length} tables: fine only if the database is never reachable from the browser. Then app-layer scoping is your ONLY authz; verify every query filters by user_id`);
    return M("Confirm every table with user data is access-controlled");
  },
  S5: (c) => {
    if (!c.probes) return M("Provide --url to auto-check that /.env returns nothing");
    const hits = (c.probes.envPaths || []).filter((p) => p.exposed);
    if (hits.length) return F(`Downloadable config exposed: ${hits.map((h) => h.path).join(", ")}`);
    return P("/.env and /.git/config return no contents");
  },
  S6: (c) => {
    const bad = c.grep(SECRET_VALUE, { clientOnly: true, limit: 8 });
    if (bad.length) return F(`Possible secret in client code: ${bad[0].file}:${bad[0].line}`);
    const leaky = c.grep(/process\.env\.(?!NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_)[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)/, { clientOnly: true, limit: 8 });
    if (leaky.length) return F(`Server env used in client file: ${leaky[0].file}:${leaky[0].line}`);
    // a public prefix (VITE_, NEXT_PUBLIC_, ...) ships the value to every visitor's browser
    // (a gitignored .env still counts: the build reads it and bakes the value into the bundle)
    const exposed = c.grep(PUBLIC_SECRET_NAME, { exclude: [".md", "test", "spec"], limit: 8 });
    if (exposed.length) return F(`Secret behind a public env prefix (bundled into the browser): ${exposed[0].file}:${exposed[0].line}`);
    const legacySupabase = c.dep("@supabase/supabase-js", "@supabase/ssr")
      && c.any(/SUPABASE_(ANON|SERVICE_ROLE)_KEY|supabaseAnonKey|service_role/, { exclude: [".md"] })
      && !c.any(/sb_publishable_|sb_secret_|SUPABASE_(PUBLISHABLE|SECRET)_KEY/, { exclude: [".md"] });
    const base = "No obvious frontend secrets found; confirm only NEXT_PUBLIC_/VITE_ vars reach the client, and none of them hold a secret";
    return M(legacySupabase ? base + ". Also: this app uses Supabase's legacy anon/service_role keys, which Supabase retires at the end of 2026; plan the move to sb_publishable_/sb_secret_ keys" : base);
  },
  S7: (c) => c.gitEnvInHistory ? F(".env appears in git history; rotate every key in it and scrub history") : M("Rotate anything ever leaked; nothing obvious in git history"),
  S10: (c) => {
    if (!c.probes) return M("Provide --url to auto-check HTTPS and the certificate");
    if (c.probes.https === true) return P("HTTPS loads with a valid certificate");
    if (c.probes.https === false && c.probes.httpsAvailable) return F("The site loads over plain http without redirecting to https (https works, so add the redirect)");
    if (c.probes.https === false && c.probes.reachable) return F("The site is served over plain http, and https does not load");
    if (c.probes.https === false) return F("HTTPS failed or the certificate is invalid");
    return M("Could not reach the URL over HTTPS");
  },
  S11: (c) => {
    if (c.dep("express-rate-limit", "@upstash/ratelimit", "rate-limiter-flexible", "@fastify/rate-limit")) return P("A rate-limiting library is installed");
    if (c.any(/rate ?limit|ratelimit|429/i, { include: [".ts", ".js"], exclude: ["test"] })) return M("Rate-limit code found; confirm it covers expensive/AI endpoints per user and IP");
    if (c.profile.ai) return F("AI features declared but no rate limiting or spend cap detected");
    return M("Add per-user and per-IP limits on any expensive endpoint");
  },
  S13: (c) => {
    // a framework release with a published critical advisory beats any "we have alerts on" signal
    const vuln = vulnerableFrameworks(c);
    if (vuln.length) {
      const v = vuln[0];
      if (v.exact) return F(`${v.name} ${v.version} (from ${v.source}) has a known critical vulnerability; upgrade to ${v.fixed} or later. See ${v.advisory}`);
      return M(`${v.source} allows ${v.name} ${v.version}, which has a known critical vulnerability (fixed in ${v.fixed}). No lockfile to confirm the installed version: check it and upgrade. See ${v.advisory}`);
    }
    const renovate = [".github/renovate.json", ".github/renovate.json5", "renovate.json", "renovate.json5", ".renovaterc", ".renovaterc.json"].some((f) => c.has(f)) || !!(c.pkg && c.pkg.renovate);
    if (c.has(".github/dependabot.yml") || c.has(".github/dependabot.yaml")) return P("Dependabot configured (consider a 1-day install cooldown against freshly-hijacked packages)");
    if (renovate) return P("Renovate configured (consider minimumReleaseAge so brand-new versions wait a day)");
    if (c.any(/(npm|pnpm|yarn|bun) audit|osv-scanner|dependency-review-action|snyk (test|monitor)|socket (ci|scan)/i, { include: [".yml", ".yaml"] })) return P("A dependency audit runs in CI");
    return F("No Dependabot or Renovate config, and no dependency audit gate in CI");
  },
  S14: (c) => {
    if (c.probes && c.probes.headers) {
      const h = c.probes.headers;
      const have = ["content-security-policy", "strict-transport-security", "x-frame-options"].filter((k) => h[k]);
      if (have.length >= 2) return P(`Security headers present: ${have.join(", ")}`);
      return F(`Missing security headers (found: ${have.join(", ") || "none"})`);
    }
    if (c.dep("helmet") || c.any(/(content-security-policy|strict-transport-security|x-frame-options)/i, { include: ["next.config", ".ts", ".js", "netlify", "vercel"] })) return P("Security-header config found in source");
    return M("Provide --url or add CSP/HSTS/X-Frame-Options headers");
  },

  S18: (c) => {
    // model output is untrusted input: rendering it as raw HTML hands a prompt-injected page script access
    const ai = /useChat|useCompletion|useAssistant|streamText|generateText|\.choices\[0\]|content\[0\]\.text|completion|aiResponse|assistantMessage/;
    const raw = c.grep(/dangerouslySetInnerHTML|\.innerHTML\s*=|v-html|\{@html/, { clientOnly: true, limit: 40 })
      .filter((h) => ai.test(c.read(h.file) || "") && !/DOMPurify|sanitize/i.test(c.read(h.file) || ""));
    if (raw.length) return F(`AI output rendered as raw HTML without sanitizing: ${raw[0].file}:${raw[0].line}`);
    const tools = c.any(/\btools\s*:\s*[\[{]|tool_choice|function_call|\btool\(\{|createMcpClient|experimental_createMCPClient/, { exclude: [".md", "test"] });
    if (tools) return M("The AI can call tools: confirm each tool re-checks the logged-in user's permissions on the server, and that text from users, web pages or files cannot trigger sensitive actions or leak data");
    return M("Confirm model output is escaped before display, no secrets sit in the system prompt, and the AI never gets more access than the user it is serving");
  },

  // ---------- Data ----------
  D1: (c) => {
    const migs = c.find(/migrations?\/.*\.sql$/i);
    if (!migs.length) return M("No SQL migrations found; N/A if you use a managed schema tool");
    // tool-managed migrations are recorded in a tracking table, so each file runs exactly once
    const tracked = (f) => /(^|\/)prisma\/migrations\//.test(f) || /(^|\/)supabase\/migrations\//.test(f)
      || c.has(f.replace(/[^/]+$/, "meta/_journal.json")); // drizzle-kit
    const manual = migs.filter((f) => !tracked(f));
    if (!manual.length) {
      const tool = migs.some((f) => /prisma\//.test(f)) ? "Prisma" : migs.some((f) => /supabase\//.test(f)) ? "the Supabase CLI" : "Drizzle";
      return P(`Migrations are managed by ${tool}, which records what has run (keep them forward-only; never edit an applied one)`);
    }
    const notIdem = manual.filter((f) => !/if (not )?exists|create or replace/i.test(c.read(f) || ""));
    if (!notIdem.length) return P(`All ${manual.length} hand-run migrations use IF NOT EXISTS / IF EXISTS guards`);
    return F(`${notIdem.length} of ${manual.length} hand-run migrations have no IF NOT EXISTS guard, so re-running them fails (e.g. ${notIdem[0]})`);
  },

  // ---------- Emails ----------
  E1: async (c) => {
    const domain = c.profile.domain;
    if (!domain) return M("Set your domain in the wizard to auto-check SPF/DMARC");
    const resolveTxt = c.resolveTxt || dns.resolveTxt;
    // "no record" is an answer; only a network failure means we could not check
    const txt = async (name) => {
      try { return (await resolveTxt(name)).map((r) => r.join("")); }
      catch (e) { if (e && (e.code === "ENODATA" || e.code === "ENOTFOUND")) return []; throw e; }
    };
    let root, dmarcRecs;
    try { [root, dmarcRecs] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]); }
    catch { return M("Could not resolve DNS for " + domain); }
    const spf = root.some((r) => /^v=spf1/i.test(r));
    const dmarc = dmarcRecs.find((r) => /^v=DMARC1/i.test(r));
    // DMARC on the root domain covers every subdomain; SPF may legitimately live on a sending subdomain
    if (!dmarc) return F(`No DMARC record at _dmarc.${domain}. Gmail, Yahoo and Outlook now reject (not just spam-folder) unauthenticated mail`);
    const policy = ((dmarc.match(/;\s*p=(\w+)/i) || [])[1] || "none").toLowerCase();
    if (!spf) return M(`DMARC found (p=${policy}) but no SPF on ${domain}; fine if you send from a subdomain that has its own SPF. Confirm SPF and DKIM show verified in your email provider`);
    if (policy === "none") return P(`SPF and DMARC found; DMARC is still p=none (monitor only), so tighten to p=quarantine once reports look clean. Verify DKIM in your provider`);
    return P(`SPF and DMARC (p=${policy}) found (verify DKIM in your provider dashboard)`);
  },
  E2: (c) => {
    if (c.profile.email === "none") return NA("No email sending declared");
    if (c.dep("resend", "@sendgrid/mail", "postmark", "nodemailer", "@loops/loops", "mailgun.js", "@aws-sdk/client-ses", "@aws-sdk/client-sesv2", "@getbrevo/brevo", "mailersend")) return P("A transactional email provider is installed");
    const api = c.grep(EMAIL_API_HOST, { exclude: [".md", "test", "spec"], limit: 1 });
    if (api.length) return P(`Email is sent through a provider's API directly (${api[0].file}:${api[0].line})`);
    return c.profile.email ? F("Email declared but no provider SDK or provider API call found") : M("Confirm transactional email is wired to a real provider");
  },
  E9: (c) => c.any(/list-unsubscribe/i) ? P("List-Unsubscribe header found") : M("Add one-click unsubscribe to marketing mail (CAN-SPAM)"),

  // ---------- Findability ----------
  SEO1: (c) => {
    if (c.probes && c.probes.og != null) return c.probes.og ? P("og:image tag served on the homepage") : F("No og:image tag on the live homepage");
    return c.any(/og:image|openGraph|opengraph/i, { include: [".ts", ".tsx", ".js", ".jsx", ".html", ".astro", ".svelte", ".vue"] }) ? P("Open Graph tags found in source") : F("No Open Graph / og:image tags found");
  },
  SEO2: (c) => {
    const priv = privateApp(c);
    if (priv) return NA(`${priv}; a private app should not be in search results, so it needs no sitemap`);
    if (c.probes && c.probes.sitemap != null) return c.probes.sitemap ? P("/sitemap.xml is served") : F("/sitemap.xml is not served");
    return (c.has("public/sitemap.xml") || c.find(/sitemap\.(xml|ts|js)$/).length) ? P("Sitemap present in project") : F("No sitemap found");
  },
  SEO3: (c) => {
    const priv = privateApp(c);
    if (priv) return NA(`${priv}; keeping search engines out is correct here (see SEO7)`);
    if (c.probes && c.probes.robotsBlocksAll === true) return F("robots.txt has a bare 'Disallow: /' blocking the whole site (if this app is private on purpose, re-run with --private true)");
    if (c.probes && c.probes.noindexHeader) return F("The site sends X-Robots-Tag: noindex, so Google will drop every page (if this app is private on purpose, re-run with --private true)");
    if (c.any(/noindex/i, { include: [".ts", ".tsx", ".html"], exclude: ["test", "admin", "dashboard"] })) return M("A 'noindex' appears in source; confirm it is not on public pages");
    return M("Confirm nothing (robots or noindex) blocks Google from public pages");
  },
  SEO4: (c) => {
    const t = c.any(/<title|title:\s*['"`]|metadata|<meta name="description"/i, { include: [".ts", ".tsx", ".js", ".html", ".astro", ".svelte", ".vue"] });
    return t ? P("Title/description metadata found") : F("No page title/description metadata found");
  },
  SEO5: (c) => {
    const hits = c.grep(/(localhost:\d+|127\.0\.0\.1:\d+|\bstaging\.[a-z0-9.-]+)/i, { exclude: ["test", "spec", ".md", "README", "docker", "compose", ".env", "vite.config", "next.config", "package.json", "scripts/", "/scripts", ".config.", ".claude", ".github", ".vscode", ".idea", "settings.local"], clientOnly: false, limit: 40 });
    // only files that actually ship: skip config/env/logs, any dot-directory (.claude, .impeccable,
    // .github, .vscode... tooling, never deployed), anything gitignored, and deploy/ops tooling
    // (a health check against 127.0.0.1 in a release script runs on the server; it is not a leftover).
    const real = hits.filter((h) =>
      !/config|\.env|settings|snapshot|session|\.log/i.test(h.file)
      && !/(^|\/)\.[A-Za-z]/.test(h.file)
      && !/\.(sh|bash|zsh|ps1|tf|tf\.json|tfvars|ya?ml|toml)$/i.test(h.file)
      && !/(^|\/)(deploy|deployment|infra|infrastructure|ops|terraform|ansible|k8s|kubernetes|helm|charts|bin|tools)\//i.test(h.file)
      && !c.isIgnored(h.file));
    return real.length ? F(`Possible staging/localhost leftover: ${real[0].file}:${real[0].line}`) : M("No obvious localhost/staging leftovers; double-check your preview and canonical URLs");
  },
  SEO7: (c) => {
    const priv = privateApp(c);
    if (priv) {
      if (c.probes && (c.probes.robotsBlocksAll || c.probes.noindexHeader)) return P(`Crawlers are told to stay out (${[c.probes.robotsBlocksAll && "robots.txt Disallow: /", c.probes.noindexHeader && "X-Robots-Tag: noindex"].filter(Boolean).join(" + ")}), which is right for a private app`);
      return M(`${priv}: serve a robots.txt with 'Disallow: /' or send X-Robots-Tag: noindex, so nothing behind the login gets indexed`);
    }
    if (c.probes && c.probes.robots != null) return c.probes.robots ? P("/robots.txt is served") : F("/robots.txt is not served");
    return (c.has("public/robots.txt") || c.find(/robots\.(txt|ts|js)$/).length) ? P("robots.txt present in project") : F("No robots.txt found");
  },

  // ---------- Speed ----------
  SP5: (c) => c.any(/prefers-reduced-motion/i, { include: [".css", ".scss", ".ts", ".tsx", ".js"] }) ? P("prefers-reduced-motion handling found") : M("Add a reduced-motion fallback; never gate content visibility on a transition"),

  // ---------- Analytics ----------
  A1: (c) => c.dep("posthog-js", "@vercel/analytics", "@amplitude/analytics-browser", "react-ga4", "@segment/analytics-next", "plausible-tracker", "@plausible-analytics/tracker", "mixpanel-browser", "@umami/node", "fathom-client", "@next/third-parties")
    || c.any(/gtag\(|googletagmanager|posthog|plausible\.io\/js|umami\.(is|js)|cdn\.usefathom\.com|scripts\.simpleanalyticscdn|static\.cloudflareinsights\.com/i)
    ? P("An analytics library is installed") : F("No analytics library detected"),
  A5: (c) => {
    if (!c.dep("@sentry", "@highlight-run", "@bugsnag", "bugsnag", "@rollbar", "rollbar", "@honeybadger-io", "@datadog/browser-rum", "@datadog/browser-logs", "dd-trace", "@appsignal/nodejs", "@logtail/node")) return F("No error tracking (e.g. Sentry) detected");
    return P(sentrySdk(c) ? "An error tracker (Sentry) is installed; see A6 for what it collects" : "An error tracker is installed");
  },
  A6: (c) => {
    // Sentry 11 replaced sendDefaultPii with dataCollection, and an unset dataCollection collects
    // cookies, headers, and request/response bodies.
    const s = sentrySdk(c);
    const configured = c.any(/dataCollection/, { exclude: [".md", "test"] });
    if (s && s.major >= 11 && !configured) {
      const msg = `${s.name} ${s.version} sends cookies, headers and request/response bodies by default; set dataCollection explicitly, or scrub them in beforeSend`;
      return s.exact ? F(msg) : M(msg + " (no lockfile to confirm the installed version)");
    }
    if (s && c.any(/sendDefaultPii\s*:\s*true/, { exclude: [".md", "test"] })) return M("Sentry has sendDefaultPii: true, so IPs, cookies and headers are sent; confirm you want that and your privacy policy says so");
    return M(manualNote.A6);
  },
  A3: (c) => c.dep("@marsidev/react-turnstile") || c.any(/turnstile|hcaptcha|recaptcha/i) ? P("Bot protection (Turnstile/captcha) found") : M("Add Cloudflare Turnstile to signup/contact forms"),

  // ---------- Legal ----------
  L1: (c) => {
    const pageFile = (f) => /\.(tsx?|jsx?|html|md|mdx|astro|svelte|vue)$/i.test(f) || /\/(page|index|\+page)\./i.test(f);
    // pages in the tree, route declarations in a single-file router, or a hosted policy provider
    const hosted = /termly\.io|iubenda\.com|termsfeed\.com|getterms\.io|app\.enzuzo\.com/i;
    const terms = c.files.some((f) => isTermsPath(f) && pageFile(f))
      || c.any(/(path|href|to)\s*[:=]\s*\{?\s*["'`]\/(terms|tos)(-of-service|-and-conditions)?["'`/]/i, { include: [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".astro", ".html"] })
      || c.any(new RegExp(hosted.source + ".*terms|terms.*" + hosted.source, "i"));
    const priv = c.files.some((f) => isPrivacyPath(f) && pageFile(f))
      || c.any(/(path|href|to)\s*[:=]\s*\{?\s*["'`]\/privacy(-policy)?["'`/]/i, { include: [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".astro", ".html"] })
      || c.any(new RegExp(hosted.source + ".*privacy|privacy.*" + hosted.source, "i"));
    // Terms of Service only matters if you sell something or let people create accounts;
    // a Privacy Policy is the baseline everyone needs (analytics, cookies, a contact form).
    const needsTerms = !!(c.caps && (c.caps.hasPayments || c.caps.hasAuth));
    if (needsTerms) {
      if (terms && priv) return P("Terms and Privacy pages found");
      if (terms || priv) return F(`Only ${terms ? "Terms" : "Privacy"} found; you sell or take accounts here, so both are required`);
      return F("No Terms of Service or Privacy Policy found, and you sell or take accounts here");
    }
    return priv ? P("Privacy Policy found (no Terms needed: nothing sold, no accounts here)") : F("No Privacy Policy found");
  },
  L7: (c) => {
    // EU AI Act Article 50 (applies from 2 Aug 2026): people must be told they are dealing with an AI
    const facing = c.any(/useChat|useAssistant|\/api\/chat|Chat(bot|Widget|Window|Interface|Panel)\b|<Chat\b|@vapi-ai|@elevenlabs|@11labs|livekit|realtime.*(openai|voice)|openai.*realtime/i, { clientOnly: true })
      || c.dep("@vapi-ai/web", "@elevenlabs/react", "@11labs/react", "@livekit/components-react", "@ai-sdk/react");
    const disclosed = c.any(/\b(AI|A\.I\.) (assistant|agent|chatbot|model)\b|(talking|chatting|speaking) (to|with) an? (AI|virtual)|generated (by|with) AI|AI[- ]generated|powered by (AI|GPT|Claude|OpenAI|Anthropic|Gemini)|AI can make mistakes|virtual assistant/i, { clientOnly: true });
    if (facing && !disclosed) return F("A user-facing chat or voice AI was found, but no \"you are talking to an AI\" notice in the client code");
    if (facing) return M("AI disclosure text found; confirm people see it before or at their first interaction, including on voice calls");
    return M("If people interact with your AI directly, tell them it is an AI; label AI-generated images, audio and video");
  },
  L3: (c) => {
    if (c.profile.analytics === false) return NA("No tracking declared");
    return c.dep("vanilla-cookieconsent", "react-cookie-consent", "cookieconsent") || c.any(/cookie.?consent|cookie.?banner/i) ? P("Cookie consent component found") : M("Add a cookie banner if you set non-essential cookies");
  },
  L4: (c) => c.any(/delete.?account|deleteaccount|data.?deletion|right.?to.?erasure|gdpr.?delete/i) ? M("Deletion code found; confirm it actually removes user data (incl. backups)") : F("No data-deletion mechanism found (your Privacy Policy will promise one)"),

  // ---------- Payments ----------
  P1: (c) => {
    if (c.profile.payments === "none") return NA("No payments declared");
    // [provider, is it installed?, webhook-verification signal]
    const providers = [
      ["Stripe", c.dep("stripe"), /webhooks\.constructEvent|constructEventAsync|stripe.*webhook/i],
      ["Polar", c.dep("@polar-sh/sdk", "@polar-sh/nextjs", "@polar-sh/express", "@polar-sh/better-auth"), /validateEvent|Webhooks\(\s*\{|onOrderPaid|onSubscription/],
      ["Paddle", c.dep("@paddle/paddle-node-sdk"), /webhooks\.unmarshal|paddle-signature/i],
      ["Lemon Squeezy", c.dep("@lemonsqueezy/lemonsqueezy.js"), /x-signature|lemonsqueezy.*webhook/i],
    ];
    for (const [name, installed, re] of providers) {
      if (c.any(re, { exclude: [".md"] }) && (installed || name === "Stripe")) return M(`${name} webhook handler found; test it in LIVE mode with a real card`);
    }
    const inst = providers.find(([, installed]) => installed);
    if (inst) return F(`${inst[0]} installed but no verified webhook handler found`);
    if (c.find(/(^|\/)webhooks?(\/|\.)/i).length) return M("A webhook route exists; confirm it verifies the signature and test it in LIVE mode");
    if (c.profile.payments) return F(`Payments declared (${c.profile.payments}) but no payment integration found in the code`);
    return NA("No payment integration detected");
  },
  P2: (c) => {
    if (c.profile.payments === "none") return NA("No payments declared");
    return c.any(/idempotencyKey|idempotency_key|Idempotency-Key/i) ? P("Idempotency key usage found") : M("Make credit/payout issuance idempotent (dedup row + provider idempotency key)");
  },

  // ---------- Deploy ----------
  DP9: (c) => {
    const lock = c.find(/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/).length > 0;
    const pinned = [".nvmrc", ".node-version", ".tool-versions", "mise.toml", ".mise.toml"].some((f) => c.has(f))
      || !!(c.pkg && (c.pkg.packageManager || (c.pkg.engines && c.pkg.engines.node) || c.pkg.volta));
    if (lock && pinned) return P("Lockfile present and Node/package-manager pinned");
    if (lock) return M("Lockfile present; add .nvmrc or packageManager to pin the version CI uses");
    return F("No lockfile found; commit one and pin the Node/package-manager version");
  },
  DP10: (c) => {
    const tf = c.find(/\.tf(\.json)?$/);
    if (!tf.length) return NA("No Terraform files");
    for (const f of tf) {
      const txt = c.read(f);
      if (txt && /[–—‘’“”]/.test(txt)) return F(`Non-ASCII (em-dash/smart quote) in ${f}; AWS rejects it in resource attributes`);
    }
    return P("Terraform strings are plain ASCII");
  },

  // ---------- Testing ----------
  T6: (c) => {
    const scripts = (c.scripts || []).map((s) => s.cmd).join("\n");
    const TEST_CMD = /node\b[^\n]*\s--test\b|\bbun test\b|\bdeno test\b|\bpytest\b|\bgo test\b/;
    const unit = c.dep("jest", "vitest", "mocha", "ava", "tap", "uvu", "@testing-library/react")
      || TEST_CMD.test(scripts)
      || c.any(/from\s+['"](node|bun):test['"]|require\(['"]node:test['"]\)/, { exclude: [".md"] });
    const e2e = c.dep("@playwright/test", "playwright", "cypress");
    // hand-rolled browser or integration scripts: not a framework, but real coverage
    const custom = c.dep("puppeteer", "puppeteer-core", "playwright-core", "selenium-webdriver", "webdriverio")
      || (c.scripts || []).some((s) => /e2e|integration|smoke|browser/i.test(s.name))
      || c.find(/(^|\/)(tests?\/)?(e2e|integration|smoke)(\/|\.)/i).length > 0;
    const ciRunsTests = c.any(/(playwright|cypress|(npm|pnpm|yarn|bun)( run)? (test|e2e|integration|smoke)|vitest|jest|node [^\n]*--test|pytest|deno test|go test)/i, { include: [".yml", ".yaml"] });
    if (e2e && ciRunsTests) return M("E2E framework present and referenced in CI; confirm the happy path actually runs and passes in CI");
    if (e2e) return F("E2E framework installed but not referenced in any CI workflow");
    if (custom && ciRunsTests) return M("Integration or browser test scripts found and tests run in CI; confirm they hit a real database and walk the core happy path");
    if (unit && custom) return F("Integration or browser test scripts found, but no CI workflow runs them");
    if (unit) return F("Unit tests only; add a real-DB integration test and an E2E happy path that runs in CI");
    return F("No test framework detected");
  },
};

// checks that are inherently human-verified (no reliable static signal)
export const manualNote = {
  F2: "Confirm your live app and any test versions use different keys and different data, so testing cannot touch real customers.",
  F3: "Confirm your secret keys are stored in your host's settings, not written in the code.",
  F6: "Confirm you have one command that must pass (tests, type-check, lint) before anything ships.",
  F7: "Confirm someone or something other than the author reviews each change.",
  F8: "Confirm unattended AI runs commit their work but do not push it live on their own.",
  F10: "Confirm you have a spending limit or billing alert on anything that charges by usage.",
  S2: "Confirm every database query only ever returns the logged-in user's own data.",
  S3: "Confirm your login and any paywall are enforced on the server, not just hidden in the browser.",
  S4: "Confirm private pages and files cannot be reached just by guessing an ID in the URL.",
  S8: "Never open a secrets file inside an AI-connected code editor.",
  S9: "When you change a secret, update it everywhere it is stored and redeploy.",
  S12: "Confirm your own server is locked down (no shortcut admin access, admins use two-step login).",
  S15: "Confirm error messages shown to users do not leak internal details, and user content cannot inject code.",
  S16: "Confirm admin access cannot be self-granted, and login links cannot be forged.",
  S17: "Confirm public endpoints check who is calling before doing anything sensitive.",
  D2: "Confirm there is one clear source of truth for your database structure.",
  D3: "Confirm your database rules allow every value your code actually saves.",
  D4: "Confirm work that cannot finish is marked failed and flagged, never silently skipped.",
  D5: "Confirm two copies of the same scheduled job cannot do the same work twice.",
  D6: "Confirm dates are handled in the user's timezone (test around midnight and month ends).",
  D7: "Confirm important records are kept as history, not overwritten or deleted.",
  D8: "Confirm money is handled as numbers, and database queries are safe from injection.",
  D9: "Confirm uploaded files go to proper storage, not a temporary folder that gets wiped.",
  D10: "Confirm personal data is encrypted, and your database types match the real database.",
  E3: "Send yourself a real signup email in Gmail and Outlook and check it looks right.",
  E4: "Send app emails from a subdomain (like mail.yourapp.com), with the From address on the domain your provider verified.",
  E5: "Send a test email to mail-tester.com and aim for 9 out of 10 or better.",
  E6: "Add your email DNS records carefully so they do not get split or broken.",
  E7: "Restart your app after changing settings, or email may silently stay switched off.",
  E8: "Handle the case where an email scanner clicks a one-time link before the person does.",
  SEO6: "Consider putting the app on a subdomain and marketing on the main domain.",
  SEO8: "Make your link preview image a designed card, not a raw screenshot.",
  SP1: "Run a free speed test (like PageSpeed Insights) on mobile and fix the worst issues.",
  SP2: "Compress your images; they are almost always what makes a page slow.",
  SP3: "Make sure the page does not jump around as it loads.",
  SP4: "Remove unused code libraries, but confirm each one is really unused first.",
  SP6: "Do not offer buttons that do nothing, and do not blank the whole page on a small error.",
  SP7: "Confirm the app does not crash on first load (browser-only code guarded).",
  SP8: "Confirm your mobile layout rules actually win over the desktop ones.",
  A2: "Track real-world load speed from the first day.",
  A4: "Set up at least one funnel so you can see where people drop off.",
  A6: "Confirm you never save personal data or secret keys into your logs.",
  A7: "If you use session recordings (replays of real visits), get consent and record only a sample.",
  A8: "Consider an admin screen so you can see what is happening inside your app.",
  A9: "Confirm your analytics actually records a visit on the live site (test with ad blockers off).",
  L2: "Know who is legally responsible for sales tax (with plain Stripe, it is you).",
  L5: "For enterprise clients, keep data in the required region and sign a data agreement.",
  L6: "Keep personal data and internal notes out of the code repo, especially if it goes public.",
  P3: "Confirm every 'payment received' path does the same thing (one shared handler).",
  P4: "Confirm Stripe and your database stay in step (Stripe is the source of truth).",
  P5: "Confirm tax is calculated and stored properly, with the rate saved.",
  P6: "Pause anything that charges money during a deploy, and use test keys on test versions.",
  P7: "Confirm any third-party connection uses that provider's current permission settings.",
  DP1: "Protect your main branch, and do not approve your own changes.",
  DP2: "Confirm a deploy only happens after the automatic checks pass.",
  DP3: "Base each change on the main branch, not on another unfinished change.",
  DP4: "Confirm every security setting is actually switched on in production, not just written down.",
  DP5: "If you use infrastructure config files, review the plan before applying so nothing gets destroyed.",
  DP6: "Confirm deploys use short-lived keys and cannot touch the wrong account.",
  DP7: "Confirm a fresh backup exists before each deploy, and you know how to roll back.",
  DP8: "If a push goes straight live, treat it like publishing: confirm before you push.",
  DP11: "Keep your setup as simple as it can be for now.",
  T1: "Open your app in a second browser and on a computer, and walk the main flow.",
  T2: "Walk your main flow on a real phone, and check mobile has the same features.",
  T3: "Click every link and button.",
  T4: "Try to break your forms: submit empty, put text where numbers go, double-click.",
  T5: "Check your 'page not found' page looks right (auto-checked if you give a URL).",
  T7: "Open the running app in a browser and confirm it renders before shipping a change.",
  T8: "Test odd inputs: blank, emoji, very large numbers, unusual dates.",
  T9: "Actually try to break your own security, do not just assume it is fine.",
  T10: "Test on your own machine first, and make sure tests cannot touch real data.",
  O1: "Set up something that pings your site and alerts you if it goes down.",
  O2: "Back up automatically, and actually try restoring one.",
  O3: "Keep an eye on your spend, and know the cost of changes you make.",
  O4: "Write down the emergency steps now, while things are calm.",
  O5: "Turn on two-step login for every admin, and keep a log of admin actions.",
  O6: "Keep your notes and docs up to date as the app changes.",
  O7: "Check the simple explanation first before assuming the worst.",
  O8: "Use separate copies of outside services for testing and live, and update every webhook.",
};

// T5 gets a live probe if a URL is given
detectors.T5 = (c) => {
  const p = c.probes;
  if (p && p.notFound) return P("A custom 404 page is served for unknown URLs");
  if (p && p.notFoundLoginPath && privateApp(c)) return P(`Unknown URLs redirect to sign-in (${p.notFoundLoginPath}), which is normal for a private app`);
  if (p && p.notFound === false) return F("Unknown URLs do not return a proper 404 page");
  return M(manualNote.T5);
};

export async function runDetectors(ctx, checks) {
  const result = {};
  for (const chk of checks) {
    const d = detectors[chk.id];
    try {
      if (d) result[chk.id] = await d(ctx);
      else if (manualNote[chk.id]) result[chk.id] = M(manualNote[chk.id]);
      else result[chk.id] = M("Verify this manually.");
    } catch (e) {
      result[chk.id] = M("Detector error: " + (e && e.message ? e.message : "unknown"));
    }
  }
  return result;
}
