/**
 * 阶段徽标。
 * 阶段枚举的唯一定义会在 `src/lib/constants.ts`（S3 落地），这里只负责配色，
 * 见到没见过的阶段值也不会炸。
 */
const STAGE_STYLES: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-600',
  DISCOVERY: 'bg-sky-100 text-sky-700',
  INTERESTED: 'bg-amber-100 text-amber-700',
  HIGH_INTENT: 'bg-orange-100 text-orange-700',
  WON: 'bg-emerald-100 text-emerald-700',
  LOST: 'bg-slate-200 text-slate-500',
}

export function StageBadge({ stage }: { stage: string | null }) {
  if (!stage) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">
        未判定
      </span>
    )
  }
  const style = STAGE_STYLES[stage] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{stage}</span>
  )
}
