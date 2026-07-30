#!/usr/bin/env node
// Ship Kit CLI. Clone the repo, then from your project run:
//   node /path/to/ship-kit/cli.mjs scan            scan the current directory
//   node /path/to/ship-kit/cli.mjs scan --project ../my-app --url https://my-app.com
//   node /path/to/ship-kit/cli.mjs scan --yes      non-interactive (use saved config / defaults)
// Zero dependencies. Node 18+.
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { meta, sections, checks } from "./data/checklist.mjs";
import { buildContext } from "./lib/context.mjs";
import { detectCapabilities, naMapFromCapabilities, capabilitySummary } from "./lib/capabilities.mjs";
import { runDetectors } from "./lib/detectors.mjs";
import { runProbes } from "./lib/probes.mjs";
import { runWizard, loadConfig, saveConfig } from "./lib/wizard.mjs";
import { assemble, writeDashboard, writeRemediation } from "./lib/report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "template.html");

function parseArgs(argv) {
  const a = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { a.flags[key] = next; i++; }
      else a.flags[key] = true;
    } else a._.push(t);
  }
  return a;
}

const C = { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m` };
const log = (s = "") => process.stdout.write(s + "\n");

function help() {
  log(`\n  ${C.b("Ship Kit")} ${C.dim("launch-readiness scanner")}\n`);
  log(`  ${C.b("node cli.mjs scan")}   scan a project, write a dashboard + remediation spec`);
  log(`  ${C.b("node cli.mjs init")}   answer the wizard and save ship-kit.config.json only`);
  log(`  ${C.b("node cli.mjs help")}   this message\n`);
  log(`  ${C.dim("Flags:")}`);
  log(`    --project <dir>   project to scan (default: current directory)`);
  log(`    --url <url>       deployed URL to run live checks against`);
  log(`    --yes             non-interactive; use saved config, flags, or safe defaults`);
  log(`    --reconfigure     re-run the wizard even if a config exists`);
  log(`\n  ${C.dim("Profile flags (skip the wizard, e.g. for an AI agent):")}`);
  log(`    --kind static|webapp|saas      ${C.dim("(static skips backend/DB/payments checks)")}`);
  log(`    --payments stripe|polar|none   --email resend|sendgrid|other|none`);
  log(`    --db supabase|firebase|convex|postgres|other   --cloud aws|vercel|cloudflare|other|none`);
  log(`    --ai true|false   --analytics true|false   --domain <domain>   --audience both|eu|us|local`);
  log(`    ${C.dim("e.g. node cli.mjs scan --yes --payments none --db supabase --cloud vercel --url https://app.com")}\n`);
}

async function scan(args, { configOnly = false } = {}) {
  const root = resolve(args.flags.project || process.cwd());
  if (!existsSync(root)) { log(C.r(`Project not found: ${root}`)); process.exit(1); }
  log(`\n  ${C.b("Ship Kit")} scanning ${C.c(root)}`);

  const existing = args.flags.reconfigure ? null : loadConfig(root);
  const profile = await runWizard(root, { flags: args.flags, existing });
  saveConfig(root, profile);
  if (configOnly) { log(`\n  Saved ${C.c("ship-kit.config.json")}. Run ${C.b("scan")} next.\n`); return; }

  log(`\n  ${C.dim("Reading the project...")}`);
  const ctx = buildContext(root, profile);
  log(`  ${C.dim(`indexed ${ctx.files.length} files`)}`);

  // review the code to decide which checks actually apply
  const caps = detectCapabilities(ctx, profile);
  ctx.caps = caps; // let individual detectors consult capabilities directly, not just the N/A map
  const naMap = naMapFromCapabilities(caps);
  const { on, off, platform, managed } = capabilitySummary(caps);
  log(`  ${C.dim("detected: " + (on.length ? on.join(", ") : "no backend features") + (off.length ? "  ·  no " + off.join(", ") : ""))}`);
  if (platform && platform !== "unknown") log(`  ${C.dim("platform: " + platform + (managed ? " (managed, so infra/secrets-hosting checks are skipped)" : ""))}`);

  if (profile.url) { log(`\n  ${C.dim("Running live checks...")}`); ctx.probes = await runProbes(profile.url, log); }
  else log(`\n  ${C.dim("No URL given; skipping live checks (add --url to enable).")}`);

  const results = await runDetectors(ctx, checks);
  const { augmented, summary } = assemble(meta, sections, checks, results, profile, naMap);

  const dateStr = new Date().toISOString().slice(0, 10);
  const dash = writeDashboard(root, TEMPLATE, meta, sections, augmented, profile, summary);
  const spec = writeRemediation(root, meta, sections, augmented, profile, summary, dateStr);

  // console summary
  const bar = (n, total, color) => { const w = 24, f = Math.round((n / Math.max(total, 1)) * w); return color("█".repeat(f)) + C.dim("░".repeat(w - f)); };
  // lead with the actionable number: launch-blockers
  if (summary.blockersFailingHard) log(`\n  ${C.r("● " + summary.blockersFailingHard + " launch-blocker(s) to fix")} before you ship.`);
  else if (summary.blockersToVerify) log(`\n  ${C.y("● No blockers failed automatically")}, but ${summary.blockersToVerify} need you to verify them.`);
  else log(`\n  ${C.g("● No launch-blockers failing.")}`);
  log(`\n  ${C.b("Automatic checks")}  ${summary.readiness}%  ${bar(summary.pass, summary.autoChecked, C.g)}  ${summary.pass} pass · ${summary.fail} fail`);
  log(`    ${C.r("● fix")}      ${summary.fail}   ${C.dim("(in REMEDIATION.md)")}`);
  log(`    ${C.y("● verify")}   ${summary.manualBlockers}   ${C.dim("before launch  ·  " + summary.manualFirstWeek + " first-week  ·  " + summary.manualOngoing + " ongoing")}`);
  log(`    ${C.dim("● n/a      " + summary.na + "   (not relevant to this project)")}`);
  log(`\n  ${C.b("Open the report")}  ${dash}`);
  log(`  ${C.dim("^ open that file in your browser. It is on your computer; nothing is uploaded.")}`);
  log(`  ${C.dim("For your AI:")}      ${spec}   ${C.dim("(hand this to Claude/Cursor/Codex)")}`);
  log(`\n  Re-run after fixes: ${C.b("node cli.mjs scan --yes")}\n`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "scan";
if (cmd === "help" || args.flags.help) help();
else if (cmd === "init") await scan(args, { configOnly: true });
else if (cmd === "scan") await scan(args);
else { log(C.r(`Unknown command: ${cmd}`)); help(); process.exit(1); }
