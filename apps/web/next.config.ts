import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @finance/shared ships TypeScript source, not a build artifact.
  transpilePackages: ['@finance/shared'],
  typedRoutes: true,
  // The app is served under momolados.com.br/financial (SPEC §12), and this is the line that
  // makes it work. It is **build-time**: Next inlines the prefix into the client bundles, so
  // it is baked into the image the CI builds — the one piece of this project's configuration
  // that is not read at runtime. Everything Next emits gets the prefix by itself (next/link,
  // redirect(), /_next/*); absolute URLs written by hand do not, and the list of those is in
  // docs/DEPLOY.md §1.3.
  basePath: '/financial',
  // Self-contained server bundle for the Docker image (Fase 9). The tracing root is the
  // monorepo root, not apps/web: without it the standalone output would miss the pnpm
  // workspace links and @finance/shared would not resolve at runtime.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
