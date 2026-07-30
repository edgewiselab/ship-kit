<div align="center">

<img src="assets/edgewise-mark.svg" width="66" alt="Edgewise Lab" />

<sub>`FROM THE LAB · EDGEWISE LAB`</sub>

# Ship Kit

**Catch what breaks AI-built apps before you launch.**

Point it at your app and it tells you, in plain English, what is not safe to ship yet: emails going to spam, a database strangers can read, no privacy policy, no way to know when something breaks.

[![by Edgewise Lab](https://img.shields.io/badge/by-Edgewise%20Lab-4138E0?style=flat-square&labelColor=1A1A1F)](https://edgewiselab.co.uk) ![license MIT](https://img.shields.io/badge/license-MIT-1A1A1F?style=flat-square) ![node 18+](https://img.shields.io/badge/node-18%2B-1A1A1F?style=flat-square) ![dependencies 0](https://img.shields.io/badge/dependencies-0-1FA463?style=flat-square) ![113 checks](https://img.shields.io/badge/checks-113-4138E0?style=flat-square&labelColor=1A1A1F)

</div>

---

## The problem it solves

Apps built with AI tools (Lovable, Cursor, Replit, v0) ship fast, but they tend to skip the boring safety work. The same handful of things go wrong again and again, and it is rarely just one category:

- **Your emails go to spam**, so sign-ups, receipts and password resets never arrive.
- **Your database is readable by strangers.** Anyone with your web address can read your users' data.
- **There is no privacy policy**, even though the site is already tracking visitors.
- **Nothing tells you when it breaks**, so you hear about it from an angry customer.
- **The small launch-day stuff is missing:** no link preview image, no analytics, no way to delete a user's data on request.

Ship Kit is the checklist of what to get right, plus a tool that reads your project and tells you which of these actually apply to you. It was built from a portfolio of real production launches.

**This is not a code-security scanner.** Tools like that exist and are worth using. Ship Kit is the wider pre-launch checklist: security, but also email deliverability, legal pages, findability, payments, deploy safety, and what to keep an eye on after launch. It runs entirely on your own machine, nothing is ever uploaded, and it is free and MIT-licensed, not a paid product.

## Two ways to use it

### 🤖 With your AI (recommended, no terminal needed)

If you built your app with an AI assistant (Claude Code, Cursor, Codex), you run Ship Kit the same way: by asking. Paste this into your assistant:

> Set up Ship Kit. If the folder ~/ship-kit does not exist, run: git clone https://github.com/edgewiselab/ship-kit ~/ship-kit. If it already exists, run: git -C ~/ship-kit pull, so you are on the latest. Do not look for it anywhere else on my computer. Then scan this project for launch readiness. Open the dashboard, walk me through the launch-blockers in plain English, then stop and wait: I will decide what to fix.

It sets up the tool, works out your stack, runs the scan, opens the report, and waits. The full set of copy-paste prompts (scan, then check, then fix) is in **[USING-WITH-AI.md](USING-WITH-AI.md)**.

### ⌨️ In the terminal (for developers)

```bash
git clone https://github.com/edgewiselab/ship-kit
cd your-project
node /path/to/ship-kit/cli.mjs scan
```

## What you get

When the scan finishes it creates a folder called `ship-kit-report` **inside your project, on your own computer**. Nothing is uploaded and it is not a website. Inside:

- **`dashboard.html`**: **open this one in your browser.** It is the report: a colour-coded, plain-English list of what to fix, what to check, and what is already fine.
- **`REMEDIATION.md`**: a to-do list written for your AI. Hand it to Claude, Cursor or Codex and it works through the fixes.
- **`report.json`**: the same result in a format tools can read.

Open `dashboard.html` first. It is the human-friendly view; the `.md` file is for your AI.

## How to read the results

Every item is one of:

- 🟢 **Green:** Ship Kit confirmed this is done. Nothing to do.
- 🔴 **Red:** a real problem it found. Fix these before you launch.
- 🟡 **Amber:** it could not tell from a quick look, so please confirm. Most of these your AI can check for you in seconds; only a few need you (like clicking through your sign-up on your phone).

Anything that does not apply to your app is hidden. The percentage at the top is how many of the automatic checks pass; amber items are a to-do list, not failures, so they never drag it down.

## What it checks

Twelve areas, so nothing important slips through:

| # | Area | | # | Area |
| --- | --- | --- | --- | --- |
| 1 | Foundations & AI workflow | | 7 | Analytics & monitoring |
| 2 | Security & access | | 8 | Legal & compliance |
| 3 | Data & database | | 9 | Payments |
| 4 | Emails & deliverability | | 10 | Deploy & release |
| 5 | Findability (SEO) | | 11 | Testing & launch day |
| 6 | Speed & user experience | | 12 | After launch |

---

<div align="center">

### 👉 Need a hand shipping it?

**Edgewise Lab** builds, hardens and launches AI-built apps. If a check has you stuck, or you would rather someone else close the list, we can take a look.

### [Talk to Edgewise Lab ↗](https://edgewiselab.co.uk)

</div>

---

## For developers

Requirements: Node 18 or newer, no dependencies to install.

```bash
node cli.mjs scan                                          # interactive wizard
node cli.mjs scan --yes --db supabase --cloud vercel --url https://app.com   # non-interactive (what an AI runs)
```

Giving it a live URL (`--url`) lets it confirm more automatically. The only network calls are the optional checks against that URL.

**Just want to read the whole checklist?** Open `index.html` in any browser (or `ship-checklist.md`): filter by area or priority, search, and tick items off, with progress saved in your browser.

| Path | What it is |
| --- | --- |
| `cli.mjs` | The scanner entry point. |
| `lib/` | The engine: `context.mjs` (reads the repo), `capabilities.mjs` (works out what the app is), `detectors.mjs` (the checks), `probes.mjs` (live URL checks), `wizard.mjs` (the questions), `report.mjs` (writes the outputs). |
| `data/checklist.mjs` | The single source of truth. Every check is one object here. |
| `build.mjs` | Regenerates `ship-checklist.md` and `index.html` from the data. |
| `template.html` | The shell both the field guide and the scanner fill with data. |
| `USING-WITH-AI.md` · `ASSESSMENT.md` · `METHOD.md` | The AI prompt guide, the reasoning behind the checks, and how the list was built. |

To edit a check, change `data/checklist.mjs` and run `node build.mjs`. To make a check auto-detect, add an entry keyed by its id in `lib/detectors.mjs`. New checks and detectors are very welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">
<img src="assets/edgewise-mark.svg" width="30" alt="" /><br>
<sub>Ship Kit is made by <a href="https://edgewiselab.co.uk"><b>Edgewise Lab</b></a>. MIT licensed, see <a href="LICENSE">LICENSE</a>.</sub>
</div>
