import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserInstances, AGENT_LIMITS, getRemainingAgentSlots } from '@/lib/get-active-instance'
import { Plan } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await getUserInstances(session.user.email)
  if (!result) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { user, instances } = result
  const plan = user.subscription?.plan as Plan | null
  const remaining = getRemainingAgentSlots(plan, instances.length)
  const limit = plan ? AGENT_LIMITS[plan] : 0

  const activeId = user.activeInstanceId ?? instances[0]?.id ?? null

  return NextResponse.json({
    activeInstanceId: activeId,
    instances: instances.map(inst => ({
      id: inst.id,
      name: inst.name,
      status: inst.status,
      accessUrl: inst.accessUrl,
      agentName: inst.config?.agentName ?? null,
      createdAt: inst.createdAt,
      isActive: inst.id === activeId,
    })),
    plan,
    limit,
    remaining,
  })
}
