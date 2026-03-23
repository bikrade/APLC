import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import playwright from 'eslint-plugin-playwright'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['node_modules', 'playwright-report', 'test-results']),
  {
    files: ['playwright.config.ts', 'tests/e2e/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      playwright.configs['flat/recommended'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'playwright/no-skipped-test': 'warn',
    },
  },
])