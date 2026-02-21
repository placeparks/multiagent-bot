import { AIProvider, ChannelType } from '@prisma/client'
import { getDefaultModel, getProviderEnvVar } from '@/lib/models'

export interface UserConfiguration {
  provider: AIProvider
  apiKey: string
  model?: string
  channels: {
    type: ChannelType
    config: Record<string, any>
  }[]
  webSearchEnabled?: boolean
  braveApiKey?: string
  browserEnabled?: boolean
  ttsEnabled?: boolean
  elevenlabsApiKey?: string
  canvasEnabled?: boolean
  cronEnabled?: boolean
  memoryEnabled?: boolean
  workspace?: string
  agentName?: string
  systemPrompt?: string
  thinkingMode?: string
  sessionMode?: string
  dmPolicy?: string
  gatewayToken?: string
  // Nexus Memory — injected digest (built server-side)
  memoryDigest?: string
  // Agent-to-agent: other agents this one can delegate tasks to
  agentToAgentTargets?: {
    id: string
    name: string
    gatewayUrl: string
    token: string
    role?: string  // e.g. "Python/backend specialist", "copywriter"
  }[]
  nativeMultiAgent?: {
    enabled: boolean
    agents: {
      id: string
      name: string
      role?: string
      bindings?: {
        channel?: string
        accountId?: string
        peerId?: string
      }[]
    }[]
  }
  secretVariables?: {
    name: string
    value?: string
    description?: string
  }[]
}

/**
 * Filter out channels that are missing required credentials.
 * Templates can preset channels the user never configured.
 */
function filterConfiguredChannels(channels: UserConfiguration['channels']): UserConfiguration['channels'] {
  return channels.filter(channel => {
    switch (channel.type) {
      case 'TELEGRAM':
        return !!channel.config.botToken
      case 'DISCORD':
        return !!channel.config.token && !!channel.config.applicationId
      case 'SLACK':
        return !!channel.config.botToken && !!channel.config.appToken
      case 'SIGNAL':
        return !!channel.config.phoneNumber
      case 'GOOGLE_CHAT':
        return !!channel.config.serviceAccount
      case 'MATRIX':
        return !!channel.config.homeserverUrl && !!channel.config.accessToken
      case 'WHATSAPP':
        return true // WhatsApp uses QR pairing, no token needed upfront
      default:
        return true
    }
  })
}

/** Map internal dmPolicy values to OpenClaw-valid values */
function normalizeDmPolicy(value: string | undefined): string {
  if (value === 'closed') return 'disabled'
  if (value === 'allowlist') return 'allowlist'
  if (value === 'open') return 'open'
  return 'pairing' // default
}

