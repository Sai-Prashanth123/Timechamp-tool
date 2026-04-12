/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` output copies only the minimal files Next.js needs
  // at runtime (including a trimmed node_modules) into
  // .next/standalone/. Lets the Docker runtime image ship ~180 MB
  // instead of ~500 MB with the full node_modules tree.
  // Harmless in local dev — `next dev` ignores this setting.
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
      { protocol: 'https', hostname: '*.backblazeb2.com' },
      { protocol: 'https', hostname: 'cdn.timechamp.io' },
    ],
  },
};

module.exports = nextConfig;
