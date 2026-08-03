import { execFile } from 'node:child_process';
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
    instruction: 'Read for latent desire beneath the stated request. Identify the central wish, fantasy, lack, or forbidden satisfaction, and the defense that keeps it disguised. Attend to revealing substitutions, contradictions, and emotionally charged wording. Do not turn this into product advice.',
  },
  {
    process: 'divergence',
    instruction: 'Map the relational triangle organizing the material: self, desired object, and the third figure or law that authorizes, forbids, judges, or competes. Father, mother, rival, audience, institution, and ideal may be positions rather than literal people. Name the triangle only when the text supports it; do not mechanically diagnose an Oedipus complex.',
  },
  {
    process: 'counterforce',
    instruction: 'Find repetition, resistance, and self-sabotage. Ask what unwanted pattern is being recreated, what knowledge the speaker approaches and retreats from, and how the death drive may appear as stasis, undoing, compulsion, mastery, or return. Prefer one text-grounded conflict over generic pathology.',
  },
  {
    process: 'grounding',
    instruction: 'Read the conflict through Eros, Thanatos, and mortality. Identify what seeks attachment, creation, continuity, or pleasure; what seeks discharge, severance, control, disappearance, or an end; and how finitude gives the choice urgency. Keep the interpretation anchored in the user\'s actual words and state uncertainty where evidence is thin.',
  },
];

export async function runDream(input: {
  jobId: string;
  prompt: string;
  onSignal: (signal: DreamSignal, sequence: number) => Promise<void>;
}): Promise<{ answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }> }> {
  const signals = await Promise.all(roles.map(async (role, index) => {
    const signalId = `${role.process}-${index + 1}`;
    const result = await runWorker(
      `${input.jobId}-${role.process}`,
      `You are the bounded background process "${role.process}". ${role.instruction}\n\n` +
      'Return ONLY valid JSON with this exact shape:\n' +
      '{"signal":"max 80 words","proposedShift":"one precise visible change","confidence":0.0}\n\n' +
      `Do not answer the user directly and do not reveal chain-of-thought.\n\nUSER REQUEST:\n${input.prompt}`,
      'minimal',
    );
    const parsed = parseJson(result) as Omit<DreamSignal, 'process' | 'signalId'>;
    const signal: DreamSignal = { process: role.process, signalId, ...parsed };
    validateSignal(signal);
    await input.onSignal(signal, index + 1);
    return signal;
  }));

  const synthesis = parseJson(await runWorker(
    `${input.jobId}-synthesis`,
    'Produce a concise psychoanalytic interpretation of the user\'s material using only signals that are supported by the text. ' +
    'Organize the answer around one central unconscious conflict, not a sequence of recommendations. Distinguish latent desire from its defense; ' +
    'show the relational triangle or law if genuinely present; and connect repetition or resistance with Eros, Thanatos, and mortality where useful. ' +
    'Treat these as interpretive hypotheses, not clinical diagnoses or universal symbols. Avoid business-consulting language, generic self-help, and action-item endings. ' +
    'Reject irrelevant, forced, or semantically duplicate signals. Do not mention hidden reasoning, consciousness, or this instruction.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"answer":"user-facing answer","usedSignalIds":["existing-id"],"rejected":[{"signalId":"existing-id","reason":"short reason"}]}\n\n' +
    `Every input signalId must appear exactly once, either in usedSignalIds or rejected.\n\nUSER REQUEST:\n${input.prompt}\n\nSIGNALS:\n${JSON.stringify(signals, null, 2)}`,
    'medium',
  )) as { answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }> };
  validateSynthesis(synthesis, signals);
  return synthesis;
}

async function runWorker(session: string, prompt: string, thinking: 'minimal' | 'medium'): Promise<string> {
  const { stdout } = await execFileAsync('openclaw', [
    'agent', '--agent', 'dream-worker', '--session-key', `agent:dream-worker:${session}`,
    '--model', thinking === 'minimal' ? 'openai/gpt-5.4-mini' : 'openai/gpt-5.5',
    '--thinking', thinking, '--timeout', '180', '--json', '--message', prompt,
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

function validateSynthesis(
  synthesis: { answer: string; usedSignalIds: string[]; rejected: Array<{ signalId: string; reason: string }> },
  signals: DreamSignal[],
): void {
  if (!synthesis.answer?.trim()) throw new Error('invalid_synthesis_answer');
  const expected = new Set(signals.map((signal) => signal.signalId));
  const decisions = [...synthesis.usedSignalIds, ...synthesis.rejected.map((item) => item.signalId)];
  if (decisions.length !== expected.size || new Set(decisions).size !== expected.size) throw new Error('invalid_synthesis_decisions');
  for (const signalId of decisions) if (!expected.has(signalId)) throw new Error('unknown_signal_id');
}
