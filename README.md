# n8n-nodes-openrouter-reasoning

Community node for n8n that adds an **OpenRouter Chat Model (Reasoning)** sub-node for the AI Agent. It behaves like the official OpenRouter Chat Model, but adds OpenRouter-specific `reasoning`, provider routing, and extra request body support through LangChain `modelKwargs`.

This package does not create a new Agent and does not use `@openrouter/agent`. It keeps the visual n8n AI Agent and replaces only the connected chat model sub-node.

## Attribution

This node is an independent community package. Its behavior is based on the public n8n OpenRouter Chat Model integration and adapts the OpenRouter tool-call argument normalization pattern so AI Agent tool calling keeps working with models that return empty tool arguments.

## Features

- Sub-node output: `AiLanguageModel`
- Compatible with the n8n AI Agent
- Uses the official n8n OpenRouter credential type: `openRouterApi`
- Dynamic OpenRouter model selector with richer labels when metadata is available
- Preserves JSON mode through `response_format`
- Preserves tool calling behavior, including OpenRouter empty tool argument normalization
- Compatible with Structured Output Parser
- Supports OpenRouter provider routing
- Supports OpenRouter reasoning options
- Supports advanced `Extra OpenRouter Body JSON`
- Optional runtime validation of model reasoning capabilities

## Options

`provider_default` means the node does not send that parameter to OpenRouter. OpenRouter, the selected model, or the selected provider decides the default behavior.

| Option | Internal name | Sent to OpenRouter |
| --- | --- | --- |
| Provider Sort | `providerSort` | `provider.sort` |
| Allow Fallbacks | `providerAllowFallbacks` | `provider.allow_fallbacks` |
| Require Parameters | `providerRequireParameters` | `provider.require_parameters` |
| Data Collection | `providerDataCollection` | `provider.data_collection` |
| ZDR Only | `providerZdr` | `provider.zdr` |
| Reasoning Enabled | `reasoningEnabled` | `reasoning.enabled = true`; disabled sends `reasoning.effort = "none"` |
| Reasoning Effort | `reasoningEffort` | `reasoning.effort` |
| Reasoning Max Tokens | `reasoningMaxTokens` | `reasoning.max_tokens` |
| Exclude Reasoning From Response | `reasoningExclude` | `reasoning.exclude` |
| Extra OpenRouter Body JSON | `extraBodyJson` | Raw top-level OpenRouter request body fields |
| Validate Model Capabilities | `validateModelCapabilities` | Local validation before model creation |

`Reasoning Enabled = Disabled` is implemented as `reasoning.effort = "none"` for compatibility. OpenRouter documents `enabled: true`, but `enabled: false` is not treated here as the portable way to disable reasoning.

`Extra OpenRouter Body JSON` must be a valid JSON object. Arrays, strings, numbers, and invalid JSON throw:

```text
Extra OpenRouter Body JSON must be a valid JSON object.
```

Explicit UI fields override conflicting values from `Extra OpenRouter Body JSON`.

## Examples

### Low reasoning for a support assistant

```json
{
  "reasoning": {
    "effort": "low",
    "exclude": true
  },
  "provider": {
    "sort": "latency",
    "require_parameters": true,
    "allow_fallbacks": true
  }
}
```

Configure this in the UI with:

- `Reasoning Effort`: `Low`
- `Exclude Reasoning From Response`: `True`
- `Provider Sort`: `Latency`
- `Require Parameters`: `True`
- `Allow Fallbacks`: `True`

### Extra OpenRouter Body JSON

```json
{
  "session_id": "support-session-123",
  "provider": {
    "sort": "price"
  }
}
```

If the UI also sets `Provider Sort = Latency`, the final request body uses:

```json
{
  "session_id": "support-session-123",
  "provider": {
    "sort": "latency"
  }
}
```

### JSON mode with reasoning

JSON mode is sent independently from reasoning:

```json
{
  "response_format": {
    "type": "json_object"
  },
  "reasoning": {
    "effort": "low"
  }
}
```

## Model capabilities

The model selector keeps the OpenRouter model `id` as the option value. When metadata is available, labels/descriptions include context length, pricing, reasoning support, and supported parameters. OpenRouter prices are returned as USD per token and displayed as USD per 1M tokens, for example `$0.25/M input · $1.50/M output`.

`Reasoning Effort` is kept as a static dropdown for compatibility with n8n community nodes. Dynamic effort filtering by selected model is not implemented because load options cannot be relied on to safely reshape nested collection options across all supported n8n versions. Use `Validate Model Capabilities` for optional runtime checks.

When `Validate Model Capabilities` is enabled:

- If the selected model declares `reasoning.supported_efforts`, the selected effort must be listed.
- If the selected model declares `reasoning.mandatory = true`, `none`/disabled reasoning is blocked.
- If the selected model does not provide reasoning metadata, execution is not blocked.

## Install dependencies

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`:

```powershell
npm.cmd install
```

On Linux/macOS:

```bash
npm install
```

## Build

```powershell
npm.cmd run build
```

## Generate a local test package

```powershell
npm.cmd pack
```

This generates a local `.tgz` file, for example:

```text
n8n-nodes-openrouter-reasoning-0.2.0.tgz
```

## Test locally with n8n

### Option 1: n8n self-hosted on the host

Install the generated package in your n8n custom nodes folder or test project:

```powershell
npm.cmd install C:\path\to\n8n-nodes-openrouter-reasoning-0.2.0.tgz
```

Restart n8n after installing.

### Option 2: Docker

Copy the `.tgz` into a folder mounted by your n8n container, then install it inside the container:

```bash
docker cp n8n-nodes-openrouter-reasoning-0.2.0.tgz <n8n-container>:/tmp/
docker exec -it <n8n-container> sh
cd /home/node/.n8n
npm install /tmp/n8n-nodes-openrouter-reasoning-0.2.0.tgz
exit
docker restart <n8n-container>
```

### Option 3: Coolify

1. Add the `.tgz` to a persistent volume or build context available to the n8n container.
2. Run an install command in the n8n data directory:

```bash
cd /home/node/.n8n
npm install /path/to/n8n-nodes-openrouter-reasoning-0.2.0.tgz
```

3. Restart the n8n service in Coolify.

## Example workflow in n8n

1. Add an **AI Agent** node.
2. Connect **OpenRouter Chat Model (Reasoning)** to the AI Agent model input.
3. Select an OpenRouter credential using the existing `OpenRouter` credential type.
4. Select a model that supports tool calling and the reasoning mode you want to use.
5. Configure reasoning, provider routing, JSON mode, or extra body options as needed.
6. Add a **Code Tool** connected to the AI Agent. A simple test tool can return:

```javascript
return [{ result: `received: ${query}` }];
```

7. Add a **Structured Output Parser** and connect it to the AI Agent output parser input.
8. Test a prompt that asks the agent to call the Code Tool and return structured JSON.

## Publish to npm later

Do not publish during local testing. When you are ready, use the n8n release flow:

```bash
npm run release -- --publish
```
