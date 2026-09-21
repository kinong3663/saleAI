'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LEAD_STAGES } from '@/lib/constants'
import { formatDateTime } from '@/lib/datetime'
import {
  ENFORCEMENT_TEMPLATES,
  enforcementFromTemplate,
  templateValueOf,
} from '@/lib/enforcement-templates'
import type { QuotePolicy, TenantConfig, TenantProduct, TenantRule } from '@/lib/types'

interface Props {
  tenant: {
    id: string
    slug: string
    name: string
    industry: string | null
    salesGoal: string
    tone: string | null
    config: TenantConfig
    updatedAt: string
  }
}

const RULE_TYPE_LABEL: Record<string, string> = {
  PROHIBIT: '禁止',
  REQUIRE: '要求',
  PREFER: '偏好',
}

// 租户配置编辑表单（依据 docs/配置改造.md §5）。
//
// 三条界面原则，都是"让非法状态无法产生"：
//   ① 阶段定义固定 6 个输入框、没有删除按钮 → 结构上不可能漏阶段
//   ② 规则编号与产品编号保存时自动重排 → 结构上不可能重复
//   ③ 自动约束用业务语言的模板下拉，不把 kind / condition 暴露给使用者
export function TenantConfigForm({ tenant }: Props) {
  const router = useRouter()
  const [basic, setBasic] = useState({
    name: tenant.name,
    industry: tenant.industry ?? '',
    salesGoal: tenant.salesGoal,
    tone: tenant.tone ?? '',
  })
  const [rules, setRules] = useState<TenantRule[]>(tenant.config.rules)
  const [stageDefs, setStageDefs] = useState<Record<string, string>>(tenant.config.stageDefs)
  const [triggersText, setTriggersText] = useState(tenant.config.needHumanTriggers.join('\n'))
  const [followUpAfterHours, setFollowUpAfterHours] = useState(tenant.config.followUpAfterHours)
  const [maxFollowUps, setMaxFollowUps] = useState(tenant.config.maxFollowUps)
  const [products, setProducts] = useState<TenantProduct[]>(tenant.config.products)
  const [priceFallbackReply, setPriceFallbackReply] = useState(tenant.config.priceFallbackReply)

  const [phase, setPhase] = useState<'idle' | 'saving'>('idle')
  const [errors, setErrors] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)

  function issueLines(payload: unknown): string[] {
    const withIssues = payload as { issues?: { path: (string | number)[]; message: string }[]; error?: string } | null
    if (withIssues && Array.isArray(withIssues.issues)) {
      return withIssues.issues.map((i) => `${i.path.join('.') || '配置'}：${i.message}`)
    }
    return [withIssues?.error ? `保存被拒绝：${withIssues.error}` : '保存失败（未知错误）']
  }

  function normalized(): TenantConfig {
    return {
      rules: rules.map((r, i) => ({ ...r, id: `R${i + 1}`, text: r.text.trim() })),
      stageDefs,
      needHumanTriggers: triggersText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      priceFallbackReply: priceFallbackReply.trim(),
      followUpAfterHours,
      maxFollowUps,
      products: products.map((p, i) => ({
        ...p,
        id: `P${i + 1}`,
        name: p.name.trim(),
        description: p.description?.trim() || undefined,
        unit: p.unit?.trim() || undefined,
      })),
    }
  }

  async function onSave() {
    setPhase('saving')
    setErrors([])
    setNote(null)
    try {
      const basicRes = await fetch(`/api/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: basic.name.trim(),
          industry: basic.industry.trim() || null,
          salesGoal: basic.salesGoal.trim(),
          tone: basic.tone.trim() || null,
        }),
      })
      if (!basicRes.ok) {
        setErrors(issueLines(await basicRes.json().catch(() => null)))
        return
      }

      const cfgRes = await fetch(`/api/tenants/${tenant.id}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: normalized() }),
      })
      const data = await cfgRes.json().catch(() => null)
      if (!cfgRes.ok) {
        setErrors(issueLines(data))
        return
      }
      setNote('已保存 · 下一次 AI 判定就会用新配置（不需要重启）')
      router.refresh()
    } catch (e) {
      setErrors([`保存失败：${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setPhase('idle')
    }
  }

  function updateRule(index: number, patch: Partial<TenantRule>) {
    setRules(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function updateProduct(index: number, patch: Partial<TenantProduct>) {
    setProducts(products.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const saving = phase === 'saving'

  return (
    <div className="mt-6 space-y-4">
      <Section title="基本信息">
        <Field label="企业名称">
          <input className={inputCls} value={basic.name} onChange={(e) => setBasic({ ...basic, name: e.target.value })} />
        </Field>
        <Field label="行业">
          <input className={inputCls} value={basic.industry} onChange={(e) => setBasic({ ...basic, industry: e.target.value })} />
        </Field>
        <Field label="销售目标（进 prompt 第一节）">
          <textarea className={inputCls} rows={2} value={basic.salesGoal} onChange={(e) => setBasic({ ...basic, salesGoal: e.target.value })} />
        </Field>
        <Field label="语气要求（进 prompt 第一节）">
          <input className={inputCls} value={basic.tone} onChange={(e) => setBasic({ ...basic, tone: e.target.value })} />
        </Field>
      </Section>

      <Section
        title="销售规则"
        hint="自动约束选业务意图即可，它决定护栏什么时候拦下报价。编号保存时自动重排。"
      >
        {rules.map((rule, i) => (
          <div key={i} className="rounded border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">R{i + 1}</span>
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                value={rule.type}
                onChange={(e) => updateRule(i, { type: e.target.value as TenantRule['type'] })}
              >
                {Object.entries(RULE_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setRules(rules.filter((_, idx) => idx !== i))}
                className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:text-red-600"
              >
                删除
              </button>
            </div>
            <textarea
              className={`${inputCls} mt-2`}
              rows={2}
              value={rule.text}
              onChange={(e) => updateRule(i, { text: e.target.value })}
              placeholder="规则文本，例如：客户未表达明确兴趣前，不主动报价"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-slate-500">自动约束</span>
              <select
                className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                value={templateValueOf(rule.enforcement)}
                onChange={(e) => updateRule(i, { enforcement: enforcementFromTemplate(e.target.value) })}
              >
                {ENFORCEMENT_TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRules([...rules, { id: `R${rules.length + 1}`, type: 'REQUIRE', text: '' }])}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
        >
          + 添加规则
        </button>
      </Section>

      <Section title="客户阶段定义" hint="六个阶段固定存在，只能改解释文本 —— 结构上不可能漏阶段。">
        {LEAD_STAGES.map((stage) => (
          <Field key={stage} label={stage}>
            <input
              className={inputCls}
              value={stageDefs[stage] ?? ''}
              onChange={(e) => setStageDefs({ ...stageDefs, [stage]: e.target.value })}
            />
          </Field>
        ))}
      </Section>

      <Section
        title="转人工条件"
        hint="一行一条。模型按这些条件理解客户的话（例如「让真人给我打电话」会被归到「要求真人」）；护栏只放行清单里已有的条件。"
      >
        <textarea
          className={inputCls}
          rows={4}
          value={triggersText}
          onChange={(e) => setTriggersText(e.target.value)}
          placeholder={'投诉\n要求真人\n涉及退款'}
        />
      </Section>

      <Section title="跟进阈值">
        <div className="flex flex-wrap gap-4">
          <Field label="沉默多久算该跟进（小时）">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={followUpAfterHours}
              onChange={(e) => setFollowUpAfterHours(Number(e.target.value))}
            />
          </Field>
          <Field label="最多跟进几次">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={maxFollowUps}
              onChange={(e) => setMaxFollowUps(Number(e.target.value))}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="产品与报价"
        hint="价格留空 = 需评估后报价，AI 不会报数字、会引导客户提供资料。报价策略选「仅人工报价」的产品，即使规则允许也不许自动报价。编号保存时自动重排。"
      >
        {products.map((p, i) => (
          <div key={i} className="rounded border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">P{i + 1}</span>
              <input
                className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                value={p.name}
                onChange={(e) => updateProduct(i, { name: e.target.value })}
                placeholder="产品名称"
              />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={p.enabled !== false}
                  onChange={(e) => updateProduct(i, { enabled: e.target.checked })}
                />
                上架
              </label>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`确定删除「${p.name || '这个产品'}」吗？价格数据会一起没了。`)) {
                    setProducts(products.filter((_, idx) => idx !== i))
                  }
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:text-red-600"
              >
                删除
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={p.price ?? ''}
                onChange={(e) =>
                  updateProduct(i, { price: e.target.value.trim() === '' ? undefined : Number(e.target.value) })
                }
                placeholder="价格（留空=需评估后报价）"
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={p.unit ?? ''}
                onChange={(e) => updateProduct(i, { unit: e.target.value })}
                placeholder="单位，例如 元/次"
              />
              <input
                className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm"
                value={p.description ?? ''}
                onChange={(e) => updateProduct(i, { description: e.target.value })}
                placeholder="说明，例如 含 1 次体验课 + 1 次体质评估"
              />
              <select
                className="col-span-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                value={p.quotePolicy ?? 'AUTO'}
                onChange={(e) => updateProduct(i, { quotePolicy: e.target.value as QuotePolicy })}
              >
                <option value="AUTO">自动报价（引流品）</option>
                <option value="HUMAN_ONLY">仅人工报价（大单）</option>
              </select>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setProducts([...products, { id: `P${products.length + 1}`, name: '', quotePolicy: 'AUTO', enabled: true }])
          }
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
        >
          + 添加产品
        </button>
      </Section>

      <Section title="报价被拦下时的兜底话术" hint="护栏打回重生成后仍违规时，用它替换 reply。">
        <textarea
          className={inputCls}
          rows={2}
          value={priceFallbackReply}
          onChange={(e) => setPriceFallbackReply(e.target.value)}
        />
      </Section>

      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存配置'}
          </button>
          <span className="text-xs text-slate-400">最后修改于 {formatDateTime(tenant.updatedAt)}</span>
        </div>

        {errors.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 rounded border border-red-200 bg-red-50 p-3 pl-7 text-xs text-red-700">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {note && <p className="mt-3 text-sm text-emerald-700">{note}</p>}
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-medium">{title}</h2>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}