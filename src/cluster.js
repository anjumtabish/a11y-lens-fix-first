'use strict';

const IMPACT_ORDER = { critical: 4, serious: 3, moderate: 2, minor: 1, null: 0 };

function wcagTags(tags = []) {
  return tags.filter(tag => /^wcag\d/.test(tag)).map(tag => {
    // axe success-criterion tags look like wcag412 (WCAG 2.0 SC 4.1.2).
    const criterion = tag.match(/^wcag(\d)(\d)(\d+)$/);
    return criterion ? `${criterion[1]}.${criterion[2]}.${criterion[3]}` : tag;
  });
}

function wcagLevels(tags = []) {
  const levels = [];
  for (const tag of tags) {
    const match = tag.match(/^wcag(\d+)(a|aa|aaa)$/);
    if (match) levels.push({ version: `2.${match[1].length > 1 ? match[1].slice(1) : '0'}`, level: match[2].toUpperCase() });
  }
  return levels;
}

function clusterResults(pageResults) {
  const groups = new Map();
  for (const pageResult of pageResults) {
    for (const violation of pageResult.violations || []) {
      const key = violation.id;
      if (!groups.has(key)) {
        groups.set(key, {
          id: violation.id,
          impact: violation.impact || 'unknown',
          description: violation.description,
          help: violation.help,
          helpUrl: violation.helpUrl,
          wcagCriteria: wcagTags(violation.tags),
          wcagLevels: wcagLevels(violation.tags),
          wcagTags: (violation.tags || []).filter(tag => /^wcag/.test(tag)),
          pages: [],
          nodeCount: 0,
          targets: []
        });
      }
      const group = groups.get(key);
      group.pages.push(pageResult.page);
      group.nodeCount += (violation.nodes || []).length;
      for (const node of violation.nodes || []) {
        group.targets.push({ page: pageResult.page, target: node.target, failureSummary: node.failureSummary || null });
      }
      if ((IMPACT_ORDER[violation.impact] || 0) > (IMPACT_ORDER[group.impact] || 0)) group.impact = violation.impact;
    }
  }
  return [...groups.values()].map(group => ({
    ...group,
    pages: [...new Set(group.pages)],
    pageCount: new Set(group.pages).size,
    priorityScore: new Set(group.pages).size * 100 + (IMPACT_ORDER[group.impact] || 0) * 10
  })).sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
}

module.exports = { clusterResults, wcagTags, wcagLevels };
