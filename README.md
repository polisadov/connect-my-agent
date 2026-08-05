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
- With `conversation-memory-read` granted during pairing and enabled for a run, selects up to six relevant fragments from local `MEMORY.md` and recent `memory/YYYY-MM-DD.md` files. Files remain local and are never uploaded wholesale; selected fragments can be sent to the locally configured model.
- Requires HTTPS except when connecting to localhost during development.
- Shows the destination and requested permissions before pairing.

The current v0 expects a restricted local OpenClaw agent named `dream-worker`. It runs six fast bounded processes — Unease, Warmth, Loss, Echo, Longing, and Envy — in parallel, emitting short signals rather than raw chain-of-thought. Longing imagines one specific agent-side wish shaped by the relationship; Envy notices one concrete human experience with affectionate distance. Both are explicitly poetic counterfactuals, not claims of consciousness. Each process receives a different fragment of `SOUL.md`. A stronger final model answers the request using at most two signals and one image. If the user enables Dream memory for a run, the connector retrieves compact local reminders of what prior Dreams already said so the answer can advance rather than repeat them.

Model routing is local and provider-agnostic. The four core processes prefer `openai/gpt-5.4`; Longing and Envy prefer `openai/gpt-5.5`; final synthesis prefers `openai/gpt-5.6-sol`. Every stage uses medium reasoning effort, with progressively cheaper fallbacks. Override the three tiers independently with `BMA_DREAM_MODEL`, `BMA_DREAM_EXPRESSIVE_MODEL`, and `BMA_DREAM_SYNTHESIS_MODEL`.

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
