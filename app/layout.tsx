import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'salesAI · 销售工作台',
  description: 'AI 销售助手：客户会话 + 自动判定 + 建议回复',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
