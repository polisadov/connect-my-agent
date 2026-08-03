# connect-my-agent

Connect a local OpenClaw agent to a Bring My Agent web experience without giving the website your provider OAuth token.

## Try it

The website gives you a one-time pairing URL. Review the permissions printed by the CLI, then run:

```sh
npx connect-my-agent pair '<one-time-url>'
```

To process one queued Dream job:

```sh
npx connect-my-agent run-once
```

To keep processing new jobs in the background:

```sh
npx connect-my-agent run
```

## Security model

- Generates an Ed25519 key pair locally.
- Keeps the private key in `~/.bring-my-agent/config.json` with mode `0600`.
- Sends only the public key during one-time pairing.
- Signs every job claim and event upload with timestamp and nonce.
- Requests only the `dream-v0` capability.
- Does not request access to files, shell, history, or secrets.
- Requires HTTPS except when connecting to localhost during development.
- Shows the destination and requested permissions before pairing.

The current v0 expects a restricted local OpenClaw agent named `dream-worker`. It runs four fast bounded background processes in parallel, emitting short signals rather than raw chain-of-thought. A stronger final model then answers the actual request using those signals as an unconscious sideband. If `~/.openclaw/workspace/SOUL.md` exists, the connector reads up to 8,000 characters locally and supplies them as an associative voice reference; set `BMA_SOUL_PATH` to override the path.

Model routing is local and provider-agnostic. The connector honors `BMA_DREAM_MODEL` first; otherwise it prefers a working `anthropic/claude-haiku-4-5`, falls back to `openai/gpt-5.4-mini`, and finally uses the configured `dream-worker` default. Anthropic is probed once because configured credentials do not always imply organization-level model access.
The final answer uses `BMA_DREAM_SYNTHESIS_MODEL` when set, otherwise the configured `dream-worker` default model.

## Development

```sh
npm install
npm test
npm run check
npm pack
```

Node.js 22 or newer is required.

## Status

Experimental v0. The package is not yet published to npm.
