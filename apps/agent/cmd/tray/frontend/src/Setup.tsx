import { useState } from 'react'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated at build time
import { Ping, Register } from '../wailsjs/go/main/App'

interface Props {
  onComplete: () => void
}

export default function Setup({ onComplete }: Props) {
  const [apiUrl, setApiUrl] = useState('https://api.timechamp.io/api/v1')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleRegister() {
    if (!token.trim()) {
      setError('Please enter your invite token.')
      return
    }
    setLoading(true)
    setError('')

    try {
      await Ping(apiUrl)
    } catch (e: unknown) {
      setError('Cannot reach API server. Check the URL and try again.')
      setLoading(false)
      return
    }

    try {
      await Register(apiUrl, token.trim())
      setSuccess(true)
      setTimeout(onComplete, 1800)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-5">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">

        {/* Logo */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-xl shadow-lg">
            ⏱
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">TimeChamp Agent Setup</h1>
            <p className="text-xs text-slate-500">Register this device with your organisation</p>
          </div>
        </div>

        <div className="mb-1 border-t border-slate-700" />

        {/* Form */}
        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              API URL
            </label>
            <input
              type="url"
              value={apiUrl}
              onChange={e => setApiUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-600">Leave default unless self-hosting</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Invite Token
            </label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="Paste token from dashboard"
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-600">
              Settings → Agent Setup → Generate Token
            </p>
          </div>
        </div>

        <button
          onClick={handleRegister}
          disabled={loading || success}
          className="mt-6 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900 disabled:text-blue-400"
        >
          {success ? '✓ Done!' : loading ? 'Registering…' : 'Register & Start Agent'}
        </button>

        {error && (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-950 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg border border-green-800 bg-green-950 p-3 text-xs text-green-300">
            ✓ Agent registered and running in the background!
          </div>
        )}
      </div>
    </div>
  )
}
