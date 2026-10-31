export default [{
  files: ['packages/**/*.mjs','desktop/**/*.cjs','scripts/**/*.mjs','tests/**/*.mjs'],
  languageOptions: { ecmaVersion: 'latest' },
  rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-constant-condition': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'constructor-super': 'error', 'valid-typeof': 'error' }
}];
