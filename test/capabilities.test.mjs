// What the scan decides applies to a project, and what it hides as not applicable.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ctxFor, pkg } from "./helpers.mjs";
import { detectCapabilities, naMapFromCapabilities, capabilitySummary } from "../lib/capabilities.mjs";

const capsOf = (files, profile = {}) => detectCapabilities(ctxFor(files, { profile }), profile);

describe("detectCapabilities", () => {
  test("a plain static site has no backend features", () => {
    const c = capsOf({ "index.html": "<h1>hi</h1>" });
    assert.deepEqual(capabilitySummary(c).on, []);
  });
  test("detects a Next.js SaaS stack", () => {
    const c = capsOf({
      "package.json": pkg({ next: "16", stripe: "18", "@supabase/supabase-js": "2", "@supabase/ssr": "0", resend: "4", openai: "5" }),
      "app/api/chat/route.ts": "export async function POST() {}",
    });
    for (const k of ["hasPayments", "hasDb", "hasAuth", "hasServer", "hasEmail", "hasAI"]) assert.ok(c[k], k);
  });
  test("finds deps in a nested app (monorepo)", () => {
    assert.ok(capsOf({ "apps/web/package.json": pkg({ stripe: "18" }) }).hasPayments);
  });
  test("an explicit profile answer overrides detection", () => {
    assert.equal(capsOf({ "package.json": pkg({ stripe: "18" }) }, { payments: "none" }).hasPayments, false);
    assert.equal(capsOf({}, { payments: "polar" }).hasPayments, true);
    assert.equal(capsOf({}, { ai: true }).hasAI, true);
  });
  test("--kind static drops db, auth and payments", () => {
    const c = capsOf({ "package.json": pkg({ stripe: "18", "next-auth": "5", pg: "8" }) }, { kind: "static" });
    assert.equal(c.hasDb || c.hasAuth || c.hasPayments, false);
  });
  test("platform detection", () => {
    assert.equal(capsOf({ ".replit": "" }).platform, "Replit");
    assert.equal(capsOf({ "replit.nix": "{ pkgs }: {}" }).platform, "Replit");
    assert.equal(capsOf({ "vercel.json": "{}" }).platform, "Vercel");
    assert.equal(capsOf({ "package.json": pkg({ "lovable-tagger": "1" }) }).platform, "Lovable");
    assert.equal(capsOf({ "main.tf": "" }).platform, "self-hosted");
    assert.equal(capsOf({ "vercel.json": "{}" }).managed, true);
    assert.equal(capsOf({ "main.tf": "" }).managed, false);
  });
  test("--cloud aws marks the project self-managed", () => {
    const c = capsOf({}, { cloud: "aws" });
    assert.equal(c.managed, false);
    assert.equal(c.platform, "AWS");
  });
  test("agent workflow is recognised from CLAUDE.md or AGENTS.md", () => {
    assert.ok(capsOf({ "CLAUDE.md": "" }).hasAgentWorkflow);
    assert.ok(capsOf({ "AGENTS.md": "" }).hasAgentWorkflow);
    assert.ok(!capsOf({ "README.md": "" }).hasAgentWorkflow);
  });
});

describe("naMapFromCapabilities", () => {
  const na = (files, profile) => naMapFromCapabilities(capsOf(files, profile));
  test("no AI hides the AI checks (S18, L7)", () => {
    const m = na({ "index.html": "" });
    assert.ok(m.has("S18") && m.has("L7"));
  });
  test("with AI, the AI checks apply", () => {
    const m = na({ "package.json": pkg({ "@anthropic-ai/sdk": "0.60" }) });
    assert.ok(!m.has("S18") && !m.has("L7"));
  });
  test("no payments hides the payment checks and L2", () => {
    const m = na({ "index.html": "" });
    for (const id of ["P1", "P2", "P7", "L2"]) assert.ok(m.has(id), id);
  });
  test("a static site hides app-only checks", () => {
    const m = na({ "index.html": "" });
    for (const id of ["A5", "S15", "T6", "O2"]) assert.ok(m.has(id), id);
  });
  test("managed platforms hide infra checks with the platform named", () => {
    const m = na({ "vercel.json": "{}", "package.json": pkg({ pg: "8" }) });
    assert.match(m.get("DP7"), /Vercel/);
  });
  test("agent-workflow checks hidden without an agent setup", () => {
    assert.ok(na({ "index.html": "" }).has("F4"));
    assert.ok(!na({ "AGENTS.md": "" }).has("F4"));
  });
  test("every id the map can hide is a real check", async () => {
    const { checks } = await import("../data/checklist.mjs");
    const ids = new Set(checks.map((c) => c.id));
    const everything = naMapFromCapabilities({ managed: true, platform: "x" });
    for (const id of everything.keys()) assert.ok(ids.has(id), `unknown check id in NA map: ${id}`);
  });
});
