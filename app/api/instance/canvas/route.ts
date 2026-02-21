import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getConfigForDisplay } from '@/lib/deploy/config-updater'
import { getActiveInstance } from '@/lib/get-active-instance'
import { resolveCanvasUpstream } from '@/lib/canvas/resolve-upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await getActiveInstance(session.user.email)
  if (!result?.instance) {
    return NextResponse.json({ error: 'No instance found' }, { status: 404 })
  }

  const config = await getConfigForDisplay(result.instance.id)
  const canvasEnabled = config?.canvasEnabled ?? false

  let isRunning = false
  if (canvasEnabled) {
    const resolved = await resolveCanvasUpstream(result.instance)
    isRunning = resolved.isRunning
  }

  return NextResponse.json({ canvasEnabled, isRunning })
}
