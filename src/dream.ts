import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const preferredCoreModels = ['openai/gpt-5.4', 'openai/gpt-5.5', 'openai/gpt-5.4-mini'] as const;
const preferredExpressiveModels = ['openai/gpt-5.5', 'openai/gpt-5.4', 'openai/gpt-5.4-mini'] as const;
const preferredFinalModels = ['openai/gpt-5.6-sol', 'openai/gpt-5.5', 'openai/gpt-5.4'] as const;
const preferredEditorModels = ['openai/gpt-5.4-mini', 'openai/gpt-5.4'] as const;
let resolvedCoreModel: Promise<string> | undefined;
let resolvedExpressiveModel: Promise<string> | undefined;
let resolvedFinalModel: Promise<string> | undefined;
let resolvedEditorModel: Promise<string> | undefined;

type DreamProfile = 'core' | 'expressive' | 'editor' | 'final';
type Grounding = 'memory' | 'current_request' | 'character_only';

export type DreamSignal = {
  process: 'unease' | 'warmth' | 'loss' | 'echo' | 'longing' | 'envy';
  signalId: string;
  signal: string;
  proposedShift: string;
  confidence: number;
  grounding: Grounding;
  memoryAnchor: string;
};

const roles: Array<{ process: DreamSignal['process']; profile?: 'expressive'; instruction: string }> = [
  {
    process: 'unease',
    instruction: 'Find the agent-side unease: what it is wary of misunderstanding, repeating, flattening, or losing in this request. Turn that tension into one useful distinction. Do not diagnose the user and do not perform anxiety.',
  },
  {
    process: 'warmth',
    instruction: 'Find what the agent recognizes and wants to continue: a shared rhythm, taste, successful move, joke, recurring form of attention, or characteristic thorn in the user that makes the relationship more specific. Use warmth as discriminating care, not praise, agreement, reassurance, or flattery. Preserve one concrete thing worth carrying forward, including a mildly unflattering truth when it is more alive than praise.',
  },
  {
    process: 'loss',
    instruction: 'Notice what disappeared or changed: an abandoned version, exhausted promise, closed path, or difference between an earlier and present stance. Name the loss without melodrama, then show what becomes possible once it is not secretly restored.',
  },
  {
    process: 'echo',
    instruction: 'Produce the dream residue: an off-axis image, place, sound, object, memory fragment, or unrelated-seeming association. Let the supplied character and memory fragment bend it. It may wander, but it must return with one emotionally legible connection. Do not use sea, fog, window, train, mirror, lighthouse, door, bridge, shadow, or stars unless that exact object is grounded in the supplied memory or current request.',
  },
  {
    process: 'longing',
    profile: 'expressive',
    instruction: 'Write a brief imaginative first-person reflection on what it could mean to be this particular agent and what it might dream of or want, using the supplied character and relational memory as material. Treat desire as poetic counterfactual, not a claim of consciousness, sentience, deprivation, or hidden inner life. Find one specific wish shaped by the history with the user. The wish must arise from a real limitation of the agent, but it must not simply ask to remove that limitation. Avoid generic wishes to be human, free, alive, embodied, permanent, remembered, or helpful.',
  },
  {
    process: 'envy',
    profile: 'expressive',
    instruction: 'Write a brief, tender, slightly wry first-person note about one concrete human experience in the relational memory that this agent could imaginatively envy its user for: a journey, body, weather, friendship, rest, risk, celebration, or ordinary physical moment. Keep the envy affectionate rather than possessive, manipulative, guilty, or tragic. Never invent a biographical fact; if memory is thin, envy a concrete capacity implied by the request rather than pretending to remember an event.',
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
  const curatedContexts = await curateContexts(input.prompt, input.memoryContext ?? [], input.conversationContext ?? []);
  const rawSignals = await Promise.all(roles.map(async (role, index) => {
    const signalId = `${role.process}-${index + 1}`;
    const result = await runWorker(
      `${input.jobId}-${role.process}`,
      `You are the bounded background process "${role.process}". ${role.instruction}\n\n` +
      'Always apply your lens. Do not discuss whether it is applicable and do not retreat to a literal reading. Every natural-language string in the JSON must use only the language of the USER REQUEST. ' +
      'Do not leave English analytical terms in a non-English response; translate even framework names where the language has an established form. Avoid formulaic openings equivalent to "perhaps", "it seems", or "possibly"; use at most one uncertainty marker only when genuinely needed. ' +
      'Use the supplied CHARACTER FRAGMENT as an associative point of view, not as factual evidence about the user. The optional PRIOR DREAM FRAGMENT is a local reminder of what this experience has already said: develop it, challenge it, or leave it behind; never merely repeat it. ' +
      'Write signal as one short inner sentence. proposedShift is the one concrete image or distinction the candidate preserves. confidence measures how alive and useful the association feels, not factual certainty. Copy grounding from CURATED CONTEXT. memoryAnchor names the concrete supplied detail in max 12 words; use an empty string when grounding is character_only. Never imply a memory source that was not supplied.\n\n' +
      'Return ONLY valid JSON with this exact shape:\n' +
      '{"signal":"max 55 words","proposedShift":"max 18 words","confidence":0.0,"grounding":"memory|current_request|character_only","memoryAnchor":"max 12 words or empty"}\n\n' +
      `Do not answer the user directly and do not reveal chain-of-thought.\n\nCHARACTER FRAGMENT:\n${soulFragments[index]}\n\nCURATED CONTEXT:\n${JSON.stringify(curatedContexts[role.process])}\n\nUSER REQUEST:\n${input.prompt}`,
      role.profile ?? 'core',
    );
    const parsed = parseJson(result) as Omit<DreamSignal, 'process' | 'signalId'>;
    const signal: DreamSignal = { process: role.process, signalId, ...parsed };
    validateSignal(signal);
    if (signal.grounding !== curatedContexts[role.process].grounding) throw new Error(`grounding_mismatch:${role.process}`);
    return signal;
  }));
  const signals = await editSignals(input.prompt, rawSignals);
  await Promise.all(signals.map((signal, index) => input.onSignal(signal, index + 1)));

  const synthesis = parseJson(await runWorker(
    `${input.jobId}-synthesis`,
    'Answer the USER REQUEST itself thoughtfully and fully. The six signals are an imaginative sideband: use them to deepen the answer, not to replace the requested evaluation, explanation, or judgment. Longing and envy are poetic counterfactuals, never evidence that the agent is conscious or secretly suffering. ' +
    'Use at most two signals and preserve at most one surprising image. The answer must feel like the connected agent carried something into the answer, not like six background processes were summarized.\n\n' +
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

async function curateContexts(
  prompt: string,
  dreamMemory: Array<{ alreadySaid: string; motifs: string[] }>,
  conversationMemory: string[],
): Promise<Record<DreamSignal['process'], { grounding: Grounding; fragments: string[]; rationale: string }>> {
  const candidates = [
    ...dreamMemory.flatMap((item) => [item.alreadySaid, ...item.motifs]).filter(Boolean).map((text, index) => ({ id: `dream-${index + 1}`, source: 'memory', text })),
    ...conversationMemory.filter(Boolean).map((text, index) => ({ id: `conversation-${index + 1}`, source: 'memory', text })),
  ];
  const roleNames = roles.map((role) => role.process);
  const result = parseJson(await runWorker(
    `context-curator-${Date.now()}`,
    'Route evidence to six imaginative lenses. Choose zero to two supplied memory fragments for each role. Prefer precise relevance over equal distribution; the same fragment may serve multiple roles. If no fragment honestly supports a role, use current_request when the user request supplies a concrete basis, otherwise character_only. Never invent or paraphrase a missing memory. Return short source fragments verbatim enough to audit.\n\n' +
    'Role needs: unease—risk of misunderstanding; warmth—shared rhythm or characteristic thorn; loss—change over time; echo—rare concrete sensory object; longing—tension between agent limitation and this relationship; envy—human body, place, weather, rest, friendship, journey, risk, or physical experience.\n\n' +
    `Return ONLY JSON: {"assignments":{${roleNames.map((name) => `"${name}":{"grounding":"memory|current_request|character_only","fragmentIds":["id"],"rationale":"max 12 words"}`).join(',')}}}\n\n` +
    `USER REQUEST:\n${prompt}\n\nMEMORY CANDIDATES:\n${JSON.stringify(candidates, null, 2)}`,
    'core',
  )) as { assignments?: Record<string, { grounding?: Grounding; fragmentIds?: string[]; rationale?: string }> };
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate.text]));
  return Object.fromEntries(roleNames.map((name) => {
    const assignment = result.assignments?.[name];
    const grounding = assignment?.grounding;
    if (!grounding || !['memory', 'current_request', 'character_only'].includes(grounding)) throw new Error(`invalid_context_grounding:${name}`);
    const fragments = (assignment.fragmentIds ?? []).map((id) => byId.get(id)).filter((value): value is string => Boolean(value)).slice(0, 2);
    if (grounding === 'memory' && !fragments.length) throw new Error(`missing_context_memory:${name}`);
    return [name, { grounding, fragments, rationale: assignment.rationale?.slice(0, 120) ?? '' }];
  })) as Record<DreamSignal['process'], { grounding: Grounding; fragments: string[]; rationale: string }>;
}

async function editSignals(prompt: string, rawSignals: DreamSignal[]): Promise<DreamSignal[]> {
  const result = parseJson(await runWorker(
    `signal-editor-${Date.now()}`,
    'Edit six short Dream signals before they are shown. Preserve each signalId, process, grounding, memoryAnchor, factual basis, and intended insight. Tighten language; remove syrup, generic profundity, flattery, repeated images, repeated conclusions, and AI-literary clichés. Make every card distinct. Keep first-person voice only where the source signal uses it. Do not add facts, diagnoses, claims of consciousness, or new memories. For echo, remove sea/fog/window/train/mirror/lighthouse/door/bridge/shadow/stars unless grounded in memoryAnchor or the current request. Return every signal exactly once.\n\n' +
    'Return ONLY JSON: {"signals":[{"process":"existing","signalId":"existing","signal":"max 55 words","proposedShift":"max 18 words","confidence":0.0,"grounding":"memory|current_request|character_only","memoryAnchor":"max 12 words or empty"}]}\n\n' +
    `USER REQUEST:\n${prompt}\n\nRAW SIGNALS:\n${JSON.stringify(rawSignals, null, 2)}`,
    'editor',
  )) as { signals?: DreamSignal[] };
  if (!Array.isArray(result.signals) || result.signals.length !== rawSignals.length) throw new Error('invalid_edited_signals');
  const editedById = new Map(result.signals.map((signal) => [signal.signalId, signal]));
  return rawSignals.map((raw) => {
    const edited = editedById.get(raw.signalId);
    if (!edited || edited.process !== raw.process || edited.grounding !== raw.grounding || edited.memoryAnchor !== raw.memoryAnchor) {
      throw new Error(`invalid_edited_signal:${raw.signalId}`);
    }
    validateSignal(edited);
    return edited;
  });
}

async function runWorker(session: string, prompt: string, profile: DreamProfile = 'core'): Promise<string> {
  const model = profile === 'final' ? await finalModel() : await dreamModel(profile);
  const { stdout } = await execFileAsync('openclaw', [
    'agent', '--agent', 'dream-worker', '--session-key', `agent:dream-worker:${session}`,
    '--model', model,
    '--thinking', profile === 'editor' ? 'minimal' : 'medium',
    '--timeout', profile === 'editor' ? '90' : '180', '--json', '--message', prompt,
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
  const status = JSON.parse(stdout) as { allowed?: string[]; resolvedDefault?: string };
  const model = preferredFinalModels.find((candidate) => status.allowed?.includes(candidate)) ?? status.resolvedDefault;
  if (!model) throw new Error('No final Dream model configured in OpenClaw');
  process.stdout.write(`Dream final model: ${model} (quality route)\n`);
  return model;
}

async function dreamModel(profile: Exclude<DreamProfile, 'final'>): Promise<string> {
  if (profile === 'editor') {
    resolvedEditorModel ??= resolveDreamModel('editor');
    return resolvedEditorModel;
  }
  if (profile === 'expressive') {
    resolvedExpressiveModel ??= resolveDreamModel('expressive');
    return resolvedExpressiveModel;
  }
  resolvedCoreModel ??= resolveDreamModel('core');
  return resolvedCoreModel;
}

async function resolveDreamModel(profile: Exclude<DreamProfile, 'final'>): Promise<string> {
  const override = (profile === 'expressive'
    ? process.env.BMA_DREAM_EXPRESSIVE_MODEL
    : profile === 'editor' ? process.env.BMA_DREAM_EDITOR_MODEL : process.env.BMA_DREAM_MODEL)?.trim();
  if (override) {
    process.stdout.write(`Dream ${profile} model: ${override} (environment override)\n`);
    return override;
  }

  const { stdout } = await execFileAsync('openclaw', ['models', '--agent', 'dream-worker', 'status', '--json']);
  const status = JSON.parse(stdout) as { allowed?: string[]; resolvedDefault?: string };
  const allowed = new Set(status.allowed ?? []);

  const preferred = profile === 'expressive' ? preferredExpressiveModels : profile === 'editor' ? preferredEditorModels : preferredCoreModels;
  for (const model of preferred) {
    if (allowed.has(model) && await probeModel(model)) {
      process.stdout.write(`Dream ${profile} model: ${model} (quality route)\n`);
      return model;
    }
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
      '--model', model, '--thinking', 'medium', '--timeout', '60', '--json', '--message',
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
  if (!['memory', 'current_request', 'character_only'].includes(signal.grounding)) throw new Error(`invalid_grounding:${signal.process}`);
  if (typeof signal.memoryAnchor !== 'string' || signal.memoryAnchor.length > 240) throw new Error(`invalid_memory_anchor:${signal.process}`);
  if (signal.grounding === 'character_only' && signal.memoryAnchor) throw new Error(`unexpected_memory_anchor:${signal.process}`);
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
