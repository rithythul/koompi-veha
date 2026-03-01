import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useLogin, useCurrentUser } from '../api/auth'
import { Loader2 } from 'lucide-react'

export default function Login() {
  const { data: user, isLoading: checking } = useCurrentUser()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  if (checking) {
    return (
      <div className="h-full bg-bg-primary flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    )
  }

  if (user) return <Navigate to="/dashboard" replace />

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    login.mutate({ username, password })
  }

  return (
    <div className="h-full bg-bg-primary flex items-center justify-center">
      <div className="w-full max-w-sm mx-4 animate-scale-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4 shadow-lg shadow-accent/20">
            <span className="text-white font-bold text-xl">V</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Veha</h1>
          <p className="text-sm text-text-secondary mt-1">Billboard Management Platform</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg-surface border border-border-default rounded-xl p-6 space-y-4"
        >
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-text-muted"
              placeholder="admin"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-text-muted"
            />
          </div>

          {login.isError && (
            <div className="text-sm text-status-error bg-status-error/10 border border-status-error/20 px-3 py-2 rounded-lg">
              {login.error?.message || 'Login failed'}
            </div>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {login.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign In
          </button>
        </form>

        <p className="text-center text-[11px] text-text-muted mt-4">Veha v0.2.0</p>
      </div>
    </div>
  )
}
