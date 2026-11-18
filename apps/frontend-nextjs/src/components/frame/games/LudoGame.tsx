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
  const leftParticipants = useCallStore((s) => s.leftParticipants);
  const rightParticipants = useCallStore((s) => s.rightParticipants);

  const [ludo, setLudo] = useState<LudoState>(INITIAL_LUDO);

  const myColor: LudoColor | null = useMemo(() => {
    if (!localUser) return null;
    if (leftParticipants.some((p) => p.id === localUser.id)) return 'red';
    if (rightParticipants.some((p) => p.id === localUser.id)) return 'blue';
    return null;
  }, [localUser, leftParticipants, rightParticipants]);

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    const handleAction = (payload: any) => {
      if (payload?.game !== 'ludo') return;
      if (payload.action === 'SYNC' && payload.state) {
        setLudo(payload.state);
      }
    };
    ws.on('GAME_ACTION', handleAction);
    return () => ws.off('GAME_ACTION', handleAction);
  }, []);

  const syncLudo = (next: LudoState) => {
    setLudo(next);
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'ludo',
      action: 'SYNC',
      sessionId,
      state: next,
    });
  };

  const canMoveToken = (pos: number, dice: number) => {
    if (pos === -1) return dice === 6;
    return pos + dice <= FINISH_POS;
  };

  const isMyTurn = myColor === ludo.turn && !ludo.winner;

  const handleRollDice = () => {
    if (!isMyTurn || ludo.dice !== null) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const myTokens = ludo.tokens[ludo.turn];
    const hasValidMove = myTokens.some((pos) => canMoveToken(pos, roll));

    if (!hasValidMove) {
      const nextTurn: LudoColor = ludo.turn === 'red' ? 'blue' : 'red';
      syncLudo({
        ...ludo,
        dice: null,
        turn: nextTurn,
        message: `${ludo.turn === 'red' ? 'Merah' : 'Biru'} lempar ${roll} (tidak ada langkah) → Giliran ${nextTurn === 'red' ? 'Merah' : 'Biru'}`,
      });
      return;
    }

    syncLudo({
      ...ludo,
      dice: roll,
      message: `${ludo.turn === 'red' ? 'Merah' : 'Biru'} dapat angka ${roll}! Pilih bidak.`,
    });
  };

  const handleMoveToken = (idx: number) => {
    if (!isMyTurn || ludo.dice === null) return;
    const dice = ludo.dice;
    const color = ludo.turn;
    const pos = ludo.tokens[color][idx];
    if (!canMoveToken(pos, dice)) return;

    const newPos = pos === -1 ? 0 : pos + dice;
    const nextTokens = {
      red: [...ludo.tokens.red],
      blue: [...ludo.tokens.blue],
    };
    nextTokens[color][idx] = newPos;

    // Capture opponent if landing on non-safe outer tile
    let captured = false;
    if (newPos >= 0 && newPos < TRACK_LEN) {
      const globalTarget = toGlobalIndex(color, newPos);
      if (!SAFE_CELLS.has(globalTarget)) {
        const opp: LudoColor = color === 'red' ? 'blue' : 'red';
        nextTokens[opp] = nextTokens[opp].map((oppPos) => {
          if (oppPos >= 0 && oppPos < TRACK_LEN && toGlobalIndex(opp, oppPos) === globalTarget) {
            captured = true;
            return -1;
          }
          return oppPos;
        });
      }
    }

    const won = nextTokens[color].every((p) => p === FINISH_POS);
    const bonusTurn = dice === 6 || captured;
    const nextTurn: LudoColor = won ? color : bonusTurn ? color : color === 'red' ? 'blue' : 'red';

    syncLudo({
      tokens: nextTokens,
      turn: nextTurn,
      dice: null,
      winner: won ? color : null,
      message: won
        ? `🏆 ${color === 'red' ? 'Merah' : 'Biru'} MENANG!`
        : captured
        ? `💥 ${color === 'red' ? 'Merah' : 'Biru'} memakan bidak lawan! Bonus lempar!`
        : dice === 6
        ? `🎲 Dapat 6! ${color === 'red' ? 'Merah' : 'Biru'} lempar lagi!`
        : `Giliran ${nextTurn === 'red' ? 'Merah' : 'Biru'}`,
    });
  };

  const handleStopGame = () => {
    if (!sessionId) return;
    WebSocketService.getInstance().sendEvent('GAME_STOP', { sessionId });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, padding: '12px', gap: '10px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '440px', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>🎲 Ludo Party</h2>
          <div style={{ fontSize: '0.82rem', color: '#475569' }}>
            Anda: <strong>{myColor === 'red' ? 'Merah (Kiri)' : myColor === 'blue' ? 'Biru (Kanan)' : 'Penonton'}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => syncLudo(INITIAL_LUDO)} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#fff', fontWeight: 600, cursor: 'pointer', color: '#0F172A' }}>
            Reset
          </button>
          <button onClick={handleStopGame} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            Stop Game
          </button>
        </div>
      </div>

      {/* 8x8 Ludo Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          width: '100%',
          maxWidth: '400px',
          aspectRatio: '1 / 1',
          gap: '2px',
          background: '#CBD5E1',
          padding: '4px',
          borderRadius: '12px',
        }}
      >
        {Array.from({ length: 8 }).map((_, r) =>
          Array.from({ length: 8 }).map((__, c) => {
            const loopIdx = LOOP_COORDS.findIndex(([lr, lc]) => lr === r && lc === c);
            const redHomeIdx = RED_HOME_COORDS.findIndex(([hr, hc]) => hr === r && hc === c);
            const blueHomeIdx = BLUE_HOME_COORDS.findIndex(([hr, hc]) => hr === r && hc === c);

            let bg = '#F1F5F9';
            if (loopIdx !== -1) {
              bg = loopIdx === 0 ? '#FEE2E2' : loopIdx === 14 ? '#DBEAFE' : SAFE_CELLS.has(loopIdx) ? '#FEF3C7' : '#FFFFFF';
            } else if (redHomeIdx !== -1) {
              bg = '#FCA5A5';
            } else if (blueHomeIdx !== -1) {
              bg = '#93C5FD';
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
                style={{
                  background: bg,
                  borderRadius: '4px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  fontSize: '0.65rem',
                  position: 'relative',
                }}
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
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        border: movable ? '2px solid #0F172A' : '1.5px solid #fff',
                        background: color === 'red' ? '#EF4444' : '#2563EB',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.62rem',
                        cursor: movable ? 'pointer' : 'default',
                        padding: 0,
                      }}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          disabled={!isMyTurn || ludo.dice !== null}
          onClick={handleRollDice}
          style={{
            padding: '10px 18px',
            borderRadius: '10px',
            border: 'none',
            background: isMyTurn && ludo.dice === null ? '#0EA5E9' : '#94A3B8',
            color: '#fff',
            fontWeight: 800,
            cursor: isMyTurn && ludo.dice === null ? 'pointer' : 'not-allowed',
          }}
        >
          {ludo.dice !== null ? `Dadu: ${ludo.dice}` : '🎲 Lempar Dadu'}
        </button>

        {myColor && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Base:</span>
            {ludo.tokens[myColor].map((pos, idx) =>
              pos === -1 ? (
                <button
                  key={idx}
                  type="button"
                  disabled={!isMyTurn || ludo.dice !== 6}
                  onClick={() => handleMoveToken(idx)}
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    border: isMyTurn && ludo.dice === 6 ? '2px solid #0F172A' : '1px solid #fff',
                    background: myColor === 'red' ? '#EF4444' : '#2563EB',
                    color: '#fff',
                    fontWeight: 800,
                    cursor: isMyTurn && ludo.dice === 6 ? 'pointer' : 'not-allowed',
                    opacity: isMyTurn && ludo.dice === 6 ? 1 : 0.6,
                  }}
                >
                  {idx + 1}
                </button>
              ) : null
            )}
          </div>
        )}
      </div>

      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#1E293B', textAlign: 'center' }}>
        {ludo.message}
      </div>
    </div>
  );
}
