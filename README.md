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
- Never requests access to shell or secrets. Conversation memory is a separate optional pairing scope.
- With explicit per-run consent, stores up to 50 compact prior Dream conclusions and motifs locally in `~/.bring-my-agent/dream-memory.json`; raw chat history is never read.
- With `conversation-memory-read` granted during pairing and enabled for a run, selects up to four relevant fragments from local `MEMORY.md` and recent `memory/YYYY-MM-DD.md` files. Files remain local and are never uploaded wholesale; selected fragments can be sent to the locally configured model.
- Requires HTTPS except when connecting to localhost during development.
- Shows the destination and requested permissions before pairing.

The current v0 expects a restricted local OpenClaw agent named `dream-worker`. It runs four fast bounded processes — Unease, Warmth, Loss, and Echo — in parallel, emitting short signals rather than raw chain-of-thought. Each process receives a different fragment of `SOUL.md`. A stronger final model answers the request using at most two signals and one image. If the user enables Dream memory for a run, the connector retrieves compact local reminders of what prior Dreams already said so the answer can advance rather than repeat them.

Model routing is local and provider-agnostic. The connector honors `BMA_DREAM_MODEL` first; otherwise it prefers a working `anthropic/claude-haiku-4-5`, falls back to `openai/gpt-5.4-mini`, and finally uses the configured `dream-worker` default. Anthropic is probed once because configured credentials do not always imply organization-level model access.
The final answer uses `BMA_DREAM_SYNTHESIS_MODEL` when set, otherwise the configured `dream-worker` default model.

Override conversation-memory sources with `BMA_CONVERSATION_MEMORY_PATHS`, separated by the platform path delimiter.

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
