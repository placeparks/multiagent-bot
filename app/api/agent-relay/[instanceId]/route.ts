import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/agent-relay/[instanceId]?key=<gatewayToken>&target=<targetInstanceId>&task=<url-encoded-task>
 *
 * Agent-to-agent relay: Agent 1 calls this via web_fetch (GET).
 * We POST the task to Agent 2's OpenClaw gateway (/v1/chat/completions) and return the reply.
 *
 * Auth: key must match the source instance's gatewayToken.
 * Security: source→target AgentLink must exist (user must have explicitly connected them).
 */
export async function GET(
  req: Request,
  { params }: { params: { instanceId: string } }
) {
  const { instanceId } = params
  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  const targetId = url.searchParams.get('target')
  const task = url.searchParams.get('task')

  if (!key || !targetId || !task) {
    return NextResponse.json({ error: 'Missing required params: key, target, task' }, { status: 400 })
  }

  // Verify source instance exists and key matches gatewayToken
  const sourceConfig = await prisma.configuration.findUnique({
    where: { instanceId },
    select: { gatewayToken: true },
  }) as any
  if (!sourceConfig || sourceConfig.gatewayToken !== key) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify an explicit AgentLink exists from source → target
  const link = await (prisma as any).agentLink.findFirst({
    where: { sourceInstanceId: instanceId, targetInstanceId: targetId },
  })
  if (!link) {
    return NextResponse.json({ error: 'No connection to target agent' }, { status: 403 })
  }

  // Look up target's internal service URL and gateway token
  const targetInstance = await prisma.instance.findFirst({
    where: { id: targetId },
    select: { serviceUrl: true },
  })
  const targetConfig = await prisma.configuration.findUnique({
    where: { instanceId: targetId },
    select: { gatewayToken: true },
  }) as any

  if (!targetInstance?.serviceUrl || !targetConfig?.gatewayToken) {
    return NextResponse.json({ error: 'Target agent is not reachable (no serviceUrl or token)' }, { status: 503 })
  }

  // POST to target agent's OpenAI-compatible completions endpoint
  const gatewayUrl = `${targetInstance.serviceUrl}/v1/chat/completions`
  let agentReply: string
  try {
    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${targetConfig.gatewayToken}`,
      },
      body: JSON.stringify({
        model: 'default',
        messages: [{ role: 'user', content: task }],
      }),
      // 60 second timeout — agent tasks can be slow
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json(
        { error: `Target agent returned ${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      )
    }

    const data = await res.json()
    agentReply = data?.choices?.[0]?.message?.content ?? JSON.stringify(data)
  } catch (err: any) {
    return NextResponse.json({ error: `Relay failed: ${err.message}` }, { status: 502 })
  }

  return new Response(agentReply, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
