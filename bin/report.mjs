// Markdown reports for PR comments and $GITHUB_STEP_SUMMARY. All remote text is escaped.
import { safe } from "./http.mjs";
export const md = (s) => safe(s).replace(/[\\`*_{}\[\]<>()#+!|~]/g, (c) => "\\" + c).replace(/\r?\n/g, " ");

export function auditMarkdown(results) {
  const failed = results.filter((r) => !r.ok).length;
  const lines = [`### cv-audit: ${results.length - failed}/${results.length} pages readable without JavaScript`, "",
    "| | Page | Text | Headings | JSON-LD | Problems |", "|---|---|---|---|---|---|"];
  for (const r of results) lines.push(`| ${r.ok ? "✅" : "❌"} | ${md(r.url)} | ${r.bodyTextLength} | ${r.headingCount} | ${r.jsonLdBlocks} | ${r.problems.map(md).join("<br>") || "none"} |`);
  return lines.join("\n") + "\n";
}

export function gradeMarkdown(grades) {
  const lines = ["### cv-audit grade", "", "| Grade | Score | Page | Missing | Notes |", "|---|---|---|---|---|"];
  for (const g of grades) lines.push(`| **${g.grade}** | ${g.score}/10 | ${md(g.url)} | ${g.checks.filter((c) => !c.pass).map((c) => md(`${c.label}${c.detail ? ` (${c.detail})` : ""}`)).join("<br>") || "none"} | ${g.notes.map(md).join("<br>") || ""} |`);
  lines.push("", "<sub>Rubric: 200 under 1s · title · description · canonical · 4+ OG · valid JSON-LD · one h1 · 1000+ chars without JS · robots.txt naming AI crawlers · same-host sitemap. A 9-10, B 7-8, C 5-6, D 3-4, F 0-2.</sub>");
  return lines.join("\n") + "\n";
}
