import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LivePageClient } from './live-page-client'

export default async function LivePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user?.role
  if (role !== 'manager' && role !== 'admin') {
    redirect('/overview')
  }

  return <LivePageClient token={(session as any).accessToken ?? ''} />
}
