# Changelog

Ship Kit's checks and scanner change over time. Re-run a scan after updating (`git -C ~/ship-kit fetch origin && git -C ~/ship-kit reset --hard origin/main`) to pick these up.

## 1.2.0 (2026-09-25)

Fixes from a scan of a private, invite-only, self-hosted Next.js 16 app, where six of ten "fix" items were false positives.

### New

- **`--private true|false`** (and a wizard question) for login-only apps. Auto-detected when `--url` lands on a sign-in page. For a private app, SEO2 (sitemap) and SEO3 (not blocking Google) are skipped, SEO7 passes when robots.txt or `X-Robots-Tag: noindex` keeps crawlers out, and T5 accepts unknown URLs redirecting to sign-in. A `noindex` header alone does not count as private, so an accidental staging `noindex` on a public site is still caught.
- **A6 now auto-checks Sentry.** Sentry 11 replaced `sendDefaultPii` with `dataCollection`, and when it is unset it collects cookies, headers and request/response bodies. A6 fails on Sentry 11+ with no `dataCollection` setting, and calls out `sendDefaultPii: true` on older versions.

### Fixes

- **S6:** in a Next.js App Router project, files under `app/` are server components unless they start with `"use client"`, so `process.env.X` in a page or layout is no longer flagged. `pages/`, Vite and similar setups keep the path rule.
- **E2 and email detection:** email sent by calling a provider's API directly (Resend, Postmark, Mailgun, SendGrid, SES, Brevo and others) now counts. Before, E2 failed, and without `--email` all of E1 to E9 were skipped.
- **T6:** recognises Node's built-in runner (`node --test`, including `node --import tsx --test`, and `node:test` imports), `bun test`, `deno test` and `pytest`. Custom integration or browser scripts that run in CI are now "verify" rather than "fail".
- **SEO5:** ignores deploy and ops tooling (shell scripts, `deploy/`, `infra/`, `ops/`, `bin/`, Terraform, YAML/TOML config), so a `127.0.0.1` health check in a release script is not a "leftover".
- **Probes:** robots.txt, sitemap.xml and `.env` results only count if they were served at that path, not at a redirect target. Before, a login page reached by redirect could be read as the robots file.
- **Auth detection:** custom auth built on `jose`, `bcrypt`/`bcryptjs`, `argon2` and similar, `jwtVerify(`, `readSession(`-style helpers, or an httpOnly session cookie now counts, so S3 and S16 are no longer skipped.
- **Terraform JSON** (`*.tf.json`) counts as infrastructure, and DP10 checks it.

## 1.1.0 (2026-09-25)

### New checks (115 in total)

- **S18 Treat everything the AI reads and writes as untrusted.** Prompt injection: the AI gets no more access than the user it serves, and its output is never rendered as raw HTML. Flags AI replies rendered with `dangerouslySetInnerHTML` / `innerHTML` / `v-html` without sanitizing.
- **L7 Tell people when they are talking to an AI.** The EU AI Act's transparency rules apply from 2 August 2026. Flags a user-facing chat or voice agent with no AI notice. Skipped for US-only or local audiences.

Both apply only when the scan finds AI features.

### Updated guidance

- **S6:** never put a secret behind a public prefix (`VITE_OPENAI_API_KEY` ships to every visitor); Supabase's new `sb_publishable_` / `sb_secret_` keys, and the legacy `anon` / `service_role` keys retiring at the end of 2026.
- **S13:** Renovate as well as Dependabot; a one-day install cooldown against hijacked packages; upgrade promptly after critical framework fixes.
- **E1:** Gmail, Yahoo and Outlook now reject unauthenticated mail rather than spam-folder it.
- **P1:** now covers Polar, Paddle and Lemon Squeezy, not only Stripe.

### Scanner fixes

Wrong failures:
- D1 no longer fails Prisma, Drizzle or Supabase CLI migrations (those tools track what has run).
- DP9 recognises `yarn.lock`, `bun.lock` and `bun.lockb` (they were never indexed), and `engines.node`, `.node-version`, `.tool-versions`, `mise.toml` and Volta as version pins.
- S13 recognises Renovate and `pnpm`/`yarn`/`bun` audit, osv-scanner, Snyk, Socket and GitHub's dependency-review action.
- CI workflows in `.github/` were never read, so S13's audit gate and T6's "E2E runs in CI" could not pass. Fixed.
- P1 no longer says "no Stripe integration" to Polar users.
- A5 recognises every `@sentry/*` SDK (SvelteKit, Vue, Astro, Remix...) plus Highlight, Bugsnag, Rollbar, Honeybadger and Datadog.
- A1 recognises Plausible, Umami, Fathom, Simple Analytics, Mixpanel and Cloudflare Web Analytics.
- F4 accepts `AGENTS.md` as well as `CLAUDE.md`.
- F1 treats `.env.sample`, `.env.template`, `.env.dist` like `.env.example`.

Wrong passes:
- S1 now checks every table created in your migrations has RLS, instead of passing when any one does. Only Supabase projects fail for missing RLS; other Postgres apps get a "verify your app-layer scoping" note.
- L1 no longer counts `photos.tsx` as a Terms of Service page. It now also finds routes declared in a single router file (Lovable / Vite apps) and hosted policies (Termly, iubenda, TermsFeed).
- S10 no longer passes a site served over plain `http://`. It reports whether https exists and whether http redirects to it.
- S13 fails a Next.js version with a published critical advisory (the August 2026 RCE fixes: 15.5.24 / 16.3.3), even when Dependabot is on.
- S6 catches newer key formats (`sb_secret_`, `sk-ant-`, `sk-proj-`, `rk_live_`, GitHub and Slack tokens) and secrets behind `VITE_` / `NEXT_PUBLIC_` / `EXPO_PUBLIC_` / `REACT_APP_` names.

Other:
- `--cloud none` (not deployed yet) no longer hides server-hardening and admin-MFA checks as "managed host".
- Replit projects are now detected (`.replit` and `replit.nix` were not indexed).
- E1 treats a missing DNS record as "missing" rather than "could not resolve", and nudges DMARC `p=none` towards `p=quarantine`.
- E4 and E5 get plain-English notes instead of "Verify this manually."
- The report folder now gets its own `.gitignore`, so a public repo never publishes its list of weaknesses.
- Version shown in the CLI (`--version`), the dashboard data, `report.json` and `REMEDIATION.md`.

### Project

- Test suite (`npm test`, Node's built-in runner, still zero dependencies) covering every detector, the probes, the report, the checklist data and the CLI end to end. Runs in CI on Node 18 to 24.

## Initial release (2026-07-30)

First public release: 113 checks, the scanner, the dashboard and the AI prompt guide.
