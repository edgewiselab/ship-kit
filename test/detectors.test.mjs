// Every detector against small real projects on disk. Each case pins down one behaviour,
// including the false passes and false failures fixed in 1.1.0.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detect, pkg } from "./helpers.mjs";

const is = (r, status, match) => {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${r.evidence}`);
  if (match) assert.match(r.evidence, match);
};

describe("F1 secrets out of git", () => {
  test("a committed .env fails", async () => is(await detect("F1", { ".env": "KEY=1", ".gitignore": "node_modules\n" }, { git: true }), "fail", /\.env is tracked/));
  test(".env.sample and .env.template are templates, not secrets", async () =>
    is(await detect("F1", { ".env.sample": "KEY=", ".env.template": "KEY=", ".gitignore": ".env*\n!.env.sample\n" }, { git: true }), "pass"));
  test("gitignored .env with an example passes", async () => is(await detect("F1", { ".gitignore": ".env\n", ".env.example": "KEY=" }), "pass", /\.env\.example/));
  test("no .gitignore at all is manual", async () => is(await detect("F1", { "index.js": "" }), "manual"));
  test(".gitignore without .env fails", async () => is(await detect("F1", { ".gitignore": "node_modules\n" }), "fail"));
});

describe("F4 AI project brief", () => {
  test("CLAUDE.md passes", async () => is(await detect("F4", { "CLAUDE.md": "# x" }), "pass", /CLAUDE\.md/));
  test("AGENTS.md alone passes", async () => is(await detect("F4", { "AGENTS.md": "# x" }), "pass", /AGENTS\.md/));
  test("no brief fails", async () => is(await detect("F4", { "README.md": "" }), "fail"));
});

describe("S1 database locked down", () => {
  const supa = { "package.json": pkg({ "@supabase/supabase-js": "2" }) };
  test("Supabase: every table has RLS", async () => is(await detect("S1", { ...supa,
    "supabase/migrations/001.sql": "create table profiles (id uuid);\nalter table profiles enable row level security;" }), "pass", /all 1 tables/));
  test("Supabase: one table without RLS fails and is named", async () => is(await detect("S1", { ...supa,
    "supabase/migrations/001.sql": "create table profiles (id uuid); alter table profiles enable row level security;",
    "supabase/migrations/002.sql": "create table messages (id uuid);" }), "fail", /1 of 2 tables.*messages/));
  test("Supabase: RLS on only the first table no longer passes the whole project", async () => is(await detect("S1", { ...supa,
    "supabase/migrations/001.sql": "create table a (id int); alter table a enable row level security; create table b (id int); create table c (id int);" }), "fail", /2 of 3/));
  test("Supabase with no migrations in the repo is manual (dashboard-made tables)", async () => is(await detect("S1", supa), "manual", /Table Editor/));
  test("Supabase declared in the profile is enough to require RLS", async () => is(await detect("S1",
    { "db/migrations/001.sql": "create table notes (id int);" }, { profile: { db: "supabase" } }), "fail"));
  test("Prisma on plain Postgres is not failed for lacking RLS", async () => is(await detect("S1", {
    "package.json": pkg({ "@prisma/client": "5" }),
    "prisma/migrations/2024_init/migration.sql": `CREATE TABLE "User" (id text);` }), "manual", /app-layer/));
  test("profile postgres is manual", async () => is(await detect("S1", {}, { profile: { db: "postgres" } }), "manual"));
  test("firebase is manual", async () => is(await detect("S1", {}, { profile: { db: "firebase" } }), "manual", /Firebase/));
  test("seed files are not treated as schema", async () => is(await detect("S1", { ...supa,
    "supabase/migrations/001.sql": "create table a (id int); alter table a enable row level security;",
    "supabase/seed.sql": "create table scratch (id int);" }), "pass"));
});

describe("S5 exposed .env", () => {
  test("no URL is manual", async () => is(await detect("S5", {}), "manual"));
  test("exposed path fails", async () => is(await detect("S5", {}, { probes: { envPaths: [{ path: "/.env", exposed: true }] } }), "fail", /\/\.env/));
  test("nothing exposed passes", async () => is(await detect("S5", {}, { probes: { envPaths: [{ path: "/.env", exposed: false }] } }), "pass"));
});

describe("S6 frontend secrets", () => {
  test("a live Stripe key in client code fails", async () => is(await detect("S6", { "src/components/Pay.tsx": `const k = "sk_live_abcdefghijklmnop";` }), "fail", /Pay\.tsx/));
  test("a new-format Supabase secret key in client code fails", async () => is(await detect("S6", { "src/lib/supa.ts": `createClient(url, "sb_secret_abcdefghijklmnop")` }), "fail"));
  test("an Anthropic key in client code fails", async () => is(await detect("S6", { "src/app/chat.tsx": `const key = "sk-ant-api03-abcdefghijklmnop";` }), "fail"));
  test("an OpenAI project key in client code fails", async () => is(await detect("S6", { "src/app/chat.tsx": `const key = "sk-proj-abcdefghijklmnop";` }), "fail"));
  test("VITE_OPENAI_API_KEY in a (gitignored) .env fails: Vite bundles it", async () =>
    is(await detect("S6", { ".gitignore": ".env\n", ".env": "VITE_OPENAI_API_KEY=sk-123", "src/main.tsx": "" }), "fail", /public env prefix/));
  test("NEXT_PUBLIC_ secret name in code fails", async () =>
    is(await detect("S6", { "src/app/page.tsx": "const s = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY" }), "fail", /public env prefix/));
  test("a publishable key behind a public prefix is fine", async () =>
    is(await detect("S6", { ".env": "VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\nNEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_x" }), "manual"));
  test("server env read in a client file fails", async () => is(await detect("S6", { "src/components/X.tsx": "const t = process.env.OPENAI_API_KEY" }), "fail", /Server env/));
  test("server env in an API route is fine", async () => is(await detect("S6", { "src/app/api/chat/route.ts": "const t = process.env.OPENAI_API_KEY" }), "manual"));
  test("legacy Supabase keys get a retirement note", async () => is(await detect("S6", {
    "package.json": pkg({ "@supabase/supabase-js": "2" }), "src/lib/s.ts": "createClient(url, import.meta.env.VITE_SUPABASE_ANON_KEY)" }), "manual", /retires at the end of 2026/));
  test("projects already on the new Supabase keys get no note", async () => {
    const r = await detect("S6", { "package.json": pkg({ "@supabase/supabase-js": "2" }), "src/lib/s.ts": "createClient(url, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)" });
    is(r, "manual"); assert.doesNotMatch(r.evidence, /retires/);
  });
});

describe("S10 HTTPS", () => {
  test("no URL is manual", async () => is(await detect("S10", {}), "manual"));
  test("https final URL passes", async () => is(await detect("S10", {}, { probes: { https: true, reachable: true } }), "pass"));
  test("plain http with https available fails and says to redirect", async () =>
    is(await detect("S10", {}, { probes: { https: false, reachable: true, httpsAvailable: true } }), "fail", /redirect/));
  test("plain http with no https at all fails", async () =>
    is(await detect("S10", {}, { probes: { https: false, reachable: true, httpsAvailable: false } }), "fail", /does not load/));
  test("TLS failure fails", async () => is(await detect("S10", {}, { probes: { https: false, reachable: false } }), "fail", /certificate/));
  test("timeout is manual", async () => is(await detect("S10", {}, { probes: { https: null, reachable: false } }), "manual"));
});

describe("S11 rate limiting", () => {
  test("a rate-limit library passes", async () => is(await detect("S11", { "package.json": pkg({ "@upstash/ratelimit": "1" }) }), "pass"));
  test("declared AI with no limits fails", async () => is(await detect("S11", { "src/api/chat.ts": "" }, { profile: { ai: true } }), "fail"));
});

describe("S13 dependency gate", () => {
  test("Dependabot passes", async () => is(await detect("S13", { ".github/dependabot.yml": "version: 2" }), "pass", /Dependabot/));
  test("Renovate passes", async () => is(await detect("S13", { "renovate.json": "{}" }), "pass", /Renovate/));
  test("Renovate config in package.json passes", async () => is(await detect("S13", { "package.json": pkg({}, { renovate: { extends: [] } }) }), "pass", /Renovate/));
  test("pnpm audit in CI passes", async () => is(await detect("S13", { ".github/workflows/ci.yml": "run: pnpm audit --prod" }), "pass"));
  test("osv-scanner in CI passes", async () => is(await detect("S13", { ".github/workflows/ci.yml": "uses: google/osv-scanner-action@v2" }), "pass"));
  test("nothing configured fails", async () => is(await detect("S13", { "package.json": pkg({ react: "19" }) }), "fail"));
  test("a known-vulnerable Next.js in the lockfile fails even with Dependabot on", async () => is(await detect("S13", {
    ".github/dependabot.yml": "version: 2",
    "package.json": pkg({ next: "^15.5.0" }),
    "package-lock.json": JSON.stringify({ packages: { "node_modules/next": { version: "15.5.10" } } }) }), "fail", /15\.5\.10.*15\.5\.24/));
  test("vulnerable Next 16 fails", async () => is(await detect("S13", {
    "package.json": pkg({ next: "16.3.2" }) }), "fail", /16\.3\.3/));
  test("a range with no lockfile is manual, not a false alarm", async () => is(await detect("S13", {
    "package.json": pkg({ next: "^15.5.0" }) }), "manual", /No lockfile/));
  test("a patched Next.js falls through to the normal gate", async () => is(await detect("S13", {
    "renovate.json": "{}", "package.json": pkg({ next: "16.3.3" }) }), "pass", /Renovate/));
  test("majors without a listed advisory are not flagged", async () => is(await detect("S13", {
    "renovate.json": "{}", "package.json": pkg({ next: "14.2.0" }) }), "pass"));
});

describe("S14 security headers", () => {
  test("two headers live passes", async () => is(await detect("S14", {}, { probes: { headers: { "content-security-policy": "x", "strict-transport-security": "y" } } }), "pass"));
  test("one header live fails", async () => is(await detect("S14", {}, { probes: { headers: { "x-frame-options": "DENY" } } }), "fail"));
});

describe("S18 untrusted AI input and output", () => {
  test("AI output rendered as raw HTML fails", async () => is(await detect("S18", {
    "src/components/Chat.tsx": "const { messages } = useChat();\nreturn <div dangerouslySetInnerHTML={{ __html: messages[0].content }} />" }), "fail", /Chat\.tsx/));
  test("sanitized raw HTML is not flagged", async () => is(await detect("S18", {
    "src/components/Chat.tsx": "import DOMPurify from 'dompurify';\nconst { messages } = useChat();\nreturn <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m) }} />" }), "manual"));
  test("raw HTML unrelated to AI is not flagged here", async () => is(await detect("S18", {
    "src/components/Blog.tsx": "return <div dangerouslySetInnerHTML={{ __html: post.body }} />" }), "manual"));
  test("tool-calling gets the permissions reminder", async () => is(await detect("S18", {
    "src/app/api/chat/route.ts": "streamText({ model, tools: { lookupOrder } })" }), "manual", /re-checks the logged-in user/));
});

describe("D1 migrations", () => {
  test("Prisma migrations pass (tracked by the tool)", async () => is(await detect("D1", {
    "prisma/migrations/2024_init/migration.sql": `CREATE TABLE "User" (id text);` }), "pass", /Prisma/));
  test("Supabase CLI migrations pass", async () => is(await detect("D1", {
    "supabase/migrations/20240101_init.sql": "create table a (id int);" }), "pass", /Supabase/));
  test("Drizzle migrations with a journal pass", async () => is(await detect("D1", {
    "migrations/0000_init.sql": "CREATE TABLE a (id int);", "migrations/meta/_journal.json": "{}" }), "pass", /Drizzle/));
  test("hand-run migrations without guards fail and name a file", async () => is(await detect("D1", {
    "db/migrations/001.sql": "create table if not exists a (id int);", "db/migrations/002.sql": "alter table a add column b int;" }), "fail", /1 of 2.*002\.sql/));
  test("hand-run migrations all guarded pass", async () => is(await detect("D1", {
    "db/migrations/001.sql": "create table if not exists a (id int);", "db/migrations/002.sql": "alter table a add column if not exists b int;" }), "pass"));
  test("no migrations is manual", async () => is(await detect("D1", {}), "manual"));
});

describe("E1 SPF / DMARC", () => {
  const dnsOf = (records) => async (name) => {
    if (records[name] instanceof Error) throw records[name];
    if (!(name in records)) { const e = new Error("no data"); e.code = "ENODATA"; throw e; }
    return records[name].map((r) => [r]);
  };
  const profile = { domain: "app.test" };
  test("no domain is manual", async () => is(await detect("E1", {}), "manual"));
  test("SPF + enforcing DMARC passes", async () => is(await detect("E1", {}, { profile, resolveTxt: dnsOf({
    "app.test": ["v=spf1 include:_spf.resend.com ~all"], "_dmarc.app.test": ["v=DMARC1; p=quarantine; rua=mailto:d@app.test"] }) }), "pass", /p=quarantine/));
  test("DMARC at p=none passes with a nudge to tighten", async () => is(await detect("E1", {}, { profile, resolveTxt: dnsOf({
    "app.test": ["v=spf1 ~all"], "_dmarc.app.test": ["v=DMARC1; p=none"] }) }), "pass", /tighten/));
  test("no DMARC record fails (a missing record is an answer, not a DNS error)", async () => is(await detect("E1", {}, { profile, resolveTxt: dnsOf({
    "app.test": ["v=spf1 ~all"] }) }), "fail", /No DMARC/));
  test("DMARC but no root SPF is manual (may send from a subdomain)", async () => is(await detect("E1", {}, { profile, resolveTxt: dnsOf({
    "app.test": ["google-site-verification=x"], "_dmarc.app.test": ["v=DMARC1; p=reject"] }) }), "manual", /subdomain/));
  test("TXT records split into chunks are joined", async () => is(await detect("E1", {}, { profile, resolveTxt: async (n) =>
    n === "app.test" ? [["v=spf1 ", "include:x ~all"]] : [["v=DMARC1; ", "p=reject"]] }), "pass", /p=reject/));
  test("a real network failure is manual", async () => {
    const err = new Error("refused"); err.code = "ECONNREFUSED";
    is(await detect("E1", {}, { profile, resolveTxt: dnsOf({ "app.test": err, "_dmarc.app.test": err }) }), "manual", /Could not resolve/);
  });
});

describe("E2 / E9 email", () => {
  test("a provider SDK passes E2", async () => is(await detect("E2", { "package.json": pkg({ resend: "4" }) }), "pass"));
  test("declared email without an SDK fails E2", async () => is(await detect("E2", {}, { profile: { email: "resend" } }), "fail"));
  test("List-Unsubscribe passes E9", async () => is(await detect("E9", { "src/mail.ts": "headers: { 'List-Unsubscribe': url }" }), "pass"));
});

describe("SEO", () => {
  test("SEO1 og tags in source pass", async () => is(await detect("SEO1", { "app/layout.tsx": "export const metadata = { openGraph: {} }" }), "pass"));
  test("SEO1 live homepage without og:image fails", async () => is(await detect("SEO1", {}, { probes: { og: false } }), "fail"));
  test("SEO2 sitemap in project passes", async () => is(await detect("SEO2", { "public/sitemap.xml": "<urlset/>" }), "pass"));
  test("SEO3 robots blocking everything fails", async () => is(await detect("SEO3", {}, { probes: { robotsBlocksAll: true } }), "fail"));
  test("SEO5 localhost left in shipped code fails", async () => is(await detect("SEO5", { "src/api.ts": `const API = "http://localhost:3000";` }), "fail", /src\/api\.ts/));
  test("SEO5 localhost in tooling dirs is ignored", async () => is(await detect("SEO5", { ".claude/settings.json": `"http://localhost:3000"` }), "manual"));
  test("SEO7 robots.txt in project passes", async () => is(await detect("SEO7", { "public/robots.txt": "User-agent: *" }), "pass"));
});

describe("A1 analytics", () => {
  test("PostHog package passes", async () => is(await detect("A1", { "package.json": pkg({ "posthog-js": "1" }) }), "pass"));
  test("a Plausible script tag passes", async () => is(await detect("A1", { "index.html": `<script defer src="https://plausible.io/js/script.js"></script>` }), "pass"));
  test("Umami passes", async () => is(await detect("A1", { "index.html": `<script src="https://cloud.umami.is/script.js"></script>` }), "pass"));
  test("nothing fails", async () => is(await detect("A1", { "index.html": "<p>hi</p>" }), "fail"));
});

describe("A5 error tracking", () => {
  for (const d of ["@sentry/nextjs", "@sentry/sveltekit", "@sentry/vue", "@sentry/astro", "@sentry/remix", "@highlight-run/next", "@bugsnag/js", "rollbar"]) {
    test(`${d} passes`, async () => is(await detect("A5", { "package.json": pkg({ [d]: "1" }) }), "pass"));
  }
  test("nothing fails", async () => is(await detect("A5", { "package.json": pkg({ react: "19" }) }), "fail"));
});

describe("L1 privacy and terms", () => {
  const accounts = { "package.json": pkg({ "next-auth": "5" }) };
  test("photos.tsx is not a Terms page (the old false pass)", async () => is(await detect("L1", { ...accounts,
    "src/pages/photos.tsx": "", "src/pages/privacy.tsx": "" }), "fail", /Only Privacy/));
  test("TermsOfService.tsx and PrivacyPolicy.tsx pass", async () => is(await detect("L1", { ...accounts,
    "src/pages/TermsOfService.tsx": "", "src/pages/PrivacyPolicy.tsx": "" }), "pass"));
  test("Next.js app-router folders pass", async () => is(await detect("L1", { ...accounts,
    "app/terms/page.tsx": "", "app/privacy/page.tsx": "" }), "pass"));
  test("routes declared in a single-file router (Lovable/Vite) pass", async () => is(await detect("L1", { ...accounts,
    "src/App.tsx": `<Route path="/terms" element={<Legal/>} />\n<Route path="/privacy" element={<Legal/>} />` }), "pass"));
  test("a hosted policy provider counts", async () => is(await detect("L1", { ...accounts,
    "src/Footer.tsx": `<a href="https://app.termly.io/policy-viewer/policy.html?policyUUID=1">Terms</a>\n<a href="https://app.termly.io/policy-viewer/policy.html?policyUUID=2">Privacy</a>` }), "pass"));
  test("static site with a privacy page passes without Terms", async () => is(await detect("L1", { "privacy.html": "" }), "pass", /no Terms needed/));
  test("static site with nothing fails", async () => is(await detect("L1", { "index.html": "" }), "fail", /No Privacy/));
});

describe("L3 / L4 legal", () => {
  test("L3 no tracking is n/a", async () => is(await detect("L3", {}, { profile: { analytics: false } }), "na"));
  test("L4 no deletion code fails", async () => is(await detect("L4", { "src/a.ts": "" }), "fail"));
  test("L4 deletion code found is manual", async () => is(await detect("L4", { "src/api/account.ts": "export async function deleteAccount() {}" }), "manual"));
});

describe("L7 AI disclosure", () => {
  test("a chat UI with no AI notice fails", async () => is(await detect("L7", {
    "src/components/Support.tsx": "const { messages } = useChat(); return <ChatWindow title='Sarah from support' />" }), "fail"));
  test("a chat UI with a notice is manual (confirm placement)", async () => is(await detect("L7", {
    "src/components/Support.tsx": "const { messages } = useChat(); return <p>You are chatting with an AI assistant. It can make mistakes.</p>" }), "manual", /disclosure text found/));
  test("a voice agent SDK counts as user-facing", async () => is(await detect("L7", {
    "package.json": pkg({ "@vapi-ai/web": "2" }), "src/app/page.tsx": "vapi.start()" }), "fail"));
  test("back-office AI with no chat UI is manual", async () => is(await detect("L7", {
    "src/api/summarise.ts": "await openai.chat.completions.create({})" }), "manual"));
});

describe("P1 payment webhooks", () => {
  test("Stripe with a verified webhook is manual (go test it live)", async () => is(await detect("P1", {
    "package.json": pkg({ stripe: "18" }), "src/app/api/webhooks/stripe/route.ts": "stripe.webhooks.constructEvent(body, sig, secret)" }), "manual", /Stripe webhook/));
  test("Stripe with no webhook fails", async () => is(await detect("P1", { "package.json": pkg({ stripe: "18" }) }), "fail", /Stripe installed/));
  test("Polar with validateEvent is manual, not 'no Stripe' (the old bug)", async () => is(await detect("P1", {
    "package.json": pkg({ "@polar-sh/sdk": "0.30" }), "src/app/api/webhook/polar/route.ts": "const event = validateEvent(body, headers, secret)" },
    { profile: { payments: "polar" } }), "manual", /Polar webhook/));
  test("Polar Next.js adapter is recognised", async () => is(await detect("P1", {
    "package.json": pkg({ "@polar-sh/nextjs": "0.4" }), "app/api/webhook/polar/route.ts": "export const POST = Webhooks({ webhookSecret, onOrderPaid })" }), "manual", /Polar/));
  test("Polar with no webhook fails naming Polar", async () => is(await detect("P1", {
    "package.json": pkg({ "@polar-sh/sdk": "0.30" }) }, { profile: { payments: "polar" } }), "fail", /Polar installed/));
  test("Paddle with unmarshal is manual", async () => is(await detect("P1", {
    "package.json": pkg({ "@paddle/paddle-node-sdk": "2" }), "src/webhook.ts": "paddle.webhooks.unmarshal(body, key, sig)" }), "manual", /Paddle/));
  test("payments none is n/a", async () => is(await detect("P1", {}, { profile: { payments: "none" } }), "na"));
});

describe("P2 idempotency", () => {
  test("idempotency key passes", async () => is(await detect("P2", { "src/pay.ts": "stripe.payouts.create(x, { idempotencyKey })" }), "pass"));
});

describe("DP9 lockfile and pinned runtime", () => {
  test("bun.lock (Bun 1.2+ text lockfile) counts", async () => is(await detect("DP9", { "bun.lock": "{}", ".nvmrc": "22" }), "pass"));
  test("bun.lockb still counts", async () => is(await detect("DP9", { "bun.lockb": "x", ".nvmrc": "22" }), "pass"));
  test("engines.node pins the runtime", async () => is(await detect("DP9", { "pnpm-lock.yaml": "", "package.json": pkg({}, { engines: { node: ">=22" } }) }), "pass"));
  test(".node-version pins the runtime", async () => is(await detect("DP9", { "yarn.lock": "", ".node-version": "22" }), "pass"));
  test("lockfile but no pin is manual", async () => is(await detect("DP9", { "package-lock.json": "{}" }), "manual"));
  test("no lockfile fails", async () => is(await detect("DP9", { "package.json": pkg({ react: "19" }) }), "fail"));
});

describe("DP10 terraform ascii", () => {
  test("smart quote in terraform fails", async () => is(await detect("DP10", { "main.tf": `description = "It’s here"` }), "fail"));
  test("plain terraform passes", async () => is(await detect("DP10", { "main.tf": `description = "plain"` }), "pass"));
});

describe("T5 / T6 testing", () => {
  test("T5 proper 404 passes", async () => is(await detect("T5", {}, { probes: { notFound: true } }), "pass"));
  test("T6 unit only fails", async () => is(await detect("T6", { "package.json": pkg({ vitest: "3" }) }), "fail", /Unit tests only/));
  test("T6 e2e in CI is manual", async () => is(await detect("T6", {
    "package.json": pkg({ "@playwright/test": "1" }), ".github/workflows/ci.yml": "run: npx playwright test" }), "manual"));
});
