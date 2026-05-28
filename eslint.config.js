import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `.claude/worktrees/*` holds copies of the repo from past Claude
  // sub-agent runs — without this ignore, every warning is multiplied
  // by N. `**/dist` and `coverage` are generated build/test output (the
  // worker dist + coverage report are gitignored). `e2e/` is the
  // Playwright suite with its own ESLint surface.
  { ignores: ['**/dist/**', 'coverage/**', '.claude/**', 'sdks/*/node_modules/**', 'e2e/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
