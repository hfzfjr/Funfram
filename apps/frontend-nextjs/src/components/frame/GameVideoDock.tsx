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
      <aside className="w-[230px] min-w-[210px] flex flex-col gap-2.5 p-2.5 bg-transparent rounded-xl overflow-y-auto h-full">
        <div className="text-xs font-bold text-slate-600 uppercase tracking-[0.06em]">
          Live Cameras ({allParticipants.length})
        </div>
        {allParticipants.map((participant) => (
          <div
            key={participant.id}
            className="w-full aspect-[16/10] rounded-[10px] overflow-hidden bg-slate-900 shrink-0"
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
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
      className={`fixed z-[900] ${collapsed ? 'w-[132px]' : 'w-[176px]'} bg-slate-900/92 backdrop-blur-md border border-slate-400/35 rounded-[14px] p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.38)] touch-none cursor-grab select-none`}
    >
      <div
        className={`flex items-center justify-between ${collapsed ? 'mb-0' : 'mb-1.5'} px-1 text-slate-200 text-[0.7rem] font-bold`}
      >
        <span>⋮⋮ Cameras ({allParticipants.length})</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="bg-white/15 border-none rounded-md text-slate-50 px-1.5 py-0.5 text-[0.68rem] cursor-pointer"
        >
          {collapsed ? 'Buka' : 'Mini'}
        </button>
      </div>

      <div
        className={`${collapsed ? 'hidden' : 'grid'} ${allParticipants.length > 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5`}
      >
        {allParticipants.map((participant) => (
          <div
            key={participant.id}
            className="w-full aspect-[4/3] rounded-lg overflow-hidden bg-slate-950"
          >
            <VideoTile participant={participant} />
          </div>
        ))}
      </div>
    </div>
  );
}
