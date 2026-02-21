import { prisma } from '@/lib/prisma'
import { getProvider } from './index'
import {
  generateOpenClawConfig,
  buildSystemPromptWithMemory,
  buildMemoryInstructions,
  buildAgentToAgentInstructions,
  buildNativeOrchestrationInstructions,
  buildEnvVariableInstructions,
  UserConfiguration,
} from '@/lib/openclaw/config-builder'
import { decrypt, encrypt } from '@/lib/utils/encryption'
import { AIProvider, ChannelType } from '@prisma/client'
import {
  BotSaasMeta,
  getConfigMeta,
  writeConfigMeta,
  applyMetaToFullConfig,
  NativeSpecialistAgent,
} from './config-meta'

/**
 * Reconstruct a UserConfiguration from the database Configuration + Channel records.
 * This is the inverse of what the Stripe webhook does when saving config.
 */
export async function loadConfigFromDB(instanceId: string): Promise<UserConfiguration> {
  const config = await prisma.configuration.findUnique({
    where: { instanceId },
    include: { channels: true },
  })

  if (!config) throw new Error('Configuration not found for instance')

  // Load agent-to-agent targets: instances this agent is linked to
  const links = await (prisma as any).agentLink.findMany({
    where: { sourceInstanceId: instanceId },
    include: {
      targetInstance: {
        select: {
          id: true,
          name: true,
          serviceUrl: true,
          config: { select: { gatewayToken: true, agentName: true } },
        },
      },
    },
  })

  const agentToAgentTargets = links
    .filter((l: any) => l.targetInstance?.serviceUrl && l.targetInstance?.config?.gatewayToken)
    .map((l: any) => ({
      id: l.targetInstance.id,
      name: l.targetInstance.config?.agentName || l.targetInstance.name || 'Agent',
      gatewayUrl: l.targetInstance.serviceUrl,
      token: l.targetInstance.config.gatewayToken,
      role: l.role || undefined,
    }))

  const fullConfig = (config.fullConfig as any) ?? {}
  const meta = (fullConfig.__botSaasMeta as BotSaasMeta | undefined) ?? {}
  const nativeMultiAgent = meta.nativeMultiAgent
    ? {
        enabled: !!meta.nativeMultiAgent.enabled,
        agents: (meta.nativeMultiAgent.agents ?? []).map((a: any) => ({
          id: String(a.id),
          name: String(a.name || a.id),
          role: a.role ? String(a.role) : undefined,
          bindings: Array.isArray(a.bindings) ? a.bindings : [],
        })),
      }
    : undefined
  const secretVariables = (meta.envVars ?? []).map(v => {
    try {
      return {
        name: v.name,
        value: decrypt(v.valueEnc),
        description: v.description || undefined,
      }
    } catch {
      return {
        name: v.name,
        value: '',
        description: v.description || undefined,
      }
    }
  })

  return {
    provider: config.provider,
    apiKey: decrypt(config.apiKey),
    model: config.model,
    channels: config.channels.map(ch => ({
      type: ch.type,
      config: ch.config as Record<string, any>,
    })),
    webSearchEnabled: config.webSearchEnabled,
    braveApiKey: config.braveApiKey ? decrypt(config.braveApiKey) : undefined,
    browserEnabled: config.browserEnabled,
    ttsEnabled: config.ttsEnabled,
    elevenlabsApiKey: config.elevenlabsApiKey ? decrypt(config.elevenlabsApiKey) : undefined,
    canvasEnabled: config.canvasEnabled,
    cronEnabled: config.cronEnabled,
    memoryEnabled: config.memoryEnabled,
    workspace: config.workspace || undefined,
    agentName: config.agentName || undefined,
    systemPrompt: config.systemPrompt || undefined,
    thinkingMode: config.thinkingMode,
    sessionMode: config.sessionMode,
    dmPolicy: config.dmPolicy,
    gatewayToken: (config as any).gatewayToken || undefined,
    agentToAgentTargets: agentToAgentTargets.length ? agentToAgentTargets : undefined,
    nativeMultiAgent,
    secretVariables: secretVariables.length ? secretVariables : undefined,
  }
}

/**
 * Get the current config for display in the settings UI.
 * API keys are masked for security.
 */
