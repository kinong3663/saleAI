import { LLM_RETRIES, LLM_TIMEOUT_MS } from '@/lib/constants'
import { AGENT_OUTPUT_JSON_SCHEMA } from './schema'

/**
 * LLM 接入层。
 *
 * 这个签名是刻意的：**它不抛异常，只返回联合类型**。
 * 调用方必须显式处理失败分支，而不会因为一个未捕获的异常把整条链路打崩。
 */
export type LLMResult =
  | { ok: true; raw: string; latencyMs: number; attempt: number; mode: LLMMode }
  | { ok: false; error: string; latencyMs: number; attempt: number }

export type LLMMode = 'json_schema' | 'json_object'

/**
 * 能力标记：兼容接口不一定支持 OpenAI 的 strict json_schema（决策 Q2）。
 * 一旦探测到不支持，本进程内不再尝试 strict，直接走 json_object + Zod 校验。
 */
let strictUnsupported = false

export function isStrictUnsupported(): boolean {
  return strictUnsupported
}

export function getLlmModel(): string {
  return process.env.LLM_MODEL ?? 'deepseek-chat'
}

export async function callLLM(
  system: string,
  user: string,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<LLMResult> {
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS
  const maxRetries = opts.retries ?? LLM_RETRIES
  const started = Date.now()

  let attempt = 0
  let lastError = 'unknown_error'

  for (let i = 0; i <= maxRetries; i++) {
    attempt = i + 1
    const mode: LLMMode = strictUnsupported ? 'json_object' : 'json_schema'
    const res = await callOnce(system, user, mode, timeoutMs)

    if (res.ok) {
      return { ok: true, raw: res.raw, latencyMs: Date.now() - started, attempt, mode }
    }

    // 能力探测失败：切换模式重来，这一次不计入重试次数
    if (res.capabilityIssue) {
      strictUnsupported = true
      console.warn('[llm] strict json_schema 不被支持，降级为 json_object:', res.error)
      i -= 1
      continue
    }

    lastError = res.error
    if (i < maxRetries) await sleep(400 * 2 ** i) // 指数退避
  }

  return { ok: false, error: lastError, latencyMs: Date.now() - started, attempt }
}

// ───────── 内部 ─────────

type OnceResult =
  | { ok: true; raw: string }
  | { ok: false; error: string; capabilityIssue: boolean }

async function callOnce(
  system: string,
  user: string,
  mode: LLMMode,
  timeoutMs: number,
): Promise<OnceResult> {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) return { ok: false, error: 'missing_llm_api_key', capabilityIssue: false }

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
    const aborted =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return {
      ok: false,
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
    return { ok: false, error: `http_${res.status}: ${text}`, capabilityIssue }
  }

  const data: unknown = await res.json().catch(() => null)
  const content = pickMessageContent(data)
  if (content === null) {
    return { ok: false, error: 'empty_completion', capabilityIssue: false }
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
