import { prisma } from '@/lib/prisma'

export interface NativeBindingRule {
  channel?: string
  accountId?: string
  peerId?: string
}

export interface NativeSpecialistAgent {
  id: string
  name: string
  role?: string
  bindings?: NativeBindingRule[]
}

export interface EnvVariableEntry {
  name: string
  valueEnc: string
  description?: string
}

export interface BotSaasMeta {
  nativeMultiAgent?: {
    enabled: boolean
    agents: NativeSpecialistAgent[]
  }
  envVars?: EnvVariableEntry[]
}

function parseMeta(fullConfig: any): BotSaasMeta {
  const meta = fullConfig?.__botSaasMeta
  if (!meta || typeof meta !== 'object') return {}
  return meta as BotSaasMeta
}

export async function getConfigMeta(instanceId: string): Promise<BotSaasMeta> {
  const row = await prisma.configuration.findUnique({
    where: { instanceId },
    select: { fullConfig: true },
  })
  return parseMeta((row?.fullConfig as any) ?? {})
}

export async function writeConfigMeta(instanceId: string, meta: BotSaasMeta): Promise<void> {
  const row = await prisma.configuration.findUnique({
    where: { instanceId },
    select: { fullConfig: true },
  })
  if (!row) throw new Error('Configuration not found')

  const full = (row.fullConfig as any) ?? {}
  await prisma.configuration.update({
    where: { instanceId },
    data: {
      fullConfig: {
        ...full,
        __botSaasMeta: meta,
      },
    },
  })
}

export function applyMetaToFullConfig(fullConfig: any, meta: BotSaasMeta): any {
  return {
    ...(fullConfig ?? {}),
    __botSaasMeta: meta,
  }
}

