'use client';

import { useState } from 'react';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAgentDevices, useGenerateInviteToken } from '@/hooks/use-agent';
import { Copy, Check, Download } from 'lucide-react';

const PLATFORMS = [
  { label: 'Windows (x64)',  suffix: 'windows-amd64.exe' },
  { label: 'macOS (Apple Silicon)', suffix: 'darwin-arm64' },
  { label: 'macOS (Intel)', suffix: 'darwin-amd64' },
  { label: 'Linux (x64)',   suffix: 'linux-amd64' },
  { label: 'Linux (ARM64)', suffix: 'linux-arm64' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-2 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function statusBadge(isActive: boolean, lastSeenAt: string | null) {
  if (!lastSeenAt) return <span className="text-slate-500 text-xs">Never seen</span>;
  const diffMin = (Date.now() - new Date(lastSeenAt).getTime()) / 60000;
  if (diffMin < 5) {
    return <span className="inline-flex items-center gap-1 text-xs text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Online</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" />Offline</span>;
}

export default function AgentSetupPage() {
  const { data: devices, isLoading: devicesLoading } = useAgentDevices();
  const { mutate: generateToken, isPending, data: tokenData } = useGenerateInviteToken();

  const releaseBase = 'https://github.com/timechamp/agent/releases/latest/download';

  return (
    <>
      <Header title="Agent Setup" />
      <div className="p-6 max-w-3xl space-y-6">

        {/* Invite Token */}
        <Card>
          <CardHeader>
            <CardTitle>Generate Invite Token</CardTitle>
            <CardDescription>
              Generate a one-time token (valid 72 hours) to register a new agent device.
              Run the installer with <code className="bg-slate-800 px-1 rounded text-xs">TC_INVITE_TOKEN=&lt;token&gt;</code> set.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => generateToken()} disabled={isPending}>
              {isPending ? 'Generating...' : 'Generate Token'}
            </Button>
            {tokenData?.token && (
              <div className="flex items-center bg-slate-800 rounded-lg px-4 py-3 font-mono text-sm text-slate-200 break-all">
                <span className="flex-1">{tokenData.token}</span>
                <CopyButton text={tokenData.token} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Downloads */}
        <Card>
          <CardHeader>
            <CardTitle>Download Agent</CardTitle>
            <CardDescription>
              Download the latest pre-built binary for your platform from GitHub Releases.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {PLATFORMS.map((p) => (
                <a
                  key={p.suffix}
                  href={`${releaseBase}/timechamp-agent-${p.suffix}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-blue-500 hover:text-white transition-colors"
                >
                  <Download className="w-4 h-4 flex-shrink-0 text-blue-400" />
                  {p.label}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Registered Devices */}
        <Card>
          <CardHeader>
            <CardTitle>Registered Devices</CardTitle>
            <CardDescription>All agent devices registered to your organization.</CardDescription>
          </CardHeader>
          <CardContent>
            {devicesLoading ? (
              <p className="text-slate-500 text-sm">Loading...</p>
            ) : !devices || devices.length === 0 ? (
              <p className="text-slate-500 text-sm">No devices registered yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400 text-left">
                      <th className="pb-2 pr-4 font-medium">Hostname</th>
                      <th className="pb-2 pr-4 font-medium">OS</th>
                      <th className="pb-2 pr-4 font-medium">Version</th>
                      <th className="pb-2 pr-4 font-medium">Last Seen</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <tr key={d.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="py-2 pr-4 text-slate-200">{d.hostname ?? '—'}</td>
                        <td className="py-2 pr-4 text-slate-400">{d.platform ?? '—'}</td>
                        <td className="py-2 pr-4 text-slate-400">{d.agentVersion ?? '—'}</td>
                        <td className="py-2 pr-4 text-slate-400">{formatDate(d.lastSeenAt)}</td>
                        <td className="py-2">{statusBadge(d.isActive, d.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </>
  );
}
