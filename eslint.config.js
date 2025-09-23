const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const jsoncPlugin = require('eslint-plugin-jsonc');
const prettierConfig = require('eslint-config-prettier');
const path = require('path');
const fs = require('fs');

// Detect workspace context and determine appropriate tsconfig
function getTsConfigPath() {
  const cwd = process.cwd();

  // Check if we're in shared workspace (has tsconfig.eslint.json)
  const eslintTsConfig = path.join(cwd, 'tsconfig.eslint.json');
  if (fs.existsSync(eslintTsConfig)) {
    return './tsconfig.eslint.json';
  }

  // Default to standard tsconfig
  return './tsconfig.json';
}

module.exports = [
  js.configs.recommended,
  ...jsoncPlugin.configs['flat/recommended-with-jsonc'],
  {
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: getTsConfigPath(),
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: getTsConfigPath(),
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
  prettierConfig,
  {
    ignores: [
      'dist/',
      'node_modules/',
      // Ignore compiled JavaScript files (only lint .ts source files)
      'index.js',
      'index.test.js',
    ],
  },
];
