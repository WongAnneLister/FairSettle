/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/graphql',
        destination: process.env.BACKEND_GRAPHQL_URL || 'http://localhost:4000/graphql',
      },
      {
        source: '/api/uploads',
        destination: process.env.BACKEND_UPLOADS_URL || 'http://localhost:4000/uploads',
      },
    ];
  },
};

export default nextConfig;
