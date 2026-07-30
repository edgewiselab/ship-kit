## What this changes

Briefly, what and why.

## Checklist

- [ ] If I changed `data/checklist.mjs`, I ran `node build.mjs` and committed the regenerated `ship-checklist.md` and `index.html`.
- [ ] New or changed detectors never fake a pass (they return `manual` when unsure).
- [ ] Wording is plain and platform-generic: the managed-platform path first, self-host as an aside, no em dashes, no hype words.
- [ ] I ran a scan on a real project to check it works (`node cli.mjs scan --project ...`).
