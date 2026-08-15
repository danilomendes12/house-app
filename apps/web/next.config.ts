import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @finance/shared ships TypeScript source, not a build artifact.
  transpilePackages: ['@finance/shared'],
  typedRoutes: true,
  // Self-contained server bundle for the Docker image (Fase 9). The tracing root is the
  // monorepo root, not apps/web: without it the standalone output would miss the pnpm
  // workspace links and @finance/shared would not resolve at runtime.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
