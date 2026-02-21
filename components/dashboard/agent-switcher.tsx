'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Bot, ChevronDown, Plus, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import NewAgentWizard from '@/components/dashboard/new-agent-wizard'

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

interface DropdownPos { top: number; left: number; width: number }

export default function AgentSwitcher() {
  const [data, setData] = useState<AgentListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null)
  const [switching, setSwitching] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [mounted, setMounted] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    fetch('/api/instance/list')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      const portalDropdown = document.getElementById('agent-switcher-dropdown')
      if (portalDropdown?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function openDropdown() {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 224),
    })
    setOpen(o => !o)
  }

  async function switchAgent(instanceId: string) {
    if (switching) return
    setSwitching(true)
    setOpen(false)
    try {
      await fetch('/api/instance/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId }),
      })
      window.location.reload()
    } finally {
      setSwitching(false)
    }
  }

  if (loading || !data) {
    return <div className="h-8 w-36 rounded bg-zinc-800/50 animate-pulse" />
  }

  const active = data.instances.find(i => i.isActive)
  const displayName = active?.agentName || active?.name || 'My Agent'
  const statusColor =
    active?.status === 'RUNNING' ? 'bg-green-500' :
    active?.status === 'DEPLOYING' ? 'bg-yellow-500' :
    active?.status === 'ERROR' ? 'bg-red-500' : 'bg-zinc-500'

  return (
    <>
      {/* Trigger button */}
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        onClick={openDropdown}
        className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white gap-2 max-w-[200px]"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
        <Bot className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
        <span className="truncate text-sm">{displayName}</span>
        {switching
          ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
          : <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
        }
      </Button>

      {/* Portal dropdown — rendered at document.body, escapes all stacking contexts */}
      {mounted && open && dropdownPos && createPortal(
        <div
          id="agent-switcher-dropdown"
          style={{
            position: 'absolute',
            top: dropdownPos.top,
            left: dropdownPos.left,
            minWidth: dropdownPos.width,
            zIndex: 999999,
          }}
          className="w-56 rounded-md border border-zinc-600 bg-zinc-800 shadow-2xl py-1"
        >
          <p className="px-3 py-1.5 text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
            Your Agents
          </p>
          <div className="border-t border-zinc-600 mb-1" />

          {data.instances.map(inst => {
            const label = inst.agentName || inst.name
            const color =
              inst.status === 'RUNNING' ? 'bg-green-500' :
              inst.status === 'DEPLOYING' ? 'bg-yellow-500' :
              inst.status === 'ERROR' ? 'bg-red-500' : 'bg-zinc-500'
            return (
              <button
                key={inst.id}
                onClick={() => !inst.isActive && switchAgent(inst.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 transition-colors ${inst.isActive ? 'text-white' : 'text-zinc-300'}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                <span className="flex-1 truncate">{label}</span>
                {inst.isActive && <CheckCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
              </button>
            )
          })}

          {data.remaining > 0 && (
            <>
              <div className="border-t border-zinc-600 mt-1 mb-1" />
              <button
                onClick={() => { setOpen(false); setShowWizard(true) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-zinc-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Agent</span>
                <span className="ml-auto text-xs text-zinc-400">{data.remaining} left</span>
              </button>
            </>
          )}

          {data.remaining === 0 && data.limit > 0 && (
            <>
              <div className="border-t border-zinc-600 mt-1" />
              <p className="px-3 py-2 text-xs text-zinc-400">
                Agent limit reached ({data.limit}/{data.limit})
              </p>
            </>
          )}
        </div>,
        document.body
      )}

      {/* New Agent Wizard — portal-rendered, handles its own overlay */}
      <NewAgentWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
      />
    </>
  )
}
