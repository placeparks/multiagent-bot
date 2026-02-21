import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applyVariableStoreUpdate } from '@/lib/deploy/config-updater'
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
    const variables = Array.isArray(body?.variables) ? body.variables : []

    await applyVariableStoreUpdate(result.instance.id, { variables })

    return NextResponse.json({
      success: true,
      message: 'Variables updated. Instance is restarting...',
    })
  } catch (error: any) {
    console.error('Variables update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

