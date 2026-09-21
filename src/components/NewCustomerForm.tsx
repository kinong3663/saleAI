'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** 新建客户：建完直接进详情页，演示动线的第一步 */
export function NewCustomerForm({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = name.trim()
    if (!value || pending) return

    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, name: value }),
      })
      if (!res.ok) {
        setError(`创建失败（HTTP ${res.status}）`)
        return
      }
      const data = (await res.json()) as { customer: { id: string } }
      setName('')
      router.push(`/customers/${data.customer.id}?tenantId=${tenantId}`)
      router.refresh()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-wrap items-center gap-2">
      <input
        className="w-64 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
        placeholder="新客户名称，例如：王女士"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? '创建中…' : '新建客户'}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  )
}