export async function getConfigForDisplay(instanceId: string) {
  const config = await prisma.configuration.findUnique({
    where: { instanceId },
    include: { channels: true },
  })

  if (!config) return null

  const maskKey = (key: string | null) => {
    if (!key) return null
    try {
      const decrypted = decrypt(key)
      if (decrypted.length <= 8) return '****'
      return decrypted.slice(0, 4) + '...' + decrypted.slice(-4)
    } catch {
      return '****'
    }
  }

  const fullConfig = (config.fullConfig as any) ?? {}
  const meta = (fullConfig.__botSaasMeta as BotSaasMeta | undefined) ?? {}
  const variables = (meta.envVars ?? []).map(v => ({
    name: v.name,
    value: '••••••••',
    hasValue: true,
    description: v.description || '',
  }))
  const nativeMultiAgent = {
    enabled: !!meta.nativeMultiAgent?.enabled,
    agents: (meta.nativeMultiAgent?.agents ?? []).map((a: any) => ({
      id: String(a.id),
      name: String(a.name || a.id),
      role: a.role ? String(a.role) : '',
      bindings: Array.isArray(a.bindings) ? a.bindings : [],
    })),
  }

  return {
    provider: config.provider,
    apiKey: maskKey(config.apiKey),
    model: config.model,
    channels: config.channels.map(ch => ({
      id: ch.id,
      type: ch.type,
      enabled: ch.enabled,
      config: ch.config as Record<string, any>,
      botUsername: ch.botUsername,
      phoneNumber: ch.phoneNumber,
      inviteLink: ch.inviteLink,
    })),
    webSearchEnabled: config.webSearchEnabled,
    braveApiKey: maskKey(config.braveApiKey),
    browserEnabled: config.browserEnabled,
    ttsEnabled: config.ttsEnabled,
    elevenlabsApiKey: maskKey(config.elevenlabsApiKey),
    canvasEnabled: config.canvasEnabled,
    cronEnabled: config.cronEnabled,
    memoryEnabled: config.memoryEnabled,
    workspace: config.workspace,
    agentName: config.agentName,
    systemPrompt: config.systemPrompt,
    thinkingMode: config.thinkingMode,
    sessionMode: config.sessionMode,
    dmPolicy: config.dmPolicy,
    nativeMultiAgent,
    variables,
  }
}

export interface AgentConfigUpdate {
  agentName?: string
  systemPrompt?: string
  provider?: AIProvider
  apiKey?: string // Only set if user provides new key
  model?: string
  thinkingMode?: string
}

export interface ChannelConfigUpdate {
  add?: { type: ChannelType; config: Record<string, any> }[]
  update?: { id: string; config: Record<string, any> }[]
  remove?: string[] // Channel IDs to remove
}

export interface SkillsConfigUpdate {
  webSearchEnabled?: boolean
  braveApiKey?: string
  browserEnabled?: boolean
  ttsEnabled?: boolean
  elevenlabsApiKey?: string
  canvasEnabled?: boolean
  cronEnabled?: boolean
  memoryEnabled?: boolean
}

export interface SecurityConfigUpdate {
  dmPolicy?: string
  sessionMode?: string
  // Per-channel allowlist updates are handled via channel config updates
}

/**
 * Apply agent configuration changes and redeploy.
 */
export async function applyAgentUpdate(instanceId: string, changes: AgentConfigUpdate) {
  const config = await prisma.configuration.findUnique({ where: { instanceId } })
  if (!config) throw new Error('Configuration not found')

  const updateData: any = {}
  if (changes.agentName !== undefined) updateData.agentName = changes.agentName
  if (changes.systemPrompt !== undefined) updateData.systemPrompt = changes.systemPrompt
  if (changes.provider !== undefined) updateData.provider = changes.provider
  if (changes.apiKey) updateData.apiKey = encrypt(changes.apiKey)
  if (changes.model !== undefined) updateData.model = changes.model
  if (changes.thinkingMode !== undefined) updateData.thinkingMode = changes.thinkingMode

  await prisma.configuration.update({ where: { instanceId }, data: updateData })

  // Rebuild full config and apply
  await rebuildAndApply(instanceId)

  await logConfigChange(instanceId, 'agent', 'update')
}

/**
 * Apply channel configuration changes and redeploy.
 */
export async function applyChannelUpdate(instanceId: string, changes: ChannelConfigUpdate) {
  const config = await prisma.configuration.findUnique({
    where: { instanceId },
    include: { channels: true },
  })
  if (!config) throw new Error('Configuration not found')

  // Remove channels
  if (changes.remove?.length) {
    await prisma.channel.deleteMany({
      where: { id: { in: changes.remove }, configId: config.id },
    })
  }

  // Update existing channels
  if (changes.update?.length) {
    for (const ch of changes.update) {
      await prisma.channel.update({
        where: { id: ch.id },
        data: { config: ch.config },
      })
    }
  }

  // Add new channels
  if (changes.add?.length) {
    await prisma.channel.createMany({
      data: changes.add.map(ch => ({
        configId: config.id,
        type: ch.type,
        enabled: true,
        config: ch.config,
      })),
    })
  }

  await rebuildAndApply(instanceId)

  await logConfigChange(instanceId, 'channels', 'update')
}

/**
 * Apply skills configuration changes and redeploy.
 */
