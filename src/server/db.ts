import { PrismaClient } from '@prisma/client'

/**
 * Prisma 单例。
 * 开发模式热重载会反复 new PrismaClient，连接数会被耗尽 —— 所以挂在 globalThis 上。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
