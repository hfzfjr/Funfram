'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';

// Simple 2-side Ludo: Red (Frame Kiri) vs Blue (Frame Kanan), 28-step outer loop + 4-step home stretch
const TRACK_LEN = 28;
const HOME_STRETCH = 4;
const FINISH_POS = TRACK_LEN + HOME_STRETCH; // 32 = finished
const SAFE_CELLS = new Set([0, 7, 14, 21]);

type LudoColor = 'red' | 'blue';

interface LudoState {
  tokens: Record<LudoColor, number[]>; // -1 = base, 0..27 = main track (relative to own start), 28..31 = home, 32 = done
  turn: LudoColor;
  dice: number | null;
  winner: LudoColor | null;
  message: string;
}

const INITIAL_LUDO: LudoState = {
  tokens: {
    red: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
  },
  turn: 'red',
  dice: null,
  winner: null,
  message: 'Giliran Merah melempar dadu!',
};

function toGlobalIndex(color: LudoColor, relPos: number): number {
  const offset = color === 'red' ? 0 : 14;
  return (relPos + offset) % TRACK_LEN;
}

// Map 28 outer cells onto a 9x9 perimeter grid for clean visual rendering
const OUTER_COORDS: [number, number][] = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8],
  [7, 8], [8, 8], [8, 7], [8, 6], [8, 5], [8, 4], [8, 3],
  [8, 2], [8, 1], [8, 0], [7, 0], [6, 0], [5, 0],
];

