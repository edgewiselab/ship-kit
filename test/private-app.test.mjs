// Regressions from a scan of a private, invite-only, self-hosted Next.js 16 App Router app
// (Drizzle + Postgres, custom JWT auth, Resend via fetch, node:test, AWS). Six of its ten
// "fix" items were false positives; each case below pins one of them down.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detect, ctxFor, makeProject, pkg } from "./helpers.mjs";
import { detectCapabilities, naMapFromCapabilities } from "../lib/capabilities.mjs";
import { runProbes } from "../lib/probes.mjs";

const is = (r, status, match) => {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${r.evidence}`);
  if (match) assert.match(r.evidence, match);
};
const next = pkg({ next: "16.3.3", react: "19" });

describe("1. S6: Next.js server components are not client files", () => {
  test("process.env in an App Router page (server component) is not flagged", async () =>
    is(await detect("S6", { "package.json": next, "app/dashboard/page.tsx": "const db = process.env.DATABASE_SECRET;" }), "manual"));
  test("process.env in src/app layout is not flagged", async () =>
    is(await detect("S6", { "package.json": next, "src/app/layout.tsx": "const k = process.env.SESSION_SECRET_KEY" }), "manual"));
  test("a 'use client' component reading a server secret IS flagged", async () =>
    is(await detect("S6", { "package.json": next, "app/settings/Form.tsx": `"use client";\nconst k = process.env.STRIPE_SECRET_KEY;` }), "fail", /Form\.tsx/));
  test("the directive is found after leading comments", async () =>
    is(await detect("S6", { "package.json": next, "app/x/Widget.tsx": `// widget\n/* shared */\n'use client'\nconst k = process.env.API_TOKEN` }), "fail"));
  test("a literal secret in a client component is still caught", async () =>
    is(await detect("S6", { "package.json": next, "app/pay/Pay.tsx": `"use client"\nconst k = "sk_live_abcdefghijklmnop"` }), "fail"));
  test("Next.js pages/ keeps the path rule", async () =>
    is(await detect("S6", { "package.json": next, "pages/index.tsx": "const k = process.env.API_SECRET" }), "fail"));
  test("a Vite app's src/ keeps the path rule", async () =>
    is(await detect("S6", { "package.json": pkg({ vite: "7", react: "19" }), "src/App.tsx": "const k = process.env.API_SECRET" }), "fail"));
});

describe("2. E2 / email capability: provider APIs called with fetch", () => {
  const resendFetch = { "package.json": next, "lib/email.ts": `await fetch("https://api.resend.com/emails", { method: "POST" })` };
  test("E2 passes on a direct Resend API call", async () => is(await detect("E2", resendFetch, { profile: { email: "resend" } }), "pass", /lib\/email\.ts/));
  test("email is detected without --email, so E1-E9 are not skipped", () => {
    const caps = detectCapabilities(ctxFor(resendFetch), {});
    assert.equal(caps.hasEmail, true);
    assert.ok(!naMapFromCapabilities(caps).has("E2"));
  });
  for (const host of ["api.postmarkapp.com/email", "api.mailgun.net/v3/x/messages", "email.eu-west-1.amazonaws.com", "api.sendgrid.com/v3/mail/send"]) {
    test(`${host.split("/")[0]} counts`, async () => is(await detect("E2", { "src/mail.ts": `fetch("https://${host}")` }), "pass"));
  }
  test("declared email with nothing wired still fails", async () => is(await detect("E2", { "src/a.ts": "" }, { profile: { email: "resend" } }), "fail", /no provider SDK or provider API/));
});

