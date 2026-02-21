import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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
    if (!result?.instance?.accessUrl) {
      return NextResponse.json({ stats: null })
    }

    const statsUrl = `${result.instance.accessUrl}/stats`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(statsUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) return NextResponse.json({ stats: null })

    const stats = await res.json()
    return NextResponse.json({ stats })
  } catch (error: any) {
    console.error('Stats fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
