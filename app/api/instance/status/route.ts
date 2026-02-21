import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getProvider } from '@/lib/deploy'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await getActiveInstance(session.user.email)
    if (!result) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { user, instance } = result

    if (!instance) {
      return NextResponse.json({
        hasInstance: false,
        subscription: user.subscription,
      })
    }

    // Check instance health
    const isHealthy = await getProvider().checkHealth(instance.id)

    // Fetch usage stats from pairing server (best-effort)
    let stats = null
    try {
      if (instance.accessUrl) {
        const statsUrl = `${instance.accessUrl}/stats`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(statsUrl, { signal: controller.signal })
        clearTimeout(timeout)
        if (res.ok) stats = await res.json()
      }
    } catch (err) {
      console.warn('Stats fetch failed (non-fatal):', err)
    }

    // Load channel list from DB
    const { prisma } = await import('@/lib/prisma')
    const config = await prisma.configuration.findUnique({
      where: { instanceId: instance.id },
      include: { channels: true },
    })

    return NextResponse.json({
      hasInstance: true,
      instance: {
        id: instance.id,
        name: instance.name,
        status: instance.status,
        port: instance.port,
        accessUrl: instance.accessUrl,
        qrCode: instance.qrCode,
        lastHealthCheck: instance.lastHealthCheck,
        isHealthy,
        channels: config?.channels || [],
        stats,
      },
      subscription: user.subscription,
    })
  } catch (error: any) {
    console.error('Status check error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
