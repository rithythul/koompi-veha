import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { BoardLiveStatus } from '../types/api'

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
            queryClient.invalidateQueries({ queryKey: ['boards'] })
          } else if (data.type === 'BoardStatusUpdate') {
            // Merge into live-status cache
            queryClient.setQueryData<Record<string, BoardLiveStatus>>(
              ['boards', 'live-status'],
              (old) => {
                if (!old) return old
                return {
                  ...old,
                  [data.board_id]: {
                    connectivity: data.connectivity,
                    player_state: data.player_state,
                    current_item: data.current_item,
                    playlist_name: data.playlist_name,
                    system_metrics: data.system_metrics,
                    last_status_at: data.last_status_at,
                    volume: data.volume ?? 1,
                    is_muted: data.is_muted ?? false,
                    current_index: data.current_index ?? 0,
                    total_items: data.total_items ?? 0,
                    playback_speed: 1,
                    is_fullscreen: false,
                  },
                }
              },
            )
            queryClient.invalidateQueries({ queryKey: ['boards'] })
          } else if (data.type === 'ScreenshotUpdated') {
            // Invalidate screenshot meta and screenshots list for this board
            queryClient.invalidateQueries({
              queryKey: ['boards', data.board_id, 'screenshot-meta'],
            })
            queryClient.invalidateQueries({
              queryKey: ['boards', data.board_id, 'screenshots'],
            })
          } else if (data.type === 'AlertCreated') {
            // Invalidate alerts queries so Alerts page and count badge refresh
            queryClient.invalidateQueries({ queryKey: ['alerts'] })
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
