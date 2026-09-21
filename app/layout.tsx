import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ZigoAI Mini',
  description: 'AI Sales Agent · 简化版',
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
