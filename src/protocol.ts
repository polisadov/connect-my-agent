import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export function createNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function generateDeviceIdentity(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function canonicalRequest(input: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body: string;
}): string {
  const bodyHash = createHash('sha256').update(input.body).digest('base64url');
  return [input.method.toUpperCase(), input.path, String(input.timestamp), input.nonce, bodyHash].join('\n');
}

export function signRequest(input: {
  agentId: string;
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body: string;
  privateKey: string;
}): { agentId: string; timestamp: number; nonce: string; signature: string } {
  return {
    agentId: input.agentId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    signature: sign(null, Buffer.from(canonicalRequest(input)), input.privateKey).toString('base64url'),
  };
}
