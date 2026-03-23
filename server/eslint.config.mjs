import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vitest from '@vitest/eslint-plugin'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'test/*.js', 'test/*.d.ts', 'vitest.config.js']),
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['test/**/*.ts', 'vitest.config.ts'],
    extends: [vitest.configs.recommended],
    languageOptions: {
      globals: {
        ...vitest.environments.env.globals,
      },
    },
    rules: {
      'vitest/no-disabled-tests': 'error',
    },
  },
])