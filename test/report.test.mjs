// Scoring, profile-driven N/A, and the files written into the scanned project.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject } from "./helpers.mjs";
import { assemble, writeDashboard, writeRemediation } from "../lib/report.mjs";
import { meta, sections, checks } from "../data/checklist.mjs";
import { VERSION } from "../lib/version.mjs";

const TEMPLATE = fileURLToPath(new URL("../template.html", import.meta.url));
const statusOf = (augmented, id) => augmented.find((c) => c.id === id);

describe("assemble", () => {
  test("--cloud none is NOT treated as a managed host (the old bug)", () => {
    const { augmented } = assemble(meta, sections, checks, {}, { cloud: "none" }, new Map());
    for (const id of ["S12", "O5", "DP5"]) assert.notEqual(statusOf(augmented, id).status, "na", id);
  });
  test("a managed host hides server checks", () => {
    const { augmented } = assemble(meta, sections, checks, {}, { cloud: "vercel" }, new Map());
    assert.equal(statusOf(augmented, "S12").status, "na");
    assert.match(statusOf(augmented, "S12").evidence, /vercel/);
  });
  test("aws and other are self-managed", () => {
    for (const cloud of ["aws", "other"]) {
      const { augmented } = assemble(meta, sections, checks, {}, { cloud }, new Map());
      assert.notEqual(statusOf(augmented, "S12").status, "na", cloud);
    }
  });
  test("US-only or local audiences skip the EU AI Act check", () => {
    for (const audience of ["us", "local"]) {
      const { augmented } = assemble(meta, sections, checks, {}, { audience }, new Map());
      assert.equal(statusOf(augmented, "L7").status, "na", audience);
    }
    const { augmented } = assemble(meta, sections, checks, {}, { audience: "eu" }, new Map());
    assert.notEqual(statusOf(augmented, "L7").status, "na");
  });
  test("capability N/A wins over a detector result", () => {
    const { augmented } = assemble(meta, sections, checks, { P1: { status: "fail", evidence: "x" } }, {}, new Map([["P1", "No payments"]]));
    assert.equal(statusOf(augmented, "P1").status, "na");
  });
  test("readiness counts only automatic results; manual items never drag it down", () => {
    const results = { F1: { status: "pass", evidence: "" }, S1: { status: "pass", evidence: "" }, S5: { status: "fail", evidence: "" } };
    const { summary } = assemble(meta, sections, checks, results, {}, new Map());
    assert.equal(summary.pass, 2);
    assert.equal(summary.fail, 1);
    assert.equal(summary.readiness, 67);
    assert.equal(summary.manual, checks.length - 3);
    assert.equal(summary.blockersFailingHard, 1); // S5 is a blocker
  });
  test("readiness is 100 when nothing could be decided automatically", () => {
    const { summary } = assemble(meta, sections, checks, {}, {}, new Map());
    assert.equal(summary.readiness, 100);
  });
});

describe("report files", () => {
  const run = (root, results = {}, profile = { cloud: "vercel" }) => {
    const { augmented, summary } = assemble(meta, sections, checks, results, profile, new Map());
    const dash = writeDashboard(root, TEMPLATE, meta, sections, augmented, profile, summary);
    const spec = writeRemediation(root, meta, sections, augmented, profile, summary, "2026-09-25");
    return { dash, spec };
  };

  test("writes a .gitignore so the report is never committed", () => {
    const root = makeProject({});
    run(root);
    const gi = readFileSync(join(root, "ship-kit-report", ".gitignore"), "utf8");
    assert.match(gi, /^\*$/m);
  });
  test("does not overwrite a .gitignore the user already changed", () => {
    const root = makeProject({});
    mkdirSync(join(root, "ship-kit-report"), { recursive: true });
    writeFileSync(join(root, "ship-kit-report", ".gitignore"), "custom\n");
    run(root);
    assert.equal(readFileSync(join(root, "ship-kit-report", ".gitignore"), "utf8"), "custom\n");
  });
  test("dashboard embeds the data and the version", () => {
    const root = makeProject({});
    const { dash } = run(root);
    const html = readFileSync(dash, "utf8");
    assert.ok(!html.includes("__SHIP_KIT_DATA__"));
    assert.ok(html.includes(`"version":"${VERSION}"`));
    assert.ok(html.includes(`"mode":"scan"`));
  });
  test("report.json records the version and every check", () => {
    const root = makeProject({});
    run(root);
    const j = JSON.parse(readFileSync(join(root, "ship-kit-report", "report.json"), "utf8"));
    assert.equal(j.shipKitVersion, VERSION);
    assert.equal(j.checks.length, checks.length);
  });
  test("REMEDIATION.md lists failures first, with evidence and the fix prompt", () => {
    const root = makeProject({});
    const { spec } = run(root, { S5: { status: "fail", evidence: "Downloadable config exposed: /.env" } });
    const md = readFileSync(spec, "utf8");
    assert.match(md, new RegExp(`Ship Kit ${VERSION.replace(/\./g, "\\.")} on 2026-09-25`));
    const fixSection = md.split("## 1. Fix these")[1].split("## 2.")[0];
    assert.match(fixSection, /`S5`/);
    assert.match(fixSection, /Downloadable config exposed/);
  });
  test("the profile's internal fields are not printed", () => {
    const root = makeProject({});
    const { spec } = run(root, {}, { cloud: "vercel", _incomplete: true });
    assert.doesNotMatch(readFileSync(spec, "utf8"), /_incomplete/);
  });
  test("N/A items are grouped by reason", () => {
    const root = makeProject({});
    const { augmented, summary } = assemble(meta, sections, checks, {}, {}, new Map([["P1", "No payments"], ["P2", "No payments"]]));
    const spec = writeRemediation(root, meta, sections, augmented, {}, summary, "2026-09-25");
    assert.match(readFileSync(spec, "utf8"), /\*\*No payments\*\* \(2\): P1, P2/);
    assert.ok(existsSync(spec));
  });
});
