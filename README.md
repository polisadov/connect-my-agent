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

The current v0 expects a restricted local OpenClaw agent named `dream-worker`. It runs four bounded background processes and a synthesis step. The emitted process events are short structured signals, not raw chain-of-thought.

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
