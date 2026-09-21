/**
 * 生成幂等键用的随机 id（clientMsgId）。
 *
 * 为什么不用 `crypto.randomUUID()` 一把梭：
 * 它**只在安全上下文**（https:// 或 localhost）里存在。线上是 http://<ip>:8080 这种明文地址，
 * 浏览器里 `crypto.randomUUID === undefined`，直接调用会抛 TypeError —— 消息发不出去，
 * 也就不会触发 AI 判断。这个 bug 只在真实部署环境暴露，本地 localhost 永远测不到。
 *
 * 降级顺序：randomUUID → getRandomValues（非安全上下文也可用）→ 时间戳 + 随机数。
 */
export function randomId(): string {
  const c =
    typeof globalThis === 'undefined' ? undefined : (globalThis.crypto as Crypto | undefined)

  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