export async function applySkillsUpdate(instanceId: string, changes: SkillsConfigUpdate) {
  const updateData: any = {}

  if (changes.webSearchEnabled !== undefined) updateData.webSearchEnabled = changes.webSearchEnabled
  if (changes.braveApiKey) updateData.braveApiKey = encrypt(changes.braveApiKey)
  if (changes.browserEnabled !== undefined) updateData.browserEnabled = changes.browserEnabled
  if (changes.ttsEnabled !== undefined) updateData.ttsEnabled = changes.ttsEnabled
  if (changes.elevenlabsApiKey) updateData.elevenlabsApiKey = encrypt(changes.elevenlabsApiKey)
  if (changes.canvasEnabled !== undefined) updateData.canvasEnabled = changes.canvasEnabled
  if (changes.cronEnabled !== undefined) updateData.cronEnabled = changes.cronEnabled
  if (changes.memoryEnabled !== undefined) updateData.memoryEnabled = changes.memoryEnabled

  await prisma.configuration.update({ where: { instanceId }, data: updateData })

  await rebuildAndApply(instanceId)

  await logConfigChange(instanceId, 'skills', 'update')
}

/**
 * Apply security configuration changes and redeploy.
 */
export async function applySecurityUpdate(instanceId: string, changes: SecurityConfigUpdate) {
  const updateData: any = {}
  if (changes.dmPolicy !== undefined) updateData.dmPolicy = changes.dmPolicy
  if (changes.sessionMode !== undefined) updateData.sessionMode = changes.sessionMode

  await prisma.configuration.update({ where: { instanceId }, data: updateData })

  await rebuildAndApply(instanceId)

  await logConfigChange(instanceId, 'security', 'update')
}

/**
 * Rebuild the full OpenClaw config from DB and push it to the running container.
 */
export async function rebuildAndApply(instanceId: string) {
  // Load current full config from DB
  const userConfig = await loadConfigFromDB(instanceId)

  const baseUrl = (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')

  // Inject Nexus Memory digest + API instructions into system prompt (if memory is enabled)
  if (userConfig.memoryEnabled) {
    try {
      const { buildMemoryDigest } = await import('@/lib/memory/processing/digest-builder')
      const { getOrCreateMemoryConfig } = await import('@/lib/memory')

      const [digest, memConfig] = await Promise.all([
        buildMemoryDigest(instanceId),
        getOrCreateMemoryConfig(instanceId),
      ])

      // Prepend digest (what the agent knows)
      if (digest) {
        userConfig.systemPrompt = buildSystemPromptWithMemory(userConfig.systemPrompt, digest)
        userConfig.memoryDigest = digest
      }

      // Append write instructions (how the agent updates memory)
      if (baseUrl && memConfig?.memoryApiKey) {
        const instructions = buildMemoryInstructions(instanceId, memConfig.memoryApiKey, baseUrl)
        userConfig.systemPrompt = userConfig.systemPrompt
          ? `${userConfig.systemPrompt}\n\n${instructions}`
          : instructions
      }
    } catch (err) {
      // Non-fatal — memory is best-effort
      console.warn('[Memory] Digest/instructions build skipped:', err)
    }
  }

  // Inject legacy cross-instance delegation instructions (if configured and native orchestration is off)
  if (!userConfig.nativeMultiAgent?.enabled && userConfig.agentToAgentTargets?.length && userConfig.gatewayToken) {
    try {
      const baseUrl = (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
      if (baseUrl) {
        const a2aInstructions = buildAgentToAgentInstructions(
          instanceId,
          userConfig.gatewayToken,
          userConfig.agentToAgentTargets,
          baseUrl
        )
        userConfig.systemPrompt = userConfig.systemPrompt
          ? `${userConfig.systemPrompt}\n\n${a2aInstructions}`
          : a2aInstructions
      }
    } catch (err) {
      console.warn('[A2A] Agent-to-agent instructions skipped:', err)
    }
  }

  // Inject native same-channel orchestration instructions.
  if (userConfig.nativeMultiAgent?.enabled && userConfig.nativeMultiAgent.agents?.length && userConfig.gatewayToken && baseUrl) {
    try {
      const orchestration = buildNativeOrchestrationInstructions(
        instanceId,
        userConfig.gatewayToken,
        userConfig.nativeMultiAgent.agents.map(a => ({ id: a.id, name: a.name, role: a.role })),
        baseUrl
      )
      userConfig.systemPrompt = userConfig.systemPrompt
        ? `${userConfig.systemPrompt}\n\n${orchestration}`
        : orchestration
    } catch (err) {
      console.warn('[Native Multi-Agent] Orchestration instructions skipped:', err)
    }
  }

  // Inject variable lookup instructions when user-saved API variables exist.
  if (userConfig.secretVariables?.length && baseUrl) {
    try {
      const { getOrCreateMemoryConfig } = await import('@/lib/memory')
      const memConfig = await getOrCreateMemoryConfig(instanceId)
      if (memConfig?.memoryApiKey) {
        const variableNames = userConfig.secretVariables.map(v => v.name)
        const envInstructions = buildEnvVariableInstructions(
          instanceId,
          memConfig.memoryApiKey,
          baseUrl,
          variableNames
        )
        userConfig.systemPrompt = userConfig.systemPrompt
          ? `${userConfig.systemPrompt}\n\n${envInstructions}`
          : envInstructions
      }
    } catch (err) {
      console.warn('[ENV] Variable instructions skipped:', err)
    }
  }

  // Regenerate OpenClaw config JSON
  const openclawConfig = generateOpenClawConfig(userConfig)

  // Update fullConfig in DB
  const meta = await getConfigMeta(instanceId)
  await prisma.configuration.update({
    where: { instanceId },
    data: { fullConfig: applyMetaToFullConfig(openclawConfig, meta) },
  })

  // Update instance metadata
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      updatedAt: new Date(),
    },
  })

  // Apply to running container via the provider
  const provider = getProvider()
  await provider.updateConfig(instanceId, userConfig)
}

