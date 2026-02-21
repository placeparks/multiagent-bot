import { prisma } from '@/lib/prisma'
import { Plan } from '@prisma/client'

/** Per-plan agent limit */
export const AGENT_LIMITS: Record<Plan, number> = {
  MONTHLY: 3,
  YEARLY: 5,
}

export interface ActiveInstanceResult {
  user: {
    id: string
    email: string
    activeInstanceId: string | null
    subscription: {
      plan: Plan
      status: string
    } | null
  }
  instance: {
    id: string
    userId: string
    name: string
    status: string
    accessUrl: string | null
    serviceUrl: string | null
    containerId: string | null
    containerName: string
    port: number
    qrCode: string | null
    deployBackend: string
    configVersion: number
    lastConfigApply: Date | null
    createdAt: Date
    updatedAt: Date
    lastHealthCheck: Date | null
  } | null
}

/**
 * Resolves the "active" instance for a session user.
 *
 * Priority:
 *   1. user.activeInstanceId — if set and belongs to this user
 *   2. First instance by createdAt (oldest = primary)
 *   3. null — user has no instances yet
 */
export async function getActiveInstance(email: string): Promise<ActiveInstanceResult | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      subscription: {
        select: { plan: true, status: true }
      },
      instances: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!user) return null

  let instance: ActiveInstanceResult['instance'] = null

  if (user.instances.length > 0) {
    // Prefer the explicitly selected one
    const active = user.activeInstanceId
      ? user.instances.find(i => i.id === user.activeInstanceId)
      : null
    instance = active ?? user.instances[0]
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      activeInstanceId: user.activeInstanceId,
      subscription: user.subscription,
    },
    instance,
  }
}

/**
 * Returns all instances for a user (for the switcher UI / list endpoint).
 */
export async function getUserInstances(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      subscription: { select: { plan: true, status: true } },
      instances: {
        include: { config: { select: { agentName: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!user) return null
  return { user, instances: user.instances }
}

/**
 * How many more agents can this user deploy?
 * Returns 0 if at limit, -1 if no subscription.
 */
export function getRemainingAgentSlots(
  plan: Plan | null | undefined,
  currentCount: number
): number {
  if (!plan) return -1
  const limit = AGENT_LIMITS[plan] ?? 1
  return Math.max(0, limit - currentCount)
}
