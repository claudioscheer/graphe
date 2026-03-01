module.exports = [
  {
    ignores: ['node_modules/**', 'out/**', 'src/renderer/dist.css'],
  },
  {
    files: ['src/main/**/*.js', 'src/preload.js', 'forge.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
    },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['src/renderer/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
    },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Renderer files intentionally export globals via top-level consts loaded by <script>.
      'no-unused-vars': 'off',
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
    },
  },
];
