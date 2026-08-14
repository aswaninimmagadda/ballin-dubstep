import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      '**/coverage/**',
      'apps/admin/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Server actions and RN styles legitimately use empty destructuring/args.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // pg query results are dynamically shaped; services cast at the edges.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
