import { ChatOpenAI, type ClientOptions } from '@langchain/openai';

import {
	getConnectionHintNoticeField,
	getProxyAgent,
	makeN8nLlmFailedAttemptHandler,
	N8nLlmTracing,
} from '@n8n/ai-utilities';

import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

interface OpenRouterCredential {
	apiKey: string;
	url: string;
}

interface OpenAIToolCall {
	function?: { arguments?: unknown };
}

interface OpenAIChoice {
	message?: { tool_calls?: OpenAIToolCall[] };
}

type ReasoningEffort = 'provider_default' | 'none' | 'low' | 'medium' | 'high' | 'xhigh';

interface OpenRouterOptions {
	frequencyPenalty?: number;
	maxTokens?: number;
	maxRetries?: number;
	timeout?: number;
	presencePenalty?: number;
	reasoningEffort?: ReasoningEffort;
	responseFormat?: 'text' | 'json_object';
	temperature?: number;
	topP?: number;
}

function isOpenAIResponseWithChoices(json: unknown): json is { choices: OpenAIChoice[] } {
	return (
		typeof json === 'object' &&
		json !== null &&
		'choices' in json &&
		Array.isArray((json as { choices: unknown }).choices)
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createOpenRouterFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
	return async (input, init) => {
		const response = await baseFetch(input, init);
		const contentType = response.headers.get('content-type') ?? '';

		if (!contentType.includes('json')) return response;

		const clone = response.clone();
		const json: unknown = await response.json();

		if (!isOpenAIResponseWithChoices(json)) return clone;

		const isInvalidArgs = (args: unknown): boolean => typeof args !== 'string' || !args.trim();
		const toolCallsToFix = json.choices
			.flatMap((choice) => choice.message?.tool_calls ?? [])
			.filter((toolCall) => toolCall.function && isInvalidArgs(toolCall.function.arguments));

		if (toolCallsToFix.length === 0) return clone;

		for (const toolCall of toolCallsToFix) {
			if (!toolCall.function) continue;

			const { arguments: args } = toolCall.function;
			toolCall.function.arguments = isPlainObject(args) ? JSON.stringify(args) : '{}';
		}

		return new Response(JSON.stringify(json), {
			status: response.status,
			statusText: response.statusText,
			headers: { 'content-type': contentType },
		});
	};
}

function buildModelKwargs(options: OpenRouterOptions): Record<string, unknown> | undefined {
	const modelKwargs: Record<string, unknown> = {};

	if (options.responseFormat) {
		modelKwargs.response_format = {
			type: options.responseFormat,
		};
	}

	if (options.reasoningEffort && options.reasoningEffort !== 'provider_default') {
		modelKwargs.reasoning = {
			effort: options.reasoningEffort,
		};
	}

	return Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined;
}

export class LmChatOpenRouterReasoning implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenRouter Chat Model (Reasoning)',
		name: 'lmChatOpenRouterReasoning',
		icon: { light: 'file:openrouter.svg', dark: 'file:openrouter.dark.svg' },
		group: ['transform'],
		version: [1],
		description: 'OpenRouter chat model for AI agents with reasoning effort support',
		subtitle: '={{ $parameter["model"] }}',
		defaults: {
			name: 'OpenRouter Chat Model (Reasoning)',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://openrouter.ai/docs',
					},
				],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'openRouterApi',
				required: true,
			},
		],
		requestDefaults: {
			ignoreHttpStatusErrors: true,
			baseURL: '={{ $credentials?.url }}',
		},
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiChain, NodeConnectionTypes.AiAgent]),
			{
				displayName:
					'If using JSON response format, you must include word "json" in the prompt in your chain or agent. Also, make sure to select a model that supports JSON mode.',
				name: 'notice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						'/options.responseFormat': ['json_object'],
					},
				},
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				description:
					'The model which will generate the completion. <a href="https://openrouter.ai/docs/models">Learn more</a>.',
				typeOptions: {
					loadOptions: {
						routing: {
							request: {
								method: 'GET',
								url: '/models',
							},
							output: {
								postReceive: [
									{
										type: 'rootProperty',
										properties: {
											property: 'data',
										},
									},
									{
										type: 'setKeyValue',
										properties: {
											name: '={{$responseItem.id}}',
											value: '={{$responseItem.id}}',
										},
									},
									{
										type: 'sort',
										properties: {
											key: 'name',
										},
									},
								],
							},
						},
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'model',
					},
				},
				default: 'openai/gpt-4.1-mini',
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Frequency Penalty',
						name: 'frequencyPenalty',
						default: 0,
						typeOptions: { maxValue: 2, minValue: -2, numberPrecision: 1 },
						description:
							"Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim",
						type: 'number',
					},
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						default: -1,
						description: 'The maximum number of tokens to generate in the completion',
						type: 'number',
						typeOptions: {
							maxValue: 32768,
						},
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						default: 'text',
						type: 'options',
						options: [
							{
								name: 'Text',
								value: 'text',
								description: 'Regular text response',
							},
							{
								name: 'JSON',
								value: 'json_object',
								description:
									'Enables JSON mode, which should guarantee the message the model generates is valid JSON',
							},
						],
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						default: 0,
						typeOptions: { maxValue: 2, minValue: -2, numberPrecision: 1 },
						description:
							"Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics",
						type: 'number',
					},
					{
						displayName: 'Reasoning Effort',
						name: 'reasoningEffort',
						default: 'provider_default',
						description:
							'Controls OpenRouter reasoning effort. Provider Default does not send a reasoning field.',
						type: 'options',
						options: [
							{
								name: 'Provider Default',
								value: 'provider_default',
								description: 'Do not send a reasoning field',
							},
							{
								name: 'None',
								value: 'none',
								description: 'Send reasoning effort none',
							},
							{
								name: 'Low',
								value: 'low',
								description: 'Send reasoning effort low',
							},
							{
								name: 'Medium',
								value: 'medium',
								description: 'Send reasoning effort medium',
							},
							{
								name: 'High',
								value: 'high',
								description: 'Send reasoning effort high',
							},
							{
								name: 'X High',
								value: 'xhigh',
								description: 'Send reasoning effort xhigh',
							},
						],
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						default: 0.7,
						typeOptions: { maxValue: 2, minValue: 0, numberPrecision: 1 },
						description:
							'Controls randomness: Lowering results in less random completions. As the temperature approaches zero, the model becomes deterministic and repetitive.',
						type: 'number',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						default: 360000,
						description: 'Maximum amount of time a request is allowed to take in milliseconds',
						type: 'number',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						default: 2,
						description: 'Maximum number of retries to attempt',
						type: 'number',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						default: 1,
						typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
						description:
							'Controls diversity via nucleus sampling: 0.5 means half of all likelihood-weighted options are considered. We generally recommend altering this or temperature but not both.',
						type: 'number',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<OpenRouterCredential>('openRouterApi');
		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as OpenRouterOptions;
		const timeout = options.timeout ?? 360000;
		const { reasoningEffort, responseFormat, ...chatOptions } = options;

		const configuration: ClientOptions = {
			baseURL: credentials.url,
			fetch: createOpenRouterFetch(globalThis.fetch),
			fetchOptions: {
				dispatcher: getProxyAgent(credentials.url, {
					headersTimeout: timeout,
					bodyTimeout: timeout,
				}) as never,
			},
		};

		const model = new ChatOpenAI({
			apiKey: credentials.apiKey,
			model: modelName,
			...chatOptions,
			timeout,
			maxRetries: options.maxRetries ?? 2,
			configuration,
			callbacks: [new N8nLlmTracing(this)],
			modelKwargs: buildModelKwargs({ reasoningEffort, responseFormat }),
			onFailedAttempt: makeN8nLlmFailedAttemptHandler(this),
		});

		return {
			response: model,
		};
	}
}
