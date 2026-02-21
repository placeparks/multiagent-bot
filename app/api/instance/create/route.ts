import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getProvider } from '@/lib/deploy'
import { loadConfigFromDB } from '@/lib/deploy/config-updater'
import { encrypt } from '@/lib/utils/encryption'
import { getDefaultModel } from '@/lib/models'
import { getUserInstances, AGENT_LIMITS, getRemainingAgentSlots } from '@/lib/get-active-instance'
import { AIProvider, ChannelType, Plan } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/instance/create
 * Body: {
 *   name: string
 *   provider?: string          — AI provider id (e.g. "ANTHROPIC"). Defaults to copy from existing agent.
 *   apiKey?: string            — Plain-text key or masked ("sk-a...1234"). Masked → copy encrypted key from existing agent.
 *   model?: string             — Model id. Defaults to copy from existing agent.
 *   channels?: { type: string; config: Record<string, any> }[]
 *   webSearchEnabled?: boolean
 *   braveApiKey?: string
 *   browserEnabled?: boolean
 *   ttsEnabled?: boolean
 *   elevenlabsApiKey?: string
 *   canvasEnabled?: boolean
 *   cronEnabled?: boolean
 *   memoryEnabled?: boolean
 * }
 *
 * Deploys a new agent. Provider config can be supplied by the caller (wizard) or
 * copied from the user's primary agent. Enforces per-plan agent limits.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const name: string = (body.name ?? '').trim() || 'My Agent'

  // Optional wizard fields
  const reqProvider = body.provider as string | undefined
  const reqApiKey = body.apiKey as string | undefined
  const reqModel = body.model as string | undefined
  const reqChannels = body.channels as Array<{ type: string; config: Record<string, any> }> | undefined

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

  // Must have at least one existing agent to copy base provider config from
  if (instances.length === 0) {
    return NextResponse.json(
      { error: 'No existing agent found to copy provider config from. Complete initial setup first.' },
      { status: 400 }
    )
  }

  // Load provider config from the primary agent (for fallback values + encrypted key copy)
  const baseConfig = await loadConfigFromDB(instances[0].id)
  const baseConfigRow = await prisma.configuration.findUnique({
    where: { instanceId: instances[0].id },
  })
  if (!baseConfigRow) {
    return NextResponse.json({ error: 'Base configuration not found' }, { status: 500 })
  }

  // --- Resolve provider ---
  const validProviders = Object.values(AIProvider) as string[]
  const finalProvider: AIProvider =
    reqProvider && validProviders.includes(reqProvider)
      ? (reqProvider as AIProvider)
      : baseConfig.provider

  // --- Resolve API key ---
  // A masked key contains "..." (format: "sk-a...1234"). Treat it as "copy from existing agent".
  const isMasked = reqApiKey ? reqApiKey.includes('...') : true
  const finalApiKeyPlain: string = (!isMasked && reqApiKey) ? reqApiKey : baseConfig.apiKey
  const encryptedApiKey: string = (!isMasked && reqApiKey)
    ? encrypt(reqApiKey)
    : baseConfigRow.apiKey   // Already encrypted — reuse to avoid re-encrypt of same value

  // --- Resolve model ---
  const finalModel: string = reqModel || baseConfig.model || getDefaultModel(finalProvider)

  // --- Resolve channels (cast type string → ChannelType for type safety) ---
  const validChannelTypes = new Set<string>(Object.values(ChannelType))
  const channelsList: { type: ChannelType; config: Record<string, any> }[] =
    (reqChannels ?? [])
      .filter(ch => validChannelTypes.has(ch.type))
      .map(ch => ({ type: ch.type as ChannelType, config: ch.config ?? {} }))

  // --- Resolve skills ---
  const webSearchEnabled: boolean = body.webSearchEnabled ?? false
  const browserEnabled: boolean = body.browserEnabled ?? false
  const ttsEnabled: boolean = body.ttsEnabled ?? false
  const canvasEnabled: boolean = body.canvasEnabled ?? false
  const cronEnabled: boolean = body.cronEnabled ?? false
  const memoryEnabled: boolean = body.memoryEnabled ?? false
  const braveApiKey: string | undefined = body.braveApiKey || undefined
  const elevenlabsApiKey: string | undefined = body.elevenlabsApiKey || undefined

  // Build config for deployment (passed to the provider to generate OpenClaw config JSON)
  const newConfig = {
    ...baseConfig,
    agentName: name,
    provider: finalProvider,
    apiKey: finalApiKeyPlain,
    model: finalModel,
    systemPrompt: undefined,
    channels: channelsList,
    webSearchEnabled,
    browserEnabled,
    ttsEnabled,
    canvasEnabled,
    cronEnabled,
    memoryEnabled,
    braveApiKey: webSearchEnabled ? braveApiKey : undefined,
    elevenlabsApiKey: ttsEnabled ? elevenlabsApiKey : undefined,
  }

  try {
    const deployment = await getProvider().deploy(user.id, newConfig)

    // Save Configuration row (individual columns)
    const configRecord = await prisma.configuration.create({
      data: {
        instanceId: deployment.instanceId,
        provider: finalProvider,
        apiKey: encryptedApiKey,
        model: finalModel,
        agentName: name,
        thinkingMode: baseConfig.thinkingMode || 'high',
        sessionMode: baseConfig.sessionMode || 'per-sender',
        dmPolicy: baseConfig.dmPolicy || 'pairing',
        webSearchEnabled,
        browserEnabled,
        ttsEnabled,
        canvasEnabled,
        cronEnabled,
        memoryEnabled,
        braveApiKey: (webSearchEnabled && braveApiKey) ? encrypt(braveApiKey) : null,
        elevenlabsApiKey: (ttsEnabled && elevenlabsApiKey) ? encrypt(elevenlabsApiKey) : null,
        fullConfig: newConfig as any,
      },
    })

    // Save channels if provided (already filtered to valid ChannelType values)
    if (channelsList.length > 0) {
      await prisma.channel.createMany({
        data: channelsList.map(ch => ({
          configId: configRecord.id,
          type: ch.type,
          enabled: true,
          config: ch.config,
        })),
      })
    }

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
