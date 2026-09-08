/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The console reads the database directly through the workspace packages, so they are
  // compiled from source rather than expected to ship a build.
  transpilePackages: ['@nx-verify/core', '@nx-verify/db'],
  eslint: { ignoreDuringBuilds: true },
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
