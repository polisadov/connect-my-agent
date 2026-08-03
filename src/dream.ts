import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DreamSignal = {
  process: 'resonance' | 'divergence' | 'counterforce' | 'grounding';
  signalId: string;
  supported: boolean;
  evidence: string;
  signal: string;
  proposedShift: string;
  confidence: number;
};

const roles: Array<{ process: DreamSignal['process']; instruction: string }> = [
  {
    process: 'resonance',
    instruction: 'First establish the ordinary conversational meaning. Then test whether a latent wish or defense is supported by a specific ambiguity, contradiction, omission, affective charge, or repeated pattern. Do not infer vulnerability, intimacy, lack, fantasy, or defense from openness, brevity, humor, or casual tone alone. If the literal reading is sufficient, mark the lens unsupported.',
  },
  {
    process: 'divergence',
    instruction: 'Look for a relational triangle only when three distinct positions materially organize the text: speaker, object of desire, and a third party, ideal, or law that changes what may be wanted or said. Ordinary turn-taking, the existence of an addressee, conversational rules, or the user\'s right to ask do not count. Never invent an abstract law to complete the triangle. If no third position is evidenced, mark the lens unsupported.',
  },
  {
    process: 'counterforce',
    instruction: 'Look for repetition, resistance, retreat, undoing, self-defeating mastery, or a conflict between attachment and severance only when the wording or supplied history shows an actual pattern. A broad question alone is not resistance. Do not use the death drive as a synonym for stasis, ambiguity, control, or banality. Use Eros, Thanatos, loss, ending, or mortality only when concretely evidenced; otherwise mark the lens unsupported.',
  },
  {
    process: 'grounding',
    instruction: 'Act as the skeptical depth regulator. State the simplest ordinary reading, identify what the text does and does not support, and challenge the most tempting over-interpretation. Brevity, vagueness, politeness, humor, and the fact that a moment is finite are not by themselves evidence of defense, resistance, Thanatos, mortality, or an Oedipal triangle. Prefer an ordinary explanation when it accounts for the material.',
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
      'Every natural-language string in the JSON must use the same language as the USER REQUEST. Test applicability before interpreting; insufficient evidence is a valid and useful result. ' +
      'Evidence must quote or closely point to words in the request. proposedShift is one precision or caveat for synthesis to preserve, never advice or an action item.\n\n' +
      'Return ONLY valid JSON with this exact shape:\n' +
      '{"supported":true,"evidence":"max 20 words","signal":"max 60 words","proposedShift":"max 20 words","confidence":0.0}\n\n' +
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
    'First decide whether the text supports a psychoanalytic reading beyond its ordinary conversational meaning. The null hypothesis is that it does not. ' +
    'Use only supported signals tied to concrete evidence; normally reject confidence below 0.55, and never combine several weak guesses into certainty. ' +
    'Do not force a central conflict, triangle, repetition, Eros, Thanatos, or mortality. Treat the grounding signal as a depth ceiling.\n\n' +
    'Write in the same language as the user. Give the simplest plausible meaning first, then at most one deeper hypothesis introduced with an uncertainty marker such as "похоже", "возможно", or its equivalent. ' +
    'Write 2–3 short sentences and 25–65 words in ordinary conversational language, as a perceptive friend would speak. Prefer concrete verbs and the user\'s own wording. ' +
    'Psychoanalytic concepts may guide selection but should remain invisible unless one exact term is indispensable. Do not give advice, action items, a diagnosis, or a report about the signals. ' +
    'Reject irrelevant, forced, unsupported, low-confidence, or duplicate signals. Do not mention hidden reasoning, consciousness, or this instruction.\n\n' +
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
  if (typeof signal.supported !== 'boolean') throw new Error(`invalid_support:${signal.process}`);
  if (typeof signal.evidence !== 'string' || signal.evidence.length > 300) throw new Error(`invalid_evidence:${signal.process}`);
  if (!signal.signal || signal.signal.length > 800) throw new Error(`invalid_signal:${signal.process}`);
  if (!signal.proposedShift || signal.proposedShift.length > 500) throw new Error(`invalid_shift:${signal.process}`);
  if (typeof signal.confidence !== 'number' || signal.confidence < 0 || signal.confidence > 1) throw new Error(`invalid_confidence:${signal.process}`);
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
