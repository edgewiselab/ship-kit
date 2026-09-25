// End to end: run the real CLI the way an AI agent does (non-interactive, no network).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, pkg } from "./helpers.mjs";
import { VERSION } from "../lib/version.mjs";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const cli = (args, cwd) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
const report = (root) => JSON.parse(readFileSync(join(root, "ship-kit-report", "report.json"), "utf8"));
const status = (r, id) => r.checks.find((c) => c.id === id).status;

describe("cli", () => {
  test("--version and help", () => {
    assert.equal(cli(["--version"]).trim(), VERSION);
    assert.match(cli(["help"]), /--kind static\|webapp\|saas/);
  });

  test("unknown command exits non-zero", () => {
    assert.throws(() => execFileSync(process.execPath, [CLI, "bogus"], { stdio: "pipe" }));
  });

  test("scans a Supabase + Stripe SaaS and writes all three outputs", () => {
    const root = makeProject({
      "package.json": pkg({ next: "16.3.3", stripe: "18", "@supabase/supabase-js": "2", "@supabase/ssr": "0", "@sentry/nextjs": "9", openai: "5" }),
      "package-lock.json": JSON.stringify({ packages: { "node_modules/next": { version: "16.3.3" } } }),
      ".nvmrc": "22",
      ".gitignore": ".env*\n",
      ".env.example": "STRIPE_SECRET_KEY=",
      "supabase/migrations/001_init.sql": "create table profiles (id uuid); alter table profiles enable row level security;\ncreate table invoices (id uuid);",
      "app/api/webhooks/stripe/route.ts": "stripe.webhooks.constructEvent(body, sig, secret)",
      "app/api/chat/route.ts": "export async function POST() { return openai.chat.completions.create({}) }",
      "app/terms/page.tsx": "", "app/privacy/page.tsx": "",
      ".github/workflows/ci.yml": "steps:\n  - run: npm audit --audit-level=critical",
      "vercel.json": "{}",
    }, { git: true });
    const out = cli(["scan", "--yes", "--project", root]);
    assert.match(out, /launch-blocker/);
    for (const f of ["dashboard.html", "REMEDIATION.md", "report.json", ".gitignore"]) assert.ok(existsSync(join(root, "ship-kit-report", f)), f);
    assert.ok(existsSync(join(root, "ship-kit.config.json")));

    const r = report(root);
    assert.equal(r.shipKitVersion, VERSION);
    assert.equal(status(r, "S1"), "fail");   // invoices has no RLS
    assert.equal(status(r, "S13"), "pass");  // audit gate in .github is now read
    assert.equal(status(r, "L1"), "pass");
    assert.equal(status(r, "P1"), "manual");
    assert.equal(status(r, "DP9"), "pass");
    assert.equal(status(r, "A5"), "pass");
    assert.equal(status(r, "S12"), "na");    // Vercel owns the server
    assert.notEqual(status(r, "S18"), "na"); // AI detected, so the AI checks apply
  });

  test("scans a static site: backend, payment and AI checks are hidden", () => {
    const root = makeProject({ "index.html": "<title>Hi</title><meta property='og:image' content='x'>", "privacy.html": "" });
    cli(["scan", "--yes", "--project", root, "--kind", "static", "--cloud", "none"]);
    const r = report(root);
    for (const id of ["P1", "S1", "S18", "L7", "A5"]) assert.equal(status(r, id), "na", id);
  });

  test("--cloud none on an app with a server does not hide server checks", () => {
    const root = makeProject({ "package.json": pkg({ express: "5" }), "server/index.js": "app.listen(3000)" });
    cli(["scan", "--yes", "--project", root, "--cloud", "none"]);
    const r = report(root);
    for (const id of ["S12", "O5"]) assert.notEqual(status(r, id), "na", id); // not deployed yet is not "managed"
  });

  test("a re-run with --yes reuses the saved config", () => {
    const root = makeProject({ "index.html": "" });
    cli(["scan", "--yes", "--project", root, "--payments", "polar"]);
    cli(["scan", "--yes", "--project", root]);
    const cfg = JSON.parse(readFileSync(join(root, "ship-kit.config.json"), "utf8"));
    assert.equal(cfg.payments, "polar");
    assert.equal(status(report(root), "P1"), "fail"); // polar declared, no integration: a real failure, named correctly
    assert.match(report(root).checks.find((c) => c.id === "P1").evidence, /polar/);
  });

  test("a second scan does not index its own previous report", () => {
    const root = makeProject({ "index.html": "" });
    cli(["scan", "--yes", "--project", root]);
    const first = cli(["scan", "--yes", "--project", root]).match(/indexed (\d+) files/)[1];
    assert.equal(first, "2"); // index.html + ship-kit.config.json
  });
});