describe("3. T6: Node's built-in runner and custom test scripts", () => {
  test("node --import tsx --test is a test framework", async () => is(await detect("T6", {
    "package.json": pkg({}, { scripts: { test: "node --import tsx --test tests/*.test.ts" } }) }), "fail", /Unit tests only/));
  test("an import of node:test counts", async () => is(await detect("T6", { "tests/a.test.ts": `import { test } from "node:test";` }), "fail", /Unit tests only/));
  test("bun test and deno test count", async () => {
    is(await detect("T6", { "package.json": pkg({}, { scripts: { test: "bun test" } }) }), "fail", /Unit tests only/);
    is(await detect("T6", { "package.json": pkg({}, { scripts: { test: "deno test -A" } }) }), "fail", /Unit tests only/);
  });
  test("pytest counts", async () => is(await detect("T6", { "package.json": pkg({}, { scripts: { test: "pytest -q" } }) }), "fail", /Unit tests only/));
  test("custom integration/browser scripts run in CI are 'verify', not 'fail'", async () => is(await detect("T6", {
    "package.json": pkg({ puppeteer: "24" }, { scripts: { test: "node --test", "test:integration": "node scripts/integration.mjs" } }),
    ".github/workflows/ci.yml": "steps:\n  - run: npm test\n  - run: npm run test:integration" }), "manual", /Integration or browser/));
  test("custom scripts that CI never runs still fail, with the reason", async () => is(await detect("T6", {
    "package.json": pkg({}, { scripts: { test: "node --test", "test:e2e": "node scripts/browser.mjs" } }) }), "fail", /no CI workflow runs them/));
  test("nothing at all still fails", async () => is(await detect("T6", { "package.json": pkg({ react: "19" }) }), "fail", /No test framework/));
});

describe("4. SEO5: deploy-time health checks are not leftovers", () => {
  for (const f of ["deploy/release.sh", "infra/healthcheck.ts", "ops/smoke.js", "bin/check.js", "deploy/terraform/main.tf.json", "fly.toml"]) {
    test(`${f} is ignored`, async () => is(await detect("SEO5", { [f]: "curl -fsS http://127.0.0.1:3000/api/health" }), "manual"));
  }
  test("localhost in shipped app code is still caught", async () =>
    is(await detect("SEO5", { "deploy/release.sh": "curl http://127.0.0.1:3000/api/health", "app/lib/api.ts": `const API = "http://localhost:3000"` }), "fail", /app\/lib\/api\.ts/));
});

