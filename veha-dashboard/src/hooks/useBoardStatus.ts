import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Connects to the /ws/dashboard WebSocket endpoint and invalidates
 * the ['boards'] react-query cache whenever a BoardStatusChange message
 * is received. Auto-reconnects on close with exponential backoff.
 */
export function useBoardStatus() {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const backoffMs = useRef(1000)
  const unmounted = useRef(false)

  useEffect(() => {
    unmounted.current = false

    function connect() {
      if (unmounted.current) return

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${window.location.host}/ws/dashboard`

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        // Reset backoff on successful connection
        backoffMs.current = 1000
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'BoardStatusChange') {
            // Invalidate all board queries so Dashboard and Boards pages refresh
            queryClient.invalidateQueries({ queryKey: ['boards'] })
          }
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (!unmounted.current) {
          // Reconnect with exponential backoff (max 30s)
          reconnectTimer.current = setTimeout(() => {
            backoffMs.current = Math.min(backoffMs.current * 2, 30000)
            connect()
          }, backoffMs.current)
        }
      }

      ws.onerror = () => {
        // onclose will fire after onerror, triggering reconnect
        ws.close()
      }
    }

    connect()

    return () => {
      unmounted.current = true
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [queryClient])
}
