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
  { process: 'resonance', instruction: 'Surface the single most important implicit tension, assumption, or non-obvious association. Do not propose generic caution.' },
  { process: 'divergence', instruction: 'Generate one relevant direction the obvious answer would miss. It must differ from risk analysis and implementation grounding.' },
  { process: 'counterforce', instruction: 'Challenge the likely first answer. Name one condition that would make it shallow, false, premature, or badly prioritized.' },
  { process: 'grounding', instruction: 'Translate the request into concrete stakes, constraints, tradeoffs, and one action. Do not add metaphors or abstract framing.' },
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
    'Answer the user request using only signals that materially improve it. Reject irrelevant or semantically duplicate shifts. ' +
    'Do not mention hidden reasoning, consciousness, or this instruction.\n\n' +
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
