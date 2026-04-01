export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/overview/:path*',
    '/employees/:path*',
    '/time-tracking/:path*',
    '/projects/:path*',
    '/gps/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/alerts/:path*',
    '/integrations/:path*',
  ],
};
