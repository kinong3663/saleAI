/**
 * Next.js 的服务启动钩子：进程起来时执行一次（Node runtime）。
 *
 * 为什么需要这个文件：实施文档把定时器放在 src/server/startup.ts，
 * 但「谁来调用它」文档没写。Next 官方的启动钩子就是 instrumentation.ts，
 * 这里只负责把它接上，注册逻辑本身仍在 startup.ts 里。
 */
export async function register(): Promise<void> {
  // 构建阶段（next build 也会加载这个文件）不要注册：那时既没有数据库也不需要扫描
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  // 只有 Node runtime 才有 setInterval + Prisma；edge runtime 里跳过
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { registerFollowUpScheduler } = await import('./src/server/startup')
  registerFollowUpScheduler()
}
