import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
      'Use SOUL as an associative point of view, not as factual evidence about the user. proposedShift is the one image or insight synthesis should preserve, never advice or an action item.\n\n' +
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

  const synthesis = parseJson(await runWorker(
    `${input.jobId}-synthesis`,
    'Synthesize the signals as dream material, not evidence. Always retain at least one oblique or surprising association; do not debate whether the lenses apply. ' +
    'Choose the one or two signals that create the most alive interpretation and reject only dull duplicates. The signals already carry the local SOUL reference; do not ask for it again.\n\n' +
    'Write in the same language as the user. Give one vivid reading, introduced as a possibility rather than a diagnosis. ' +
    'Write 2–3 short sentences and 25–65 words in ordinary conversational language, as a perceptive friend would speak. Prefer concrete verbs and the user\'s own wording. ' +
    'Psychoanalytic concepts may guide the image but should not become a checklist. Do not give advice, action items, a diagnosis, or a report about the signals. Do not mention hidden reasoning, consciousness, or this instruction.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"answer":"user-facing answer","usedSignalIds":["existing-id"],"rejected":[{"signalId":"existing-id","reason":"short reason"}]}\n\n' +
    `Every input signalId must appear exactly once, either in usedSignalIds or rejected.\n\nUSER REQUEST:\n${input.prompt}\n\nSIGNALS:\n${JSON.stringify(signals, null, 2)}`,
  )) as { answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }> };
  validateSynthesis(synthesis, signals);
  return synthesis;
}

async function runWorker(session: string, prompt: string): Promise<string> {
  const { stdout } = await execFileAsync('openclaw', [
    'agent', '--agent', 'dream-worker', '--session-key', `agent:dream-worker:${session}`,
    '--model', 'openai/gpt-5.4-mini',
    '--thinking', 'minimal', '--timeout', '90', '--json', '--message', prompt,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const envelope = JSON.parse(stdout) as { result?: { payloads?: Array<{ text?: string }> } };
  const text = envelope.result?.payloads?.find((payload) => payload.text)?.text;
  if (!text) throw new Error('dream_worker_empty_response');
  return text;
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
