/**
 * 展示用时间格式化。
 * 固定按北京时间输出，避免服务端时区（本地开发是 Asia/Shanghai，容器里通常是 UTC）
 * 让同一份数据渲染出两种结果。
 */
const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDateTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return '—'
  return DATE_TIME.format(d)
}

/**
 * 相对时间（「3 天前」这种）。
 * prompt 里必须给 —— 模型自己推算不出相对时间（决策 Q9），UI 复用同一份实现。
 */
export function formatRelative(input: string | Date | null): string {
  if (!input) return '无记录'
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return '无记录'

  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return DATE_TIME.format(d)
}
