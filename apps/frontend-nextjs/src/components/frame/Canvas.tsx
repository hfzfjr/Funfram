import React, { useEffect, useRef } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { CanvasEvent } from '@/types/game';
import styles from './Canvas.module.css';

export interface CanvasProps {
  events: CanvasEvent[];
  isDrawer: boolean;
  isActive: boolean;
}

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const BRUSH_COLOR = '#111827';
const BRUSH_SIZE = 5;

export default function Canvas({ events, isDrawer, isActive }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const dispatchCanvasEvent = useCallStore((state) => state.dispatchCanvasEvent);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  const drawEvent = (ctx: CanvasRenderingContext2D, event: CanvasEvent) => {
    if (event.type === 'start') {
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = event.color || BRUSH_COLOR;
      ctx.lineWidth = event.brushSize || BRUSH_SIZE;
      ctx.moveTo(event.x, event.y);
      return;
    }

    if (event.type === 'move') {
      ctx.lineTo(event.x, event.y);
      ctx.stroke();
      return;
    }

    if (event.type === 'end') {
      ctx.lineTo(event.x, event.y);
      ctx.stroke();
      ctx.closePath();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    events.forEach((event) => drawEvent(ctx, event));
  }, [events]);

  const sendCanvasEvent = (event: CanvasEvent) => {
    if (!isDrawer || !isActive) return;
    dispatchCanvasEvent(event);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || !isActive) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
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

  return (
    <div className={styles.canvasShell}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={styles.canvas}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />
      {!isDrawer && <div className={styles.badge}>Viewing</div>}
      {isDrawer && !isActive && <div className={styles.badge}>Get ready</div>}
    </div>
  );
}
