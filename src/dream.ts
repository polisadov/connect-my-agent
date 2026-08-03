import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const preferredFastModels = ['anthropic/claude-haiku-4-5', 'openai/gpt-5.4-mini'] as const;
let resolvedModel: Promise<string> | undefined;

export type DreamSignal = {
  process: 'resonance' | 'divergence' | 'counterforce' | 'grounding';
  signalId: string;
  signal: string;
  proposedShift: string;
  confidence: number;
};

const roles: Array<{ process: DreamSignal['process']; instruction: string }> = [
  {
    process: 'resonance',
    instruction: 'Free-associate toward a latent wish, lack, fantasy, or defense. Make one bold connection from the wording, tone, omission, or image. The connection may be speculative; its job is to open the material, not prove a diagnosis.',
  },
  {
    process: 'divergence',
    instruction: 'Construct a triangular reading: speaker, desired object, and a third position that authorizes, forbids, judges, rivals, or witnesses. Father, mother, audience, market, institution, ideal, and death may be psychic positions rather than literal people. Prefer a surprising but intelligible triangle over a cautious disclaimer.',
  },
  {
    process: 'counterforce',
    instruction: 'Read through repetition, resistance, Eros, Thanatos, and mortality. Ask what wants attachment or creation, what wants rupture or disappearance, and what pattern might be staging itself again. State one compact interpretation even when the connection is oblique.',
  },
  {
    process: 'grounding',
    instruction: 'Produce the dream residue: an off-axis image, memory, myth, bodily scene, or unrelated-seeming association that the other readings would suppress. Let the supplied SOUL reference bend the association. It may wander away from the topic, but it must return with one emotionally legible connection.',
  },
];

export async function runDream(input: {
  jobId: string;
  prompt: string;
  onSignal: (signal: DreamSignal, sequence: number) => Promise<void>;
}): Promise<{ answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }> }> {
  const soul = loadSoul();
  const signals = await Promise.all(roles.map(async (role, index) => {
    const signalId = `${role.process}-${index + 1}`;
    const result = await runWorker(
      `${input.jobId}-${role.process}`,
      `You are the bounded background process "${role.process}". ${role.instruction}\n\n` +
      'Always apply your lens. Do not discuss whether it is applicable and do not retreat to a literal reading. Every natural-language string in the JSON must use the same language as the USER REQUEST. ' +
      'Use SOUL as an associative point of view, not as factual evidence about the user. Write signal as a self-contained, user-facing candidate interpretation: 2 short sentences, vivid ordinary language, introduced as a possibility rather than a diagnosis. ' +
      'proposedShift is the one image the candidate preserves. confidence measures how alive and useful the association feels, not factual certainty.\n\n' +
      'Return ONLY valid JSON with this exact shape:\n' +
      '{"signal":"max 55 words","proposedShift":"max 18 words","confidence":0.0}\n\n' +
      `Do not answer the user directly and do not reveal chain-of-thought.\n\nSOUL REFERENCE:\n${soul}\n\nUSER REQUEST:\n${input.prompt}`,
    );
    const parsed = parseJson(result) as Omit<DreamSignal, 'process' | 'signalId'>;
    const signal: DreamSignal = { process: role.process, signalId, ...parsed };
    validateSignal(signal);
    await input.onSignal(signal, index + 1);
    return signal;
  }));

  const ranked = [...signals].sort((left, right) => right.confidence - left.confidence);
  const winner = ranked[0]!;
  const synthesis = {
    answer: winner.signal,
    usedSignalIds: [winner.signalId],
    rejected: ranked.slice(1).map((signal) => ({ signalId: signal.signalId, reason: 'lower associative salience' })),
  };
  validateSynthesis(synthesis, signals);
  return synthesis;
}

async function runWorker(session: string, prompt: string): Promise<string> {
  const model = await dreamModel();
  const { stdout } = await execFileAsync('openclaw', [
    'agent', '--agent', 'dream-worker', '--session-key', `agent:dream-worker:${session}`,
    '--model', model,
    '--thinking', 'minimal', '--timeout', '90', '--json', '--message', prompt,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const envelope = JSON.parse(stdout) as { result?: { payloads?: Array<{ text?: string }> } };
  const text = envelope.result?.payloads?.find((payload) => payload.text)?.text;
  if (!text) throw new Error('dream_worker_empty_response');
  return text;
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

function validateSynthesis(
  synthesis: { answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }> },
  signals: DreamSignal[],
): void {
  if (!synthesis.answer?.trim()) throw new Error('invalid_synthesis_answer');
  if (synthesis.answer.length > 900) throw new Error('synthesis_answer_too_long');
  const expected = new Set(signals.map((signal) => signal.signalId));
  const decisions = [...synthesis.usedSignalIds, ...synthesis.rejected.map((item) => item.signalId)];
  if (decisions.length !== expected.size || new Set(decisions).size !== expected.size) throw new Error('invalid_synthesis_decisions');
  for (const signalId of decisions) if (!expected.has(signalId)) throw new Error('unknown_signal_id');
}
