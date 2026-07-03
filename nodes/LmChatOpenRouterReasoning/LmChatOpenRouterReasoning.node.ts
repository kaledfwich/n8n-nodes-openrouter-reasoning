import { ChatOpenAI, type ClientOptions } from '@langchain/openai';

import {
	getConnectionHintNoticeField,
	getProxyAgent,
	makeN8nLlmFailedAttemptHandler,
	N8nLlmTracing,
} from '@n8n/ai-utilities';

import {
	NodeConnectionTypes,
	NodeOperationError,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
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

interface OpenRouterModel {
	id?: string;
	name?: string;
	context_length?: number;
	pricing?: {
		prompt?: string;
		completion?: string;
	};
	reasoning?: {
		mandatory?: boolean;
		supported_efforts?: string[];
	};
	supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
	data?: OpenRouterModel[];
}

type ProviderDefault = 'provider_default';
type BooleanOption = ProviderDefault | 'true' | 'false';
type ReasoningEnabled = ProviderDefault | 'enabled' | 'disabled';
type ReasoningEffort =
	| ProviderDefault
	| 'none'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh'
	| 'max';
type ProviderSort = ProviderDefault | 'price' | 'latency' | 'throughput';
type ProviderDataCollection = ProviderDefault | 'allow' | 'deny';

interface OpenRouterOptions {
	extraBodyJson?: string;
	frequencyPenalty?: number;
	maxTokens?: number;
	maxRetries?: number;
	presencePenalty?: number;
	providerAllowFallbacks?: BooleanOption;
	providerDataCollection?: ProviderDataCollection;
	providerRequireParameters?: BooleanOption;
	providerSort?: ProviderSort;
	providerZdr?: BooleanOption;
	reasoningEnabled?: ReasoningEnabled;
	reasoningEffort?: ReasoningEffort;
	reasoningExclude?: BooleanOption;
	reasoningMaxTokens?: number | string;
	responseFormat?: 'text' | 'json_object';
	temperature?: number;
	timeout?: number;
	topP?: number;
	validateModelCapabilities?: boolean;
}

type ChatOpenRouterOptions = Omit<
	OpenRouterOptions,
	| 'extraBodyJson'
	| 'providerAllowFallbacks'
	| 'providerDataCollection'
	| 'providerRequireParameters'
	| 'providerSort'
	| 'providerZdr'
	| 'reasoningEnabled'
	| 'reasoningEffort'
	| 'reasoningExclude'
	| 'reasoningMaxTokens'
	| 'responseFormat'
	| 'validateModelCapabilities'
>;

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

function parseBooleanOption(value: BooleanOption | undefined): boolean | undefined {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return undefined;
}

function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];

		if (isPlainObject(current) && isPlainObject(value)) {
			target[key] = deepMerge({ ...current }, value);
			continue;
		}

		target[key] = value;
	}

	return target;
}

function parseExtraBodyJson(
	node: ISupplyDataFunctions,
	extraBodyJson: string | undefined,
): Record<string, unknown> {
	if (!extraBodyJson?.trim()) return {};

	let parsed: unknown;

	try {
		parsed = JSON.parse(extraBodyJson);
	} catch (error) {
		throw new NodeOperationError(
			node.getNode(),
			'Extra OpenRouter Body JSON must be a valid JSON object.',
			{ description: error instanceof Error ? error.message : undefined },
		);
	}

	if (!isPlainObject(parsed)) {
		throw new NodeOperationError(
			node.getNode(),
			'Extra OpenRouter Body JSON must be a valid JSON object.',
			{ description: 'Top-level JSON value is not an object.' },
		);
	}

	return parsed;
}

