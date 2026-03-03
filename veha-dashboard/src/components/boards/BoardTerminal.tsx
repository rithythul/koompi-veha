import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { X, Circle, ChevronRight } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

interface BoardTerminalProps {
  boardId: string
  onClose: () => void
}

// Quick commands grouped by category — clicking types them into the shell
const QUICK_COMMANDS = [
  {
    label: 'Services',
    commands: [
      { name: 'Status', cmd: 'systemctl status veha-player veha-agent --no-pager' },
      { name: 'Restart Player', cmd: 'systemctl restart veha-player' },
      { name: 'Restart Agent', cmd: 'systemctl restart veha-agent && echo "Agent restarted (terminal will disconnect)"' },
      { name: 'Player Logs', cmd: 'journalctl -u veha-player -n 50 --no-pager' },
      { name: 'Agent Logs', cmd: 'journalctl -u veha-agent -n 50 --no-pager' },
      { name: 'Follow Logs', cmd: 'journalctl -u veha-player -f' },
    ],
  },
  {
    label: 'System',
    commands: [
      { name: 'Overview', cmd: 'echo "=== Uptime ===" && uptime && echo "\\n=== Memory ===" && free -h && echo "\\n=== Disk ===" && df -h / && echo "\\n=== CPU ===" && top -bn1 | head -5' },
      { name: 'Network', cmd: 'ip -br addr && echo "" && ip route | head -5' },
      { name: 'Processes', cmd: 'ps aux --sort=-%cpu | head -15' },
      { name: 'Temperature', cmd: 'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null || echo "N/A"' },
    ],
  },
  {
    label: 'Config',
    commands: [
      { name: 'Player Config', cmd: 'cat /etc/veha/veha-player.toml 2>/dev/null || cat ~/.config/veha/veha-player.toml 2>/dev/null || echo "Not found"' },
      { name: 'Agent Config', cmd: 'cat /etc/veha/veha-agent.toml 2>/dev/null || cat ~/.config/veha/veha-agent.toml 2>/dev/null || echo "Not found"' },
    ],
  },
]

export default function BoardTerminal({ boardId, onClose }: BoardTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [showQuickCmds, setShowQuickCmds] = useState(false)

  const sendMessage = useCallback((msg: object) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  // Type a command into the terminal (as if the admin typed it)
  const injectCommand = useCallback((cmd: string) => {
    sendMessage({ type: 'TerminalInput', data: btoa(cmd + '\n') })
    setShowQuickCmds(false)
    // Re-focus the terminal
    terminalRef.current?.focus()
  }, [sendMessage])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.ctrlKey) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!termRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#c9d1d9',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(termRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${window.location.host}/ws/terminal/${boardId}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    terminal.writeln('\x1b[90mConnecting to board...\x1b[0m')

    ws.onopen = () => {
      setStatus('connecting')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'TerminalReady':
            setStatus('connected')
            terminal.writeln('\x1b[32mConnected.\x1b[0m\r\n')
            sendMessage({
              type: 'TerminalResize',
              cols: terminal.cols,
              rows: terminal.rows,
            })
            break
          case 'TerminalOutput': {
            const bytes = atob(msg.data)
            terminal.write(bytes)
            break
          }
          case 'TerminalExit':
            setStatus('disconnected')
            terminal.writeln(
              `\r\n\x1b[90mSession ended${msg.code != null ? ` (exit code: ${msg.code})` : ''}.\x1b[0m`
            )
            if (msg.error) {
              terminal.writeln(`\x1b[31m${msg.error}\x1b[0m`)
            }
            break
        }
      } catch {
        // Ignore bad messages
      }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      terminal.writeln('\r\n\x1b[90mConnection closed.\x1b[0m')
    }

    ws.onerror = () => {
      setStatus('disconnected')
      terminal.writeln('\r\n\x1b[31mConnection error.\x1b[0m')
    }

    terminal.onData((data) => {
      sendMessage({ type: 'TerminalInput', data: btoa(data) })
    })

    terminal.onResize(({ cols, rows }) => {
      sendMessage({ type: 'TerminalResize', cols, rows })
    })

    const handleResize = () => { fitAddon.fit() }
    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(() => { fitAddon.fit() })
    resizeObserver.observe(termRef.current)

    terminal.focus()

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      ws.close()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      wsRef.current = null
    }
  }, [boardId, sendMessage])

  const statusColor = status === 'connected'
    ? 'text-green-400'
    : status === 'connecting'
      ? 'text-yellow-400'
      : 'text-red-400'

  const statusLabel = status === 'connected'
    ? 'Connected'
    : status === 'connecting'
      ? 'Connecting...'
      : 'Disconnected'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="flex flex-col rounded-xl overflow-hidden shadow-2xl border border-[#30363d]"
        style={{ width: '80vw', height: '80vh' }}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-[#30363d] select-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition-all"
                title="Close (Ctrl+Esc)"
              />
              <div className="w-3 h-3 rounded-full bg-[#febc2e] opacity-50" />
              <div className="w-3 h-3 rounded-full bg-[#28c840] opacity-50" />
            </div>
            <div className="flex items-center gap-2 ml-1">
              <Circle
                className={`w-2 h-2 fill-current ${statusColor} ${status === 'connecting' ? 'animate-pulse' : ''}`}
              />
              <span className="text-[13px] text-[#c9d1d9] font-medium font-mono tracking-tight">
                {boardId}
              </span>
              <span className={`text-[11px] ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQuickCmds(!showQuickCmds)}
              disabled={status !== 'connected'}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                showQuickCmds
                  ? 'bg-[#58a6ff]/20 text-[#58a6ff]'
                  : 'text-[#484f58] hover:text-[#c9d1d9] hover:bg-[#30363d]'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
              title="Quick commands"
            >
              Quick Commands
            </button>
            <span className="text-[11px] text-[#484f58]">Ctrl+Esc to close</span>
            <button
              onClick={onClose}
              className="p-1 rounded text-[#484f58] hover:text-[#c9d1d9] hover:bg-[#30363d] transition-colors"
              title="Close terminal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick commands dropdown */}
        {showQuickCmds && (
          <div className="bg-[#161b22] border-b border-[#30363d] px-4 py-2.5 flex gap-6 overflow-x-auto">
            {QUICK_COMMANDS.map((group) => (
              <div key={group.label} className="flex-shrink-0">
                <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1.5 font-medium">{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.commands.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => injectCommand(c.cmd)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d] transition-colors"
                      title={c.cmd}
                    >
                      <ChevronRight className="w-3 h-3 text-[#484f58]" />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Terminal body */}
        <div
          ref={termRef}
          className="flex-1 bg-[#0d1117]"
          style={{ padding: '8px 8px 4px' }}
        />

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-[#161b22] border-t border-[#30363d] text-[11px] text-[#484f58]">
          <span>
            {terminalRef.current
              ? `${terminalRef.current.cols}x${terminalRef.current.rows}`
              : '--'}
          </span>
          <span>SSH via WebSocket &middot; Full shell access</span>
        </div>
      </div>
    </div>
  )
}
