import Link from 'next/link'

//
// 全局顶栏。
//
// 一屏工作台里最贵的资源是垂直空间：顶栏固定 56px，只放"身份 + 切换 + 出口"三件事，
// 其余全部让给内容。左端是项目名（点它回客户列表），右端是调用方塞进来的动作插槽。
//
// 色调沿用既有视觉世界（slate 底 + blue 主色 + amber 警示），没有引入新色。
//
export function AppHeader({
  subtitle,
  children,
}: {
  /** 项目名右边的灰字，用来说明"你现在在哪" */
  subtitle?: string
  /** 右侧动作区：租户切换、用户配置、退出登录等 */
  children?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-6 px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/customers"
            className="text-[15px] font-semibold tracking-tight text-slate-900 transition-colors hover:text-blue-700"
          >
            salesAI
          </Link>
          {subtitle && (
            <span className="truncate text-xs text-slate-400" title={subtitle}>
              {subtitle}
            </span>
          )}
        </div>

        {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
    </header>
  )
}
