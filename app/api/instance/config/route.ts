import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getConfigForDisplay } from '@/lib/deploy/config-updater'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — return current configuration (masked keys) for the settings UI. */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await getActiveInstance(session.user.email)
    if (!result?.instance) {
      return NextResponse.json({ error: 'No instance found' }, { status: 404 })
    }

    const config = await getConfigForDisplay(result.instance.id)
    if (!config) {
      return NextResponse.json({ error: 'No configuration found' }, { status: 404 })
    }

    return NextResponse.json({ config })
  } catch (error: any) {
    console.error('Get config error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
