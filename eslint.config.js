import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/.turbo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // Rule 4 and rule 10: identifiers and credentials must never reach a log sink.
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Migration runner and operational scripts report progress on stdout by design.
    files: ['packages/db/scripts/**/*.ts', 'scripts/**/*.ts', 'test/global-setup.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