function buildReasoningOptions(
	node: ISupplyDataFunctions,
	options: OpenRouterOptions,
): Record<string, unknown> {
	const reasoning: Record<string, unknown> = {};

	if (options.reasoningEnabled === 'enabled') {
		reasoning.enabled = true;
	} else if (options.reasoningEnabled === 'disabled') {
		reasoning.effort = 'none';
	}

	if (options.reasoningEffort && options.reasoningEffort !== 'provider_default') {
		reasoning.effort = options.reasoningEffort;
	}

	if (options.reasoningExclude) {
		const exclude = parseBooleanOption(options.reasoningExclude);
		if (exclude !== undefined) reasoning.exclude = exclude;
	}

	const maxTokens = options.reasoningMaxTokens;
	if (maxTokens !== undefined && maxTokens !== null && maxTokens !== '') {
		const numericMaxTokens = typeof maxTokens === 'string' ? Number(maxTokens) : maxTokens;

		if (!Number.isFinite(numericMaxTokens) || numericMaxTokens <= 0) {
			throw new NodeOperationError(
				node.getNode(),
				'Reasoning Max Tokens must be a positive number when provided.',
			);
		}

		reasoning.max_tokens = numericMaxTokens;
	}

	return reasoning;
}

function buildProviderOptions(options: OpenRouterOptions): Record<string, unknown> {
	const provider: Record<string, unknown> = {};

	if (options.providerSort && options.providerSort !== 'provider_default') {
		provider.sort = options.providerSort;
	}

	const allowFallbacks = parseBooleanOption(options.providerAllowFallbacks);
	if (allowFallbacks !== undefined) provider.allow_fallbacks = allowFallbacks;

	const requireParameters = parseBooleanOption(options.providerRequireParameters);
	if (requireParameters !== undefined) provider.require_parameters = requireParameters;

	if (options.providerDataCollection && options.providerDataCollection !== 'provider_default') {
		provider.data_collection = options.providerDataCollection;
	}

	const zdr = parseBooleanOption(options.providerZdr);
	if (zdr !== undefined) provider.zdr = zdr;

	return provider;
}

function buildModelKwargs(
	node: ISupplyDataFunctions,
	options: OpenRouterOptions,
): Record<string, unknown> | undefined {
	const modelKwargs = parseExtraBodyJson(node, options.extraBodyJson);

	if (options.responseFormat) {
		deepMerge(modelKwargs, {
			response_format: {
				type: options.responseFormat,
			},
		});
	}

	const reasoning = buildReasoningOptions(node, options);
	if (Object.keys(reasoning).length > 0) {
		deepMerge(modelKwargs, { reasoning });
	}

	const provider = buildProviderOptions(options);
	if (Object.keys(provider).length > 0) {
		deepMerge(modelKwargs, { provider });
	}

	return Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined;
}

function getChatOptions(options: OpenRouterOptions): ChatOpenRouterOptions {
	const {
		extraBodyJson,
		providerAllowFallbacks,
		providerDataCollection,
		providerRequireParameters,
		providerSort,
		providerZdr,
		reasoningEnabled,
		reasoningEffort,
		reasoningExclude,
		reasoningMaxTokens,
		responseFormat,
		validateModelCapabilities,
		...chatOptions
	} = options;

	void extraBodyJson;
	void providerAllowFallbacks;
	void providerDataCollection;
	void providerRequireParameters;
	void providerSort;
	void providerZdr;
	void reasoningEnabled;
	void reasoningEffort;
	void reasoningExclude;
	void reasoningMaxTokens;
	void responseFormat;
	void validateModelCapabilities;

	return chatOptions;
}

function formatPrice(price: string | undefined): string | undefined {
	if (!price) return undefined;

	const numericPrice = Number(price);
	if (!Number.isFinite(numericPrice)) return undefined;

	return `$${numericPrice.toExponential(2)}`;
}

