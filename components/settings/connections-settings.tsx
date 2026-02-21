'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Bot, ArrowRight, Loader2, RefreshCw } from 'lucide-react'

interface AgentEntry {
  id: string
  name: string
  status: string
  linked: boolean
}

interface ConnectionsSettingsProps {
  onConfigChange: () => void
}

export function ConnectionsSettings({ onConfigChange }: ConnectionsSettingsProps) {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchAgents = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/instance/config/connections')
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
      setAgents(data.otherAgents)
    } catch (err: any) {
      setError(err.message || 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAgents()
  }, [])

  const toggle = async (agentId: string, currentlyLinked: boolean) => {
    setToggling(agentId)
    setError(null)
    try {
      const res = await fetch('/api/instance/config/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetInstanceId: agentId,
          action: currentlyLinked ? 'remove' : 'add',
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      // Optimistically update local state
      setAgents(prev =>
        prev.map(a => a.id === agentId ? { ...a, linked: !currentlyLinked } : a)
      )
      onConfigChange()
    } catch (err: any) {
      setError(err.message || 'Failed to update connection')
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-xs text-white/30 font-mono mt-1">
            Allow this agent to delegate tasks to other agents you own.
          </p>
        </div>
        <button
          onClick={fetchAgents}
          className="text-white/20 hover:text-white/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400 font-mono">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <Card className="border border-white/5 bg-white/[0.02] text-white">
          <CardContent className="py-10 text-center">
            <Bot className="w-8 h-8 text-white/10 mx-auto mb-3" />
            <p className="text-sm text-white/30 font-mono">No other agents found</p>
            <p className="text-xs text-white/15 font-mono mt-1">
              Deploy a second agent to enable agent-to-agent connections.
            </p>
          </CardContent>
        </Card>
      ) : (
        agents.map(agent => (
          <Card key={agent.id} className="border border-red-500/15 bg-white/[0.02] text-white overflow-hidden">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-all duration-300 ${
                    agent.linked
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}>
                    {toggling === agent.id ? (
                      <Loader2 className="h-4 w-4 text-white/40 animate-spin" />
                    ) : (
                      <Bot className={`h-4 w-4 ${agent.linked ? 'text-red-400' : 'text-white/30'}`} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{agent.name}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${
                        agent.status === 'RUNNING'
                          ? 'bg-green-500/10 text-green-400/70 border border-green-500/20'
                          : 'bg-white/5 text-white/20 border border-white/10'
                      }`}>
                        {agent.status.toLowerCase()}
                      </span>
                    </div>
                    {agent.linked && (
                      <p className="text-[10px] text-red-400/50 font-mono flex items-center gap-1 mt-0.5">
                        <ArrowRight className="w-2.5 h-2.5" />
                        Can receive delegated tasks
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  checked={agent.linked}
                  disabled={toggling === agent.id}
                  onCheckedChange={() => toggle(agent.id, agent.linked)}
                />
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <p className="text-[11px] text-white/15 font-mono text-center pt-1">
        Connections are one-directional. To let both agents call each other, enable from both sides.
      </p>
    </div>
  )
}
