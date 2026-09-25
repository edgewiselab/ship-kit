// The checklist is the single source of truth: keep it well-formed and in step with the engine and docs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { meta, sections, checks } from "../data/checklist.mjs";
import { detectors, manualNote } from "../lib/detectors.mjs";

const PRIORITIES = ["blocker", "first-week", "nice", "ongoing"];
const PHASES = ["foundation", "build", "prelaunch", "deploy", "launch", "postlaunch"];
const ORIGINS = ["kept", "edited", "new"];
const ids = new Set(checks.map((c) => c.id));
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("check ids are unique", () => {
  assert.equal(ids.size, checks.length);
});

test("every check is well-formed", () => {
  const sectionIds = new Set(sections.map((s) => s.id));
  for (const c of checks) {
    assert.ok(sectionIds.has(c.section), `${c.id}: unknown section ${c.section}`);
    assert.ok(PRIORITIES.includes(c.priority), `${c.id}: bad priority`);
    assert.ok(PHASES.includes(c.phase), `${c.id}: bad phase`);
    assert.ok(ORIGINS.includes(c.origin), `${c.id}: bad origin`);
    for (const k of ["title", "what", "how", "bad", "why", "source"]) assert.ok(c[k] && c[k].trim(), `${c.id}: missing ${k}`);
  }
});

test("house style: no em dashes in checklist text", () => {
  for (const c of checks) for (const [k, v] of Object.entries(c)) {
    if (typeof v === "string") assert.ok(!v.includes("—"), `${c.id}.${k} contains an em dash`);
  }
});

test("every detector and manual note belongs to a real check", () => {
  for (const id of Object.keys(detectors)) assert.ok(ids.has(id), `detector for unknown check ${id}`);
  for (const id of Object.keys(manualNote)) assert.ok(ids.has(id), `manual note for unknown check ${id}`);
});

test("every check has either a detector or a plain-English manual note", () => {
  for (const c of checks) assert.ok(detectors[c.id] || manualNote[c.id], `${c.id} has neither`);
});

test("the README badge and prose match the real check count", () => {
  const readme = read("README.md");
  assert.match(readme, new RegExp(`checks-${checks.length}`));
  const n = (read("METHOD.md").match(/of the (\d+) checks/) || [])[1];
  assert.equal(Number(n), checks.length, "METHOD.md count");
  const added = checks.filter((c) => c.origin === "new").length;
  assert.match(read("METHOD.md"), new RegExp(`${added} additional checks`));
  assert.match(read("ASSESSMENT.md"), new RegExp(`${added} checks`));
});

test("generated files are up to date with the data (run node build.mjs)", () => {
  const md = read("ship-checklist.md");
  for (const c of checks) assert.ok(md.includes(`\`${c.id}\` ${c.title}`), `ship-checklist.md is stale for ${c.id}`);
  const html = read("index.html");
  assert.ok(html.includes(JSON.stringify({ meta, sections, checks })), "index.html is stale");
});

test("the dashboard template still has its data marker", () => {
  assert.ok(read("template.html").includes("__SHIP_KIT_DATA__"));
});
