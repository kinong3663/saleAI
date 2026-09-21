export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">ZigoAI Mini</h1>
      <p className="mt-3 text-sm text-slate-600">
        S0 脚手架已就绪。客户列表页在 S2 落地，本页之后会重定向到 /customers。
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        <li>
          健康检查：{' '}
          <a className="text-blue-600 underline" href="/api/health">
            /api/health
          </a>
        </li>
      </ul>
    </main>
  )
}
