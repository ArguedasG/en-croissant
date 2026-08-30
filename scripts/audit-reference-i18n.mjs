import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseSync, traverse } from "@babel/core";

function sourceFiles(dir = "src") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
}

/** Static coverage is measurable; it is not a claim that every possible dynamic key is covered. */
export function referenceReport() {
  const en = JSON.parse(readFileSync("src/translation/en-US.json", "utf8")).translation;
  const es = JSON.parse(readFileSync("src/translation/es-ES.json", "utf8")).translation;
  const missingEs = Object.keys(en).filter((key) => !es[key]?.trim());
  const missingEn = Object.keys(es).filter((key) => !en[key]?.trim());
  const placeholders = (value) =>
    [...new Set(value.match(/\{\{[^}]+\}\}/g) ?? [])].sort().join("|");
  const placeholderMismatches = Object.keys(en).filter(
    (key) => es[key] && placeholders(en[key]) !== placeholders(es[key]),
  );
  const usedKeys = new Set();
  const hardcodedTrainingText = [];
  for (const path of sourceFiles()) {
    const ast = parseSync(readFileSync(path, "utf8"), {
      filename: path,
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
    });
    traverse(ast, {
      CallExpression({ node }) {
        if (
          (["t", "trainingT"].includes(node.callee.name) || node.callee.property?.name === "t") &&
          node.arguments[0]?.type === "StringLiteral"
        )
          usedKeys.add(node.arguments[0].value);
      },
      JSXAttribute({ node }) {
        if (node.name.name === "i18nKey" && node.value?.type === "StringLiteral")
          usedKeys.add(node.value.value);
        if (
          /components\/(training|panels\/practice)/.test(path) &&
          ["label", "title", "aria-label"].includes(node.name.name) &&
          node.value?.type === "StringLiteral" &&
          /[a-z]/i.test(node.value.value)
        )
          hardcodedTrainingText.push(`${path}:${node.loc.start.line} ${node.value.value}`);
      },
      JSXText({ node }) {
        if (!/components\/(training|panels\/practice)/.test(path)) return;
        const text = node.value.replace(/\s+/g, " ").trim();
        if (/[a-záéíóúñ]/i.test(text) && !["cp", "s)", "N/A"].includes(text))
          hardcodedTrainingText.push(`${path}:${node.loc.start.line} ${text}`);
      },
    });
  }
  const missingUsed = [...usedKeys].filter((key) => !en[key] && !en[`${key}_other`]);
  return {
    englishKeys: Object.keys(en).length,
    spanishKeys: Object.keys(es).length,
    missingEs,
    missingEn,
    placeholderMismatches,
    missingUsed,
    hardcodedTrainingText,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/audit-reference-i18n.mjs")) {
  const report = referenceReport();
  console.log(JSON.stringify(report, null, 2));
  if (
    [
      report.missingEs,
      report.missingEn,
      report.placeholderMismatches,
      report.missingUsed,
      report.hardcodedTrainingText,
    ].some((issues) => issues.length > 0)
  )
    process.exitCode = 1;
}
