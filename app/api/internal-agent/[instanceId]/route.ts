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
    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sourceConfig.gatewayToken}`,
      },
      body: JSON.stringify({
        model: 'default',
        // Try common agent-targeting fields supported by multi-agent gateways.
        agentId,
        metadata: { agentId },
        messages: [{ role: 'user', content: task }],
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json(
        { error: `Internal agent call failed (${res.status}): ${errText.slice(0, 240)}` },
        { status: 502 }
      )
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? JSON.stringify(data)
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (err: any) {
    return NextResponse.json({ error: `Internal agent relay error: ${err.message}` }, { status: 502 })
  }
}