function formatContextLength(contextLength: number | undefined): string | undefined {
	if (!contextLength) return undefined;
	if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k`;
	return String(contextLength);
}

function getReasoningDescription(model: OpenRouterModel): string | undefined {
	const efforts = model.reasoning?.supported_efforts;
	if (efforts?.length) return `reasoning: ${efforts.join('/')}`;
	if (model.supported_parameters?.includes('reasoning')) return 'reasoning';
	return undefined;
}

function formatModelOption(model: OpenRouterModel): INodePropertyOptions | undefined {
	if (!model.id) return undefined;

	const labelParts = [model.id];
	const context = formatContextLength(model.context_length);
	if (context) labelParts.push(`ctx ${context}`);

	const reasoning = getReasoningDescription(model);
	if (reasoning) labelParts.push(reasoning);

	const priceIn = formatPrice(model.pricing?.prompt);
	const priceOut = formatPrice(model.pricing?.completion);
	const descriptionParts = [
		model.name,
		priceIn && priceOut ? `price in/out: ${priceIn}/${priceOut}` : undefined,
		model.supported_parameters?.length
			? `supported: ${model.supported_parameters.join(', ')}`
			: undefined,
	].filter(Boolean);

	return {
		name: labelParts.join(' - '),
		value: model.id,
		description: descriptionParts.join(' | ') || undefined,
	};
}

async function fetchOpenRouterModels(credentials: OpenRouterCredential): Promise<OpenRouterModel[]> {
	const baseUrl = credentials.url.replace(/\/$/, '');
	const response = await globalThis.fetch(`${baseUrl}/models`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${credentials.apiKey}`,
			Accept: 'application/json',
		},
	});

	if (!response.ok) return [];

	const json = (await response.json()) as OpenRouterModelsResponse;
	return Array.isArray(json.data) ? json.data : [];
}

async function validateModelCapabilities(
	node: ISupplyDataFunctions,
	credentials: OpenRouterCredential,
	modelName: string,
	options: OpenRouterOptions,
): Promise<void> {
	if (!options.validateModelCapabilities) return;

	const models = await fetchOpenRouterModels(credentials);
	const model = models.find((candidate) => candidate.id === modelName);
	if (!model?.reasoning) return;

	const selectedEffort =
		options.reasoningEffort && options.reasoningEffort !== 'provider_default'
			? options.reasoningEffort
			: options.reasoningEnabled === 'disabled'
				? 'none'
				: undefined;

	if (model.reasoning.mandatory && selectedEffort === 'none') {
		throw new NodeOperationError(
			node.getNode(),
			'The selected model declares reasoning as mandatory. Choose a supported reasoning effort or disable Validate Model Capabilities.',
		);
	}

	const supportedEfforts = model.reasoning.supported_efforts;
	if (!selectedEffort || !supportedEfforts?.length) return;

	if (!supportedEfforts.includes(selectedEffort)) {
		throw new NodeOperationError(
			node.getNode(),
			`The selected model does not list support for reasoning effort "${selectedEffort}". Choose a supported effort or disable Validate Model Capabilities.`,
		);
	}
}

