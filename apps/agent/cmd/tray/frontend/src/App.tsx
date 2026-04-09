import { useEffect, useState } from 'react'
import Setup from './Setup'
import Status from './Status'

// Wails auto-generates these bindings when you run `wails dev` or `wails build`.
// They proxy Go method calls over the native WebView IPC bridge.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated at build time
import { CheckSetup } from '../wailsjs/go/main/App'

export default function App() {
  const [isSetup, setIsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    CheckSetup().then((ok: boolean) => setIsSetup(ok))
  }, [])

  if (isSetup === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return isSetup
    ? <Status />
    : <Setup onComplete={() => setIsSetup(true)} />
}
