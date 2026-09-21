import { LLM_RETRIES, LLM_TIMEOUT_MS } from '@/lib/constants'
import { AGENT_OUTPUT_JSON_SCHEMA } from './schema'

/**
 * LLM 接入层。
 *
 * 这个签名是刻意的：**它不抛异常，只返回联合类型**。
 * 调用方必须显式处理失败分支，而不会因为一个未捕获的异常把整条链路打崩。
 *
 * S7 补全：失败带上 `kind`（四类失败各自可辨），并加了 /dev 用的强制故障开关。
 */

export type LLMMode = 'json_schema' | 'json_object'

/** 失败分类（实施文档 S7 的四类失败） */
export type LLMFailureKind =
  | 'timeout' // 超时
  | 'network' // 网络错误
  | 'http' // API 4xx / 5xx
  | 'empty' // 200 但内容为空
  | 'missing_api_key'
  | 'forced' // /dev 的强制故障开关

export type LLMResult =
  | { ok: true; raw: string; latencyMs: number; attempt: number; mode: LLMMode }
  | { ok: false; kind: LLMFailureKind; error: string; latencyMs: number; attempt: number }

/**
 * 进程内状态挂在 globalThis 上，而不是模块作用域。
 *
 * 原因（实测踩过）：Next 会把每个 Route Handler 单独打包，`/api/dev/force-failure`
 * 和 `/api/customers/:id/analyze` 可能各持一份模块实例 —— 模块级变量会让开关「设了没生效」。
 * 这也和文档里 startup.ts「用 globalThis 挂标记防重复注册」同一套理由。
 */
interface LlmGlobalState {
  /** 兼容接口不一定支持 OpenAI 的 strict json_schema（决策 Q2）：一旦探测到不支持就不再试 */
  strictUnsupported?: boolean
  /** 强制故障开关：打开后不真的发请求，直接返回失败（/dev 演示与测试用） */
  forceFailure?: boolean
}

const globalState = globalThis as unknown as { __zigoaiLlm?: LlmGlobalState }
const state: LlmGlobalState = (globalState.__zigoaiLlm ??= {})

export function __setForceFailure(value: boolean): void {
  state.forceFailure = value
}

export function isForceFailure(): boolean {
  return state.forceFailure === true
}

export function isStrictUnsupported(): boolean {
  return state.strictUnsupported === true
}

export function getLlmModel(): string {
  return process.env.LLM_MODEL ?? 'deepseek-chat'
}

export async function callLLM(
  system: string,
  user: string,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<LLMResult> {
  const started = Date.now()

  if (isForceFailure()) {
    return {
      ok: false,
      kind: 'forced',
      error: 'forced_failure：/dev 的强制故障开关是打开的',
      latencyMs: 0,
      attempt: 0,
    }
  }

  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS
  const maxRetries = opts.retries ?? LLM_RETRIES

  let attempt = 0
  let lastKind: LLMFailureKind = 'network'
  let lastError = 'unknown_error'

  for (let i = 0; i <= maxRetries; i++) {
    attempt = i + 1
    const mode: LLMMode = isStrictUnsupported() ? 'json_object' : 'json_schema'
    const res = await callOnce(system, user, mode, timeoutMs)

    if (res.ok) {
      return { ok: true, raw: res.raw, latencyMs: Date.now() - started, attempt, mode }
    }

    // 能力探测失败：切换模式重来，这一次不计入重试次数
    if (res.capabilityIssue) {
      state.strictUnsupported = true
      console.warn('[llm] strict json_schema 不被支持，降级为 json_object:', res.error)
      i -= 1
      continue
    }

    lastKind = res.kind
    lastError = res.error
    if (i < maxRetries) await sleep(400 * 2 ** i) // 指数退避
  }

  return {
    ok: false,
    kind: lastKind,
    error: lastError,
    latencyMs: Date.now() - started,
    attempt,
  }
}

// ───────── 内部 ─────────

type OnceResult =
  | { ok: true; raw: string }
  | { ok: false; kind: LLMFailureKind; error: string; capabilityIssue: boolean }

async function callOnce(
  system: string,
  user: string,
  mode: LLMMode,
  timeoutMs: number,
): Promise<OnceResult> {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      kind: 'missing_api_key',
      error: 'missing_llm_api_key',
      capabilityIssue: false,
    }
  }

  const baseUrl = (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/+$/, '')
  const body = {
    model: getLlmModel(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    response_format:
      mode === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'agent_output',
              strict: true,
              schema: AGENT_OUTPUT_JSON_SCHEMA,
            },
          }
        : { type: 'json_object' },
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return {
      ok: false,
      kind: aborted ? 'timeout' : 'network',
      error: aborted ? `timeout_after_${timeoutMs}ms` : `network_error: ${errorText(e)}`,
      capabilityIssue: false,
    }
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300)
    // 只有「我们主动要求 strict，服务端说这个 response_format 不认」才算能力问题
    const capabilityIssue =
      mode === 'json_schema' &&
      res.status >= 400 &&
      res.status < 500 &&
      /response_format|json_schema|json mode|strict/i.test(text)
    return { ok: false, kind: 'http', error: `http_${res.status}: ${text}`, capabilityIssue }
  }

  const data: unknown = await res.json().catch(() => null)
  const content = pickMessageContent(data)
  if (content === null) {
    return { ok: false, kind: 'empty', error: 'empty_completion', capabilityIssue: false }
  }
  return { ok: true, raw: content }
}

function pickMessageContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.trim() !== '' ? content : null
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
