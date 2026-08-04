import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workspace = process.env.BMA_OPENCLAW_WORKSPACE ?? path.join(os.homedir(), '.openclaw', 'workspace');

export function recallConversationMemory(prompt: string, limit = 4): string[] {
  const terms = tokens(prompt);
  return memoryFiles()
    .flatMap((file) => readFragments(file))
    .filter((fragment) => !looksSensitive(fragment))
    .map((fragment, index) => ({ fragment, index, score: overlap(terms, tokens(fragment)) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ fragment }) => fragment.slice(0, 700));
}

function memoryFiles(): string[] {
  const explicit = process.env.BMA_CONVERSATION_MEMORY_PATHS?.split(path.delimiter).filter(Boolean);
  if (explicit?.length) return explicit;
  const files = [path.join(workspace, 'MEMORY.md')];
  const daily = path.join(workspace, 'memory');
  try {
    files.push(...fs.readdirSync(daily)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort().reverse().slice(0, 30)
      .map((name) => path.join(daily, name)));
  } catch {}
  return files;
}

function readFragments(file: string): string[] {
  try {
    return fs.readFileSync(file, 'utf8').split(/\n\s*\n/g)
      .map((value) => value.replace(/^#+\s+/gm, '').trim())
      .filter((value) => value.length >= 40 && value.length <= 2_000);
  } catch {
    return [];
  }
}

function looksSensitive(value: string): boolean {
  return /(api[_ -]?key|secret|password|token\s*[:=]|private key|credential|парол|секрет|ключ\s*[:=])/iu.test(value);
}

function tokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

function overlap(left: Set<string>, right: Set<string>): number {
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}
