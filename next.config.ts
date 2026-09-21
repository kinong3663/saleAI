import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prisma 走 Node 运行时；页面/路由都是服务端组件，不额外开实验特性
  serverExternalPackages: ['@prisma/client'],
}

export default nextConfig
