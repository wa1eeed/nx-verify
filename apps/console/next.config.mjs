/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The console reads the database directly through the workspace packages, so they are
  // compiled from source rather than expected to ship a build.
  transpilePackages: ['@nx-verify/core', '@nx-verify/db'],
  eslint: { ignoreDuringBuilds: true },
  /**
   * The addresses screens had before the console was reorganised, first into seven places
   * and then into the handoff's home screen and four places.
   *
   * Temporary rather than permanent, so a browser does not remember them for ever, and
   * kept, because a bookmark, an old notification email and a link in somebody's notes
   * should all still open the right screen.
   */
  async redirects() {
    return [
      // Before the seven places (unit 76).
      { source: '/registry', destination: '/customers', permanent: false },
      { source: '/entities/:id', destination: '/customers/:id', permanent: false },
      { source: '/queue', destination: '/customers/reviews', permanent: false },
      { source: '/onboarding', destination: '/verifications/onboarding', permanent: false },
      { source: '/onboarding/:id', destination: '/verifications/onboarding/:id', permanent: false },
      { source: '/portfolios', destination: '/settings/portfolios', permanent: false },
      { source: '/usage', destination: '/billing', permanent: false },
      { source: '/settings/api-keys', destination: '/settings/developers', permanent: false },
      { source: '/settings/users', destination: '/settings', permanent: false },
      { source: '/developer', destination: '/settings/developers/sandbox', permanent: false },
      { source: '/logs', destination: '/settings/developers/logs', permanent: false },
      { source: '/docs', destination: '/settings/developers/reference', permanent: false },
      { source: '/support', destination: '/settings/support', permanent: false },
      {
        source: '/operator/connections',
        destination: '/operator/verification/integration',
        permanent: false,
      },
      // Before the handoff's places (design phase 2).
      { source: '/customers/new', destination: '/verifications/new', permanent: false },
      { source: '/verifications/reviews', destination: '/customers/reviews', permanent: false },
      { source: '/monitoring', destination: '/customers/alerts', permanent: false },
      { source: '/monitoring/freshness', destination: '/settings/freshness', permanent: false },
      { source: '/notifications', destination: '/customers/alerts', permanent: false },
      { source: '/billing/statement', destination: '/billing/invoices', permanent: false },
      { source: '/developers', destination: '/settings/developers', permanent: false },
      {
        source: '/developers/:path*',
        destination: '/settings/developers/:path*',
        permanent: false,
      },
      { source: '/operator/tenants', destination: '/operator/subscribers', permanent: false },
      {
        source: '/operator/tenants/:id',
        destination: '/operator/subscribers/:id',
        permanent: false,
      },
      { source: '/operator/topups', destination: '/operator/subscribers/topups', permanent: false },
      { source: '/operator/packages', destination: '/operator/pricing', permanent: false },
      { source: '/operator/margin', destination: '/operator/reports', permanent: false },
      {
        source: '/operator/integration',
        destination: '/operator/verification/integration',
        permanent: false,
      },
      {
        source: '/operator/endpoints',
        destination: '/operator/verification/endpoints',
        permanent: false,
      },
      {
        source: '/operator/health',
        destination: '/operator/verification/health',
        permanent: false,
      },
      {
        source: '/operator/readiness',
        destination: '/operator/verification/readiness',
        permanent: false,
      },
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
