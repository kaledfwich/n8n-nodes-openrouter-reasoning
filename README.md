# n8n-nodes-openrouter-reasoning

Community node for n8n that adds an **OpenRouter Chat Model (Reasoning)** sub-node for the AI Agent. It behaves like the official OpenRouter Chat Model, but adds `reasoning.effort` support through LangChain `modelKwargs`.

This package does not create a new Agent and does not use `@openrouter/agent`. It keeps the visual n8n AI Agent and replaces only the connected chat model sub-node.

## Attribution

This node is an independent community package. Its behavior is based on the public n8n OpenRouter Chat Model integration and adapts the OpenRouter tool-call argument normalization pattern so AI Agent tool calling keeps working with models that return empty tool arguments.

## Features

- Sub-node output: `AiLanguageModel`
- Compatible with the n8n AI Agent
- Uses the official n8n OpenRouter credential type: `openRouterApi`
- Dynamic OpenRouter model selector
- Preserves JSON mode through `response_format`
- Preserves tool calling behavior, including OpenRouter empty tool argument normalization
- Compatible with Structured Output Parser
- Adds `Reasoning Effort`: Provider Default, None, Low, Medium, High, X High

## Install dependencies

On this Windows machine, use `npm.cmd` because PowerShell may block `npm.ps1`:

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
n8n-nodes-openrouter-reasoning-0.1.0.tgz
```

## Test locally with n8n

### Option 1: n8n self-hosted on the host

Install the generated package in your n8n custom nodes folder or test project:

```powershell
npm.cmd install C:\path\to\n8n-nodes-openrouter-reasoning-0.1.0.tgz
```

Restart n8n after installing.

### Option 2: Docker

Copy the `.tgz` into a folder mounted by your n8n container, then install it inside the container:

```bash
docker cp n8n-nodes-openrouter-reasoning-0.1.0.tgz <n8n-container>:/tmp/
docker exec -it <n8n-container> sh
cd /home/node/.n8n
npm install /tmp/n8n-nodes-openrouter-reasoning-0.1.0.tgz
exit
docker restart <n8n-container>
```

### Option 3: Coolify

1. Add the `.tgz` to a persistent volume or build context available to the n8n container.
2. Run an install command in the n8n data directory:

```bash
cd /home/node/.n8n
npm install /path/to/n8n-nodes-openrouter-reasoning-0.1.0.tgz
```

3. Restart the n8n service in Coolify.

## Example workflow in n8n

1. Add an **AI Agent** node.
2. Connect **OpenRouter Chat Model (Reasoning)** to the AI Agent model input.
3. Select an OpenRouter credential using the existing `OpenRouter` credential type.
4. Select a model that supports tool calling and the reasoning mode you want to use.
5. In **Options**, set:
   - `Reasoning Effort`: `Low`, `Medium`, `High`, or `Provider Default`
   - `Response Format`: `JSON` when using JSON mode
6. Add a **Code Tool** connected to the AI Agent. A simple test tool can return:

```javascript
return [{ result: `received: ${query}` }];
```

7. Add a **Structured Output Parser** and connect it to the AI Agent output parser input.
8. Test a prompt that asks the agent to call the Code Tool and return structured JSON.

When `Reasoning Effort` is `Provider Default`, this node does not send a `reasoning` field. When set to `Low`, it sends:

```json
{
  "reasoning": {
    "effort": "low"
  }
}
```

JSON mode is sent independently:

```json
{
  "response_format": {
    "type": "json_object"
  }
}
```

When both options are enabled, both fields are included in the same `modelKwargs` object.

## Publish to npm later

Do not publish during local testing. When you are ready:

```bash
npm login
npm publish
```

Before publishing, fill in `author`, `repository`, and any package metadata you want to expose publicly.