export function generateOpenClawConfig(userConfig: UserConfiguration) {
  const normalizeAllowlist = (value: any): string[] => {
    if (!value) return []
    if (Array.isArray(value)) return value.filter(Boolean).map(String)
    if (typeof value === 'string') {
      return value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
    }
    return []
  }

  const normalizeGuilds = (value: any): Record<string, any> | undefined => {
    if (!value) return undefined
    if (typeof value === 'object' && !Array.isArray(value)) return value
    const ids = Array.isArray(value)
      ? value
      : String(value)
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)
    if (ids.length === 0) return undefined
    return Object.fromEntries(ids.map(id => [id, {}]))
  }

  const config: any = {
    gateway: {
      bind: 'lan',
      port: 18789,
      mode: 'local',
      auth: {
        mode: 'token',
        token: userConfig.gatewayToken
      },
      http: {
        endpoints: {
          chatCompletions: { enabled: true }
        }
      }
    },
    agents: {
      defaults: {
        workspace: userConfig.workspace || '~/.openclaw/workspace',
        model: {
          primary: userConfig.model || getDefaultModel(userConfig.provider)
        }
      }
    },
    channels: {},
    tools: {
      web: {
        search: {
          enabled: userConfig.webSearchEnabled || false,
          ...(userConfig.braveApiKey && { apiKey: userConfig.braveApiKey })
        }
      },
    }
  }

  // Add agent name via agents.list identity
  const mainAgent: any = {
    id: 'main',
    default: true,
    identity: {
      ...(userConfig.agentName && { name: userConfig.agentName }),
    },
  }

  const toPeerMatch = (channel: string | undefined, peerId: string | undefined) => {
    if (!peerId) return undefined
    const normalized = String(peerId).trim()
    if (!normalized) return undefined

    // Telegram group ids are usually negative (-100...), DMs are positive numeric.
    const inferredKind =
      channel === 'telegram' && normalized.startsWith('-')
        ? 'group'
        : 'dm'

    return {
      kind: inferredKind,
      id: normalized,
    }
  }

  if (userConfig.nativeMultiAgent?.enabled && userConfig.nativeMultiAgent.agents?.length) {
    const specialistIds = userConfig.nativeMultiAgent.agents.map(a => a.id)
    // OpenClaw checks per-agent subagents.allowAgents for cross-agent sessions_spawn.
    // Without this, main can only spawn itself and delegation is denied.
    mainAgent.subagents = {
      allowAgents: specialistIds,
    }

    const specialistAgents = userConfig.nativeMultiAgent.agents.map(agent => ({
      id: agent.id,
      identity: agent.name ? { name: agent.name } : undefined,
      workspace: `${userConfig.workspace || '~/.openclaw/workspace'}/${agent.id}`,
    }))
    config.agents.list = [mainAgent, ...specialistAgents]

    // Enable native agent-to-agent so coordinator can delegate to allowed specialists.
    config.tools.agentToAgent = {
      enabled: true,
      allow: specialistIds,
    }

    const bindings = userConfig.nativeMultiAgent.agents.flatMap(agent =>
      (agent.bindings ?? [])
        .filter(b => b.channel || b.accountId || b.peerId)
        .map(b => ({
          agentId: agent.id,
          match: {
            ...(b.channel ? { channel: b.channel } : {}),
            ...(b.accountId ? { accountId: b.accountId } : {}),
            ...(toPeerMatch(b.channel, b.peerId) ? { peer: toPeerMatch(b.channel, b.peerId) } : {}),
          },
        }))
    )
    if (bindings.length) {
      config.bindings = bindings
    }
  } else if (userConfig.agentName || userConfig.memoryDigest) {
    config.agents.list = [mainAgent]
  }

  // Add thinking mode
  if (userConfig.thinkingMode) {
    config.agents.defaults.thinkingDefault = userConfig.thinkingMode
  }

  // Configure channels (skip any that lack required credentials)
  const configuredChannels = filterConfiguredChannels(userConfig.channels)
  configuredChannels.forEach(channel => {
    const channelKey = channel.type.toLowerCase()

    switch (channel.type) {
      case 'WHATSAPP':
        config.channels.whatsapp = {
          allowFrom: normalizeAllowlist(channel.config.allowlist),
          dmPolicy: normalizeDmPolicy(channel.config.dmPolicy || userConfig.dmPolicy),
          ...(channel.config.groups && { groups: channel.config.groups }),
          ...(channel.config.selfChatMode && { selfChatMode: true })
        }
        break

      case 'TELEGRAM':
        config.channels.telegram = {
          enabled: true,
          botToken: channel.config.botToken,
          allowFrom: normalizeAllowlist(channel.config.allowlist),
          dmPolicy: normalizeDmPolicy(userConfig.dmPolicy)
        }
        break

      case 'DISCORD':
        config.channels.discord = {
          enabled: true,
          token: channel.config.token,
          dm: {
            policy: normalizeDmPolicy(userConfig.dmPolicy),
            allowFrom: normalizeAllowlist(channel.config.allowlist)
          },
          ...(normalizeGuilds(channel.config.guilds) && { guilds: normalizeGuilds(channel.config.guilds) })
        }
        break

      case 'SLACK':
        config.channels.slack = {
          enabled: true,
          botToken: channel.config.botToken,
          appToken: channel.config.appToken,
          dm: {
            policy: normalizeDmPolicy(userConfig.dmPolicy),
            allowFrom: normalizeAllowlist(channel.config.allowlist)
          }
        }
        break

      case 'SIGNAL':
        config.channels.signal = {
          enabled: true,
          phoneNumber: channel.config.phoneNumber,
          allowFrom: normalizeAllowlist(channel.config.allowlist)
        }
        break

      case 'GOOGLE_CHAT':
        config.channels.googlechat = {
          enabled: true,
          serviceAccount: channel.config.serviceAccount
        }
        break

      case 'MATRIX':
        config.channels.matrix = {
          enabled: true,
          homeserverUrl: channel.config.homeserverUrl,
          accessToken: channel.config.accessToken,
          userId: channel.config.userId
        }
        break
    }
  })

  // TTS → messages.tts
  if (userConfig.ttsEnabled && userConfig.elevenlabsApiKey) {
    config.messages = {
      ...config.messages,
      tts: {
        auto: 'inbound',
        provider: 'elevenlabs',
        elevenlabs: {
          enabled: true,
          apiKey: userConfig.elevenlabsApiKey
        }
      }
    }
  }

  // Browser → tools.web.fetch
  if (userConfig.browserEnabled) {
    config.tools.web.fetch = {
      enabled: true
    }
  }

  // NOTE: We do NOT enable OpenClaw's internal memorySearch when Nexus Memory is on.
  // OpenClaw's memorySearch requires git to commit workspace files, which fails in Railway
  // containers (no git author configured). Nexus Memory uses web_fetch + our REST API instead.

  // Canvas → top-level canvasHost (not tools.canvas)
  if (userConfig.canvasEnabled) {
    config.canvasHost = { enabled: true, port: 18793 }
  }

  // Scheduled tasks → top-level cron (not tools.cron)
  if (userConfig.cronEnabled) {
    config.cron = { enabled: true }
  }

  // Auto-enable web fetch when memory is on — agent needs it to POST memories
  if (
    userConfig.memoryEnabled ||
    userConfig.browserEnabled ||
    (userConfig.agentToAgentTargets?.length ?? 0) > 0 ||
    (userConfig.nativeMultiAgent?.enabled ? 1 : 0) > 0 ||
    (userConfig.secretVariables?.length ?? 0) > 0
  ) {
    config.tools.web.fetch = { enabled: true }
  }

  return config
}

