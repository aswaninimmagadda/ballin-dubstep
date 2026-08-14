/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@gymflow/config',
    '@gymflow/core',
    '@gymflow/database',
    '@gymflow/i18n',
    '@gymflow/types',
    '@gymflow/utils',
    '@gymflow/validation',
  ],
  // pg must stay a Node external (native connection handling)
  serverExternalPackages: ['pg'],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
      ],
    },
  ],
};

export default nextConfig;
