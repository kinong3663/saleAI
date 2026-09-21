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
