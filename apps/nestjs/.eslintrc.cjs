module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true,
    es2021: true,
  },
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/'],
  reportUnusedDisableDirectives: true,
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-expect-error': 'allow-with-description' },
    ],
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.property.name='query']",
        message:
          'Raw SQL execution via .query() is strictly prohibited. Use TypeORM Repository methods (find, findOne, save, update) or SelectQueryBuilder with parameter binding (:param). If raw SQL is mandatory (e.g. DDL / REFRESH MATERIALIZED VIEW), you must add an explicit eslint-disable comment with rationale.',
      },
    ],
  },
};
