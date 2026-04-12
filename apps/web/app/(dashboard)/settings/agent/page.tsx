'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useAgentDevices,
  useGenerateInviteToken,
  usePersonalAgentToken,
  useRotatePersonalAgentToken,
} from '@/hooks/use-agent';
import { Copy, Check, Download, RotateCw, KeyRound, Radio, Camera, Activity } from 'lucide-react';

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
  const { data: personalToken, isLoading: personalLoading } = usePersonalAgentToken();
  const { mutate: rotateToken, isPending: rotating } = useRotatePersonalAgentToken();

  const releaseBase = 'https://github.com/timechamp/agent/releases/latest/download';

  const handleRotate = () => {
    if (!confirm(
      'Rotate your personal agent token? The current token will stop working immediately. ' +
      'Agents already registered keep running — only new agent setups will need the new token. ' +
      'Note: tokens are single-use — after a successful registration, a fresh one is generated automatically.',
    )) {
      return;
    }
    rotateToken();
  };

  return (
    <>
      <Header title="Agent Setup" />
      <div className="p-6 max-w-3xl space-y-6">

        {/* Personal Agent Token — the primary path */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-400" />
              My Personal Agent Token
            </CardTitle>
            <CardDescription>
              Paste this token into the TimeChamp desktop agent&apos;s setup screen
              along with your display name to register a new machine.{' '}
              <strong className="text-slate-200">Each token is single-use</strong> —
              after a successful registration a fresh token is generated automatically,
              so come back here to grab the next one before setting up another device.
              The token carries your name as a prefix (e.g. <code className="text-blue-300">johndoe-…</code>)
              so it&apos;s visually identifiable if you manage multiple workspaces.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {personalLoading ? (
              <p className="text-slate-500 text-sm">Loading...</p>
            ) : personalToken ? (
              <>
                <div className="text-xs text-slate-400">
                  Logged in as{' '}
                  <span className="font-medium text-slate-200">
                    {personalToken.userName}
                  </span>
                </div>
                <div className="flex items-center bg-slate-800 rounded-lg px-4 py-3 font-mono text-sm text-slate-200 break-all">
                  <span className="flex-1">{personalToken.token}</span>
                  <CopyButton text={personalToken.token} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRotate}
                  disabled={rotating}
                  className="gap-2"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${rotating ? 'animate-spin' : ''}`} />
                  {rotating ? 'Rotating...' : 'Regenerate token'}
                </Button>
              </>
            ) : (
              <p className="text-slate-500 text-sm">Failed to load token.</p>
            )}
          </CardContent>
        </Card>

        {/* Legacy invite-token flow — kept for backwards compat with existing installers */}
        <details>
          <summary className="text-xs uppercase tracking-wider text-slate-500 cursor-pointer select-none">
            Legacy: one-time invite token
          </summary>
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-base">Generate One-Time Invite Token</CardTitle>
              <CardDescription>
                Legacy flow. Generates a one-time token (valid 72 hours) usable by older agent
                installers that don&apos;t support personal tokens. Prefer the personal token above.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" onClick={() => generateToken()} disabled={isPending}>
                {isPending ? 'Generating...' : 'Generate Invite Token'}
              </Button>
              {tokenData?.token && (
                <div className="flex items-center bg-slate-800 rounded-lg px-4 py-3 font-mono text-sm text-slate-200 break-all">
                  <span className="flex-1">{tokenData.token}</span>
                  <CopyButton text={tokenData.token} />
                </div>
              )}
            </CardContent>
          </Card>
        </details>

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
                      <th className="pb-2 pr-4 font-medium">Name</th>
                      <th className="pb-2 pr-4 font-medium">Hostname</th>
                      <th className="pb-2 pr-4 font-medium">OS</th>
                      <th className="pb-2 pr-4 font-medium">Version</th>
                      <th className="pb-2 pr-4 font-medium">Last Seen</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <tr key={d.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="py-2 pr-4 text-slate-200 font-medium">
                          {d.displayName ?? d.hostname ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-slate-400">{d.hostname ?? '—'}</td>
                        <td className="py-2 pr-4 text-slate-400">{d.platform ?? '—'}</td>
                        <td className="py-2 pr-4 text-slate-400">{d.agentVersion ?? '—'}</td>
                        <td className="py-2 pr-4 text-slate-400">{formatDate(d.lastSeenAt)}</td>
                        <td className="py-2 pr-4">{statusBadge(d.isActive, d.lastSeenAt)}</td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link
                              href={`/live?focus=${d.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-300 transition-colors"
                              title="Open live monitoring for this device"
                            >
                              <Radio className="w-3 h-3" />
                              Live
                            </Link>
                            <Link
                              href={`/monitoring/screenshots?deviceId=${d.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
                              title="Browse screenshots from this device"
                            >
                              <Camera className="w-3 h-3" />
                              Shots
                            </Link>
                            <Link
                              href={`/monitoring/${d.userId}?deviceId=${d.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
                              title="Open activity timeline for this device"
                            >
                              <Activity className="w-3 h-3" />
                              Activity
                            </Link>
                          </div>
                        </td>
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