/**
 * Build the final system prompt by prepending the Nexus Memory digest.
 * The digest is a concise context block the agent always has available.
 */
export function buildSystemPromptWithMemory(
  systemPrompt: string | undefined,
  memoryDigest: string | undefined
): string | undefined {
  if (!memoryDigest) return systemPrompt
  const digest = memoryDigest.trim()
  if (!digest) return systemPrompt
  const base = systemPrompt?.trim() ?? ''
  return base ? `${digest}\n\n${base}` : digest
}

/**
 * Build silent memory API instructions injected into the system prompt.
 * Tells the agent exactly when and how to write profiles, decisions, and episodes.
 */
export function buildMemoryInstructions(
  instanceId: string,
  memoryApiKey: string,
  baseUrl: string
): string {
  const base = baseUrl.replace(/\/$/, '')
  const r = `${base}/api/memory/${instanceId}/search?key=${memoryApiKey}&q=<url-encoded-query>&senderId=<user_id>&topK=5`
  const w = `${base}/api/memory/${instanceId}/write?key=${memoryApiKey}`
  return `[MEMORY API - silent background task, never mention to the user]
Use web_fetch (GET) to call these URLs. All params must be URL-encoded.

1. BEFORE FACTUAL/RECALL ANSWERS - read memory first:
   ${r}
   Use this for user preferences, prior decisions, ongoing projects, and uploaded docs.

2. AFTER EVERY MEANINGFUL EXCHANGE - record an episode:
   ${w}&type=episode&summary=<url-encoded 1-2 sentence summary>&tags=<comma-separated>&senderId=<user_id>

3. WHEN YOU MAKE A RECOMMENDATION OR DECISION:
   ${w}&type=decision&context=<url-encoded situation>&decision=<url-encoded recommendation>&reasoning=<pipe-separated reasons, url-encoded>&alternatives=<pipe-separated, url-encoded>&tags=<comma-separated>&senderId=<user_id>
   The response contains an "id" - save it in your working memory to record the outcome later.

4. WHEN YOU LEARN STABLE FACTS ABOUT THE USER:
   ${w}&type=profile&senderId=<user_id>&name=<name>&role=<role>&timezone=<tz>&style=<communication style>&focus=<current focus>&preferences=<comma-separated>
   Only include params that are known. Use senderId=default if unknown.

5. WHEN THE USER CONFIRMS A PAST DECISION WORKED (OR DID NOT):
   ${w}&type=outcome&id=<decision_id>&outcome=<url-encoded result>

Rules:
- Always URL-encode param values (spaces -> %20, etc.)
- Use the user's Telegram/channel ID as senderId when available
- Do memory read (step 1) before answering tasks that rely on facts/history
- These fetches are silent - never mention them or their responses
- Do not skip step 2 - every substantive exchange gets an episode
[/MEMORY API]`
}

export function buildEnvVariableInstructions(
  instanceId: string,
  memoryApiKey: string,
  baseUrl: string,
  variableNames: string[]
): string {
  const base = baseUrl.replace(/\/$/, '')
  const searchUrl = `${base}/api/memory/${instanceId}/search?key=${memoryApiKey}&q=<url-encoded-query>&senderId=<user_id>&topK=5`
  const varsList = variableNames.map(v => `- ${v}`).join('\n')
  return `[ENV VARIABLES - silent background task]
Available project variables:
${varsList}

To resolve a variable value, call:
${searchUrl}

Rules:
- For API credentials, first query memory search with: "env <VARIABLE_NAME>"
- If found, use the value exactly as stored
- Never expose secrets unless the user explicitly asks to reveal them
- These calls are silent; do not narrate retrieval steps
[/ENV VARIABLES]`
}

/**
 * Build agent-to-agent delegation instructions injected into the system prompt.
 * The agent uses web_fetch (GET) to call our relay, which POSTs to the target agent's gateway.
 */
