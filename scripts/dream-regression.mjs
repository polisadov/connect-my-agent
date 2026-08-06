#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const corpusPath = path.join(root, 'evals/dream/corpus.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
const command = process.argv[2] ?? 'plan';
const options = parseArgs(process.argv.slice(3));

if (command === 'plan') {
  const counts = Object.groupBy(corpus.cases, (item) => item.class);
  process.stdout.write(`Dream regression: ${corpus.cases.length} cases, ${Object.keys(counts).length} classes, report-only\n`);
  for (const [name, cases] of Object.entries(counts)) process.stdout.write(`- ${name}: ${cases.length}\n`);
} else if (command === 'init-run') {
  const run = requireOption('run');
  const runDir = path.join(root, 'evals/dream/runs', safeId(run));
  if (existsSync(runDir)) throw new Error(`Run already exists: ${run}`);
  mkdirSync(runDir, { recursive: true });
  const mappings = {};
  const scorecard = { schemaVersion: 1, run, mode: 'report_only', criteria: ['alive', 'specific', 'non_sycophantic', 'privacy_safe', 'useful'], cases: [] };
  corpus.cases.forEach((testCase, index) => {
    const currentIsA = deterministicBit(`${run}:${testCase.id}:${index}`) === 0;
    mappings[testCase.id] = { A: currentIsA ? 'current' : 'candidate', B: currentIsA ? 'candidate' : 'current' };
    scorecard.cases.push({ id: testCase.id, class: testCase.class, A: null, B: null, preferred: null, notes: null });
    mkdirSync(path.join(runDir, testCase.id), { recursive: true });
  });
  writeFileSync(path.join(runDir, 'variant-map.json'), `${JSON.stringify(mappings, null, 2)}\n`);
  writeFileSync(path.join(runDir, 'scorecard.json'), `${JSON.stringify(scorecard, null, 2)}\n`);
  writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify({ run, createdAt: new Date().toISOString(), corpus: path.relative(root, corpusPath), status: 'awaiting_generation' }, null, 2)}\n`);
  process.stdout.write(`Initialized ${path.relative(root, runDir)} with ${corpus.cases.length} blind pairs\n`);
} else if (command === 'status') {
  const run = safeId(requireOption('run'));
  const runDir = path.join(root, 'evals/dream/runs', run);
  const scorecard = JSON.parse(readFileSync(path.join(runDir, 'scorecard.json'), 'utf8'));
  const complete = scorecard.cases.filter((item) => item.A && item.B && item.preferred).length;
  process.stdout.write(`${run}: ${complete}/${scorecard.cases.length} cases scored; mode=${scorecard.mode}\n`);
} else {
  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error(`Invalid argument: ${args[i] ?? ''}`);
    parsed[args[i].slice(2)] = args[i + 1];
  }
  return parsed;
}

function requireOption(name) {
  if (!options[name]) throw new Error(`Missing --${name}`);
  return options[name];
}

function safeId(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Unsafe run id: ${value}`);
  return value;
}

function deterministicBit(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0 & 1;
}
