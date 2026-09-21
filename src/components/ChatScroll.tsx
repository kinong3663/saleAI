'use client'

import { useEffect, useRef } from 'react'

//
// 聊天记录的可滚动容器。
//
// 两件事：
//   ① 自己滚，不带动整页 —— 工作台是"三栏各自管自己"，页面本身不滚（h-screen + overflow-hidden）。
//      左栏时间线、右栏 AI 窗口因此永远停在原位，只有中间的对话在动。
//   ② 一进来就停在最新一条。聊天记录的默认视角是"最新"，不是"最旧"；
//      每次消息列表变化（watchKey 变）也重新贴底，发完消息不用手动往下拉。
//
// watchKey 用"最后一条消息 id + 条数"这种会随新消息变化的字符串，
// 这样同一条消息被判定更新（内容没变）时不会无谓地跳一下。
//
export function ChatScroll({
  children,
  watchKey,
}: {
  children: React.ReactNode
  watchKey: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [watchKey])

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
    >
      {children}
    </div>
  )
}
