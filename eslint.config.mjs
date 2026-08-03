import next from 'eslint-config-next';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
      'coverage/**',
      'supabase/.temp/**',
    ],
  },
  ...next,
  {
    // The Next.js app lives in a workspace, not at the repo root.
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Maintenance CLIs talk to the operator through stdout.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