describe("5. Private apps: SEO2, SEO3, SEO7, T5", () => {
  const loginOnly = { homeLoginPath: "/login", robots: true, robotsBlocksAll: true, noindexHeader: true, sitemap: false, notFound: false, notFoundLoginPath: "/login" };
  test("SEO2: no sitemap needed", async () => is(await detect("SEO2", {}, { probes: loginOnly }), "na", /redirects to sign-in/));
  test("SEO3: blocking crawlers is correct", async () => is(await detect("SEO3", {}, { probes: loginOnly }), "na"));
  test("SEO7: Disallow + noindex passes", async () => is(await detect("SEO7", {}, { probes: loginOnly }), "pass", /Disallow.*noindex/));
  test("SEO7: a private app with nothing blocking crawlers is told to add it", async () =>
    is(await detect("SEO7", {}, { probes: { homeLoginPath: "/sign-in", robots: false } }), "manual", /Disallow: \//));
  test("T5: unknown URLs redirecting to sign-in pass", async () => is(await detect("T5", {}, { probes: loginOnly }), "pass", /redirect to sign-in/));
  test("--private true works without a URL", async () => {
    is(await detect("SEO2", {}, { profile: { private: true } }), "na", /marked this as a private app/);
    is(await detect("SEO7", {}, { profile: { private: true } }), "manual");
  });
  test("--private false overrides the probe (a public site that redirects is flagged)", async () =>
    is(await detect("SEO3", {}, { profile: { private: false }, probes: loginOnly }), "fail", /Disallow/));
  test("a public site with Disallow: / still fails SEO3 and hints at --private", async () =>
    is(await detect("SEO3", {}, { probes: { robots: true, robotsBlocksAll: true } }), "fail", /--private true/));
  test("noindex alone does not make a site private (the accidental staging noindex)", async () =>
    is(await detect("SEO3", {}, { probes: { noindexHeader: true } }), "fail", /noindex/));
  test("a public site whose unknown URLs redirect to login still fails T5", async () =>
    is(await detect("T5", {}, { probes: { notFound: false, notFoundLoginPath: "/login" } }), "fail"));
});

describe("5b. Probes: private-app signals and redirect targets", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  // every path on this site redirects anonymous visitors to /login, except robots.txt
  const site = (robotsServed) => {
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      const html = { status: 200, url: "https://app.test/login", body: "<!doctype html><form>Sign in</form>", headers: { "x-robots-tag": "noindex, nofollow" } };
      const r = path === "/robots.txt" && robotsServed ? { status: 200, url, body: "User-agent: *\nDisallow: /\n", headers: { "content-type": "text/plain" } } : html;
      return { ok: true, status: r.status, url: r.url, headers: new Headers({ "content-type": "text/html", ...r.headers }), text: async () => r.body };
    };
  };
  test("a homepage that lands on /login is recorded, with the noindex header", async () => {
    site(true);
    const p = await runProbes("https://app.test");
    assert.equal(p.homeLoginPath, "/login");
    assert.equal(p.noindexHeader, true);
    assert.equal(p.robots, true);
    assert.equal(p.robotsBlocksAll, true);
    assert.equal(p.notFoundLoginPath, "/login");
  });
  test("robots.txt that redirects to the login page is NOT a robots file", async () => {
    site(false);
    const p = await runProbes("https://app.test");
    assert.equal(p.robots, false);
    assert.equal(p.sitemap, false);
  });
  test("a .env path that redirects elsewhere is never 'exposed'", async () => {
    globalThis.fetch = async (url) => ({ ok: true, status: 200, url: "https://app.test/", headers: new Headers({ "content-type": "text/plain" }), text: async () => "KEY=value" });
    const p = await runProbes("https://app.test");
    assert.ok(p.envPaths.every((e) => !e.exposed));
  });
});

describe("6. Custom auth is detected", () => {
  const authOf = (files) => detectCapabilities(ctxFor(files), {}).hasAuth;
  test("jose counts", () => assert.ok(authOf({ "package.json": pkg({ jose: "6" }) })));
  test("bcryptjs counts", () => assert.ok(authOf({ "package.json": pkg({ bcryptjs: "3" }) })));
  test("a readSession() helper counts", () => assert.ok(authOf({ "lib/session.ts": "export async function readSession() {}" })));
  test("jwtVerify( counts", () => assert.ok(authOf({ "lib/auth.ts": "await jwtVerify(token, key)" })));
  test("an httpOnly session cookie counts", () => assert.ok(authOf({ "lib/auth.ts": "cookies().set('session', t, { httpOnly: true })" })));
  test("S3 and S16 are no longer skipped", () => {
    const na = naMapFromCapabilities(detectCapabilities(ctxFor({ "package.json": pkg({ jose: "6" }) }), {}));
    assert.ok(!na.has("S3") && !na.has("S16"));
  });
  test("a plain site is still not an auth app", () => assert.ok(!authOf({ "index.html": "<p>hi</p>" })));
});

describe("7. Terraform JSON is Terraform", () => {
  test("*.tf.json counts as infrastructure", () => assert.ok(detectCapabilities(ctxFor({ "deploy/terraform/main.tf.json": "{}" }), {}).hasInfra));
  test("DP10 reads *.tf.json", async () => {
    is(await detect("DP10", { "deploy/terraform/main.tf.json": `{"resource":{}}` }), "pass");
    is(await detect("DP10", { "deploy/terraform/main.tf.json": `{"description":"It’s"}` }), "fail", /main\.tf\.json/);
  });
});

