'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { clusterResults } = require('./cluster');

const ROOT = path.resolve(__dirname, '..');
const DEMO = path.join(ROOT, 'demo');
const OUT = path.join(ROOT, 'paper', 'evidence', 'a11y-scan');
const PAGES = ['home', 'catalog', 'requests', 'settings', 'profile', 'help'];
const FAILING_IMPACTS = new Set(['critical', 'serious']);
const DOCUMENT_LEVEL_RULES = new Set(['html-has-lang', 'meta-viewport']);

async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true }); }

async function annotatePage(page, violations, outputPath) {
  const annotations = [];
  const documentFindings = [];
  for (const violation of violations) {
    if (DOCUMENT_LEVEL_RULES.has(violation.id)) {
      documentFindings.push({ id: violation.id, impact: violation.impact });
      continue;
    }
    for (const node of violation.nodes || []) {
      for (const target of node.target || []) {
        if (typeof target === 'string' && target.trim()) {
          annotations.push({ selector: target, rule: violation.id });
        }
      }
    }
  }
  await page.evaluate(({ annotations: targets, documentFindings: docFindings }) => {
    const styleId = 'a11y-lens-annotation-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = [
        '.a11y-lens-summary{box-sizing:border-box;width:100%;min-height:28px;padding:6px 10px;background:#8c2f2f;color:#fff;font:600 11px/16px Arial,sans-serif;}',
        '.a11y-lens-highlight{outline:3px solid #e66b22!important;outline-offset:2px!important;position:relative!important;}',
        '.a11y-lens-label{position:absolute;left:0;top:-14px;z-index:2147483647;padding:1px 3px;background:#e66b22;color:#fff;font:600 10px/12px Arial,sans-serif;white-space:nowrap;}'
      ].join('');
      document.head.appendChild(style);
    }
    if (docFindings.length) {
      const banner = document.createElement('div');
      banner.className = 'a11y-lens-summary';
      banner.setAttribute('aria-hidden', 'true');
      banner.textContent = `Document-level a11y: ${docFindings.map(f => `[${f.impact}] ${f.id}`).join(' · ')}`;
      document.body.prepend(banner);
    }
    let number = 0;
    for (const annotation of targets) {
      try {
        document.querySelectorAll(annotation.selector).forEach(el => {
          el.classList.add('a11y-lens-highlight');
          number += 1;
          const label = document.createElement('span');
          label.className = 'a11y-lens-label';
          label.setAttribute('aria-hidden', 'true');
          label.textContent = `${number}. ${annotation.rule}`;
          const bounds = el.getBoundingClientRect();
          label.style.left = `${Math.max(0, Math.min(bounds.left + window.scrollX, window.innerWidth - 4))}px`;
          label.style.top = `${bounds.top + window.scrollY - 14}px`;
          document.body.appendChild(label);
          const labelBounds = label.getBoundingClientRect();
          if (labelBounds.right > window.innerWidth) {
            label.style.left = `${Math.max(0, window.innerWidth - labelBounds.width - 4)}px`;
          }
        });
      }
      catch (_) { /* axe target expressions are not always CSS selectors */ }
    }
  }, { annotations, documentFindings });
  await page.screenshot({ path: outputPath, fullPage: true });
}

function publicAxeResult(results, pageName) {
  // The raw axe payload otherwise includes the author's machine-specific absolute path.
  return { ...results, url: `file:///demo/${pageName}.html` };
}

