import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { applyConnectionsUpdate } from '@/lib/deploy/config-updater'
import { getActiveInstance, getUserInstances } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/instance/config/connections
 * Returns the active agent's current outgoing links + all other agents the user owns.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await getActiveInstance(session.user.email)
  if (!result?.instance) {
    return NextResponse.json({ error: 'No instance found' }, { status: 404 })
  }

  const allInstances = await getUserInstances(session.user.email)
  if (!allInstances) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const sourceId = result.instance.id

  // Current outgoing links from this agent (with role)
  const links = await (prisma as any).agentLink.findMany({
    where: { sourceInstanceId: sourceId },
    select: { targetInstanceId: true, role: true },
  })
  const linkMap = new Map(links.map((l: any) => [l.targetInstanceId, l.role ?? '']))

  // All other agents this user owns (excluding the active one)
  const otherAgents = allInstances.instances
    .filter((i: any) => i.id !== sourceId)
    .map((i: any) => ({
      id: i.id,
      name: i.config?.agentName || i.name || 'Agent',
      status: i.status,
      linked: linkMap.has(i.id),
      role: linkMap.get(i.id) ?? '',
    }))

  return NextResponse.json({ otherAgents })
}

/**
 * POST /api/instance/config/connections
 * Body: { targetInstanceId: string, action: 'add' | 'remove', role?: string }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await getActiveInstance(session.user.email)
  if (!result?.instance) {
    return NextResponse.json({ error: 'No instance found' }, { status: 404 })
  }

  const body = await req.json()
  const { targetInstanceId, action, role } = body as {
    targetInstanceId: string
    action: 'add' | 'remove' | 'update_role'
    role?: string
  }

  if (!targetInstanceId || !['add', 'remove', 'update_role'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Verify the target belongs to the same user
  const target = await prisma.instance.findFirst({
    where: { id: targetInstanceId, userId: result.user.id },
  })
  if (!target) {
    return NextResponse.json({ error: 'Target agent not found' }, { status: 404 })
  }

  if (targetInstanceId === result.instance.id) {
    return NextResponse.json({ error: 'Cannot link an agent to itself' }, { status: 400 })
  }

  try {
    await applyConnectionsUpdate(result.instance.id, targetInstanceId, action, role)
    return NextResponse.json({
      success: true,
      message: action === 'add'
        ? 'Connection added. Agent is redeploying...'
        : action === 'remove'
          ? 'Connection removed. Agent is redeploying...'
          : 'Role updated. Agent is redeploying...',
    })
  } catch (err: any) {
    console.error('Connections update error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
