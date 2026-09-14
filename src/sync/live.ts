/**
 * WebSocket connection to a project's live room, with reconnection.
 * The store-facing logic (what to do with messages) lives in liveController.ts.
 */
import type { ClientMessage, ServerMessage } from '../model/collab'

export interface LiveHandlers {
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: 'connecting' | 'on' | 'off') => void
}

export class LiveConnection {
  private ws: WebSocket | null = null
  private closed = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly projectId: string,
    /** path of the WebSocket endpoint */
    readonly url: string,
    private handlers: LiveHandlers,
  ) {
    this.open()
  }

  private open() {
    if (this.closed) return
    this.handlers.onStatus('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${proto}://${location.host}${this.url}`)
    } catch {
      this.retry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.handlers.onStatus('on')
    }
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      try {
        this.handlers.onMessage(JSON.parse(e.data) as ServerMessage)
      } catch {
        // ignore malformed frames
      }
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      // 4004: the project is gone or no longer shared with us: do not hammer the server
      if (e.code === 4004) this.closed = true
      this.retry()
    }
    ws.onerror = () => {
      // onclose follows
    }
  }

  private retry() {
    if (this.closed) {
      this.handlers.onStatus('off')
      return
    }
    this.handlers.onStatus('connecting')
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt++, 4))
    this.timer = setTimeout(() => this.open(), delay)
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  send(msg: ClientMessage): boolean {
    if (!this.connected) return false
    this.ws!.send(JSON.stringify(msg))
    return true
  }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    const ws = this.ws
    this.ws = null
    ws?.close(1000, 'bye')
    this.handlers.onStatus('off')
  }
}
