// Builds a bounded, cached view of the target project for detectors to query.
// Zero dependencies, Node built-ins only.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { execFileSync } from "node:child_process";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "out", ".venv", "venv",
  "coverage", ".turbo", ".cache", "__pycache__", ".vercel", ".output", "vendor",
  "target", ".svelte-kit", "ship-kit-report",
]);
const TEXT_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".html",
  ".css", ".scss", ".sql", ".tf", ".tfvars", ".yml", ".yaml", ".toml", ".txt",
  ".env", ".example", ".sh", ".xml", ".svelte", ".vue", ".astro",
]);
const EXTLESS_KEEP = new Set([
  ".gitignore", ".env", ".env.local", ".env.production", ".env.example", ".nvmrc",
  "Dockerfile", "dockerfile", "robots.txt", ".dockerignore", "Caddyfile",
]);
const MAX_FILES = 6000;
const MAX_BYTES = 512 * 1024;

export function buildContext(root, profile = {}) {
  const files = [];
  (function walk(dir, depth) {
    if (depth > 12 || files.length > MAX_FILES) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length > MAX_FILES) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".git")) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        const keep = TEXT_EXT.has(ext) || EXTLESS_KEEP.has(e.name) || e.name.startsWith(".env");
        if (keep) files.push(relative(root, full));
      }
    }
  })(root, 0);

  const cache = new Map();
  const read = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let txt = null;
    try {
      const abs = join(root, rel);
      if (statSync(abs).size <= MAX_BYTES) txt = readFileSync(abs, "utf8");
    } catch {}
    cache.set(rel, txt);
    return txt;
  };

  // package.json + deps, aggregated across the whole tree (handles apps nested in a
  // subfolder, monorepos, apps/web layouts) so detection does not depend on the app
  // sitting exactly at the scanned root.
  const pkgFiles = files.filter((f) => /(^|\/)package\.json$/.test(f));
  let pkg = {};
  const deps = new Set();
  for (const pf of pkgFiles) {
    let j;
    try { j = JSON.parse(read(pf) || "{}"); } catch { continue; }
    if (pf === "package.json" || Object.keys(pkg).length === 0) pkg = j;
    for (const grp of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const k of Object.keys(j[grp] || {})) deps.add(k);
    }
  }

  // git tracked files + history probes
  let gitTracked = null, gitEnvInHistory = false, isGit = existsSync(join(root, ".git"));
  if (isGit) {
    try {
      gitTracked = new Set(
        execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 24 })
          .split("\n").filter(Boolean)
      );
    } catch {}
    try {
      const hist = execFileSync("git", ["-C", root, "log", "--all", "--oneline", "--", ".env", ".env.local", ".env.production"],
        { encoding: "utf8", maxBuffer: 1 << 22 });
      gitEnvInHistory = hist.trim().length > 0;
    } catch {}
  }

  // .gitignore patterns (simple substring / prefix match)
  const gitignore = (read(".gitignore") || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const isIgnored = (rel) => gitignore.some((p) => {
    const pat = p.replace(/^\//, "").replace(/\/$/, "");
    return rel === pat || rel.startsWith(pat + "/") || basename(rel) === pat ||
      (pat.startsWith("*") && rel.endsWith(pat.slice(1))) || (pat.endsWith("*") && rel.startsWith(pat.slice(0, -1)));
  });

  const has = (rel) => files.includes(rel) || (gitTracked ? gitTracked.has(rel) : false) || existsSync(join(root, rel));

  // find files by name/path regex
  const find = (re) => files.filter((f) => re.test(f));

  // client-reachable source (rough heuristic): src/app/components/pages, minus api/server/lib/server
  const isClientFile = (f) =>
    /(^|\/)(src|app|components|pages|features)\//i.test(f) &&
    /\.(jsx?|tsx?|mjs|svelte|vue|astro)$/i.test(f) &&
    !/(^|\/)(api|server|serverless|functions|lib\/server|actions)\//i.test(f) &&
    !/\.(test|spec)\./i.test(f);

  // bounded content grep
  const grep = (re, opts = {}) => {
    const { include, exclude, clientOnly, limit = 40 } = opts;
    const out = [];
    for (const f of files) {
      if (out.length >= limit) break;
      if (include && !include.some((x) => f.includes(x) || f.endsWith(x))) continue;
      if (exclude && exclude.some((x) => f.includes(x))) continue;
      if (clientOnly && !isClientFile(f)) continue;
      const txt = read(f);
      if (!txt) continue;
      const lines = txt.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) { out.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 160) }); break; }
      }
    }
    return out;
  };
  const any = (re, opts) => grep(re, { ...opts, limit: 1 }).length > 0;

  return {
    root, files, read, has, find, grep, any, pkg, deps, gitTracked, gitEnvInHistory, isGit, isIgnored, isClientFile,
    profile,
    dep: (...names) => names.some((n) => deps.has(n) || [...deps].some((d) => d === n || d.startsWith(n + "/"))),
  };
}
