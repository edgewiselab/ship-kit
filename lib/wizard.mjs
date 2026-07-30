// Short interactive profile. Cached to ship-kit.config.json so scans are repeatable.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as rl from "node:readline/promises";
import { stdin, stdout } from "node:process";

const CONFIG = "ship-kit.config.json";

export function loadConfig(root) {
  const p = join(root, CONFIG);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch {} }
  return null;
}
export function saveConfig(root, cfg) {
  writeFileSync(join(root, CONFIG), JSON.stringify(cfg, null, 2) + "\n");
}

const pick = (val, options) => {
  const v = String(val || "").trim().toLowerCase();
  return options.find((o) => o === v || o.startsWith(v)) || null;
};

export async function runWizard(root, { flags = {}, existing = null } = {}) {
  const base = existing || {};
  if (flags.url) base.url = flags.url;

  // non-interactive: keep existing/flags, fill gaps as unknown
  // Non-interactive (--yes, or no TTY, e.g. an AI agent running the command):
  // take each field from a flag if given, else the saved config, else null.
  if (!stdin.isTTY || flags.yes) {
    const bool = (v) => v === true || /^(true|yes|y|1)$/i.test(String(v));
    const f = (k) => (flags[k] !== undefined ? flags[k] : (base[k] ?? null));
    const anyProfileFlag = ["kind", "payments", "email", "db", "cloud", "domain", "url", "ai", "audience"].some((k) => flags[k] !== undefined);
    const kind = f("kind");
    const isStatic = kind === "static";
    return {
      kind,
      payments: isStatic ? "none" : f("payments"),
      email: f("email"),
      db: isStatic ? "none" : f("db"),
      cloud: f("cloud"),
      ai: flags.ai !== undefined ? bool(flags.ai) : (isStatic ? false : (base.ai ?? null)),
      analytics: flags.analytics !== undefined ? bool(flags.analytics) : (base.analytics ?? null),
      domain: f("domain"), url: f("url"), audience: f("audience"),
      _incomplete: !existing && !anyProfileFlag,
    };
  }

  const io = rl.createInterface({ input: stdin, output: stdout });
  const ask = async (q, def) => {
    const a = (await io.question(`  ${q}${def ? ` [${def}]` : ""}: `)).trim();
    return a || def || "";
  };
  const askPick = async (q, options, def) => {
    let a;
    do { a = pick(await ask(`${q} (${options.join("/")})`, def), options); } while (!a);
    return a;
  };
  const askBool = async (q, def = "y") => /^y/i.test(await ask(`${q} (y/n)`, def));

  stdout.write("\n  A few questions so the scan fits your project. Press enter to accept a default.\n\n");
  const profile = {};
  profile.kind = await askPick("What kind of project is this?", ["static", "webapp", "saas"], base.kind || "webapp");

  if (profile.kind === "static") {
    // Marketing / landing / brochure site: no backend, DB, accounts or payments.
    // Skip everything that does not apply and keep the wizard short.
    stdout.write("  (Static site: skipping the backend, database and payments questions.)\n");
    profile.payments = "none"; profile.db = "none"; profile.ai = false;
    profile.email    = await askPick("Do you send any email (e.g. a contact form)?", ["resend", "sendgrid", "other", "none"], base.email || "none");
    profile.analytics= await askBool("Do you use analytics or tracking?", base.analytics === false ? "n" : "y");
    profile.cloud    = await askPick("Where does it deploy?", ["vercel", "cloudflare", "aws", "other", "none"], base.cloud || "vercel");
    profile.audience = base.audience || "both";
  } else {
    profile.payments = await askPick("Do you take payments?", ["stripe", "polar", "other", "none"], base.payments || (profile.kind === "saas" ? "stripe" : "none"));
    profile.email    = await askPick("Do you send email?", ["resend", "sendgrid", "other", "none"], base.email || "none");
    profile.db       = await askPick("Database / auth model?", ["supabase", "firebase", "convex", "postgres", "other", "none"], base.db || "other");
    profile.ai       = await askBool("Do you have AI / LLM endpoints?", base.ai ? "y" : "n");
    profile.cloud    = await askPick("Where does it deploy?", ["aws", "vercel", "cloudflare", "other", "none"], base.cloud || "vercel");
    profile.analytics= await askBool("Do you use analytics or tracking?", base.analytics === false ? "n" : "y");
    profile.audience = await askPick("Do you sell internationally / to the EU?", ["both", "eu", "us", "local"], base.audience || "both");
  }
  profile.domain = await ask("Production domain (for SPF/DMARC, blank to skip)", base.domain || "");
  profile.url    = flags.url || await ask("Deployed URL for live checks (blank to skip)", base.url || "");
  io.close();

  profile.domain = profile.domain || null;
  profile.url = profile.url || null;
  if (!profile.domain && profile.url) { try { profile.domain = new URL(/^https?:/.test(profile.url) ? profile.url : "https://" + profile.url).hostname.replace(/^www\./, ""); } catch {} }
  return profile;
}
