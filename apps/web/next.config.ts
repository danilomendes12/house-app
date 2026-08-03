import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @finance/shared ships TypeScript source, not a build artifact.
  transpilePackages: ['@finance/shared'],
  typedRoutes: true,
};

export default nextConfig;
