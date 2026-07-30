# Using Ship Kit with your AI

You built your app with an AI assistant (Claude Code, Codex, Cursor). You can run Ship Kit the same way: by asking. You do not need to touch the terminal. Copy each prompt below into your assistant, in order, and it will do the work.

> These prompts assume your AI can run commands and read your files (Claude Code, the Codex CLI, Cursor's agent mode). If you are in a plain chat window with no access to your project, jump to [No terminal? Work the checks by hand](#no-terminal-work-the-checks-by-hand) at the bottom.

---

## 1. Scan the project

Paste this into your assistant:

```
You can run commands and read my project. Set up Ship Kit and scan this project for launch readiness. Do not fix anything yet.

1. Get the latest Ship Kit: if ~/ship-kit does not exist, run `git clone https://github.com/edgewiselab/ship-kit ~/ship-kit`. If it already exists, run `git -C ~/ship-kit pull` so you are on the newest version (the checks improve often).
2. Run the scan. Ship Kit reads the code and works out which checks apply, so you mostly just need my live URL. Ask me for it, or run without it:

   node ~/ship-kit/cli.mjs scan --yes --url <https://my-live-url.com>

   (You can pass hints like --db postgres or --payments stripe, but the scan auto-detects the stack, so you usually do not need to.)
3. Open ship-kit-report/dashboard.html in my browser so I can see the results.
4. Then tell me in plain English, and keep it short: what are my launch-blockers (the red ones), and roughly how ready am I?
5. Stop there. Do not change anything. I will look at the dashboard and tell you what I want fixed.
```

Your assistant clones the tool, scans, opens the dashboard, and gives you the short version, then stops. Nothing is changed and nothing is uploaded.

## 2. Look at the dashboard, then decide

This is your call, not the AI's. In the dashboard: green is passing, red is a real problem to fix, amber is something to verify yourself, and anything that does not apply to your project is hidden. Decide which red items you actually want handled now. Then, when you are ready, move on.

## 3. Let your AI check the "verify" list (this shrinks it a lot)

The long "verify" list is mostly not work for you. Ship Kit is a quick scanner; it flags anything it cannot judge from the code as "verify," but your AI can actually go and check most of them. Paste this:

```
Go through the "Verify before launch" items in ship-kit-report/REMEDIATION.md. Check each one yourself: read the relevant code, and the live site if I gave you a URL. Then tell me, grouped:
- Fine: the ones you confirmed are already handled.
- Actually a problem: the ones that are not, each with a one-line fix.
- Needs me: the few only I can do (like walking the signup flow on my phone, or a business or legal decision).
Do not change anything yet.
```

This usually turns a scary "16 to verify" into "most are fine, 3 real problems, 1 thing only you can check."

## 4. Fix only what you chose

```
Fix these for me: <name the items you want, e.g. "the missing preview image (SEO1) and error tracking (A5)">. For each one:
- tell me in a sentence what you are about to do,
- make the change,
- tell me how to confirm it worked.

Rules: do not fake a pass, do not weaken or delete any test to make something pass, and ask me before anything irreversible (deploying, deleting data, or sending emails).
```

## 5. Re-check, and repeat

```
Re-run the scan with the same settings: node ~/ship-kit/cli.mjs scan --yes
Show me the new readiness score and what is left. We will repeat this loop until no launch-blockers remain.
```

## 6. See it, if you like

```
Open ship-kit-report/dashboard.html in my browser.
```

The dashboard is the same list, colour-coded (green = passing, red = to fix, amber = to verify), with a readiness dial. Green and red are decided for you; amber is the "verify" list from step 3.

---

## Fixing just one thing

You do not have to run the whole scan. Every check in the field guide comes with a ready-made prompt. Open `ship-checklist.md` (or `index.html` in a browser), find the check you care about, and paste its prompt into your assistant. For example, for locking down your database:

```
Check my database is protected from public access. If I use Supabase: is Row Level Security enabled on EVERY table with user data, and does each table have policies so users can only read and write their own rows? If I use Firebase: are my security rules locked down or world-readable? Show me exactly which tables or collections are unprotected.
```

---

## No terminal? Work the checks by hand

If your AI is a plain chat window that cannot see your project or run commands, you cannot auto-scan, but you can still work the list:

1. Open `ship-checklist.md` and start at the top with the 🔴 launch-blockers.
2. For each check, copy its prompt (and paste in the relevant file from your project when the prompt asks for it).
3. Apply the fix your AI suggests, then move to the next.

Slower than the scanner, but it gets you to the same place.

---

Made by [Edgewise Lab](https://edgewiselab.co.uk).
