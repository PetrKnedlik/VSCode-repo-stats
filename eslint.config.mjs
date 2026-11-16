import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';

export default tseslint.config(
  { ignores: ['out', 'dist', '**/*.d.ts', 'node_modules', 'webview-ui/dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // explicit version: 'detect' calls context.getFilename, removed in ESLint 10
    settings: { react: { version: '18.3' } },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: ['warn', 'always'],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CatchClause ReturnStatement[argument.type='ArrayExpression'][argument.elements.length=0]",
          message: 'Do not silently return [] from catch blocks. Log, surface, or rethrow explicitly.',
        },
        {
          selector: "CatchClause ReturnStatement[argument.type='Literal'][argument.value=null]",
          message: 'Do not silently return null from catch blocks. Log, surface, or rethrow explicitly.',
        },
        {
          selector: "CatchClause ReturnStatement[argument.type='ObjectExpression'][argument.properties.length=0]",
          message: 'Do not silently return {} from catch blocks. Log, surface, or rethrow explicitly.',
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'react/no-multi-comp': ['error', { ignoreStateless: false }],
    },
  },
);
