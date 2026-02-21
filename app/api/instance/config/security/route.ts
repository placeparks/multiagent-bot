import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applySecurityUpdate, SecurityConfigUpdate } from '@/lib/deploy/config-updater'
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

    const body: SecurityConfigUpdate = await req.json()

    if (body.dmPolicy && !['open', 'closed', 'pairing'].includes(body.dmPolicy)) {
      return NextResponse.json({ error: 'Invalid DM policy' }, { status: 400 })
    }

    if (body.sessionMode && !['per-sender', 'shared', 'group-isolated'].includes(body.sessionMode)) {
      return NextResponse.json({ error: 'Invalid session mode' }, { status: 400 })
    }

    await applySecurityUpdate(result.instance.id, body)

    return NextResponse.json({
      success: true,
      message: 'Security configuration updated. Instance is restarting...',
    })
  } catch (error: any) {
    console.error('Security config update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
