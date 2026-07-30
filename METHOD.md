# Method

Ship Kit is made by Edgewise Lab. It has two roots.

**The standard checks.** A set of pre-launch checks circulates widely for indie and AI-built apps: turn on row-level security, enforce the paywall on the server, do not expose `.env`, set up SPF/DKIM/DMARC, add an og image, run PageSpeed, install analytics, publish a Terms of Service. These are common practice, not any one person's invention. Ship Kit compiles them (about a third of the 113 checks), keeps the useful shape of each (what to check, how, what bad looks like, why it matters), and corrects a handful with sharper, real-world guidance.

**Production experience.** A pre-launch list only covers the hour before you go live. The most expensive bugs live just outside that window: in how you build, how you deploy, and how you operate afterwards. So Edgewise Lab expanded the list with lessons drawn from a portfolio of real production apps built with AI coding agents (payments, voice-AI, marketing sites, internal tools), organised into 76 additional checks and five new sections:

1. **Foundations & AI Workflow:** how to build safely with an AI agent: a deny-list before auto-accept, one machine gate that defines done, an independent checker, commit-but-never-push.
2. **Data & Migrations:** the single most expensive class of bug and absent from most pre-launch lists: fail loud, one schema source of truth, idempotent crons, timezone-correct dates.
3. **Payments:** beyond "test the webhook": idempotent issuance, one shared paid-event handler, explicit VAT, suspend money-moving jobs during deploys.
4. **Deploy & Release:** writing the config is not the same as the control being live; deploy the exact commit CI passed; verify a backup before every deploy.
5. **Post-Launch & Operations:** uptime monitoring is not error tracking; a backup you have never restored is not a backup; write the incident runbook while calm.

## The cross-cutting themes

Five lessons showed up again and again, across every kind of app:

1. **The server is the only security boundary.** Auth, paywall, authorization, validation and tenant scoping must all be enforced server-side. Anything in the browser is UX.
2. **Wrote it is not shipped it.** Merged infrastructure-as-code, an unset flag, a secret not redeployed, an unrestarted server: the gap between authored and active is invisible until an incident.
3. **Green tests still ship bugs.** Mock-heavy suites skip the real database, the real backend-from-frontend, and the conditions bugs actually trigger under.
4. **Fail loud.** A silently-skipped work item is worse than a failed one, because nobody ever finds out.
5. **Secrets are scar tissue.** Rotate anything ever seen where it should not be, update both stores then redeploy, and never let a secret near a transcript.

## Priorities and phases

Each check carries a priority (🔴 launch blocker, 🟡 first week, 🟢 nice to have, 🔵 always-on) and a phase (Foundation, Build, Pre-launch, Deploy, Launch day, Post-launch). That lets the same list answer three questions: what to do before you write code, what must be green before you launch, and what you operate forever.

## Contributing to the source list

Every check is one object in `data/checklist.mjs`, with a short `source` line describing where the lesson comes from. If you add a check from your own experience, keep that line generic: describe the class of app and the failure mode, not a specific company, product, or person.