const booleanProviderOptions: INodePropertyOptions[] = [
	{
		name: 'Provider Default',
		value: 'provider_default',
		description: 'Do not send this field',
	},
	{
		name: 'True',
		value: 'true',
		description: 'Send true',
	},
	{
		name: 'False',
		value: 'false',
		description: 'Send false',
	},
];

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
				displayName: 'Model Name or ID',
				name: 'model',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getModels',
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
						displayName: 'Allow Fallbacks',
						name: 'providerAllowFallbacks',
						default: 'provider_default',
						description: 'Controls OpenRouter provider.allow_fallbacks',
						type: 'options',
						options: booleanProviderOptions,
					},
					{
						displayName: 'Data Collection',
						name: 'providerDataCollection',
						default: 'provider_default',
						description: 'Controls OpenRouter provider.data_collection',
						type: 'options',
						options: [
							{
								name: 'Provider Default',
								value: 'provider_default',
								description: 'Do not send provider.data_collection',
							},
							{
								name: 'Allow',
								value: 'allow',
								description: 'Allow provider data collection',
							},
							{
								name: 'Deny',
								value: 'deny',
								description: 'Deny provider data collection',
							},
						],
					},
					{
						displayName: 'Exclude Reasoning From Response',
						name: 'reasoningExclude',
						default: 'provider_default',
						description: 'Controls OpenRouter reasoning.exclude',
						type: 'options',
						options: booleanProviderOptions,
					},
					{
						displayName: 'Extra OpenRouter Body JSON',
						name: 'extraBodyJson',
						default: '',
						description:
							'Additional raw OpenRouter request body parameters. Must be a JSON object. Explicit UI fields override conflicting values.',
						type: 'json',
						typeOptions: {
							rows: 5,
						},
					},
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
						displayName: 'Max Retries',
						name: 'maxRetries',
						default: 2,
						description: 'Maximum number of retries to attempt',
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
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						default: 0,
						typeOptions: { maxValue: 2, minValue: -2, numberPrecision: 1 },
						description:
							"Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics",
						type: 'number',
					},
					{
						displayName: 'Provider Sort',
						name: 'providerSort',
						default: 'provider_default',
						description: 'Controls OpenRouter provider.sort',
						type: 'options',
						options: [
							{
								name: 'Provider Default',
								value: 'provider_default',
								description: 'Do not send provider.sort',
							},
							{
								name: 'Price',
								value: 'price',
								description: 'Sort providers by price',
							},
							{
								name: 'Latency',
								value: 'latency',
								description: 'Sort providers by latency',
							},
							{
								name: 'Throughput',
								value: 'throughput',
								description: 'Sort providers by throughput',
							},
						],
					},
					{
						displayName: 'Reasoning Effort',
						name: 'reasoningEffort',
						default: 'provider_default',
						description:
							'Controls OpenRouter reasoning.effort. Provider Default does not send the field.',
						type: 'options',
						options: [
							{
								name: 'Provider Default',
								value: 'provider_default',
								description: 'Do not send reasoning.effort',
							},
							{
								name: 'None',
								value: 'none',
								description: 'Send reasoning effort none',
							},
							{
								name: 'Minimal',
								value: 'minimal',
								description: 'Send reasoning effort minimal',
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
							{
								name: 'Max',
								value: 'max',
								description: 'Send reasoning effort max',
							},
						],
					},
					{
						displayName: 'Reasoning Enabled',
						name: 'reasoningEnabled',
						default: 'provider_default',
						description:
							'Controls OpenRouter reasoning. Disabled sends reasoning.effort = "none" for compatibility.',
						type: 'options',
						options: [
							{
								name: 'Provider Default',
								value: 'provider_default',
								description: 'Do not send reasoning.enabled',
							},
							{
								name: 'Enabled',
								value: 'enabled',
								description: 'Send reasoning.enabled = true',
							},
							{
								name: 'Disabled',
								value: 'disabled',
								description: 'Send reasoning.effort = "none"',
							},
						],
					},
					{
						displayName: 'Reasoning Max Tokens',
						name: 'reasoningMaxTokens',
						default: '',
						description:
							'Optional max tokens budget for reasoning, for compatible models only. Leave empty to omit reasoning.max_tokens.',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
					},
					{
						displayName: 'Require Parameters',
						name: 'providerRequireParameters',
						default: 'provider_default',
						description: 'Controls OpenRouter provider.require_parameters',
						type: 'options',
						options: booleanProviderOptions,
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
						displayName: 'Top P',
						name: 'topP',
						default: 1,
						typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
						description:
							'Controls diversity via nucleus sampling: 0.5 means half of all likelihood-weighted options are considered. We generally recommend altering this or temperature but not both.',
						type: 'number',
					},
					{
						displayName: 'Validate Model Capabilities',
						name: 'validateModelCapabilities',
						default: false,
						description:
							'Whether to validate selected reasoning options against OpenRouter model metadata when available',
						type: 'boolean',
					},
					{
						displayName: 'ZDR Only',
						name: 'providerZdr',
						default: 'provider_default',
						description: 'Controls OpenRouter provider.zdr',
						type: 'options',
						options: booleanProviderOptions,
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials<OpenRouterCredential>('openRouterApi');
				const models = await fetchOpenRouterModels(credentials);
				const options = models
					.map(formatModelOption)
					.filter((option): option is INodePropertyOptions => option !== undefined);

				return options.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<OpenRouterCredential>('openRouterApi');
		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as OpenRouterOptions;
		const timeout = options.timeout ?? 360000;
		const chatOptions = getChatOptions(options);

		await validateModelCapabilities(this, credentials, modelName, options);

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
			modelKwargs: buildModelKwargs(this, options),
			onFailedAttempt: makeN8nLlmFailedAttemptHandler(this),
		});

		return {
			response: model,
		};
	}
}
