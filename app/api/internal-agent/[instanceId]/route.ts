import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/internal-agent/[instanceId]?key=<gatewayToken>&agent=<agentId>&task=<url-encoded-task>
 *
 * Coordinator helper for same-channel native multi-agent orchestration.
 * Calls the same instance gateway /v1/chat/completions while requesting a target internal agent.
 */
export async function GET(
  req: Request,
  { params }: { params: { instanceId: string } }
) {
  const { instanceId } = params
  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  const agentId = url.searchParams.get('agent')
  const task = url.searchParams.get('task')

  if (!key || !agentId || !task) {
    return NextResponse.json({ error: 'Missing required params: key, agent, task' }, { status: 400 })
  }

  const sourceConfig = await prisma.configuration.findUnique({
    where: { instanceId },
    select: { gatewayToken: true },
  }) as any
  if (!sourceConfig || sourceConfig.gatewayToken !== key) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { serviceUrl: true },
  })
  if (!instance?.serviceUrl) {
    return NextResponse.json({ error: 'Instance service URL not found' }, { status: 503 })
  }

  const gatewayUrl = `${instance.serviceUrl}/v1/chat/completions`
  try {
    const attempts: Array<{
      name: string
      headers?: Record<string, string>
      body: Record<string, any>
    }> = [
      {
        name: 'model-openclaw-agentid + header',
        headers: { 'x-openclaw-agent-id': agentId },
        body: {
          model: `openclaw:${agentId}`,
          user: `orchestrator:${instanceId}`,
          messages: [{ role: 'user', content: task }],
        },
      },
      {
        name: 'model-openclaw + header',
        headers: { 'x-openclaw-agent-id': agentId },
        body: {
          model: 'openclaw',
          user: `orchestrator:${instanceId}`,
          messages: [{ role: 'user', content: task }],
        },
      },
      {
        name: 'model-agent-alias',
        body: {
          model: `agent:${agentId}`,
          user: `orchestrator:${instanceId}`,
          messages: [{ role: 'user', content: task }],
        },
      },
      {
        name: 'legacy-default + metadata',
        body: {
          model: 'default',
          user: `orchestrator:${instanceId}`,
          metadata: { agentId },
          messages: [{ role: 'user', content: task }],
        },
      },
    ]

    const errors: string[] = []
    for (const attempt of attempts) {
      const res = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sourceConfig.gatewayToken}`,
          ...(attempt.headers ?? {}),
        },
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(60_000),
      })

      if (res.ok) {
        const data = await res.json()
        const content = data?.choices?.[0]?.message?.content ?? JSON.stringify(data)
        return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }

      const errText = await res.text()
      errors.push(`${attempt.name}: ${res.status} ${errText.slice(0, 180)}`)
    }

    return NextResponse.json(
      {
        error: 'Internal agent call failed for all request formats',
        details: errors,
      },
      { status: 502 }
    )
  } catch (err: any) {
    return NextResponse.json({ error: `Internal agent relay error: ${err.message}` }, { status: 502 })
  }
}
