'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, ChevronDown, Plus, CheckCircle, Circle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AgentInfo {
  id: string
  name: string
  status: string
  agentName: string | null
  isActive: boolean
}

interface AgentListData {
  activeInstanceId: string | null
  instances: AgentInfo[]
  plan: string | null
  limit: number
  remaining: number
}

export default function AgentSwitcher() {
  const router = useRouter()
  const [data, setData] = useState<AgentListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    fetch('/api/instance/list')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  async function switchAgent(instanceId: string) {
    if (switching) return
    setSwitching(true)
    try {
      await fetch('/api/instance/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId }),
      })
      // Reload the page so all dashboard data refreshes for the new agent
      router.refresh()
      window.location.reload()
    } finally {
      setSwitching(false)
    }
  }

  async function createAgent() {
    if (creating) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/instance/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAgentName.trim() || 'My Agent' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error || 'Failed to create agent')
        return
      }
      setShowNewDialog(false)
      setNewAgentName('')
      // New agent is auto-selected — reload to dashboard
      router.push('/dashboard/settings')
      window.location.href = '/dashboard/settings'
    } finally {
      setCreating(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="h-8 w-36 rounded bg-zinc-800/50 animate-pulse" />
    )
  }

  const active = data.instances.find(i => i.isActive)
  const displayName = active?.agentName || active?.name || 'My Agent'
  const statusColor =
    active?.status === 'RUNNING' ? 'bg-green-500' :
    active?.status === 'DEPLOYING' ? 'bg-yellow-500' :
    active?.status === 'ERROR' ? 'bg-red-500' : 'bg-zinc-500'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white gap-2 max-w-[200px]"
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
            <Bot className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
            <span className="truncate text-sm">{displayName}</span>
            {switching
              ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
              : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            }
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-56 bg-zinc-900 border-zinc-700 text-white"
        >
          <DropdownMenuLabel className="text-zinc-400 text-xs uppercase tracking-wider">
            Your Agents
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-zinc-700" />

          {data.instances.map(inst => {
            const label = inst.agentName || inst.name
            const color =
              inst.status === 'RUNNING' ? 'bg-green-500' :
              inst.status === 'DEPLOYING' ? 'bg-yellow-500' :
              inst.status === 'ERROR' ? 'bg-red-500' : 'bg-zinc-500'
            return (
              <DropdownMenuItem
                key={inst.id}
                onClick={() => !inst.isActive && switchAgent(inst.id)}
                className={`gap-2 cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 ${inst.isActive ? 'opacity-100' : 'opacity-70'}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                <span className="flex-1 truncate">{label}</span>
                {inst.isActive && <CheckCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
              </DropdownMenuItem>
            )
          })}

          {data.remaining > 0 && (
            <>
              <DropdownMenuSeparator className="bg-zinc-700" />
              <DropdownMenuItem
                onClick={() => setShowNewDialog(true)}
                className="gap-2 cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 text-red-400"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Agent</span>
                <span className="ml-auto text-xs text-zinc-500">{data.remaining} left</span>
              </DropdownMenuItem>
            </>
          )}

          {data.remaining === 0 && data.limit > 0 && (
            <>
              <DropdownMenuSeparator className="bg-zinc-700" />
              <DropdownMenuItem disabled className="gap-2 text-zinc-500 text-xs">
                Agent limit reached ({data.limit}/{data.limit})
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-red-400" />
              New Agent
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Deploy a new AI agent. It will copy your AI provider settings — configure
              channels and skills after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name" className="text-zinc-300">Agent Name</Label>
              <Input
                id="agent-name"
                placeholder="e.g. Support Bot"
                value={newAgentName}
                onChange={e => setNewAgentName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createAgent()}
                className="bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
                autoFocus
              />
            </div>
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewDialog(false)}
              className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={createAgent}
              disabled={creating}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                'Deploy Agent'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
