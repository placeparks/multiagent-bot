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

    const { searchParams } = new URL(req.url)
    const tail = parseInt(searchParams.get('tail') || '100')

    const result = await getActiveInstance(session.user.email)
    if (!result?.instance) {
      return NextResponse.json({ error: 'No instance found' }, { status: 404 })
    }

    const logs = await getProvider().getLogs(result.instance.id, tail)

    return NextResponse.json({ logs })
  } catch (error: any) {
    console.error('Get logs error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