export async function applyNativeMultiAgentUpdate(
  instanceId: string,
  payload: {
    enabled: boolean
    agents: NativeSpecialistAgent[]
  }
) {
  const meta = await getConfigMeta(instanceId)
  meta.nativeMultiAgent = {
    enabled: !!payload.enabled,
    agents: payload.agents ?? [],
  }
  await writeConfigMeta(instanceId, meta)
  await rebuildAndApply(instanceId)
  await logConfigChange(instanceId, 'native_multi_agent', 'update')
}

export async function applyVariableStoreUpdate(
  instanceId: string,
  payload: {
    variables: { name: string; value: string; description?: string }[]
  }
) {
  const normalized = (payload.variables ?? [])
    .map(v => ({
      name: String(v.name || '').trim(),
      value: String(v.value || '').trim(),
      description: v.description?.trim() || undefined,
    }))
    .filter(v => v.name && v.value)

  const meta = await getConfigMeta(instanceId)
  meta.envVars = normalized.map(v => ({
    name: v.name,
    valueEnc: encrypt(v.value),
    description: v.description,
  }))
  await writeConfigMeta(instanceId, meta)

  // Save an env doc into memory knowledge base so retrieval can ground API usage.
  try {
    const { storeDocument } = await import('@/lib/memory/stores/documents')
    await (prisma as any).knowledgeDocument.deleteMany({
      where: { instanceId, filename: '_env_variables.md' },
    })
    const docContent = [
      '# Environment Variables',
      '',
      ...normalized.map(v => `- ${v.name}=${v.value}${v.description ? `  # ${v.description}` : ''}`),
      '',
      'Use these values exactly when required by API calls.',
    ].join('\n')
    await storeDocument(instanceId, '_env_variables.md', 'text/markdown', docContent, Buffer.byteLength(docContent))
  } catch (err) {
    console.warn('[ENV] Failed to sync env variables into knowledge base:', err)
  }

  await rebuildAndApply(instanceId)
  await logConfigChange(instanceId, 'variables', 'update')
}

/**
 * Add, remove, or update the role on an agent-to-agent link, then redeploy.
 */
export async function applyConnectionsUpdate(
  sourceInstanceId: string,
  targetInstanceId: string,
  action: 'add' | 'remove' | 'update_role',
  role?: string
) {
  if (action === 'add') {
    await (prisma as any).agentLink.upsert({
      where: { sourceInstanceId_targetInstanceId: { sourceInstanceId, targetInstanceId } },
      create: { sourceInstanceId, targetInstanceId, id: require('crypto').randomUUID(), role: role ?? null },
      update: { role: role ?? null },
    })
  } else if (action === 'update_role') {
    await (prisma as any).agentLink.updateMany({
      where: { sourceInstanceId, targetInstanceId },
      data: { role: role ?? null },
    })
  } else {
    await (prisma as any).agentLink.deleteMany({
      where: { sourceInstanceId, targetInstanceId },
    })
  }

  await rebuildAndApply(sourceInstanceId)
  await logConfigChange(sourceInstanceId, 'connections', action)
}

/** Log a config change (best-effort — table may not exist until migration runs). */
async function logConfigChange(instanceId: string, field: string, action: string) {
  try {
    await (prisma as any).configChangeLog?.create?.({
      data: { instanceId, field, action, status: 'applied' },
    })
  } catch {
    // Table might not exist yet — log to deployment log instead
    await prisma.deploymentLog.create({
      data: { instanceId, action: 'CONFIG_UPDATE', status: 'SUCCESS', message: `Updated ${field}` },
    })
  }
}
