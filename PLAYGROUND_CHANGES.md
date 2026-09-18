# 模型操练场 / Model Playground

Based on Chatbox Community Edition (GPL-3.0), upstream commit
`471bfd08ff5905366444c1cc00dbb75a2870166a`.

Copyright notices and the upstream LICENSE are retained. This is an independent
modified distribution, not an official Chatbox release.

## Changes

- Independent ModelPlayground application identity and Windows data directory.
- Local connection editor/import/export, OpenAI Chat Completions and Responses,
  Claude Messages, manual model IDs, optional keys, request timeout and JSON overrides.
- Same-origin loopback Web gateway with origin/host/session checks, streaming
  backpressure, cancellation, and no redirects or generation retries.
- Request diagnostics, redaction, provider-reported usage, latency, raw events,
  history and JSON export/import. Raw event capture is capped at 1 MiB per request;
  the UI identifies truncated diagnostics. Chat output is not capped by this limit.
- API keys excluded from persisted settings. Web keys are memory-only; optional
  Windows Credential Manager storage is handled by the Electron main process.
- JPEG/PNG/WebP attachments limited to four images, 5 MiB each, before conversion.
- Custom Responses API preserves explicit API-root prefixes.

Existing Chatbox provider adapters, conversation history, image storage, Markdown,
session parameters, cancellation, and Electron networking remain in use.

## Usage

Use Node 22 and pnpm 10.33.0. `pnpm install --frozen-lockfile` installs the pinned
dependencies. `node playground/server.mjs --dev` starts the independent Web UI at
http://127.0.0.1:5174. `pnpm playground:build-web` creates the renderer assets;
`node playground/server.mjs` serves those assets with the local gateway.

`pnpm start` starts the desktop application. `pnpm playground:package` builds the
Windows x64 installer. Installation does not require ModelBase, Rust, or llama.cpp.
Desktop and Web each use their own data storage. Only the Windows desktop host can
remember API keys. The Web host must be served by the included local gateway.

Configure the API root explicitly, e.g. `http://127.0.0.1:11434/v1`. Endpoints are
appended to that root. The model service must already be running. Import the
credential-free connection JSON exported from ModelBase, save it, and start a new
conversation. Session settings contain system prompts and sampling parameters.

Requests can incur usage at the configured provider. The connection test sends a
small text request; it does not download or deploy any model.

## Verification commands

```text
node --test playground/server.test.mjs
pnpm exec vitest run src/renderer/playground/runtime.test.ts src/shared/providers/definitions/models/playground.test.ts src/main/playground-credentials.test.ts --maxWorkers 2
pnpm exec tsc --noEmit
```

External provider credentials are not included. Protocol tests use a local mock
server and must not be described as successful paid-provider inference.
