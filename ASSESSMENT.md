# Why these checks

Ship Kit compiles the standard pre-launch checklist for AI-built apps and expands it. This file explains what the classic list gets right, what needed sharpening, and what was missing, so you can trust the additions rather than take them on faith.

## The classic pre-launch list is a good start

The pre-launch checks that circulate for indie and AI-built apps are well-scoped and battle-tested: row-level security, server-side paywall enforcement, no exposed `.env`, no frontend secrets, SPF/DKIM/DMARC, og image, PageSpeed, analytics, a Terms of Service, and a final test pass. Each check has a useful shape (what to check, how, what bad looks like, why it matters), and they point at the real ways AI-built apps break. Ship Kit keeps this core: about a third of the 113 checks, most intact, a handful sharpened.

Its one limit is scope. A pre-launch list is a snapshot of the hour before you go live. It says little about how you build so the problems do not recur, and nothing about the days after launch. That is where the most expensive production bugs live.

## What the classic list gets right (kept, 23 checks)

- **The security core is the right core.** Row-level security, server-side paywall enforcement, no exposed `.env`, no frontend secrets. These are the top ways AI-built apps get breached.
- **Email deliverability as a first-class topic.** SPF/DKIM/DMARC, transactional setup, the Gmail-and-Outlook test, sending from a subdomain.
- **Findability and speed are solid and correctly prioritised** (og image and PageSpeed as blockers, the rest as first-week).
- **The final-test section has the right instinct:** walk the real flow, in a second browser, on a phone, and break your forms.

## What needed sharpening (edited, 14 checks)

These were right but incomplete. The sharper version, drawn from real incidents:

| The classic check says | The sharper version adds |
| --- | --- |
| Turn on RLS | ...and if you drop RLS for portability, app-layer `user_id` scoping becomes the ONLY authz, so verify it adversarially |
| Remove secret keys from frontend | ...and strip internal fields from API responses with a public serializer; a raw row leaks tokens and third-party ids |
| Set up transactional emails | ...some auth providers silently ignore your templates and send unbranded mail; wire a real provider first |
| Configure SPF/DKIM/DMARC | ...roll DMARC out in stages (p=none then p=quarantine), and never paste DKIM into a web UI (it splits the record) |
| Send from a subdomain | ...and keep the From address on the DKIM-authenticated domain or DMARC alignment fails silently |
| Turn on error tracking | ...wire your logger into it so errors auto-capture, and never log PII or tokens |
| Remove unused libraries | ...but confirm each "unused" hit by hand; static tools flag live code as dead |
| Walk your flow on your phone | ...mobile is often a separate component that does not inherit desktop changes; maintain parity deliberately |

## What was missing (added by Edgewise Lab, 76 checks in 5 new sections)

1. **Foundations & AI Workflow.** The classic list assumes the app exists. Nothing about building it safely with an AI agent: a deny-list before auto-accept, one machine gate that defines done, an independent checker that grades the work, commit-but-never-push overnight.
2. **Data & Migrations.** The single most expensive class of bug, and the pre-launch list does not mention it. Fail loud (never silently skip work), one schema source of truth, idempotent crons with atomic claims, timezone-correct dates.
3. **Payments** as its own section. The classic list has one Stripe check. Payments deserve more: idempotent issuance, one shared paid-event handler, explicit VAT, suspend money-moving crons during deploys.
4. **Deploy & Release.** The classic list stops at "it works on my machine." Writing the infrastructure-as-code is not the same as applying it; deploy the exact commit CI passed; never stack a PR on another PR's branch; verify a backup exists before every deploy.
5. **Post-Launch & Operations.** The classic list ends at launch. Uptime monitoring is not error tracking; a backup you have never restored is not a backup; write the incident runbook while calm.

Plus items folded into existing sections: HTTP security headers, dependency and supply-chain gating, server hardening, rotate-anything-ever-leaked, email unsubscribe (CAN-SPAM), a real data-deletion mechanism (usually promised in the ToS but never built), reduced-motion as a correctness bug, and no-no-op-buttons UX.

## The structural change

The classic list is organised by topic. Ship Kit keeps the topics but adds a phase axis (Foundation, Build, Pre-launch, Deploy, Launch day, Post-launch) and a priority axis (blocker, first-week, nice, always-on). The same list then answers three questions: what to do before you write code, what must be green before you launch, and what you operate forever.

## Bottom line

Use the classic pre-launch checks as your launch gate; they are good at that. Ship Kit is the superset: those checks preserved or upgraded, plus 76 lessons the pre-launch window does not cover, organised so you can drop it into any repo on day one.
