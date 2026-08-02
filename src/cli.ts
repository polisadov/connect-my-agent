#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { runDream, type DreamSignal } from './dream.js';
import { createNonce, generateDeviceIdentity, signRequest } from './protocol.js';

type Config = {
  baseUrl: string;
  agentId: string;
  publicKey: string;
  privateKey: string;
  capability: 'dream-v0';
};

const packageVersion = '0.1.0';
const args = process.argv.slice(2);
const command = args[0];
const argument = args.find((value, index) => index > 0 && !value.startsWith('--'));
const assumeYes = args.includes('--yes') || args.includes('-y');
const configPath = path.join(process.env.BMA_HOME ?? path.join(os.homedir(), '.bring-my-agent'), 'config.json');

try {
  if (command === 'pair' && argument) await pair(argument, assumeYes);
  else if (command === 'poll') await pollOnce();
  else if (command === 'run-once') await runOnce();
  else if (command === '--version' || command === '-v') process.stdout.write(`${packageVersion}\n`);
  else if (!command || command === '--help' || command === '-h') printHelp();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  process.stderr.write(`connect-my-agent: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function printHelp(): void {
  process.stdout.write(`connect-my-agent ${packageVersion}\n\n` +
    'Usage:\n' +
    '  connect-my-agent pair <one-time-url>\n' +
    '  connect-my-agent poll\n' +
    '  connect-my-agent run-once\n\n' +
    'Options:\n' +
    '  -y, --yes     Confirm pairing without an interactive prompt\n' +
    '  -h, --help    Show help\n' +
    '  -v, --version Show version\n');
}

async function pair(pairingUrl: string, yes: boolean): Promise<void> {
  const url = new URL(pairingUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Pairing requires HTTPS (localhost is allowed for development)');
  }
  const pairingId = url.pathname.match(/\/pair\/([^/]+)$/)?.[1];
  const secret = new URLSearchParams(url.hash.slice(1)).get('secret');
  if (!pairingId || !secret) throw new Error('Invalid pairing URL');

  process.stdout.write([
    `Pair with ${url.origin}`,
    'Requested capability: dream-v0',
    'Files: no | Shell: no | History: no | Secrets: no',
  ].join('\n') + '\n');
  if (!yes && !(await confirmPairing())) {
    process.stdout.write('Pairing cancelled.\n');
    return;
  }

  const identity = generateDeviceIdentity();
  const response = await fetch(`${url.origin}/api/pairings/${pairingId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret, publicKey: identity.publicKey }),
  });
  if (!response.ok) throw new Error(`Pairing failed: ${response.status} ${await response.text()}`);
  const result = await response.json() as { agentId: string; capability: 'dream-v0' };
  writeConfig({ baseUrl: url.origin, agentId: result.agentId, publicKey: identity.publicKey, privateKey: identity.privateKey, capability: result.capability });
  process.stdout.write(`Paired agent ${result.agentId}; private key saved locally with mode 0600.\n`);
}

async function confirmPairing(): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error('Interactive confirmation unavailable; rerun with --yes after reviewing permissions');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question('Allow this connection? [y/N] ')).trim().toLowerCase() === 'y';
  } finally {
    terminal.close();
  }
}

async function pollOnce(): Promise<void> {
  process.stdout.write(`${JSON.stringify({ job: await claimNextJob() }, null, 2)}\n`);
}

async function claimNextJob(): Promise<{ id: string; agentId: string; prompt: string } | null> {
  const config = readConfig();
  const requestPath = `/api/agents/${config.agentId}/jobs/next`;
  const response = await signedFetch(config, requestPath, 'POST', '');
  if (!response.ok) throw new Error(`Poll failed: ${response.status} ${await response.text()}`);
  return (await response.json() as { job: { id: string; agentId: string; prompt: string } | null }).job;
}

async function runOnce(): Promise<void> {
  const config = readConfig();
  const job = await claimNextJob();
  if (!job) return void process.stdout.write('No pending Dream job.\n');
  process.stdout.write(`Running Dream job ${job.id}\n`);
  const synthesis = await runDream({
    jobId: job.id,
    prompt: job.prompt,
    onSignal: async (signal, sequence) => {
      await postEvent(config, job.id, sequence, signal.process, 'process', JSON.stringify(signal));
      process.stdout.write(`Process ready: ${signal.process}\n`);
    },
  });
  await postEvent(config, job.id, 5, 'synthesis', 'final', JSON.stringify(synthesis));
  process.stdout.write(`Dream job complete: ${job.id}\n`);
}

async function postEvent(config: Config, jobId: string, sequence: number, stream: DreamSignal['process'] | 'synthesis', type: 'process' | 'final', text: string): Promise<void> {
  const requestPath = `/api/jobs/${jobId}/events`;
  const body = JSON.stringify({ sequence, stream, type, text });
  const response = await signedFetch(config, requestPath, 'POST', body);
  if (!response.ok) throw new Error(`Event upload failed: ${response.status} ${await response.text()}`);
}

async function signedFetch(config: Config, requestPath: string, method: string, body: string): Promise<Response> {
  const signed = signRequest({ agentId: config.agentId, method, path: requestPath, timestamp: Date.now(), nonce: createNonce(), body, privateKey: config.privateKey });
  return fetch(`${config.baseUrl}${requestPath}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-bma-agent-id': signed.agentId,
      'x-bma-timestamp': String(signed.timestamp),
      'x-bma-nonce': signed.nonce,
      'x-bma-signature': signed.signature,
    },
    ...(body ? { body } : {}),
  });
}

function writeConfig(config: Config): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(configPath, 0o600);
}

function readConfig(): Config {
  if (!fs.existsSync(configPath)) throw new Error('No paired agent. Run `connect-my-agent pair <one-time-url>` first.');
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;
}
