# Security Review

Date: 2026-07-02

## Scope

Reviewed the package for public npm publication risk. The review covered source files, build output, package metadata, README, license, hidden project metadata, and the actual npm tarball contents.

## Commands Executed

- `Get-ChildItem -Force`
- `rg --files -uu` excluding dependency/cache/Git directories
- `rg -n -i -uu <secret, credential, local path, customer/project, workflow, and token patterns> .`
- `rg -n -i -uu <private key, cloud key, GitHub token, Slack token, OpenRouter/OpenAI key patterns> .`
- `npm.cmd run build`
- `npm.cmd run lint`
- `npm.cmd pack --dry-run --json`
- `npm.cmd pack`
- `tar -tf n8n-nodes-openrouter-reasoning-0.1.0.tgz`
- `tar -xOf n8n-nodes-openrouter-reasoning-0.1.0.tgz <published file> | rg -n -i <sensitive patterns>`

`npm.cmd pack` was run with a local npm cache directory inside the workspace because the default npm cache path was not writable in this environment.

## Files Published by npm Pack

- `LICENSE.md`
- `README.md`
- `dist/nodes/LmChatOpenRouterReasoning/LmChatOpenRouterReasoning.node.d.ts`
- `dist/nodes/LmChatOpenRouterReasoning/LmChatOpenRouterReasoning.node.js`
- `dist/nodes/LmChatOpenRouterReasoning/LmChatOpenRouterReasoning.node.js.map`
- `dist/nodes/LmChatOpenRouterReasoning/openrouter.dark.svg`
- `dist/nodes/LmChatOpenRouterReasoning/openrouter.svg`
- `package.json`

The package does not publish `node_modules`, `.git`, `.agents`, `.npm-cache`, `.env`, `.npmrc`, logs, screenshots, local tarball inputs, source `nodes/`, `package-lock.json`, or temporary files.

## Findings

- No API keys, bearer tokens, cookies, passwords, private keys, real OpenRouter keys, credential IDs, workflow IDs, container IDs, customer data, student data, prompts, or private operational configuration were found in files published to npm.
- The credential reference is generic n8n configuration: the node references `openRouterApi` and reads `credentials.apiKey` at runtime. No credential value or default key is stored in this package.
- Search hits for words such as `credential`, `apiKey`, `token`, and `workflow` were reviewed and are code or documentation false positives.
- `package-lock.json` contains dependency names and registry metadata only. It is not included in the npm tarball.
- The original README contained a machine-specific local install path. It was replaced with a generic placeholder path.
- The package uses a restrictive `"files"` allowlist: `dist`, `README.md`, and `LICENSE.md`.
- License metadata was adjusted from a blank copyright owner to a generic contributor copyright.
- README attribution was added because the behavior is based on the public n8n OpenRouter Chat Model integration and adapts the OpenRouter tool-call argument normalization behavior.

## Corrections Made

- Replaced the local install path in `README.md` with a generic placeholder.
- Expanded `package.json` `"files"` to explicitly include only `dist`, `README.md`, and `LICENSE.md`.
- Updated `LICENSE.md` copyright ownership to `n8n-nodes-openrouter-reasoning contributors`.
- Added a concise attribution section to `README.md`.
- Regenerated the npm tarball after corrections.

## Conclusion

OK_PUBLICAR_NPM_PUBLICO
