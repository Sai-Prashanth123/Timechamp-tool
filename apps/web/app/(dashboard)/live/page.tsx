import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LivePageClient } from './live-page-client'

export default async function LivePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = (session.user as any)?.role
  if (role !== 'MANAGER' && role !== 'ADMIN') {
    redirect('/dashboard')
  }

  return <LivePageClient token={(session as any).accessToken ?? ''} />
}
