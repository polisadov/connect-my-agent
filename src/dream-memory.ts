import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type DreamMemoryEntry = {
  prompt: string;
  alreadySaid: string;
  motifs: string[];
  createdAt: string;
};

const memoryPath = path.join(process.env.BMA_HOME ?? path.join(os.homedir(), '.bring-my-agent'), 'dream-memory.json');

export function recallDreamMemory(prompt: string, limit = 3): Array<{ alreadySaid: string; motifs: string[] }> {
  const entries = readEntries();
  const terms = tokens(prompt);
  return entries
    .map((entry, index) => ({ entry, index, score: overlap(terms, tokens(`${entry.prompt} ${entry.alreadySaid} ${entry.motifs.join(' ')}`)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => ({ alreadySaid: entry.alreadySaid, motifs: entry.motifs }));
}

export function rememberDream(prompt: string, memory: { alreadySaid: string; motifs: string[] }): void {
  const entries = readEntries();
  entries.unshift({ prompt: prompt.slice(0, 1_000), alreadySaid: memory.alreadySaid.slice(0, 500), motifs: memory.motifs.slice(0, 3).map((motif) => motif.slice(0, 160)), createdAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(memoryPath, `${JSON.stringify(entries.slice(0, 50), null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(memoryPath, 0o600);
}

function readEntries(): DreamMemoryEntry[] {
  try {
    const value = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    return Array.isArray(value) ? value as DreamMemoryEntry[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}

function tokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function overlap(left: Set<string>, right: Set<string>): number {
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}
