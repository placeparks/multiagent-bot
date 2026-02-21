import { prisma } from '@/lib/prisma'
import { RailwayClient } from '@/lib/railway/client'

type InstanceLike = {
  id: string
  accessUrl: string | null
  serviceUrl: string | null
  containerId: string | null
}

function normalizeBase(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  return (trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`).replace(/\/$/, '')
}

async function probeCanvas(base: string, timeoutMs = 3500): Promise<boolean> {
  try {
    const res = await fetch(`${base}/canvas/__openclaw__/canvas/`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

async function getLatestRailwayUrl(serviceId: string | null | undefined): Promise<string | null> {
  if (!serviceId) return null
  try {
    const railway = new RailwayClient()
    const deployment = await railway.getLatestDeployment(serviceId)
    return normalizeBase(deployment?.url ?? null)
  } catch {
    return null
  }
}

export async function resolveCanvasUpstream(instance: InstanceLike): Promise<{ baseUrl: string | null; isRunning: boolean }> {
  const candidateSet = new Set<string>()
  const accessBase = normalizeBase(instance.accessUrl)
  if (accessBase) candidateSet.add(accessBase)

  const latestRailwayBase = await getLatestRailwayUrl(instance.containerId)
  if (latestRailwayBase) candidateSet.add(latestRailwayBase)

  const serviceBase = normalizeBase(instance.serviceUrl)
  if (serviceBase && !serviceBase.includes('.railway.internal')) {
    candidateSet.add(serviceBase)
  }

  const candidates = Array.from(candidateSet)
  for (const base of candidates) {
    const ok = await probeCanvas(base)
    if (ok) {
      if (base !== accessBase) {
        // Best effort self-heal for stale/deleted Railway domains.
        try {
          await prisma.instance.update({
            where: { id: instance.id },
            data: { accessUrl: base },
          })
        } catch {
          // no-op
        }
      }
      return { baseUrl: base, isRunning: true }
    }
  }

  // Keep first candidate for diagnostics even if probe failed.
  return { baseUrl: candidates[0] ?? null, isRunning: false }
}

