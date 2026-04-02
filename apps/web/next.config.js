/** @type {import('next').NextConfig} */
const nextConfig = {
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
