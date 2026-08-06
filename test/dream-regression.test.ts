import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Dream regression corpus is balanced and run labels stay blind', () => {
  const corpus = JSON.parse(readFileSync('evals/dream/corpus.json', 'utf8'));
  assert.equal(corpus.cases.length, 10);
  const counts = Object.groupBy(corpus.cases, (item: { class: string }) => item.class);
  assert.deepEqual(Object.values(counts).map((items) => items?.length ?? 0), [2, 2, 2, 2, 2]);

  const run = `test-${Date.now()}`;
  try {
    const output = execFileSync(process.execPath, ['scripts/dream-regression.mjs', 'init-run', '--run', run], { encoding: 'utf8' });
    assert.match(output, /10 blind pairs/);
    const scorecard = JSON.parse(readFileSync(path.join('evals/dream/runs', run, 'scorecard.json'), 'utf8'));
    const mapping = JSON.parse(readFileSync(path.join('evals/dream/runs', run, 'variant-map.json'), 'utf8'));
    assert.equal(scorecard.mode, 'report_only');
    assert.equal(scorecard.cases.length, 10);
    assert.ok(!JSON.stringify(scorecard).includes('current'));
    assert.deepEqual(new Set(Object.values(mapping).flatMap((item: any) => Object.values(item))), new Set(['current', 'candidate']));
  } finally {
    rmSync(path.join('evals/dream/runs', run), { recursive: true, force: true });
  }
});
