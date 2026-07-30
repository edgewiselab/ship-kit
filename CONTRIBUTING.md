# Contributing to Ship Kit

Thanks for helping. Two kinds of contribution are especially valuable.

## Add or improve a check

Every check lives as one object in `data/checklist.mjs`. A check has:

- `id`, `section`, `origin` (`kept` / `edited` / `new`), `priority` (`blocker` / `first-week` / `nice` / `ongoing`), `phase` (`foundation` / `build` / `prelaunch` / `deploy` / `launch` / `postlaunch`)
- `title`, `what`, `how`, `bad`, `why`, an optional `prompt`, and a short `source`

Keep the `source` line generic: describe the class of app and the failure mode, not a specific company, product, or person. After editing, run:

```bash
node build.mjs
```

That regenerates `ship-checklist.md` and `index.html`. Do not hand-edit those two files.

## Add a detector (the high-leverage one)

A detector lets a check auto-detect instead of asking the user. Add an entry keyed by the check id in `lib/detectors.mjs`:

```js
S14: (c) => {
  if (c.dep("helmet")) return { status: "pass", evidence: "helmet is installed" };
  return { status: "manual", evidence: "Add CSP/HSTS/X-Frame-Options headers" };
},
```

The context object `c` gives you `c.read(path)`, `c.has(path)`, `c.find(regex)`, `c.grep(regex, opts)`, `c.any(regex, opts)`, `c.dep(...names)`, `c.pkg`, `c.gitTracked`, `c.profile`, and (when a URL was given) `c.probes`.

Rules for detectors:

- **Never fake a pass.** If you cannot be sure, return `manual`, not `pass`.
- Prefer evidence a human can check: cite the file, the dependency, or the probe result.
- Detectors may be `async` (for DNS or network work).

Run it against a real project before opening a PR:

```bash
node cli.mjs scan --project ../some-app
```

## Style

Plain, direct language. Present tense. No hype words. Keep lines that become part of the checklist short and concrete.