describe("8. Sentry 11 collects cookies, headers and bodies by default (A5 / A6)", () => {
  const sentry = (version, extra = {}) => ({
    "package.json": pkg({ "@sentry/nextjs": `^${version}` }),
    "package-lock.json": JSON.stringify({ packages: { "node_modules/@sentry/nextjs": { version } } }),
    ...extra,
  });
  test("v11 with no dataCollection fails A6", async () => is(await detect("A6", sentry("11.2.0")), "fail", /dataCollection/));
  test("v11 with dataCollection set is manual", async () =>
    is(await detect("A6", sentry("11.2.0", { "sentry.server.config.ts": "Sentry.init({ dataCollection: { cookies: false, httpBodies: false } })" })), "manual"));
  test("v11 from a package.json range only is manual, not a false alarm", async () =>
    is(await detect("A6", { "package.json": pkg({ "@sentry/nextjs": "^11.0.0" }) }), "manual", /no lockfile/));
  test("v10 is manual", async () => is(await detect("A6", sentry("10.40.0")), "manual"));
  test("v10 with sendDefaultPii: true is called out", async () =>
    is(await detect("A6", sentry("10.40.0", { "sentry.client.config.ts": "Sentry.init({ sendDefaultPii: true })" })), "manual", /sendDefaultPii/));
  test("A5 still passes, and points at A6", async () => is(await detect("A5", sentry("11.2.0")), "pass", /A6/));
  test("no Sentry: A6 is the plain manual note", async () => is(await detect("A6", { "package.json": pkg({}) }), "manual"));
});

describe("End to end: the reported app shape", () => {
  const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  test("the six false positives are gone", () => {
    const root = makeProject({
      "package.json": pkg({ next: "16.3.3", react: "19", "drizzle-orm": "0.44", pg: "8", jose: "6", bcryptjs: "3", "@sentry/nextjs": "^11.2.0" },
        { scripts: { test: "node --import tsx --test tests/*.test.ts" }, engines: { node: ">=22" } }),
      "package-lock.json": JSON.stringify({ packages: { "node_modules/next": { version: "16.3.3" }, "node_modules/@sentry/nextjs": { version: "11.2.0" } } }),
      "app/dashboard/page.tsx": "const url = process.env.DATABASE_URL; const secret = process.env.JWT_SECRET_KEY;",
      "app/login/LoginForm.tsx": `"use client";\nexport function LoginForm() { return null }`,
      "lib/session.ts": "export async function readSession() { return jwtVerify(token, key) }",
      "lib/email.ts": `await fetch("https://api.resend.com/emails", { method: "POST" })`,
      "tests/auth.test.ts": `import { test } from "node:test";`,
      "deploy/release.sh": "curl -fsS http://127.0.0.1:3000/api/health",
      "deploy/terraform/main.tf.json": "{}",
      "drizzle/0000_init.sql": "CREATE TABLE users (id serial);",
      ".gitignore": ".env*\n",
      ".github/dependabot.yml": "version: 2",
    }, { git: true });
    execFileSync(process.execPath, [CLI, "scan", "--yes", "--project", root, "--email", "resend", "--cloud", "aws", "--payments", "none", "--private", "true"], { stdio: "ignore" });
    const r = JSON.parse(readFileSync(join(root, "ship-kit-report", "report.json"), "utf8"));
    const st = (id) => r.checks.find((c) => c.id === id);
    assert.notEqual(st("S6").status, "fail", st("S6").evidence);
    assert.equal(st("E2").status, "pass", st("E2").evidence);
    assert.match(st("T6").evidence, /Unit tests only/); // a real, honest finding, not "no framework"
    assert.notEqual(st("SEO5").status, "fail", st("SEO5").evidence);
    assert.equal(st("SEO2").status, "na");
    assert.notEqual(st("SEO7").status, "fail");
    for (const id of ["S3", "S16"]) assert.notEqual(st(id).status, "na", `${id} should apply to a custom-auth app`);
    assert.equal(st("DP10").status, "pass", st("DP10").evidence);
    assert.equal(st("A6").status, "fail"); // the real Sentry 11 finding
  });
});
