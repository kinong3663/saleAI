import { FOLLOWUP_SCAN_INTERVAL_MS } from '@/lib/constants'
import { runFollowUpScan } from './followup'

/**
 * 进程内定时器（决策 Q6）。
 *
 * 为什么可行：部署目标是常驻 Docker 容器，Node 进程一直活着。
 * 为什么不可移植：Vercel 这类 serverless 上代码不常驻，setInterval 活不过一次请求 ——
 * 「部署决策影响架构自由度」的具体例子，README 里会写。
 *
 * 为什么挂 globalThis：开发热重载会重复执行模块，不挂标记就会注册多个定时器 → 跟进重复。
 */
interface StartupState {
  followUpTimer?: ReturnType<typeof setInterval>
  registered?: boolean
}

const globalState = globalThis as unknown as { __zigoaiStartup?: StartupState }
const state: StartupState = (globalState.__zigoaiStartup ??= {})

export function registerFollowUpScheduler(): void {
  if (state.registered) return
  state.registered = true

  state.followUpTimer = setInterval(() => {
    void runFollowUpScan()
      .then((r) => {
        if (r.followedUp.length > 0) {
          console.log(
            `[followup] 生成了 ${r.followedUp.length} 条跟进建议：` +
              r.followedUp.map((f) => `${f.customerName}(${f.waitedHours}h)`).join('、'),
          )
        }
      })
      .catch((e) => console.error('[followup] 扫描失败：', e))
  }, FOLLOWUP_SCAN_INTERVAL_MS)

  console.log(`[startup] 跟进扫描已注册：每 ${FOLLOWUP_SCAN_INTERVAL_MS / 1000}s 一次`)
}

export function isFollowUpSchedulerRegistered(): boolean {
  return state.registered === true
}
