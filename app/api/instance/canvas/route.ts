import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getConfigForDisplay } from '@/lib/deploy/config-updater'
import { getActiveInstance } from '@/lib/get-active-instance'

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
  if (canvasEnabled && result.instance.accessUrl) {
    const base = result.instance.accessUrl.replace(/\/$/, '')
    try {
      // Hit pairing server's /canvas proxy handler (PORT=18800, public URL)
      // which strips /canvas and forwards to the gateway at /__openclaw__/canvas/
      const res = await fetch(`${base}/canvas/__openclaw__/canvas/`, {
        signal: AbortSignal.timeout(3000),
      })
      isRunning = res.ok
    } catch {
      isRunning = false
    }
  }

  return NextResponse.json({ canvasEnabled, isRunning })
}