// Adjust coordinates into a closed 28-tile loop (8x8 perimeter = 28 tiles!)
const LOOP_COORDS: [number, number][] = [
  // Top row left->right (0..7)
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
  // Right col top->bottom (8..13)
  [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7],
  // Bottom row right->left (14..21)
  [7, 7], [7, 6], [7, 5], [7, 4], [7, 3], [7, 2], [7, 1], [7, 0],
  // Left col bottom->top (22..27)
  [6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [1, 0],
];

const RED_HOME_COORDS: [number, number][] = [[1, 1], [2, 2], [3, 3], [3, 4]];
const BLUE_HOME_COORDS: [number, number][] = [[6, 6], [5, 5], [4, 4], [4, 3]];

export default function LudoGame() {
  const sessionId = useCallStore((s) => s.sessionId);
  const localUser = useCallStore((s) => s.localUser);
  const localFrameRole = useCallStore((s) => s.localFrameRole);

  const [ludo, setLudo] = useState<LudoState>(INITIAL_LUDO);

  const myColor: LudoColor | null = useMemo(() => {
    if (!localUser) return null;
    return localFrameRole === 'A' ? 'red' : 'blue';
  }, [localUser, localFrameRole]);

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    const handleAction = (payload: any) => {
      if (payload?.game !== 'ludo') return;
      if (payload.action === 'SYNC' && payload.state) {
        const st = payload.state;
        if (st.tokens) {
          setLudo(st);
        } else {
          setLudo({
            tokens: {
              red: Array.isArray(st.red) ? st.red : [-1, -1, -1, -1],
              blue: Array.isArray(st.blue) ? st.blue : [-1, -1, -1, -1],
            },
            turn: st.turn || 'red',
            dice: typeof st.dice === 'number' ? st.dice : null,
            winner: st.winner ?? null,
            message: st.statusMsg || '',
          });
        }
      }
    };
    ws.on('GAME_ACTION', handleAction);
    return () => ws.off('GAME_ACTION', handleAction);
  }, []);

  const canMoveToken = (pos: number, dice: number) => {
    if (pos === -1) return dice === 6;
    return pos + dice <= FINISH_POS;
  };

  const isMyTurn = myColor === ludo.turn && !ludo.winner;

  const handleRollDice = () => {
    if (!isMyTurn || ludo.dice !== null) return;
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'ludo',
      action: 'ROLL',
      sessionId,
    });
  };

  const handleMoveToken = (idx: number) => {
    if (!isMyTurn || ludo.dice === null) return;
    const pos = ludo.tokens[ludo.turn][idx];
    if (!canMoveToken(pos, ludo.dice)) return;
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'ludo',
      action: 'MOVE',
      tokenIndex: idx,
      sessionId,
    });
  };

  const handleStopGame = () => {
    if (!sessionId) return;
    WebSocketService.getInstance().sendEvent('GAME_STOP', { sessionId });
  };

  return (
    <div className="flex flex-col items-center flex-1 p-3 gap-2.5 overflow-y-auto">
      <div className="flex flex-wrap justify-between items-center w-full max-w-[440px] gap-2">
        <div>
          <h2 className="m-0 text-[1.15rem] font-extrabold text-slate-900">🎲 Ludo Party</h2>
          <div className="text-[0.82rem] text-slate-600">
            Anda: <strong>{myColor === 'red' ? 'Merah (Kiri)' : myColor === 'blue' ? 'Biru (Kanan)' : 'Penonton'}</strong>
          </div>
        </div>
        {localUser?.isOwner && (
          <div className="flex gap-2">
            <button
              onClick={() => WebSocketService.getInstance().sendEvent('GAME_ACTION', { game: 'ludo', action: 'RESET', sessionId })}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleStopGame}
              className="px-3 py-1.5 rounded-lg border-none bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer transition-colors"
            >
              Stop Game
            </button>
          </div>
        )}
      </div>

      {/* 8x8 Ludo Grid */}
      <div className="grid grid-cols-8 w-full max-w-[400px] aspect-square gap-0.5 bg-slate-300 p-1 rounded-xl">
        {Array.from({ length: 8 }).map((_, r) =>
          Array.from({ length: 8 }).map((__, c) => {
            const loopIdx = LOOP_COORDS.findIndex(([lr, lc]) => lr === r && lc === c);
            const redHomeIdx = RED_HOME_COORDS.findIndex(([hr, hc]) => hr === r && hc === c);
            const blueHomeIdx = BLUE_HOME_COORDS.findIndex(([hr, hc]) => hr === r && hc === c);

            let bgClass = 'bg-slate-100';
            if (loopIdx !== -1) {
              bgClass =
                loopIdx === 0
                  ? 'bg-red-100'
                  : loopIdx === 14
                  ? 'bg-blue-100'
                  : SAFE_CELLS.has(loopIdx)
                  ? 'bg-amber-100'
                  : 'bg-white';
            } else if (redHomeIdx !== -1) {
              bgClass = 'bg-red-300';
            } else if (blueHomeIdx !== -1) {
              bgClass = 'bg-blue-300';
            }

            // Find tokens at this cell
            const cellTokens: { color: LudoColor; idx: number }[] = [];
            (['red', 'blue'] as LudoColor[]).forEach((col) => {
              ludo.tokens[col].forEach((pos, idx) => {
                if (pos >= 0 && pos < TRACK_LEN && toGlobalIndex(col, pos) === loopIdx) {
                  cellTokens.push({ color: col, idx });
                } else if (pos >= TRACK_LEN && pos < FINISH_POS) {
                  const homeStep = pos - TRACK_LEN;
                  if (col === 'red' && redHomeIdx === homeStep) cellTokens.push({ color: 'red', idx });
                  if (col === 'blue' && blueHomeIdx === homeStep) cellTokens.push({ color: 'blue', idx });
                }
              });
            });

            return (
              <div
                key={`${r}-${c}`}
                className={`${bgClass} rounded flex flex-wrap items-center justify-center gap-0.5 text-[0.65rem] relative`}
              >
                {SAFE_CELLS.has(loopIdx) && cellTokens.length === 0 ? '★' : null}
                {cellTokens.map(({ color, idx }) => {
                  const movable = isMyTurn && ludo.dice !== null && color === myColor && canMoveToken(ludo.tokens[color][idx], ludo.dice);
                  return (
                    <button
                      key={`${color}-${idx}`}
                      type="button"
                      disabled={!movable}
                      onClick={() => handleMoveToken(idx)}
                      className={`w-[18px] h-[18px] rounded-full ${
                        movable ? 'border-2 border-slate-900 cursor-pointer' : 'border-[1.5px] border-white cursor-default'
                      } ${color === 'red' ? 'bg-red-500' : 'bg-blue-600'} text-white font-extrabold text-[0.62rem] p-0`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Controls: Dice + Base Tokens */}
      <div className="flex items-center gap-3 flex-wrap justify-center">
        <button
          type="button"
          disabled={!isMyTurn || ludo.dice !== null}
          onClick={handleRollDice}
          className={`px-[18px] py-2.5 rounded-[10px] border-none text-white font-extrabold ${
            isMyTurn && ludo.dice === null
              ? 'bg-sky-500 hover:bg-sky-600 cursor-pointer'
              : 'bg-slate-400 cursor-not-allowed'
          }`}
        >
          {ludo.dice !== null ? `Dadu: ${ludo.dice}` : '🎲 Lempar Dadu'}
        </button>

        {myColor && (
          <div className="flex gap-1.5 items-center">
            <span className="text-[0.78rem] font-bold">Base:</span>
            {ludo.tokens[myColor].map((pos, idx) =>
              pos === -1 ? (
                <button
                  key={idx}
                  type="button"
                  disabled={!isMyTurn || ludo.dice !== 6}
                  onClick={() => handleMoveToken(idx)}
                  className={`w-[26px] h-[26px] rounded-full ${
                    isMyTurn && ludo.dice === 6
                      ? 'border-2 border-slate-900 cursor-pointer opacity-100'
                      : 'border border-white cursor-not-allowed opacity-60'
                  } ${myColor === 'red' ? 'bg-red-500' : 'bg-blue-600'} text-white font-extrabold`}
                >
                  {idx + 1}
                </button>
              ) : null
            )}
          </div>
        )}
      </div>

      <div className="text-[0.84rem] font-semibold text-slate-800 text-center">
        {ludo.message}
      </div>
    </div>
  );
}
