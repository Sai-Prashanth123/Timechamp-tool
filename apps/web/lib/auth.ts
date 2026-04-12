import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import axios from 'axios';

const API_URL =
  process.env.API_URL ??
  'https://timechamp-api-fgasejh3f0a7gxgk.eastasia-01.azurewebsites.net/api/v1';

async function refreshAccessToken(refreshToken: string) {
  try {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefreshToken } = data.data;
    return { accessToken, refreshToken: newRefreshToken ?? refreshToken, error: null };
  } catch {
    return { accessToken: null, refreshToken, error: 'RefreshFailed' };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        try {
          const { data } = await axios.post(`${API_URL}/auth/login`, {
            email: credentials.email,
            password: credentials.password,
          });

          const { user, accessToken, refreshToken } = data.data;

          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`.trim(),
            role: user.role,
            organizationId: user.organizationId,
            accessToken,
            refreshToken,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Initial sign-in — store tokens from API response
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.role = (user as any).role;
        token.organizationId = (user as any).organizationId;
        // Decode expiry from the JWT (exp is in seconds)
        try {
          const payload = JSON.parse(Buffer.from((token.accessToken as string).split('.')[1], 'base64').toString());
          token.accessTokenExpires = payload.exp * 1000;
        } catch {
          token.accessTokenExpires = Date.now() + 7 * 24 * 60 * 60 * 1000;
        }
        return token;
      }

      // Return token as-is if not expired yet (5-minute buffer)
      if (Date.now() < ((token.accessTokenExpires as number) ?? 0) - 5 * 60 * 1000) {
        return token;
      }

      // Token expired — refresh
      const refreshed = await refreshAccessToken(token.refreshToken as string);
      if (refreshed.error) {
        return { ...token, error: 'RefreshFailed' };
      }
      try {
        const payload = JSON.parse(Buffer.from(refreshed.accessToken!.split('.')[1], 'base64').toString());
        token.accessTokenExpires = payload.exp * 1000;
      } catch {
        token.accessTokenExpires = Date.now() + 7 * 24 * 60 * 60 * 1000;
      }
      return { ...token, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken };
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).error = token.error;
      session.user.id = token.sub as string;
      session.user.role = token.role as 'admin' | 'manager' | 'employee';
      session.user.organizationId = token.organizationId as string;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
};
