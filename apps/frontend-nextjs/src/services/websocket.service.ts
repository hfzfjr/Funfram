import { EventEmitter } from 'events';

/**
 * Production‑ready WebSocket service.
 * - Single instance (singleton) shared across the app.
 * - Uses NEXT_PUBLIC_WS_URL or defaults to ws://localhost:5001/socket.
 * - Reconnects only on `onclose` and respects a `shouldReconnect` flag.
 * - Prevents duplicate connections and multiple reconnect timers.
 * - Provides clear lifecycle logging.
 */
class WebSocketServiceClass {
  private static instance: WebSocketServiceClass;
  private ws: WebSocket | null = null;
  private emitter = new EventEmitter();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private url: string;

  private constructor() {
    // Resolve endpoint from env; fallback to default.
    this.url = typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_WS_GAME_URL
      ? process.env.NEXT_PUBLIC_WS_GAME_URL
      : 'ws://localhost:5001';
  }

  static getInstance(): WebSocketServiceClass {
    if (!WebSocketServiceClass.instance) {
      WebSocketServiceClass.instance = new WebSocketServiceClass();
    }
    return WebSocketServiceClass.instance;
  }

  /** Connect if not already connected or connecting. */
  connect(customUrl?: string) {
    const targetUrl = customUrl ?? this.url;
    // Guard against duplicate connections (CONNECTING or OPEN)
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.info('WebSocket already CONNECTING or OPEN – skipping new connect');
      return;
    }
    console.info('WebSocket connecting →', targetUrl);
    this.shouldReconnect = true; // reset flag on manual connect
    this.ws = new WebSocket(targetUrl);

    this.ws.onopen = () => {
      console.info('WebSocket connected');
      this.clearReconnectTimer();
    };

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const { event, payload } = data;
        this.emitter.emit(event, payload);
        console.debug('WebSocket message received', event, payload);
      } catch (_) {
        console.warn('Invalid WebSocket message format', (e as any).data);
      }
    };

    this.ws.onerror = (err) => {
      // Extract useful info from the Event object
      const e: any = err as any;
      const type = e.type || 'unknown';
      const url = e?.target?.url || 'unknown';
      console.warn('WebSocket error →', { type, url }, err);
      // Do NOT reconnect here – onclose will handle reconnection.
    };

    this.ws.onclose = (ev) => {
      console.info(`WebSocket closed (code ${ev.code}) – ${ev.reason || 'no reason provided'}`);
      this.ws = null;
      if (this.shouldReconnect) {
        console.info('Scheduling reconnection in 2 s');
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return; // already scheduled
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Send an event only when the socket is OPEN. */
  sendEvent(event: string, payload: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not ready – dropping event', event);
      return;
    }
    this.ws.send(JSON.stringify({ event, payload }));
    console.info('WebSocket sent', event);
  }

  /** Send immediately when open, or wait for the current connection to open. */
  sendWhenOpen(event: string, payload: any) {
    if (!this.ws) {
      this.connect();
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendEvent(event, payload);
      return;
    }

    this.ws?.addEventListener('open', () => {
      this.sendEvent(event, payload);
    }, { once: true });
  }

  /** Register a listener for a specific event. */
  on(event: string, handler: (payload: any) => void) {
    this.emitter.on(event, handler);
  }

  /** Deregister a listener. */
  off(event: string, handler: (payload: any) => void) {
    this.emitter.off(event, handler);
  }

  /** Manual disconnect – disables automatic reconnection. */
  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    console.info('WebSocket manually disconnected');
  }
}

export const WebSocketService = WebSocketServiceClass;
