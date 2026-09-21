'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 登录表单（客户端）。
 *
 * 成功之后 `router.replace(next)` + `router.refresh()`：
 * replace 是为了让浏览器后退键回不到登录页，refresh 是为了让服务端组件按新 cookie 重新渲染。
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: user.trim(), password }),
      })
      if (!res.ok) {
        setError(res.status === 401 ? '账号或密码不正确' : `登录失败（HTTP ${res.status}）`)
        return
      }
      router.replace(next)
      router.refresh()
    } catch (e) {
      setError(`登录失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded border border-slate-200 bg-white p-5">
      <label className="block">
        <span className="text-xs text-slate-500">账号</span>
        <input
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </label>

      <label className="block">
        <span className="text-xs text-slate-500">密码</span>
        <input
          type="password"
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? '登录中…' : '登录'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
