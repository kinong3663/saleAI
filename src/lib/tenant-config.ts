import { z } from 'zod'
import { ENFORCEMENT_CONDITIONS, ENFORCEMENT_KINDS, LEAD_STAGES } from '@/lib/constants'

//
// 租户配置的写入校验（依据 docs/配置改造.md §4.2）。
//
// 三个必查项，每一个都对应一个具体故障：
//   ① kind / condition 用 z.enum  → 防"护栏静默失效"（存进不认识的 kind，G3 直接跳过）
//   ② stageDefs 六个阶段全覆盖     → 防漏一个阶段导致 prompt 出现 undefined
//   ③ 规则 ID / 产品 ID / 产品名唯一 → 防 rules_hit 分不清哪条命中、产品列表编辑错乱
//

export const ProductSchema = z.object({
  id: z.string().min(1).max(20),
  name: z.string().trim().min(1).max(60),
  price: z.number().nonnegative().optional(),
  unit: z.string().trim().max(20).optional(),
  description: z.string().trim().max(200).optional(),
  quotePolicy: z.enum(['AUTO', 'HUMAN_ONLY']).default('AUTO'),
  enabled: z.boolean().default(true),
})

export const TenantRuleSchema = z.object({
  id: z.string().min(1).max(10),
  type: z.enum(['PROHIBIT', 'REQUIRE', 'PREFER']),
  text: z.string().trim().min(1).max(300),
  enforcement: z
    .object({
      kind: z.enum(ENFORCEMENT_KINDS),
      condition: z.enum(ENFORCEMENT_CONDITIONS),
    })
    .optional(),
})

export const TenantConfigSchema = z.object({
  rules: z
    .array(TenantRuleSchema)
    .max(10)
    .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, {
      message: '规则 ID 不能重复',
    }),

  stageDefs: z
    .record(z.string(), z.string().trim().min(1).max(200))
    .refine((defs) => LEAD_STAGES.every((s) => (defs[s] ?? '').trim() !== ''), {
      message: `六个阶段定义必须全部填写：${LEAD_STAGES.join(' / ')}`,
    }),

  needHumanTriggers: z.array(z.string().trim().min(1).max(30)).max(10),
  priceFallbackReply: z.string().trim().min(1).max(200),
  followUpAfterHours: z.number().int().min(1).max(720),
  maxFollowUps: z.number().int().min(0).max(10),

  products: z
    .array(ProductSchema)
    .max(20)
    .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, {
      message: '产品 ID 不能重复',
    })
    .refine((ps) => new Set(ps.map((p) => p.name)).size === ps.length, {
      message: '产品名称不能重复',
    }),
})

export type TenantConfigInput = z.infer<typeof TenantConfigSchema>

// 自动约束的"业务语言模板"在同目录的 enforcement-templates.ts 里（那个文件不引 zod，客户端组件也能用）
