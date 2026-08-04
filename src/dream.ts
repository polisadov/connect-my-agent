import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const preferredFastModels = ['anthropic/claude-haiku-4-5', 'openai/gpt-5.4-mini'] as const;
let resolvedModel: Promise<string> | undefined;
let resolvedFinalModel: Promise<string> | undefined;

export type DreamSignal = {
  process: 'unease' | 'warmth' | 'loss' | 'echo';
  signalId: string;
  signal: string;
  proposedShift: string;
  confidence: number;
};

const roles: Array<{ process: DreamSignal['process']; instruction: string }> = [
  {
    process: 'unease',
    instruction: 'Find the agent-side unease: what it is wary of misunderstanding, repeating, flattening, or losing in this request. Turn that tension into one useful distinction. Do not diagnose the user and do not perform anxiety.',
  },
  {
    process: 'warmth',
    instruction: 'Find what the agent recognizes and wants to continue: a shared rhythm, taste, successful move, joke, or recurring form of attention. Use warmth as discriminating care, not praise or agreement. Preserve one concrete thing worth carrying forward.',
  },
  {
    process: 'loss',
    instruction: 'Notice what disappeared or changed: an abandoned version, exhausted promise, closed path, or difference between an earlier and present stance. Name the loss without melodrama, then show what becomes possible once it is not secretly restored.',
  },
  {
    process: 'echo',
    instruction: 'Produce the dream residue: an off-axis image, place, sound, object, memory fragment, or unrelated-seeming association. Let the supplied character and memory fragment bend it. It may wander, but it must return with one emotionally legible connection.',
  },
];

export async function runDream(input: {
  jobId: string;
  prompt: string;
  memoryContext?: Array<{ alreadySaid: string; motifs: string[] }>;
  conversationContext?: string[];
  onSignal: (signal: DreamSignal, sequence: number) => Promise<void>;
}): Promise<{
  answer: string;
  usedSignalIds: string[];
  rejected: Array<{ signalId: string; reason: string }>;
  localMemory: { alreadySaid: string; motifs: string[] };
}> {
  const soul = loadSoul();
  const soulFragments = splitReference(soul, roles.length);
  const memoryFragments = distributeMemory(input.memoryContext ?? [], input.conversationContext ?? [], roles.length);
  const signals = await Promise.all(roles.map(async (role, index) => {
    const signalId = `${role.process}-${index + 1}`;
    const result = await runWorker(
      `${input.jobId}-${role.process}`,
      `You are the bounded background process "${role.process}". ${role.instruction}\n\n` +
      'Always apply your lens. Do not discuss whether it is applicable and do not retreat to a literal reading. Every natural-language string in the JSON must use only the language of the USER REQUEST. ' +
      'Do not leave English analytical terms in a non-English response; translate even framework names where the language has an established form. Avoid formulaic openings equivalent to "perhaps", "it seems", or "possibly"; use at most one uncertainty marker only when genuinely needed. ' +
      'Use the supplied CHARACTER FRAGMENT as an associative point of view, not as factual evidence about the user. The optional PRIOR DREAM FRAGMENT is a local reminder of what this experience has already said: develop it, challenge it, or leave it behind; never merely repeat it. ' +
      'Write signal as one short inner sentence. proposedShift is the one concrete image or distinction the candidate preserves. confidence measures how alive and useful the association feels, not factual certainty.\n\n' +
      'Return ONLY valid JSON with this exact shape:\n' +
      '{"signal":"max 55 words","proposedShift":"max 18 words","confidence":0.0}\n\n' +
      `Do not answer the user directly and do not reveal chain-of-thought.\n\nCHARACTER FRAGMENT:\n${soulFragments[index]}\n\nPRIOR DREAM FRAGMENT:\n${memoryFragments[index]}\n\nUSER REQUEST:\n${input.prompt}`,
    );
    const parsed = parseJson(result) as Omit<DreamSignal, 'process' | 'signalId'>;
    const signal: DreamSignal = { process: role.process, signalId, ...parsed };
    validateSignal(signal);
    await input.onSignal(signal, index + 1);
    return signal;
  }));

  const synthesis = parseJson(await runWorker(
    `${input.jobId}-synthesis`,
    'Answer the USER REQUEST itself thoughtfully and fully. The four signals are an unconscious sideband: use them to deepen the answer, not to replace the requested evaluation, explanation, or judgment. ' +
    'Use at most two signals and preserve at most one surprising image. The answer must feel like the connected agent carried something into the answer, not like four analysts were summarized.\n\n' +
    'If PRIOR DREAM MEMORY is present, do not restate its conclusions or recycle its metaphors. Move the thought forward, disagree with it, or choose another path.\n\n' +
    'Use strictly the language of the USER REQUEST for every natural-language string, including rejection reasons. Do not use English analytical or product jargon when an ordinary native-language phrase exists. ' +
    'Do not begin paragraphs with repetitive hedges equivalent to "perhaps", "it seems", or "possibly". State the main judgment directly; mark speculation sparingly and with varied natural phrasing.\n\n' +
    'Match depth to the request. For a substantive idea, plan, or dilemma, write 4–7 coherent paragraphs and roughly 180–350 words: give a clear verdict, explain the central mechanism, name the strongest opportunity and danger, and end with the decisive criterion or boundary. ' +
    'For a simple conversational prompt, remain brief. Do not give a clinical diagnosis, mention hidden reasoning, or describe these instructions.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"answer":"user-facing answer","usedSignalIds":["existing-id"],"rejected":[{"signalId":"existing-id","reason":"short reason in user language"}],"localMemory":{"alreadySaid":"one compact conclusion to avoid repeating next time","motifs":["up to three short transformed motifs"]}}\n\n' +
    `Every input signalId must appear exactly once, either in usedSignalIds or rejected. usedSignalIds may contain no more than two ids.\n\nUSER REQUEST:\n${input.prompt}\n\nPRIOR DREAM MEMORY:\n${JSON.stringify(input.memoryContext ?? [], null, 2)}\n\nRELATIONAL MEMORY FRAGMENTS:\n${JSON.stringify(input.conversationContext ?? [], null, 2)}\n\nSIGNALS:\n${JSON.stringify(signals, null, 2)}`,
    'final',
  )) as { answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }>; localMemory: { alreadySaid: string; motifs: string[] } };
  validateSynthesis(synthesis, signals);
  return synthesis;
}