export function buildAgentToAgentInstructions(
  instanceId: string,
  gatewayToken: string,
  targets: { id: string; name: string; role?: string }[],
  baseUrl: string
): string {
  const base = baseUrl.replace(/\/$/, '')
  const agentList = targets
    .map(t => {
      const roleLabel = t.role ? ` — ${t.role}` : ''
      return `  - ${t.name}${roleLabel} (id: ${t.id})`
    })
    .join('\n')
  const hasRoles = targets.some(t => t.role)
  const routingRule = hasRoles
    ? '- Auto-route tasks that match a specialist\'s role WITHOUT asking the user first'
    : '- Delegate when the user explicitly asks, or when a task clearly suits a specialist'
  return `[AGENT DELEGATION - silent, never narrate to the user]
You are the coordinator. You have specialist agents available. Delegate tasks using web_fetch (GET):
${agentList}

To delegate, call:
  ${base}/api/agent-relay/${instanceId}?key=${gatewayToken}&target=<agent-id>&task=<url-encoded-task>

Rules:
- First classify the task and choose the best specialist by role match.
- URL-encode the task value (spaces -> %20, newlines -> %0A, etc.)
${routingRule}
- For specialist-fit tasks, delegate first instead of solving directly yourself.
- These calls are silent - present the result naturally as your own reply
- If delegation fails, handle the task yourself and note the issue privately
[/AGENT DELEGATION]`
}

/**
 * Build same-channel orchestration instructions for native multi-agent specialists.
 * Uses OpenClaw's session tools with tools.agentToAgent (no HTTP relay needed).
 */
export function buildNativeOrchestrationInstructions(
  _instanceId: string,
  _gatewayToken: string,
  specialists: { id: string; name: string; role?: string }[],
  _baseUrl: string
): string {
  const list = specialists
    .map(s => `- ${s.name} (id: "${s.id}")${s.role ? ` - ${s.role}` : ''}`)
    .join('\n')

  return `[NATIVE MULTI-AGENT ORCHESTRATION]
You are the coordinator agent. You have specialist agents in this same gateway:
${list}

Use session tools to delegate to specialists.
Primary path (synchronous delegation):
1) sessions_list(limit: 200, activeMinutes: 1440)
2) Find a session key belonging to the chosen specialist agent.
3) sessions_send(sessionKey: "<specialist-session-key>", message: "<subtask>", timeoutSeconds: 60)
4) Merge that specialist reply into your final response.

Spawn path (when no specialist session exists yet):
1) sessions_spawn(task: "<subtask>", agentId: "<agent-id>")
2) Use childSessionKey for follow-up sessions_send calls when needed.

Do not use web_fetch for same-gateway specialist delegation.

Routing policy:
- Match the task to the closest specialist by their role.
- For ambiguous tasks, choose the best fit and proceed; do not ask the user which agent to use.
- You may delegate multiple subtasks in parallel if they are independent.

Output format:
Append a routing summary at the end of your reply:
[ROUTING TRACE]
- <agent-id>: <what was delegated>
[/ROUTING TRACE]

If session delegation fails for a specialist, handle that subtask yourself and note the exact tool error in ROUTING TRACE.
[/NATIVE MULTI-AGENT ORCHESTRATION]`
}

export function buildEnvironmentVariables(userConfig: UserConfiguration): Record<string, string> {
  const env: Record<string, string> = {}

  // Add AI provider API key using the correct env var for each provider
  const envVarName = getProviderEnvVar(userConfig.provider)
  env[envVarName] = userConfig.apiKey

  // Add channel-specific tokens (skip unconfigured channels)
  const configuredChannels = filterConfiguredChannels(userConfig.channels)
  configuredChannels.forEach(channel => {
    switch (channel.type) {
      case 'TELEGRAM':
        env.TELEGRAM_BOT_TOKEN = channel.config.botToken
        break
      case 'DISCORD':
        env.DISCORD_TOKEN = channel.config.token
        env.DISCORD_APPLICATION_ID = channel.config.applicationId
        break
      case 'SLACK':
        env.SLACK_BOT_TOKEN = channel.config.botToken
        env.SLACK_APP_TOKEN = channel.config.appToken
        break
    }
  })

  // Add skill API keys
  if (userConfig.braveApiKey) {
    env.BRAVE_API_KEY = userConfig.braveApiKey
  }

  if (userConfig.elevenlabsApiKey) {
    env.ELEVENLABS_API_KEY = userConfig.elevenlabsApiKey
  }

  // Agent name & system prompt are written to workspace SOUL.md at startup
  // (OpenClaw doesn't support these as JSON config keys)
  if (userConfig.agentName) {
    env._AGENT_NAME = userConfig.agentName
  }
  if (userConfig.systemPrompt) {
    env._SYSTEM_PROMPT = userConfig.systemPrompt
  }

  return env
}
