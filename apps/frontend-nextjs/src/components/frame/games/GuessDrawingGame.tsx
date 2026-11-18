'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { CanvasEvent } from '@/types/game';

interface CanvasProps {
  events: CanvasEvent[];
  isDrawer: boolean;
  isActive: boolean;
}

const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 540;
const BRUSH_COLOR = '#111827';
const BRUSH_SIZE = 5;

function DrawingCanvas({ events, isDrawer, isActive }: CanvasProps) {
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

function GuessInput({ onSubmit }: { onSubmit: (guess: string) => void }) {
  const [value, setValue] = useState('');
  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  };
  return (
    <form onSubmit={handle} className="w-full">
      <input
        type="text"
        placeholder="Enter guess..."
        value={value}
        onChange={e => setValue(e.target.value)}
        className="w-full px-4 py-3 rounded-lg bg-white border border-slate-300 focus:border-indigo-600 text-slate-900 text-base outline-none transition-colors"
      />
      <button
        type="submit"
        className="mt-2 w-full p-3 bg-indigo-600 hover:bg-indigo-700 text-white border-none rounded-lg font-bold cursor-pointer transition-colors"
      >
        Send
      </button>
    </form>
  );
}

function ScoreBoard({ scores, names = {} }: { scores: Record<string, number>; names?: Record<string, string> }) {
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return (
      <div className="p-3.5 bg-white/90 border border-slate-200/80 rounded-xl text-slate-600 text-sm">
        No scores yet.
      </div>
    );
  }
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return (
    <div className="p-3.5 bg-white/90 border border-slate-200/80 rounded-xl text-slate-900">
      <h3 className="m-0 mb-2 text-base font-bold text-slate-800">Scores</h3>
      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {sorted.map(([playerId, score]) => (
          <li key={playerId} className="flex justify-between py-1.5 border-b border-slate-200/70 last:border-b-0 text-sm">
            <span className="font-medium text-slate-700">{names[playerId] || 'Player'}</span>
            <span className="font-bold text-slate-900">{score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GuessDrawingGame() {
  const gameState = useCallStore(state => state.gameState);
  const submitGuess = useCallStore(state => state.submitGuess);
  const localUserId = useCallStore(state => state.localUser?.id);
  const leftParticipants = useCallStore(state => state.leftParticipants);
  const rightParticipants = useCallStore(state => state.rightParticipants);
  const sessionId = useCallStore(state => state.sessionId);

  const participants = useMemo(
    () => [...leftParticipants, ...rightParticipants],
    [leftParticipants, rightParticipants]
  );

  const [timer, setTimer] = useState<number>(0);
  const [showCorrect, setShowCorrect] = useState(false);

  useEffect(() => {
    if (!gameState) return;
    setTimer(gameState.timeRemaining);
  }, [gameState?.currentRound, gameState?.status, gameState?.timeRemaining]);

  useEffect(() => {
    if (!gameState) return;
    const interval = setInterval(() => {
      setTimer(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState?.currentRound, gameState?.status]);

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    let feedbackTimeout: number | null = null;
    const handleGuessFeedback = (payload: { correct?: boolean }) => {
      if (!payload.correct) return;
      setShowCorrect(true);
      if (feedbackTimeout !== null) {
        window.clearTimeout(feedbackTimeout);
      }
      feedbackTimeout = window.setTimeout(() => setShowCorrect(false), 1400);
    };

    ws.on('GUESS_FEEDBACK', handleGuessFeedback);
    return () => {
      ws.off('GUESS_FEEDBACK', handleGuessFeedback);
      if (feedbackTimeout !== null) {
        window.clearTimeout(feedbackTimeout);
      }
    };
  }, []);

  if (!gameState) {
    return <div className="flex-1 text-3xl text-center mt-8 font-semibold">Loading game...</div>;
  }

  const isDrawer = gameState.currentDrawerId === localUserId;
  const isDrawing = gameState.status === 'Drawing';
  const canGuess = isDrawing && !isDrawer;
  const wordLabel = isDrawer
    ? (gameState.currentWord || 'Waiting for word...')
    : (gameState.wordHint || 'Waiting for hint...');
  const playerNames = Object.fromEntries(participants.map((participant) => [participant.id, participant.name]));

  const handleStopGame = () => {
    if (!sessionId) return;
    WebSocketService.getInstance().sendEvent('GAME_STOP', { sessionId });
  };

  return (
    <>
      <div className="relative flex-[3] p-4 min-w-0">
        <DrawingCanvas events={gameState.canvasEvents} isDrawer={isDrawer} isActive={isDrawing} />
        {showCorrect && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg bg-green-600 text-white text-2xl font-extrabold animate-[popCorrect_1.4s_ease_both]">
            Correct!
          </div>
        )}
        {gameState.status === 'Finished' && (
          <div className="absolute inset-4 rounded-xl bg-slate-900/75 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 z-20 text-white gap-3">
            <span className="text-4xl">🏆</span>
            <h3 className="text-2xl font-extrabold m-0">Permainan Selesai!</h3>
            <p className="text-lg font-semibold text-amber-300 m-0">
              Pemenang: {gameState.winner || 'Belum ada pemenang'}
            </p>
            <p className="text-sm text-slate-300 m-0">
              Kembali ke layar video call utama dalam beberapa detik...
            </p>
          </div>
        )}
      </div>
      <div className="w-full md:w-[290px] md:flex-none md:self-start h-fit max-h-full bg-white/80 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-sm p-4 flex flex-col gap-3.5 overflow-y-auto">
        <div className="flex flex-col gap-1.5 p-3.5 border border-slate-200/80 rounded-xl bg-white/90">
          <span className="text-xs font-bold text-blue-500 uppercase tracking-wide">{gameState.status}</span>
          <strong className="text-slate-900 text-xl leading-tight break-words">{wordLabel}</strong>
          {gameState.status === 'Reveal' && gameState.currentWord && (
            <span className="text-amber-600 text-[0.95rem] font-medium">Answer: {gameState.currentWord}</span>
          )}
          {canGuess && (
            <div className="mt-2">
              <GuessInput onSubmit={submitGuess} />
            </div>
          )}
        </div>
        <ScoreBoard scores={gameState.score} names={playerNames} />
        <div className="text-lg font-bold text-center text-slate-800 py-0.5">
          {gameState.status === 'Countdown' ? `Starts in: ${gameState.drawTimer}s` : `Time left: ${timer}s`}
        </div>
        <button
          type="button"
          className="w-full border-none rounded-xl p-3 bg-[#93000A] hover:bg-red-700 text-white font-bold cursor-pointer transition-colors"
          onClick={handleStopGame}
        >
          Stop Game
        </button>
      </div>
    </>
  );
}
