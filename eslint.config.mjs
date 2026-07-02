import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['package.json'],
		rules: {
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
		},
	},
	{
		files: ['nodes/**/*.ts'],
		rules: {
			'@n8n/community-nodes/no-credential-reuse': 'off',
			'n8n-nodes-base/node-param-collection-type-unsorted-items': 'off',
			'n8n-nodes-base/node-param-options-type-unsorted-items': 'off',
		},
	},
];
