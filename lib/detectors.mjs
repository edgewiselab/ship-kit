// Per-check detectors. Each returns {status, evidence}.
// status: "pass" | "fail" | "na" | "manual"
// Honest by design: when we cannot be sure, we return "manual" (verify yourself), never a fake pass.
import { promises as dns } from "node:dns";

const P = (evidence) => ({ status: "pass", evidence });
const F = (evidence) => ({ status: "fail", evidence });
const NA = (evidence) => ({ status: "na", evidence });
const M = (evidence) => ({ status: "manual", evidence });

// ---- detectors keyed by check id ----
export const detectors = {

  // ---------- Foundations ----------
  F1: (c) => {
    const tracked = c.gitTracked && [...c.gitTracked].filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f));
    if (tracked && tracked.length) return F(`.env is tracked by git: ${tracked.slice(0, 3).join(", ")}`);
    const ignored = c.isIgnored(".env") || c.isIgnored(".env.local");
    const hasExample = c.has(".env.example") || c.find(/\.env\.example$/).length > 0;
    if (ignored && hasExample) return P(".env is gitignored and .env.example is committed");
    if (ignored) return P(".env is gitignored (consider adding .env.example)");
    if (c.has(".gitignore")) return F(".env is not listed in .gitignore");
    return M("No .gitignore found; confirm secrets are never committed");
  },
  F4: (c) => c.has("CLAUDE.md") ? P("CLAUDE.md present") : F("No CLAUDE.md constitution at repo root"),
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
    const migs = c.find(/migrations?\/.*\.sql$/i).filter((f) => !/legacy|archived/i.test(f));
    if (c.profile.db === "supabase" || migs.length) {
      const rls = c.any(/enable row level security/i, { include: [".sql"], exclude: ["legacy", "archived"] });
      if (rls) return P("RLS enabled in migrations (spot-check a policy exists per table)");
      if (migs.length) return F(`Found ${migs.length} SQL migrations but no "ENABLE ROW LEVEL SECURITY"`);
    }
    return M("Confirm every table with user data is access-controlled");
  },
  S5: (c) => {
    if (!c.probes) return M("Provide --url to auto-check that /.env returns nothing");
    const hits = (c.probes.envPaths || []).filter((p) => p.exposed);
    if (hits.length) return F(`Downloadable config exposed: ${hits.map((h) => h.path).join(", ")}`);
    return P("/.env and /.git/config return no contents");
  },
  S6: (c) => {
    const bad = c.grep(/(sk_live_[0-9a-zA-Z]{10,}|AKIA[0-9A-Z]{16}|service_role|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----)/, { clientOnly: true, limit: 8 });
    if (bad.length) return F(`Possible secret in client code: ${bad[0].file}:${bad[0].line}`);
    const leaky = c.grep(/process\.env\.(?!NEXT_PUBLIC_|VITE_|PUBLIC_)[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)/, { clientOnly: true, limit: 8 });
    if (leaky.length) return F(`Server env used in client file: ${leaky[0].file}:${leaky[0].line}`);
    return M("No obvious frontend secrets found; confirm only NEXT_PUBLIC_/VITE_ vars reach the client");
  },
  S7: (c) => c.gitEnvInHistory ? F(".env appears in git history; rotate every key in it and scrub history") : M("Rotate anything ever leaked; nothing obvious in git history"),
  S10: (c) => {
    if (!c.probes) return M("Provide --url to auto-check HTTPS and the certificate");
    if (c.probes.https === true) return P("HTTPS loads with a valid certificate");
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
    if (c.has(".github/dependabot.yml") || c.has(".github/dependabot.yaml")) return P("Dependabot configured");
    if (c.any(/npm audit/i, { include: [".yml", ".yaml"] })) return P("npm audit runs in CI");
    return F("No Dependabot config and no npm audit gate in CI");
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

  // ---------- Data ----------
  D1: (c) => {
    const migs = c.find(/migrations?\/.*\.sql$/i);
    if (!migs.length) return M("No SQL migrations found; N/A if you use a managed schema tool");
    const idem = c.any(/if not exists/i, { include: [".sql"] });
    return idem ? P("Migrations use IF NOT EXISTS") : F(`${migs.length} migrations found, none use IF NOT EXISTS (not idempotent)`);
  },

  // ---------- Emails ----------
  E1: async (c) => {
    if (!c.profile.domain) return M("Set your domain in the wizard to auto-check SPF/DMARC");
    try {
      const txt = (await dns.resolveTxt(c.profile.domain)).flat().join(" ");
      const spf = /v=spf1/i.test(txt);
      let dmarc = false;
      try { dmarc = (await dns.resolveTxt(`_dmarc.${c.profile.domain}`)).flat().join(" ").includes("v=DMARC1"); } catch {}
      if (spf && dmarc) return P("SPF and DMARC records found (verify DKIM in your provider dashboard)");
      if (spf) return F("SPF found but no DMARC record at _dmarc." + c.profile.domain);
      return F("No SPF record found for " + c.profile.domain);
    } catch (e) { return M("Could not resolve DNS for " + c.profile.domain); }
  },
  E2: (c) => {
    if (c.profile.email === "none") return NA("No email sending declared");
    if (c.dep("resend", "@sendgrid/mail", "postmark", "nodemailer", "@loops/loops", "mailgun.js", "@aws-sdk/client-ses")) return P("A transactional email provider is installed");
    return c.profile.email ? F("Email declared but no provider SDK found in dependencies") : M("Confirm transactional email is wired to a real provider");
  },
  E9: (c) => c.any(/list-unsubscribe/i) ? P("List-Unsubscribe header found") : M("Add one-click unsubscribe to marketing mail (CAN-SPAM)"),

  // ---------- Findability ----------
  SEO1: (c) => {
    if (c.probes && c.probes.og != null) return c.probes.og ? P("og:image tag served on the homepage") : F("No og:image tag on the live homepage");
    return c.any(/og:image|openGraph|opengraph/i, { include: [".ts", ".tsx", ".js", ".jsx", ".html", ".astro", ".svelte", ".vue"] }) ? P("Open Graph tags found in source") : F("No Open Graph / og:image tags found");
  },
  SEO2: (c) => {
    if (c.probes && c.probes.sitemap != null) return c.probes.sitemap ? P("/sitemap.xml is served") : F("/sitemap.xml is not served");
    return (c.has("public/sitemap.xml") || c.find(/sitemap\.(xml|ts|js)$/).length) ? P("Sitemap present in project") : F("No sitemap found");
  },
  SEO3: (c) => {
    if (c.probes && c.probes.robotsBlocksAll === true) return F("robots.txt has a bare 'Disallow: /' blocking the whole site");
    if (c.any(/noindex/i, { include: [".ts", ".tsx", ".html"], exclude: ["test", "admin", "dashboard"] })) return M("A 'noindex' appears in source; confirm it is not on public pages");
    return M("Confirm nothing (robots or noindex) blocks Google from public pages");
  },
  SEO4: (c) => {
    const t = c.any(/<title|title:\s*['"`]|metadata|<meta name="description"/i, { include: [".ts", ".tsx", ".js", ".html", ".astro", ".svelte", ".vue"] });
    return t ? P("Title/description metadata found") : F("No page title/description metadata found");
  },
  SEO5: (c) => {
    const hits = c.grep(/(localhost:\d+|127\.0\.0\.1:\d+|\bstaging\.[a-z0-9.-]+)/i, { exclude: ["test", "spec", ".md", "README", "docker", "compose", ".env", "vite.config", "next.config", "package.json", "scripts/", "/scripts", ".config.", ".claude", ".github", ".vscode", ".idea", "settings.local"], clientOnly: false, limit: 8 });
    // only files that actually ship: skip config/env/logs, any dot-directory (.claude, .impeccable,
    // .github, .vscode... tooling, never deployed), and anything gitignored.
    const real = hits.filter((h) =>
      !/config|\.env|settings|snapshot|session|\.log/i.test(h.file)
      && !/(^|\/)\.[A-Za-z]/.test(h.file)
      && !c.isIgnored(h.file));
    return real.length ? F(`Possible staging/localhost leftover: ${real[0].file}:${real[0].line}`) : M("No obvious localhost/staging leftovers; double-check your preview and canonical URLs");
  },
  SEO7: (c) => {
    if (c.probes && c.probes.robots != null) return c.probes.robots ? P("/robots.txt is served") : F("/robots.txt is not served");
    return (c.has("public/robots.txt") || c.find(/robots\.(txt|ts|js)$/).length) ? P("robots.txt present in project") : F("No robots.txt found");
  },

  // ---------- Speed ----------
  SP5: (c) => c.any(/prefers-reduced-motion/i, { include: [".css", ".scss", ".ts", ".tsx", ".js"] }) ? P("prefers-reduced-motion handling found") : M("Add a reduced-motion fallback; never gate content visibility on a transition"),

  // ---------- Analytics ----------
  A1: (c) => c.dep("posthog-js", "@vercel/analytics", "@amplitude/analytics-browser", "react-ga4", "@segment/analytics-next", "plausible-tracker") || c.any(/gtag\(|googletagmanager|posthog/i) ? P("An analytics library is installed") : F("No analytics library detected"),
  A5: (c) => c.dep("@sentry/nextjs", "@sentry/node", "@sentry/react", "@sentry/browser", "@highlight-run/node", "bugsnag") ? P("An error tracker is installed") : F("No error tracking (e.g. Sentry) detected"),
  A3: (c) => c.dep("@marsidev/react-turnstile") || c.any(/turnstile|hcaptcha|recaptcha/i) ? P("Bot protection (Turnstile/captcha) found") : M("Add Cloudflare Turnstile to signup/contact forms"),

  // ---------- Legal ----------
  L1: (c) => {
    const terms = c.find(/(terms|tos)[^/]*\.(tsx?|jsx?|html|md|mdx|astro|svelte|vue)$/i).length || c.find(/\/(terms|tos)\//i).length;
    const priv = c.find(/privacy[^/]*\.(tsx?|jsx?|html|md|mdx|astro|svelte|vue)$/i).length || c.find(/\/privacy\//i).length;
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
  L3: (c) => {
    if (c.profile.analytics === false) return NA("No tracking declared");
    return c.dep("vanilla-cookieconsent", "react-cookie-consent", "cookieconsent") || c.any(/cookie.?consent|cookie.?banner/i) ? P("Cookie consent component found") : M("Add a cookie banner if you set non-essential cookies");
  },
  L4: (c) => c.any(/delete.?account|deleteaccount|data.?deletion|right.?to.?erasure|gdpr.?delete/i) ? M("Deletion code found; confirm it actually removes user data (incl. backups)") : F("No data-deletion mechanism found (your Privacy Policy will promise one)"),

  // ---------- Payments ----------
  P1: (c) => {
    if (c.profile.payments === "none") return NA("No payments declared");
    const webhook = c.any(/webhooks\.constructEvent|stripe.*webhook|constructEventAsync/i);
    if (webhook) return M("Stripe webhook handler found; test it in LIVE mode with a real card");
    if (c.dep("stripe")) return F("Stripe installed but no webhook handler (webhooks.constructEvent) found");
    if (c.profile.payments) return F("Payments declared but no Stripe integration found");
    return NA("No payment integration detected");
  },
  P2: (c) => {
    if (c.profile.payments === "none") return NA("No payments declared");
    return c.any(/idempotencyKey|idempotency_key|Idempotency-Key/i) ? P("Idempotency key usage found") : M("Make credit/payout issuance idempotent (dedup row + provider idempotency key)");
  },

  // ---------- Deploy ----------
  DP9: (c) => {
    const lock = c.find(/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/).length > 0;
    const pinned = c.has(".nvmrc") || (c.pkg && c.pkg.packageManager);
    if (lock && pinned) return P("Lockfile present and Node/package-manager pinned");
    if (lock) return M("Lockfile present; add .nvmrc or packageManager to pin the version CI uses");
    return F("No lockfile found; commit one and pin the Node/package-manager version");
  },
  DP10: (c) => {
    const tf = c.find(/\.tf$/);
    if (!tf.length) return NA("No Terraform files");
    for (const f of tf) {
      const txt = c.read(f);
      if (txt && /[–—‘’“”]/.test(txt)) return F(`Non-ASCII (em-dash/smart quote) in ${f}; AWS rejects it in resource attributes`);
    }
    return P("Terraform strings are plain ASCII");
  },

  // ---------- Testing ----------
  T6: (c) => {
    const unit = c.dep("jest", "vitest", "mocha", "@testing-library/react");
    const e2e = c.dep("@playwright/test", "playwright", "cypress");
    const ciRunsTests = c.any(/(playwright|cypress|npm test|npm run test|vitest|jest)/i, { include: [".yml", ".yaml"] });
    if (e2e && ciRunsTests) return M("E2E framework present and referenced in CI; confirm the happy path actually runs and passes in CI");
    if (e2e) return F("E2E framework installed but not referenced in any CI workflow");
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
  if (c.probes && c.probes.notFound != null) return c.probes.notFound ? P("A custom 404 page is served for unknown URLs") : F("Unknown URLs do not return a proper 404 page");
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
