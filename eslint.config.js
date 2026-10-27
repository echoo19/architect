import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // The mentor side of the engine and every adapter must never reach the test split.
    files: ['packages/adapters/**/*.ts', 'packages/engine/src/mentor/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/vault', '**/vault/**'], message: 'Only the runner may use the vault.' },
          ],
        },
      ],
    },
  },
  {
    // Workspace sessions run graduates offline: no mentor code in the agent host.
    files: ['packages/engine/src/agent-host/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mentor', '**/mentor/**'],
              message: 'The agent host never loads mentor code.',
            },
            { group: ['**/vault', '**/vault/**'], message: 'Only the runner may use the vault.' },
          ],
        },
      ],
    },
  },
);
