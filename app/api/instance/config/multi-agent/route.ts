import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applyNativeMultiAgentUpdate } from '@/lib/deploy/config-updater'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await getActiveInstance(session.user.email)
    if (!result?.instance) {
      return NextResponse.json({ error: 'No instance found' }, { status: 404 })
    }

    const body = await req.json()
    const enabled = !!body?.enabled
    const agents = Array.isArray(body?.agents) ? body.agents : []
    const normalized = agents
      .map((a: any) => ({
        id: String(a?.id || '').trim().toLowerCase(),
        name: String(a?.name || '').trim(),
        role: a?.role ? String(a.role).trim() : undefined,
        bindings: Array.isArray(a?.bindings)
          ? a.bindings
              .map((b: any) => ({
                channel: b?.channel ? String(b.channel).trim().toLowerCase() : undefined,
                accountId: b?.accountId ? String(b.accountId).trim() : undefined,
                peerId: b?.peerId ? String(b.peerId).trim() : undefined,
              }))
              .filter((b: any) => b.channel || b.accountId || b.peerId)
          : [],
      }))
      .filter((a: any) => a.id && a.name)

    await applyNativeMultiAgentUpdate(result.instance.id, {
      enabled,
      agents: normalized,
    })

    return NextResponse.json({
      success: true,
      message: 'Native multi-agent settings updated. Instance is restarting...',
    })
  } catch (error: any) {
    console.error('Multi-agent config update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

