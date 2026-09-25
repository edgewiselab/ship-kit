// Regenerates ship-checklist.md and index.html from data/checklist.mjs
// Run:  node build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { meta, sections, checks } from "./data/checklist.mjs";

const PRIO = {
  blocker:   { label: "Launch blocker", emoji: "🔴" },
  "first-week": { label: "First week", emoji: "🟡" },
  nice:      { label: "Nice to have", emoji: "🟢" },
  ongoing:   { label: "Always-on", emoji: "🔵" },
};
const PHASE = { foundation:"Foundation", build:"Build", prelaunch:"Pre-launch", deploy:"Deploy", launch:"Launch day", postlaunch:"Post-launch" };
const ORIGIN = { kept:"Classic check", edited:"Expanded", new:"Added" };

const bySection = (id) => checks.filter((c) => c.section === id);
const count = (pred) => checks.filter(pred).length;

// ---------------------------------------------------------------- markdown
function buildMarkdown() {
  let m = "";
  m += `# ${meta.title}: ${meta.subtitle}\n\n`;
  m += `> ${meta.tagline}\n\n`;
  m += `${meta.sourceNote}\n\n`;
  m += `Open **index.html** for the interactive, filterable version that saves your progress.\n\n`;

  m += `## Legend\n\n`;
  m += `**Priority:** 🔴 Launch blocker · 🟡 First week · 🟢 Nice to have · 🔵 Always-on (a standing rule, not a one-time gate)\n\n`;
  m += `**Origin:** items are marked *Classic check* (a standard pre-launch check, kept), *Expanded* (a standard check corrected or expanded with a production learning), or *Added* (new, from Edgewise Lab's production experience).\n\n`;

  // summary
  m += `## At a glance\n\n`;
  m += `${checks.length} checks across ${sections.length} sections.\n\n`;
  m += `| Priority | Count |\n| --- | --- |\n`;
  for (const [k, info] of Object.entries(PRIO)) m += `| ${info.emoji} ${info.label} | ${count((c) => c.priority === k)} |\n`;
  m += `\n`;
  m += `| Origin | Count |\n| --- | --- |\n`;
  for (const [k, label] of Object.entries(ORIGIN)) m += `| ${label} | ${count((c) => c.origin === k)} |\n`;
  m += `\n`;

  // section index
  m += `| # | Section | Checks | Blockers |\n| --- | --- | --- | --- |\n`;
  for (const s of sections) {
    const items = bySection(s.id);
    m += `| ${String(s.n).padStart(2, "0")} | ${s.name} | ${items.length} | ${items.filter((c) => c.priority === "blocker").length} |\n`;
  }
  m += `\n---\n\n`;

  // full detail
  for (const s of sections) {
    m += `## ${s.n}. ${s.name}\n\n`;
    m += `_${s.blurb}_\n\n`;
    for (const c of bySection(s.id)) {
      const info = PRIO[c.priority];
      m += `### \`${c.id}\` ${c.title}\n\n`;
      m += `${info.emoji} **${info.label}** · Phase: ${PHASE[c.phase]} · ${ORIGIN[c.origin]}\n\n`;
      if (c.what) m += `**What to check.** ${c.what}\n\n`;
      if (c.how)  m += `**How.** ${c.how}\n\n`;
      if (c.bad)  m += `**What bad looks like.** ${c.bad}\n\n`;
      if (c.why)  m += `**Why it matters.** ${c.why}\n\n`;
      if (c.prompt) m += `**Paste into your AI tool:**\n\n\`\`\`text\n${c.prompt}\n\`\`\`\n\n`;
      if (c.source) m += `<sub>Where this comes from: ${c.source}</sub>\n\n`;
    }
    m += `---\n\n`;
  }
  m += `<sub>Generated from data/checklist.mjs by build.mjs. Edit the data, then run \`node build.mjs\` to regenerate this file and index.html.</sub>\n`;
  return m;
}

// ---------------------------------------------------------------- html
function buildHtml() {
  const payload = JSON.stringify({ meta, sections, checks });
  const tpl = readFileSync(new URL("./template.html", import.meta.url), "utf8");
  if (!tpl.includes("__SHIP_KIT_DATA__")) throw new Error("template marker missing");
  return tpl.replace("__SHIP_KIT_DATA__", payload);
}

// Artifact-ready variant: no doctype/html/head/body wrappers (the Artifact host adds them).
// Keep the <style> block, the visible markup, and the scripts.
function buildArtifact() {
  const html = buildHtml();
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  return `<title>Ship Kit · Edgewise Lab</title>\n${style}\n${body}`;
}

writeFileSync(new URL("./ship-checklist.md", import.meta.url), buildMarkdown());
writeFileSync(new URL("./index.html", import.meta.url), buildHtml());
writeFileSync(new URL("./artifact.html", import.meta.url), buildArtifact());

console.log(`Wrote ship-checklist.md and index.html`);
console.log(`${checks.length} checks · ${sections.length} sections`);
console.log(`Blockers: ${count((c) => c.priority === "blocker")} | First week: ${count((c) => c.priority === "first-week")} | Nice: ${count((c) => c.priority === "nice")} | Always-on: ${count((c) => c.priority === "ongoing")}`);
console.log(`Origin: kept ${count((c) => c.origin === "kept")} | edited ${count((c) => c.origin === "edited")} | new ${count((c) => c.origin === "new")}`);
