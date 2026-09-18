import { cp, mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
const output = new URL('release/playground-web/', root)
await mkdir(output, { recursive: true })
// The target is fixed beneath this project's release directory.
await rm(new URL('public/', output), { recursive: true, force: true })
await cp(new URL('release/app/dist/renderer/', root), new URL('public/', output), { recursive: true })
for (const name of ['LICENSE', 'PLAYGROUND_CHANGES.md']) await cp(new URL(name, root), new URL(name, output))
await cp(new URL('server.mjs', import.meta.url), new URL('server.mjs', output))
await writeFile(new URL('start.cmd', output), '@echo off\r\nset "PLAYGROUND_ASSETS=%~dp0public"\r\nnode "%~dp0server.mjs"\r\npause\r\n')
await writeFile(new URL('start.sh', output), '#!/bin/sh\nPLAYGROUND_ASSETS="$(dirname "$0")/public" node "$(dirname "$0")/server.mjs"\n')
console.log('Web release:', fileURLToPath(output))