async function main() {
  await ensureDir(OUT);
  const browser = await chromium.launch({ headless: true });
  const chromiumVersion = browser.version();
  const pageResults = [];
  try {
    for (const pageName of PAGES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      // Public demo scan is intentionally isolated: remote HTTP(S) requests are blocked.
      await page.route(/^https?:\/\//i, route => route.abort());
      const filePath = path.join(DEMO, `${pageName}.html`);
      await page.goto(pathToFileURL(filePath).href, { waitUntil: 'load' });
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      // The manuscript describes a full-document axe analysis. Do not restrict the engine
      // to a hand-picked tag set: preserve the complete result and filter only the
      // fix-first index to critical/serious impacts below.
      const results = await page.evaluate(async () => window.axe.run(document));
      const failing = results.violations.filter(v => FAILING_IMPACTS.has(v.impact));
      const result = { page: pageName, url: pathToFileURL(filePath).href, allViolations: results.violations, violations: failing, passes: results.passes.length, incomplete: results.incomplete.length, inapplicable: results.inapplicable.length };
      pageResults.push(result);
      await fs.writeFile(path.join(OUT, `${pageName}.axe.json`), JSON.stringify(publicAxeResult(results, pageName), null, 2));
      if (failing.some(v => v.nodes && v.nodes.length)) {
        await annotatePage(page, failing, path.join(OUT, `${pageName}.annotated.png`));
      }
      await page.close();
      console.log(`Scanned ${pageName}: ${failing.length} critical/serious rule hits`);
    }
  } finally {
    await browser.close();
  }

  const clusters = clusterResults(pageResults);
  const totalHits = pageResults.reduce((sum, p) => sum + p.violations.length, 0);
  const allViolationHits = pageResults.reduce((sum, p) => sum + p.allViolations.length, 0);
  const allViolationRules = new Set(pageResults.flatMap(p => p.allViolations.map(v => v.id)));
  const criticalHits = pageResults.reduce((sum, p) => sum + p.violations.filter(v => v.impact === 'critical').length, 0);
  const seriousHits = pageResults.reduce((sum, p) => sum + p.violations.filter(v => v.impact === 'serious').length, 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    playwrightVersion: require('playwright/package.json').version,
    chromiumVersion,
    axeCoreVersion: require('axe-core').version,
    pagesScanned: pageResults.length,
    pagesWithCriticalOrSeriousFindings: pageResults.filter(p => p.violations.length).length,
    criticalRuleHits: criticalHits,
    seriousRuleHits: seriousHits,
    allViolationRuleHits: allViolationHits,
    uniqueAllViolationRules: allViolationRules.size,
    totalCriticalOrSeriousRuleHits: totalHits,
    uniqueFailingRules: clusters.length,
    ticketCandidateCompression: clusters.length ? Number((totalHits / clusters.length).toFixed(2)) : null,
    note: 'Counts are rule hits per page, not individual affected DOM nodes. Compare with the published preprint; do not assume exact reproduction until validated.'
  };
  await fs.writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(OUT, 'clusters.json'), JSON.stringify(clusters, null, 2));
  await fs.writeFile(path.join(OUT, 'pages.json'), JSON.stringify(pageResults.map(p => ({ page: p.page, allViolationRules: p.allViolations.map(v => ({ id: v.id, impact: v.impact })), fixFirstRules: p.violations.map(v => v.id), passes: p.passes, incomplete: p.incomplete, inapplicable: p.inapplicable })), null, 2));
  const md = [
    '# A11y Lens – Fix-first accessibility report', '',
    `Generated: ${summary.generatedAt}`, `Node.js: ${summary.nodeVersion}`, `Playwright: ${summary.playwrightVersion}`, `Chromium: ${summary.chromiumVersion}`, `axe-core: ${summary.axeCoreVersion}`, '',
    '## Summary', '',
    `- Pages scanned: ${summary.pagesScanned}`,
    `- Pages with critical/serious findings: ${summary.pagesWithCriticalOrSeriousFindings}`,
    `- All axe violation rule hits: ${allViolationHits} across ${allViolationRules.size} unique rules`,
    `- Critical rule hits: ${criticalHits}`,
    `- Serious rule hits: ${seriousHits}`,
    `- Total rule hits: ${totalHits}`,
    `- Unique failing rules: ${clusters.length}`,
    `- Rule-hit / unique-rule ratio: ${summary.ticketCandidateCompression ?? 'n/a'}x`, '',
    '> Counts are rule hits per page, not individual affected DOM nodes. Automated checks do not establish WCAG conformance.', '',
    '## Fix-first clustered findings', '',
    '| Priority | Rule | Impact | Pages affected | WCAG tags | Nodes |',
    '|---:|---|---|---:|---|---:|',
    ...clusters.map((c, i) => `| ${i + 1} | ${c.id} | ${c.impact} | ${c.pageCount}/${PAGES.length} | ${(c.wcagTags || []).join(', ')} | ${c.nodeCount} |`), '',
    '## Per-page findings', '',
    ...pageResults.flatMap(p => [
      `- **${p.page} — all axe violations:** ${p.allViolations.map(v => `${v.id} (${v.impact})`).join(', ') || 'None'}`,
      `  **Fix-first (critical/serious):** ${p.violations.map(v => `${v.id} (${v.impact})`).join(', ') || 'None'}`
    ]), ''
  ].join('\n');
  await fs.writeFile(path.join(OUT, 'report.md'), md);
  console.log('\n' + JSON.stringify(summary, null, 2));
  console.log(`\nReports written to ${path.relative(ROOT, OUT)}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
