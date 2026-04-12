import axios from 'axios';
import { getSession, signOut } from 'next-auth/react';

const api = axios.create({
  baseURL:
    process.env.NEXT_PUBLIC_API_URL ??
    'https://timechamp-api-fgasejh3f0a7gxgk.eastasia-01.azurewebsites.net/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const session = await getSession();
  // If token refresh failed, force sign-out immediately
  if ((session as any)?.error === 'RefreshFailed') {
    await signOut({ callbackUrl: '/login' });
    return config;
  }
  const accessToken = (session as any)?.accessToken as string | undefined;
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await signOut({ callbackUrl: '/login' });
    }
    return Promise.reject(error);
  },
);

export default api;
