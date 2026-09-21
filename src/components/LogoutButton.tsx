'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** 退出登录：清 cookie → 回登录页。门锁的出口，不然只能靠关浏览器。 */
export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    setBusy(true)
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => null)
    router.replace('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
    >
      {busy ? '退出中…' : '退出登录'}
    </button>
  )
}
