/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The console reads the database directly through the workspace packages, so they are
  // compiled from source rather than expected to ship a build.
  transpilePackages: ['@nx-verify/core', '@nx-verify/db'],
  eslint: { ignoreDuringBuilds: true },
  /**
   * The addresses screens had before the console was reorganised into seven places.
   *
   * Temporary rather than permanent, so a browser does not remember them for ever, and
   * kept, because a bookmark, an old notification email and a link in somebody's notes
   * should all still open the right screen.
   */
  async redirects() {
    return [
      { source: '/registry', destination: '/customers', permanent: false },
      { source: '/entities/:id', destination: '/customers/:id', permanent: false },
      { source: '/queue', destination: '/verifications/reviews', permanent: false },
      { source: '/onboarding', destination: '/verifications/onboarding', permanent: false },
      { source: '/onboarding/:id', destination: '/verifications/onboarding/:id', permanent: false },
      { source: '/portfolios', destination: '/settings/portfolios', permanent: false },
      { source: '/usage', destination: '/billing', permanent: false },
      { source: '/settings/api-keys', destination: '/developers', permanent: false },
      { source: '/settings/users', destination: '/settings', permanent: false },
      { source: '/settings/freshness', destination: '/monitoring/freshness', permanent: false },
      { source: '/developer', destination: '/developers/sandbox', permanent: false },
      { source: '/logs', destination: '/developers/logs', permanent: false },
      { source: '/docs', destination: '/developers/reference', permanent: false },
      { source: '/support', destination: '/settings/support', permanent: false },
      { source: '/operator/connections', destination: '/operator/integration', permanent: false },
      { source: '/', destination: '/dashboard', permanent: false },
    ];
  },
  webpack: (config) => {
    // Those packages target Node and therefore import with explicit .js specifiers, which
    // is correct for NodeNext and meaningless to a bundler. This maps a .js specifier back
    // onto the TypeScript source it refers to, so the packages keep one correct import
    // style instead of one per consumer.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
