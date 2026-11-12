'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clusterResults, wcagTags, wcagLevels } = require('../src/cluster');

test('converts axe success-criterion tags into WCAG criterion labels', () => {
  assert.deepEqual(wcagTags(['wcag412', 'wcag143', 'best-practice']), ['4.1.2', '1.4.3']);
});

test('extracts WCAG version and conformance level tags', () => {
  assert.deepEqual(wcagLevels(['wcag2a', 'wcag21aa', 'wcag22aaa']), [
    { version: '2.0', level: 'A' },
    { version: '2.1', level: 'AA' },
    { version: '2.2', level: 'AAA' }
  ]);
});

test('clusters the same rule across pages and records fan-out', () => {
  const result = clusterResults([
    { page: 'Home', violations: [{ id: 'button-name', impact: 'critical', tags: ['wcag412'], nodes: [{ target: ['button'] }] }] },
    { page: 'Help', violations: [{ id: 'button-name', impact: 'critical', tags: ['wcag412'], nodes: [{ target: ['button'] }, { target: ['.menu'] }] }] }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].pageCount, 2);
  assert.equal(result[0].nodeCount, 3);
  assert.deepEqual(result[0].pages, ['Home', 'Help']);
  assert.deepEqual(result[0].wcagCriteria, ['4.1.2']);
});

test('prioritizes critical shared rules above serious page-local rules', () => {
  const result = clusterResults([
    { page: 'Home', violations: [
      { id: 'shared-critical', impact: 'critical', tags: [], nodes: [] },
      { id: 'local-serious', impact: 'serious', tags: [], nodes: [] }
    ] },
    { page: 'Help', violations: [
      { id: 'shared-critical', impact: 'critical', tags: [], nodes: [] }
    ] }
  ]);
  assert.equal(result[0].id, 'shared-critical');
});

test('prioritizes broader page fan-out within the same impact level', () => {
  const result = clusterResults([
    { page: 'Home', violations: [
      { id: 'shared', impact: 'serious', tags: [], nodes: [] },
      { id: 'local', impact: 'serious', tags: [], nodes: [] }
    ] },
    { page: 'Help', violations: [
      { id: 'shared', impact: 'serious', tags: [], nodes: [] }
    ] }
  ]);
  assert.deepEqual(result.map(group => group.id), ['shared', 'local']);
  assert.deepEqual(result.map(group => group.priorityScore), [230, 130]);
});

test('prioritizes page-wide serious rules ahead of local critical rules', () => {
  const result = clusterResults([
    { page: 'Home', violations: [{ id: 'shared-serious', impact: 'serious', tags: [], nodes: [] }] },
    { page: 'Catalog', violations: [{ id: 'shared-serious', impact: 'serious', tags: [], nodes: [] }] },
    { page: 'Requests', violations: [{ id: 'shared-serious', impact: 'serious', tags: [], nodes: [] }] },
    { page: 'Settings', violations: [{ id: 'shared-serious', impact: 'serious', tags: [], nodes: [] }] },
    { page: 'Profile', violations: [{ id: 'shared-serious', impact: 'serious', tags: [], nodes: [] }] },
    { page: 'Help', violations: [
      { id: 'shared-serious', impact: 'serious', tags: [], nodes: [] },
      { id: 'local-critical', impact: 'critical', tags: [], nodes: [] }
    ] }
  ]);
  assert.deepEqual(result.map(group => group.id), ['shared-serious', 'local-critical']);
});
