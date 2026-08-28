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
        // Ignored over plain http, so it is safe for LAN testing and correct
        // in production behind TLS.
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        {
          // Next injects inline bootstrap scripts and Tailwind emits inline
          // styles, so 'unsafe-inline' is required without a nonce-issuing
          // middleware. The value of this policy is elsewhere: no external
          // script origin, no framing, no plugins, and forms/XHR restricted
          // to our own origin — which is what an injected payload needs.
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "object-src 'none'",
          ].join('; '),
        },
      ],
    },
  ],
};

export default nextConfig;
