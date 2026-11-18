'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import VideoTile from './VideoTile';

export default function GameVideoDock() {
  const leftParticipants = useCallStore((state) => state.leftParticipants);
  const rightParticipants = useCallStore((state) => state.rightParticipants);
  const allParticipants = [...leftParticipants, ...rightParticipants];

  const [isMobile, setIsMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState({ x: 12, y: 72 });
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 12, origY: 72 });

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (allParticipants.length === 0) return null;

  // Desktop: docked vertical camera column beside the game board
  if (!isMobile) {
    return (
      <aside
        style={{
          width: '230px',
          minWidth: '210px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '10px',
          background: 'rgba(15, 23, 42, 0.92)',
          borderRadius: '12px',
          overflowY: 'auto',
          height: '100%',
        }}
      >
        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#94A3B8',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Live Cameras ({allParticipants.length})
        </div>
        {allParticipants.map((participant) => (
          <div
            key={participant.id}
            style={{
              width: '100%',
              aspectRatio: '16 / 10',
              borderRadius: '10px',
              overflow: 'hidden',
              background: '#0F172A',
              flexShrink: 0,
            }}
          >
            <VideoTile participant={participant} />
          </div>
        ))}
      </aside>
    );
  }

  // Mobile: floating draggable Picture-in-Picture (WhatsApp style)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const maxX = Math.max(8, window.innerWidth - (collapsed ? 140 : 190));
    const maxY = Math.max(8, window.innerHeight - 180);
    setPos({
      x: Math.min(maxX, Math.max(8, dragRef.current.origX + dx)),
      y: Math.min(maxY, Math.max(8, dragRef.current.origY + dy)),
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.dragging) {
      dragRef.current.dragging = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        zIndex: 900,
        width: collapsed ? '132px' : '176px',
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        borderRadius: '14px',
        padding: '6px',
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.38)',
        touchAction: 'none',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: collapsed ? 0 : '6px',
          padding: '0 4px',
          color: '#E2E8F0',
          fontSize: '0.7rem',
          fontWeight: 700,
        }}
      >
        <span>⋮⋮ Cameras ({allParticipants.length})</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: 'rgba(255,255,255,0.14)',
            border: 'none',
            borderRadius: '6px',
            color: '#F8FAFC',
            padding: '2px 6px',
            fontSize: '0.68rem',
            cursor: 'pointer',
          }}
        >
          {collapsed ? 'Buka' : 'Mini'}
        </button>
      </div>

      <div
        style={{
          display: collapsed ? 'none' : 'grid',
          gridTemplateColumns: allParticipants.length > 2 ? '1fr 1fr' : '1fr',
          gap: '6px',
        }}
      >
        {allParticipants.map((participant) => (
          <div
            key={participant.id}
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              borderRadius: '8px',
              overflow: 'hidden',
              background: '#020617',
            }}
          >
            <VideoTile participant={participant} />
          </div>
        ))}
      </div>
    </div>
  );
}
