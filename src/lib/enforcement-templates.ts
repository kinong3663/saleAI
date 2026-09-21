//
// 自动约束的"业务语言模板"（依据 docs/配置改造.md §5.2）。
//
// 界面上不要暴露 kind / condition 两个下拉 —— 那是把实现细节丢给业务人员。
// 使用者选业务意图，这里映射到具体组合。
// 加一个新的约束种类 = 这里加一行 + 写一条护栏分支，界面自动多一个选项。
//
// 这个文件刻意不引 zod：它要被客户端组件 import，而 tenant-config.ts 里的校验 schema 只在服务端用。
//
export const ENFORCEMENT_TEMPLATES = [
  { value: '', label: '不施加自动约束' },
  {
    value: 'FORBID_PRICE_UNTIL:INTEREST_EXPRESSED',
    label: '禁止报价，直到客户表达明确兴趣',
  },
  {
    value: 'FORBID_PRICE_UNTIL:DOCUMENT_CONFIRMED',
    label: '禁止报价，直到客户提供资料',
  },
] as const

/** 把配置里的 enforcement 还原成模板 value（认不出的组合返回空串 → 界面显示"不施加自动约束"） */
export function templateValueOf(enforcement?: { kind: string; condition: string }): string {
  if (!enforcement) return ''
  const hit = ENFORCEMENT_TEMPLATES.find(
    (t) => t.value === `${enforcement.kind}:${enforcement.condition}`,
  )
  return hit ? hit.value : ''
}

/** 模板 value → enforcement（空串 = 不施加自动约束） */
export function enforcementFromTemplate(
  value: string,
): { kind: string; condition: string } | undefined {
  if (!value) return undefined
  const [kind, condition] = value.split(':')
  if (!kind || !condition) return undefined
  return { kind, condition }
}
