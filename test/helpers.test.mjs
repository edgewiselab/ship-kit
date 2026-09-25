import { test } from "node:test";
import assert from "node:assert/strict";
import { rlsCoverage, isTermsPath, isPrivacyPath, semverLt } from "../lib/detectors.mjs";
import { installedVersion } from "../lib/context.mjs";

test("rlsCoverage: every created table with RLS enabled", () => {
  const c = rlsCoverage([
    `create table public.profiles (id uuid);\nalter table public.profiles enable row level security;`,
    `CREATE TABLE IF NOT EXISTS "orders" (id int);\nALTER TABLE ONLY "orders" ENABLE ROW LEVEL SECURITY;`,
  ]);
  assert.deepEqual(c.missing, []);
  assert.equal(c.created.length, 2);
});

test("rlsCoverage: lists tables missing RLS", () => {
  const c = rlsCoverage([`create table profiles (id uuid);\ncreate table notes (id uuid);\nalter table profiles enable row level security;`]);
  assert.deepEqual(c.missing, ["notes"]);
});

test("rlsCoverage: a later migration can disable RLS again", () => {
  const c = rlsCoverage([
    `create table notes (id uuid); alter table notes enable row level security;`,
    `alter table notes disable row level security;`,
  ]);
  assert.deepEqual(c.missing, ["notes"]);
});

test("rlsCoverage: dropped tables no longer count", () => {
  const c = rlsCoverage([`create table temp_import (id int);`, `drop table if exists temp_import;`]);
  assert.deepEqual(c.missing, []);
  assert.equal(c.created.length, 0);
});

test("rlsCoverage: non-public schemas are not exposed, so they are skipped", () => {
  const c = rlsCoverage([`create table private.audit (id int); create table auth.x (id int);`]);
  assert.equal(c.created.length, 0);
});

test("rlsCoverage: commented-out SQL is ignored", () => {
  const c = rlsCoverage([`-- create table ghosts (id int);\ncreate table real_one (id int); alter table real_one enable row level security;`]);
  assert.deepEqual(c.created, ["real_one"]);
});

test("isTermsPath: matches real terms pages", () => {
  for (const f of ["src/pages/terms.tsx", "app/terms/page.tsx", "src/pages/TermsOfService.tsx", "src/pages/tos.tsx",
    "content/terms-and-conditions.md", "src/routes/legal-terms.svelte", "pages/terms-of-service.vue"]) {
    assert.ok(isTermsPath(f), f);
  }
});

test("isTermsPath: does not match words that merely contain 'tos' or 'term'", () => {
  for (const f of ["src/pages/photos.tsx", "src/components/Tostada.tsx", "src/lib/terminal.ts", "src/pages/protos.tsx", "src/utils/determine.ts"]) {
    assert.ok(!isTermsPath(f), f);
  }
});

test("isPrivacyPath", () => {
  assert.ok(isPrivacyPath("app/privacy/page.tsx"));
  assert.ok(isPrivacyPath("src/pages/PrivacyPolicy.tsx"));
  assert.ok(!isPrivacyPath("src/pages/pricing.tsx"));
});

test("semverLt", () => {
  assert.ok(semverLt("15.5.23", "15.5.24"));
  assert.ok(semverLt("15.4.99", "15.5.0"));
  assert.ok(!semverLt("15.5.24", "15.5.24"));
  assert.ok(!semverLt("16.3.4", "16.3.3"));
  assert.ok(semverLt("16.3.3-canary.1", "16.3.4"));
});

const reader = (files) => (f) => files[f] ?? null;

test("installedVersion: package-lock.json (v3)", () => {
  const files = { "package-lock.json": JSON.stringify({ packages: { "node_modules/next": { version: "15.5.10" } } }) };
  assert.deepEqual(installedVersion(reader(files), [], "next"), { version: "15.5.10", exact: true, source: "package-lock.json" });
});

test("installedVersion: pnpm-lock.yaml", () => {
  const files = { "pnpm-lock.yaml": "lockfileVersion: '9.0'\npackages:\n\n  next@16.3.1:\n    resolution: {}\n" };
  assert.equal(installedVersion(reader(files), [], "next").version, "16.3.1");
});

test("installedVersion: yarn.lock", () => {
  const files = { "yarn.lock": `"next@^15.0.0":\n  version "15.5.2"\n  resolved "x"\n` };
  assert.equal(installedVersion(reader(files), [], "next").version, "15.5.2");
});

test("installedVersion: bun.lock", () => {
  const files = { "bun.lock": `{\n  "packages": {\n    "next": ["next@16.2.0", "", {}, "sha512-x"],\n  }\n}` };
  assert.equal(installedVersion(reader(files), [], "next").version, "16.2.0");
});

test("installedVersion: falls back to the package.json range, marked inexact", () => {
  const files = { "package.json": JSON.stringify({ dependencies: { next: "^15.5.0" } }) };
  assert.deepEqual(installedVersion(reader(files), ["package.json"], "next"), { version: "15.5.0", exact: false, source: "package.json" });
});

test("installedVersion: an exact pin in package.json counts as exact", () => {
  const files = { "package.json": JSON.stringify({ dependencies: { next: "16.3.3" } }) };
  assert.equal(installedVersion(reader(files), ["package.json"], "next").exact, true);
});

test("installedVersion: scoped names do not bleed into each other", () => {
  const files = { "package-lock.json": JSON.stringify({ packages: { "node_modules/next-auth": { version: "5.0.0" } } }) };
  assert.equal(installedVersion(reader(files), [], "next"), null);
});
