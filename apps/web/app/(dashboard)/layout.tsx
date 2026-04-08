import { Sidebar } from '@/components/dashboard/sidebar';
import { EmailVerificationBanner } from '@/components/dashboard/email-verification-banner';
import { LayoutClient } from './layout-client';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <EmailVerificationBanner />
        <LayoutClient>{children}</LayoutClient>
      </main>
    </div>
  );
}
