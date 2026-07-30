// Reviews the actual code to decide which checks apply to THIS project, so a simple
// site is not buried under checks about databases, payments and tenancy it does not have.
// Detection is primary; explicit profile answers (payments provider, db type, --kind) refine it.

export function detectCapabilities(ctx, profile = {}) {
  const c = ctx;
  const caps = {
    hasPayments: c.dep("stripe", "@stripe/stripe-js", "@polar-sh/sdk", "@paddle/paddle-node-sdk", "@lemonsqueezy/lemonsqueezy.js", "braintree", "square")
      || c.any(/stripe\.(checkout|charges|paymentIntents|subscriptions)|api\.stripe\.com|checkout\.stripe/i),
    hasDb: c.dep("pg", "postgres", "mysql2", "mongoose", "mongodb", "@prisma/client", "prisma", "drizzle-orm", "@supabase/supabase-js", "firebase-admin", "better-sqlite3", "kysely", "sequelize", "typeorm", "@planetscale/database", "@neondatabase/serverless", "@vercel/postgres")
      || c.find(/schema\.prisma$/).length > 0 || c.find(/drizzle\.config\.|(^|\/)drizzle\//).length > 0
      || c.find(/(^|\/)(migrations?|supabase\/migrations)\//i).length > 0,
    hasAuth: c.dep("next-auth", "@auth/core", "@clerk/nextjs", "@clerk/clerk-sdk-node", "better-auth", "lucia", "@supabase/auth-helpers-nextjs", "@supabase/ssr", "passport", "jsonwebtoken", "express-session", "iron-session", "@auth0/nextjs-auth0", "@workos-inc/node")
      || c.any(/getServerSession|currentUser\(|requireAuth|getCurrentUser\(|useUser\(|auth0|clerkClient/),
    hasServer: c.find(/(^|\/)(app|src\/app)\/api\/.*route\.(t|j)sx?$/).length > 0
      || c.find(/(^|\/)pages\/api\/.*\.(t|j)sx?$/).length > 0
      || c.find(/(^|\/)api\/[^/]+\.(m|c)?(t|j)sx?$/).length > 0
      || c.find(/(^|\/)(netlify\/functions|supabase\/functions|functions|server|routes)\//).length > 0
      || c.dep("express", "fastify", "hono", "koa", "@nestjs/core")
      || c.any(/['"]use server['"]/),
    hasAI: c.dep("openai", "@anthropic-ai/sdk", "ai", "@google/generative-ai", "@google/genai", "langchain", "@langchain/core", "replicate", "cohere-ai", "@mistralai/mistralai", "groq-sdk", "together-ai")
      || c.any(/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis/i),
    hasEmail: c.dep("resend", "@sendgrid/mail", "nodemailer", "postmark", "@loops/loops", "mailgun.js", "@aws-sdk/client-ses"),
    hasInfra: c.find(/\.tf$/).length > 0 || c.find(/(^|\/)Dockerfile$/i).length > 0 || c.find(/serverless\.(yml|yaml)$/).length > 0 || c.find(/(cdk\.json|pulumi\.ya?ml)$/).length > 0,
    hasDependencies: c.deps.size > 0,
    // is the owner actually running an AI coding agent with a repo-level setup?
    hasAgentWorkflow: c.find(/(^|\/)\.claude(\/|$)/).length > 0 || c.find(/(^|\/)CLAUDE\.md$/i).length > 0
      || c.find(/(^|\/)\.cursor(\/|$)/).length > 0 || c.find(/(^|\/)AGENTS?\.md$/i).length > 0
      || c.find(/(^|\/)\.github\/copilot-instructions\.md$/i).length > 0,
  };

  // explicit profile answers override detection
  const p = profile || {};
  if (p.payments && p.payments !== "none") caps.hasPayments = true;
  if (p.payments === "none") caps.hasPayments = false;
  if (p.email && p.email !== "none") caps.hasEmail = true;
  if (p.email === "none") caps.hasEmail = false;
  if (p.db && !["none", "other"].includes(p.db)) caps.hasDb = true;
  if (p.db === "none") caps.hasDb = false;
  if (p.ai === true) caps.hasAI = true;
  if (p.ai === false) caps.hasAI = false;
  // --kind static is a coarse hint: no db / auth / payments (but keep any server or AI we detected)
  if (p.kind === "static") { caps.hasDb = false; caps.hasAuth = false; caps.hasPayments = false; }

  // host platform. Managed platforms (Replit, Lovable, Vercel, etc.) handle secret
  // storage, servers, backups and infra for you, so those checks do not apply.
  const plat =
    (c.find(/(^|\/)\.replit$/).length || c.find(/(^|\/)replit\.nix$/).length) ? "Replit"
      : c.dep("lovable-tagger") ? "Lovable"
      : c.find(/(^|\/)netlify\.toml$/).length ? "Netlify"
      : (c.find(/(^|\/)vercel\.json$/).length || c.find(/(^|\/)\.vercel(\/|$)/).length) ? "Vercel"
      : c.find(/(^|\/)railway\.(json|toml)$/).length ? "Railway"
      : c.find(/(^|\/)render\.yaml$/).length ? "Render"
      : c.find(/(^|\/)fly\.toml$/).length ? "Fly.io"
      : c.find(/(^|\/)wrangler\.toml$/).length ? "Cloudflare"
      : caps.hasInfra ? "self-hosted"
      : "unknown";
  caps.platform = plat;
  caps.managed = ["Replit", "Lovable", "Netlify", "Vercel", "Railway", "Render", "Fly.io", "Cloudflare"].includes(plat);
  if (p.cloud === "aws" || p.cloud === "other") { caps.managed = false; if (plat === "unknown") caps.platform = p.cloud === "aws" ? "AWS" : "self-hosted"; }
  if (["vercel", "cloudflare", "netlify", "railway", "render"].includes(p.cloud)) { caps.managed = true; if (plat === "unknown") caps.platform = p.cloud; }

  return caps;
}

// Which checks to mark N/A, and why, given the detected capabilities.
export function naMapFromCapabilities(caps) {
  const m = new Map();
  const add = (cond, ids, reason) => { if (cond) for (const id of ids) if (!m.has(id)) m.set(id, reason); };
  add(!caps.hasPayments, ["P1", "P2", "P3", "P4", "P5", "P6", "P7"], "No payment integration found in the code");
  add(!caps.hasDb, ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "S1", "S2"], "No database found in the code");
  add(!caps.hasEmail, ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9"], "No email sending found in the code");
  add(!caps.hasDb && !caps.hasAuth, ["S4"], "No user data behind IDs found in the code");
  add(!caps.hasAuth, ["S3", "S16"], "No login or user accounts found in the code");
  add(!caps.hasServer, ["S12", "S17", "O5", "O8", "A8"], "No backend or server endpoints found in the code");
  add(!caps.hasServer && !caps.hasAI, ["S11"], "No server endpoints or AI calls to rate-limit");
  add(!caps.hasDb, ["DP7"], "No database to back up");
  add(!caps.hasInfra, ["DP4", "DP5", "DP6", "DP10", "DP11"], "No infrastructure-as-code (Terraform, etc.) in the repo");
  // managed platforms (Replit, Lovable, Vercel, ...) own secret storage, servers, backups and infra
  add(caps.managed, ["F3", "S12", "DP4", "DP5", "DP6", "DP7", "DP10", "DP11", "O5"], `Your platform (${caps.platform}) handles this for you`);
  // the "AI coding workflow" checks only apply if you run an AI agent against the repo
  add(!caps.hasAgentWorkflow, ["F4", "F5", "F6", "F7", "F8", "F9"], "Only applies if you run an AI coding agent against the repo (auto-accept loops, machine gates); no such setup found");
  // static / content sites (no backend, no database, no user accounts) skip the app-only checks
  const noBackend = !caps.hasServer && !caps.hasDb && !caps.hasAuth;
  add(noBackend, ["A5", "A6", "A8", "S15", "SP6", "SP7", "T6", "T7", "T9", "T10", "O2"],
    "This is a static or content site (no backend, database, or user accounts), so this does not apply");
  // no code dependencies means nothing to audit, prune, or lock
  add(!caps.hasDependencies, ["S13", "SP4", "DP9"], "This project has no third-party code dependencies to audit or lock");
  // nothing is sold, so no sales-tax or merchant-of-record concern
  add(!caps.hasPayments, ["L2"], "You do not sell anything here, so there is no sales tax or merchant of record to sort out");
  return m;
}

export function capabilitySummary(caps) {
  const CORE = ["hasPayments", "hasDb", "hasAuth", "hasServer", "hasAI", "hasEmail", "hasInfra"];
  const on = CORE.filter((k) => caps[k]).map((k) => k.replace(/^has/, "").toLowerCase());
  const off = CORE.filter((k) => !caps[k]).map((k) => k.replace(/^has/, "").toLowerCase());
  return { on, off, platform: caps.platform, managed: caps.managed };
}
