import { useEffect, useState } from 'react'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated at build time
import { GetStatus } from '../wailsjs/go/main/App'

interface Status {
  running: boolean
}

export default function Status() {
  const [status, setStatus] = useState<Status>({ running: false })

  function refresh() {
    // Wails generates GetStatus() as Promise<Record<string,any>>; cast to Status
    GetStatus().then((s: unknown) => setStatus(s as Status))
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-900">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-2xl shadow-xl">
        ⏱
      </div>

      <div className="text-center">
        <h1 className="text-base font-bold text-slate-100">TimeChamp Agent</h1>
        <p className="mt-1 text-xs text-slate-500">Background monitoring agent</p>
      </div>

      <div
        className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium ${
          status.running
            ? 'border border-green-800 bg-green-950 text-green-300'
            : 'border border-slate-700 bg-slate-800 text-slate-400'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            status.running ? 'animate-pulse bg-green-400' : 'bg-slate-600'
          }`}
        />
        {status.running ? 'Agent Running' : 'Agent Stopped'}
      </div>

      <p className="max-w-xs text-center text-xs text-slate-600">
        Close this window — the agent keeps running in the background.
        Use the system tray icon to show or quit.
      </p>
    </div>
  )
}
