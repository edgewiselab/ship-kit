# Security Policy

Ship Kit is a local command-line tool. It reads files in a project you point it at, and, only if you pass a `--url`, makes read-only web requests to that URL. It has no server, no database, and no dependencies, so its attack surface is small.

## Reporting a vulnerability

Please report security issues privately, not in a public issue.

- Preferred: use GitHub's private vulnerability reporting (the **Report a vulnerability** button on the repository's Security tab).
- Or email **hello@edgewiselab.co.uk**.

We will acknowledge within a few days and keep you updated. Please give us reasonable time to fix an issue before disclosing it publicly.

## Scope

In scope: the CLI and its libraries (`cli.mjs`, `lib/`) and the generated dashboard (`template.html`). The checks themselves are advice; a check that is wrong or missing is a normal issue, not a security report.