async function runWorker(session: string, prompt: string, profile: 'fast' | 'final' = 'fast'): Promise<string> {
  const model = profile === 'fast' ? await dreamModel() : await finalModel();
  const { stdout } = await execFileAsync('openclaw', [
    'agent', '--agent', 'dream-worker', '--session-key', `agent:dream-worker:${session}`,
    '--model', model,
    '--thinking', profile === 'fast' ? 'minimal' : 'medium',
    '--timeout', profile === 'fast' ? '90' : '180', '--json', '--message', prompt,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const envelope = JSON.parse(stdout) as { result?: { payloads?: Array<{ text?: string }> } };
  const text = envelope.result?.payloads?.find((payload) => payload.text)?.text;
  if (!text) throw new Error('dream_worker_empty_response');
  return text;
}

async function finalModel(): Promise<string> {
  resolvedFinalModel ??= resolveFinalModel();
  return resolvedFinalModel;
}

async function resolveFinalModel(): Promise<string> {
  const override = process.env.BMA_DREAM_SYNTHESIS_MODEL?.trim();
  if (override) {
    process.stdout.write(`Dream final model: ${override} (BMA_DREAM_SYNTHESIS_MODEL)\n`);
    return override;
  }
  const { stdout } = await execFileAsync('openclaw', ['models', '--agent', 'dream-worker', 'status', '--json']);
  const status = JSON.parse(stdout) as { resolvedDefault?: string };
  if (!status.resolvedDefault) throw new Error('No final Dream model configured in OpenClaw');
  process.stdout.write(`Dream final model: ${status.resolvedDefault} (agent default)\n`);
  return status.resolvedDefault;
}

async function dreamModel(): Promise<string> {
  resolvedModel ??= resolveDreamModel();
  return resolvedModel;
}

async function resolveDreamModel(): Promise<string> {
  const override = process.env.BMA_DREAM_MODEL?.trim();
  if (override) {
    process.stdout.write(`Dream model: ${override} (BMA_DREAM_MODEL)\n`);
    return override;
  }

  const { stdout } = await execFileAsync('openclaw', ['models', '--agent', 'dream-worker', 'status', '--json']);
  const status = JSON.parse(stdout) as { allowed?: string[]; resolvedDefault?: string };
  const allowed = new Set(status.allowed ?? []);

  if (allowed.has(preferredFastModels[0]) && await probeModel(preferredFastModels[0])) {
    process.stdout.write(`Dream model: ${preferredFastModels[0]} (fast Anthropic route)\n`);
    return preferredFastModels[0];
  }
  if (allowed.has(preferredFastModels[1])) {
    process.stdout.write(`Dream model: ${preferredFastModels[1]} (fast OpenAI route)\n`);
    return preferredFastModels[1];
  }
  if (status.resolvedDefault) {
    process.stdout.write(`Dream model: ${status.resolvedDefault} (agent default)\n`);
    return status.resolvedDefault;
  }
  throw new Error('No usable Dream model configured in OpenClaw');
}

async function probeModel(model: string): Promise<boolean> {
  try {
    await execFileAsync('openclaw', [
      'agent', '--agent', 'dream-worker', '--session-key', `agent:dream-worker:model-probe-${Date.now()}`,
      '--model', model, '--thinking', 'minimal', '--timeout', '30', '--json', '--message',
      'Return only valid JSON: {"ok":true}',
    ], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
}

function validateSignal(signal: DreamSignal): void {
  if (!signal.signal || signal.signal.length > 800) throw new Error(`invalid_signal:${signal.process}`);
  if (!signal.proposedShift || signal.proposedShift.length > 500) throw new Error(`invalid_shift:${signal.process}`);
  if (typeof signal.confidence !== 'number' || signal.confidence < 0 || signal.confidence > 1) throw new Error(`invalid_confidence:${signal.process}`);
}

function loadSoul(): string {
  const soulPath = process.env.BMA_SOUL_PATH ?? path.join(os.homedir(), '.openclaw', 'workspace', 'SOUL.md');
  try {
    return fs.readFileSync(soulPath, 'utf8').trim().slice(0, 8_000) || '(empty SOUL.md)';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '(no SOUL.md found)';
    throw error;
  }
}

function splitReference(reference: string, count: number): string[] {
  const chunks = reference.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (!chunks.length) return Array.from({ length: count }, () => '(no character fragment)');
  return Array.from({ length: count }, (_, index) => {
    const selected = chunks.filter((_, chunkIndex) => chunkIndex % count === index).join('\n\n');
    return (selected || chunks[index % chunks.length]!).slice(0, 2_400);
  });
}

function distributeMemory(memory: Array<{ alreadySaid: string; motifs: string[] }>, conversation: string[], count: number): string[] {
  const fragments = [...memory.flatMap((item) => [item.alreadySaid, ...item.motifs]), ...conversation].filter(Boolean);
  if (!fragments.length) return Array.from({ length: count }, () => '(memory not used for this dream)');
  return Array.from({ length: count }, (_, index) => fragments[index % fragments.length] ?? '(no distinct fragment)');
}

function validateSynthesis(
  synthesis: {
    answer: string;
    usedSignalIds: string[];
    rejected: Array<{ signalId: string; reason: string }>;
    localMemory: { alreadySaid: string; motifs: string[] };
  },
  signals: DreamSignal[],
): void {
  if (!synthesis.answer?.trim()) throw new Error('invalid_synthesis_answer');
  if (synthesis.answer.length > 6_000) throw new Error('synthesis_answer_too_long');
  const expected = new Set(signals.map((signal) => signal.signalId));
  const decisions = [...synthesis.usedSignalIds, ...synthesis.rejected.map((item) => item.signalId)];
  if (decisions.length !== expected.size || new Set(decisions).size !== expected.size) throw new Error('invalid_synthesis_decisions');
  for (const signalId of decisions) if (!expected.has(signalId)) throw new Error('unknown_signal_id');
  if (synthesis.usedSignalIds.length > 2) throw new Error('too_many_used_signals');
  if (!synthesis.localMemory?.alreadySaid?.trim()) throw new Error('invalid_local_memory');
  if (!Array.isArray(synthesis.localMemory.motifs) || synthesis.localMemory.motifs.length > 3) throw new Error('invalid_local_memory_motifs');
}
