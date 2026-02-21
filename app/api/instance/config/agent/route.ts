import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applyAgentUpdate, AgentConfigUpdate } from '@/lib/deploy/config-updater'
import { PROVIDERS } from '@/lib/models'
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

    const body: AgentConfigUpdate = await req.json()

    const validProviders = PROVIDERS.map(p => p.id)
    if (body.provider && !validProviders.includes(body.provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
    }

    if (body.thinkingMode && !['high', 'medium', 'low'].includes(body.thinkingMode)) {
      return NextResponse.json({ error: 'Invalid thinking mode' }, { status: 400 })
    }

    await applyAgentUpdate(result.instance.id, body)

    return NextResponse.json({
      success: true,
      message: 'Agent configuration updated. Instance is restarting...',
    })
  } catch (error: any) {
    console.error('Agent config update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
