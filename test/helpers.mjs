// Test helpers: build a throwaway project on disk and read it back through the real context.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { after } from "node:test";
import { buildContext } from "../lib/context.mjs";
import { detectCapabilities } from "../lib/capabilities.mjs";
import { detectors } from "../lib/detectors.mjs";

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

// files: { "path/in/project": "contents" | object (written as JSON) }
export function makeProject(files = {}, { git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ship-kit-test-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  if (git) {
    const g = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
    g("init", "-q");
    g("add", "-A", "-f");
  }
  return root;
}

// A context exactly as the CLI builds it, with capabilities attached.
export function ctxFor(files, { profile = {}, git = false, probes, resolveTxt } = {}) {
  const root = makeProject(files, { git });
  const ctx = buildContext(root, profile);
  ctx.caps = detectCapabilities(ctx, profile);
  if (probes) ctx.probes = probes;
  if (resolveTxt) ctx.resolveTxt = resolveTxt;
  return ctx;
}

// Run one detector against a throwaway project.
export async function detect(id, files, opts) {
  return detectors[id](ctxFor(files, opts));
}

export const pkg = (deps = {}, extra = {}) => ({ name: "fixture", version: "1.0.0", dependencies: deps, ...extra });
