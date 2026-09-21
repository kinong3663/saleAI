import { analyzeCustomerMessage } from './analyze'

//
// 消息触发时序 · B 路径的最小实现。
//
// 为什么要有这个文件：AI 判定不能挂在"发送"这条路径上 ——
// 模型的 5~15 秒延迟会被用户感知为"消息发不出去"。所以发送只管落库，
// 判定放到响应之后（在路由里用 Next 的 after() 接管生命周期），
// 并且用防抖把"客户一口气连发的几条"合并成一轮分析。
//
// 状态挂 globalThis 的原因和 /dev 的故障开关一样：Next 会把每个 Route Handler
// 单独打包，模块作用域的 Map/Set 在不同路由之间不是同一份，锁会失效。
//
interface SchedulerState {
  timers: Map<string, ReturnType<typeof setTimeout>>
  inFlight: Set<string>
}

const globalState = globalThis as unknown as { __zigoaiScheduler?: SchedulerState }
const state: SchedulerState = (globalState.__zigoaiScheduler ??= {
  timers: new Map(),
  inFlight: new Set(),
})

/** 防抖窗口：客户连发多条时，只分析最后一条（3 秒是"一口气说完"的自然停顿） */
const DEBOUNCE_MS = 3_000

const keyOf = (tenantId: string, customerId: string) => `${tenantId}:${customerId}`

/**
 * B 路径：写完客户消息后调用。**立即返回**，不阻塞发送。
 * 同一个客户在 3 秒内又发了消息 → 取消上一次定时器 → 只跑最后一次。
 */
export function scheduleAnalyze(
  tenantId: string,
  customerId: string,
  triggerMessageId: string,
): void {
  const key = keyOf(tenantId, customerId)
  const prev = state.timers.get(key)
  if (prev) clearTimeout(prev)

  state.timers.set(
    key,
    setTimeout(() => {
      state.timers.delete(key)
      void runOnce(tenantId, customerId, triggerMessageId)
    }, DEBOUNCE_MS),
  )
}

/**
 * 立即执行一次判定，带进程内锁防重入。
 * **后台任务绝不让异常冒出去** —— 判定失败只影响建议卡片，不能影响任何人的操作。
 */
export async function runOnce(
  tenantId: string,
  customerId: string,
  triggerMessageId: string,
): Promise<Awaited<ReturnType<typeof analyzeCustomerMessage>> | null> {
  const key = keyOf(tenantId, customerId)
  if (state.inFlight.has(key)) return null // 本进程已在分析这个客户 → 直接放弃

  state.inFlight.add(key)
  try {
    return await analyzeCustomerMessage(tenantId, customerId, {
      trigger: 'CUSTOMER_MESSAGE',
      triggerMessageId,
    })
  } catch (e) {
    console.error('[scheduler] 后台判定失败', {
      tenantId,
      customerId,
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  } finally {
    state.inFlight.delete(key)
  }
}

/** 仅供测试与排障：清掉待执行的定时器 */
export function __clearScheduled(): number {
  const n = state.timers.size
  for (const timer of state.timers.values()) clearTimeout(timer)
  state.timers.clear()
  return n
}
