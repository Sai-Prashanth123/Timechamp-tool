export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/overview/:path*',
    '/monitoring/:path*',
    '/live/:path*',
    '/time-tracking/:path*',
    '/analytics/:path*',
    '/projects/:path*',
    '/gps/:path*',
    '/alerts/:path*',
    '/integrations/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/onboarding/:path*',
  ],
};
