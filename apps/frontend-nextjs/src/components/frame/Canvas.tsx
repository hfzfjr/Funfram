import React, { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { CanvasEvent } from '@/types/game';

export interface CanvasProps {
  events: CanvasEvent[];
  isDrawer: boolean;
  isActive: boolean;
}

const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 540;
const BRUSH_COLOR = '#111827';
const BRUSH_SIZE = 5;

export default function Canvas({ events, isDrawer, isActive }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const [redoStack, setRedoStack] = useState<CanvasEvent[][]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: VIRTUAL_WIDTH, height: VIRTUAL_HEIGHT });

  const dispatchCanvasEvent = useCallStore((state) => state.dispatchCanvasEvent);
  const sessionId = useCallStore((state) => state.sessionId);

  // Clear redo stack when a new round starts (events reset to empty)
  useEffect(() => {
    if (events.length === 0) {
      setRedoStack([]);
    }
  }, [events.length]);

  // Keep canvas backing bitmap matched 1:1 to its visible white container on Desktop & Mobile
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        setCanvasSize({
          width: Math.round(rect.width * dpr),
          height: Math.round(rect.height * dpr),
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(VIRTUAL_WIDTH, ((event.clientX - rect.left) / rect.width) * VIRTUAL_WIDTH));
    const y = Math.max(0, Math.min(VIRTUAL_HEIGHT, ((event.clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT));
    return { x, y };
  };

  const drawEvent = (ctx: CanvasRenderingContext2D, event: CanvasEvent, w: number, h: number) => {
    const px = (event.x / VIRTUAL_WIDTH) * w;
    const py = (event.y / VIRTUAL_HEIGHT) * h;
    const scale = Math.min(w / VIRTUAL_WIDTH, h / VIRTUAL_HEIGHT);

    if (event.type === 'start') {
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = event.color || BRUSH_COLOR;
      ctx.lineWidth = Math.max(2, (event.brushSize || BRUSH_SIZE) * scale);
      ctx.moveTo(px, py);
      return;
    }

    if (event.type === 'move') {
      ctx.lineTo(px, py);
      ctx.stroke();
      return;
    }

    if (event.type === 'end') {
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.closePath();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    events.forEach((event) => drawEvent(ctx, event, canvas.width, canvas.height));
  }, [events, canvasSize]);

  const sendCanvasEvent = (event: CanvasEvent) => {
    if (!isDrawer || !isActive) return;
    dispatchCanvasEvent(event);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || !isActive) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    setRedoStack([]);
    sendCanvasEvent({
      type: 'start',
      ...getPoint(event),
      color: BRUSH_COLOR,
      brushSize: BRUSH_SIZE,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    sendCanvasEvent({
      type: 'move',
      ...getPoint(event),
    });
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    sendCanvasEvent({
      type: 'end',
      ...getPoint(event),
    });
  };

  const syncCanvasEvents = (nextEvents: CanvasEvent[]) => {
    useCallStore.getState().updateGameState({ canvasEvents: nextEvents });
    if (sessionId) {
      WebSocketService.getInstance().sendEvent('GAME_ACTION', {
        game: 'guess_drawing',
        action: 'SYNC_CANVAS',
        sessionId,
        events: nextEvents,
      });
    }
  };

  const handleUndo = () => {
    if (!isDrawer || !isActive || events.length === 0) return;
    let lastStartIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'start') {
        lastStartIdx = i;
        break;
      }
    }
    if (lastStartIdx === -1) return;

    const removedStroke = events.slice(lastStartIdx);
    const nextEvents = events.slice(0, lastStartIdx);
    setRedoStack((prev) => [...prev, removedStroke]);
    syncCanvasEvents(nextEvents);
  };

  const handleRedo = () => {
    if (!isDrawer || !isActive || redoStack.length === 0) return;
    const strokeToRestore = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    syncCanvasEvents([...events, ...strokeToRestore]);
  };

  const canUndo = isDrawer && isActive && events.length > 0;
  const canRedo = isDrawer && isActive && redoStack.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className={`block w-full h-full touch-none ${isDrawer && isActive ? 'cursor-crosshair' : 'cursor-default'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />

      {isDrawer && isActive && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900/80 hover:enabled:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold border-none cursor-pointer transition-opacity"
          >
            <span>↩</span>
            <span>Undo</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900/80 hover:enabled:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold border-none cursor-pointer transition-opacity"
          >
            <span>↪</span>
            <span>Redo</span>
          </button>
        </div>
      )}

      {!isDrawer && (
        <div className="absolute top-3 right-3 px-2.5 py-1.5 rounded-md bg-gray-900/80 text-white text-xs font-semibold pointer-events-none">
          Viewing
        </div>
      )}
      {isDrawer && !isActive && (
        <div className="absolute top-3 right-3 px-2.5 py-1.5 rounded-md bg-gray-900/80 text-white text-xs font-semibold pointer-events-none">
          Get ready
        </div>
      )}
    </div>
  );
}
