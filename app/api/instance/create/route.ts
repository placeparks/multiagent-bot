import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getProvider } from '@/lib/deploy'
import { loadConfigFromDB } from '@/lib/deploy/config-updater'
import { encrypt } from '@/lib/utils/encryption'
import { getDefaultModel } from '@/lib/models'
import { getUserInstances, AGENT_LIMITS, getRemainingAgentSlots } from '@/lib/get-active-instance'
import { Plan } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/instance/create
 * Body: { name: string }
 *
 * Deploys a new agent for the authenticated user. Copies the AI provider config
 * from their first existing agent (channels start empty — user sets them in Settings).
 * Enforces per-plan agent limits.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const name: string = (body.name ?? '').trim() || 'My Agent'

  const result = await getUserInstances(session.user.email)
  if (!result) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { user, instances } = result
  const plan = user.subscription?.plan as Plan | null
  const subStatus = user.subscription?.status

  // Must have an active subscription
  if (!plan || subStatus !== 'ACTIVE') {
    return NextResponse.json({ error: 'Active subscription required' }, { status: 403 })
  }

  // Enforce plan limit
  const remaining = getRemainingAgentSlots(plan, instances.length)
  if (remaining <= 0) {
    const limit = AGENT_LIMITS[plan]
    return NextResponse.json(
      { error: `Agent limit reached. Your ${plan} plan allows up to ${limit} agents.` },
      { status: 403 }
    )
  }

  // Must have at least one existing agent to copy provider config from
  if (instances.length === 0) {
    return NextResponse.json(
      { error: 'No existing agent found to copy provider config from. Complete initial setup first.' },
      { status: 400 }
    )
  }

  // Load provider config from the first (primary) agent — skip channels
  const baseConfig = await loadConfigFromDB(instances[0].id)
  const newConfig = {
    ...baseConfig,
    agentName: name,
    systemPrompt: undefined,
    channels: [], // user configures channels after creation
    canvasEnabled: false,
    cronEnabled: false,
    memoryEnabled: false,
    webSearchEnabled: false,
    ttsEnabled: false,
    browserEnabled: false,
  }

  try {
    const deployment = await getProvider().deploy(user.id, newConfig)

    // Save configuration
    const encryptedApiKey = encrypt(newConfig.apiKey)
    await prisma.configuration.create({
      data: {
        instanceId: deployment.instanceId,
        provider: newConfig.provider,
        apiKey: encryptedApiKey,
        model: newConfig.model || getDefaultModel(newConfig.provider),
        agentName: name,
        thinkingMode: newConfig.thinkingMode || 'high',
        sessionMode: newConfig.sessionMode || 'per-sender',
        dmPolicy: newConfig.dmPolicy || 'pairing',
        fullConfig: newConfig as any,
      },
    })

    // Update the instance name
    await prisma.instance.update({
      where: { id: deployment.instanceId },
      data: { name },
    })

    // Auto-select the new agent
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstanceId: deployment.instanceId },
    })

    return NextResponse.json({
      success: true,
      instanceId: deployment.instanceId,
      name,
    })
  } catch (err: any) {
    console.error('Create agent error:', err)
    return NextResponse.json({ error: err.message || 'Deployment failed' }, { status: 500 })
  }
}
