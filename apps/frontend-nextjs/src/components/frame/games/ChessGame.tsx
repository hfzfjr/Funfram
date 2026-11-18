'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';

type PieceColor = 'w' | 'b';
type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
interface Piece {
  color: PieceColor;
  type: PieceType;
}
type Board = (Piece | null)[][];

const PIECE_UNICODE: Record<string, string> = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

function createInitialBoard(): Board {
  const backRow: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = { color: 'b', type: backRow[c] };
    board[1][c] = { color: 'b', type: 'P' };
    board[6][c] = { color: 'w', type: 'P' };
    board[7][c] = { color: 'w', type: backRow[c] };
  }
  return board;
}

function getPseudoMoves(board: Board, r: number, c: number): [number, number][] {
  const piece = board[r][c];
  if (!piece) return [];
  const moves: [number, number][] = [];
  const inBounds = (rr: number, cc: number) => rr >= 0 && rr < 8 && cc >= 0 && cc < 8;

  const slide = (dirs: [number, number][]) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push([nr, nc]);
        } else {
          if (target.color !== piece.color) moves.push([nr, nc]);
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  };

  switch (piece.type) {
    case 'P': {
      const dir = piece.color === 'w' ? -1 : 1;
      const startRow = piece.color === 'w' ? 6 : 1;
      if (inBounds(r + dir, c) && !board[r + dir][c]) {
        moves.push([r + dir, c]);
        if (r === startRow && !board[r + 2 * dir][c]) {
          moves.push([r + 2 * dir, c]);
        }
      }
      for (const dc of [-1, 1]) {
        if (inBounds(r + dir, c + dc)) {
          const target = board[r + dir][c + dc];
          if (target && target.color !== piece.color) {
            moves.push([r + dir, c + dc]);
          }
        }
      }
      break;
    }
    case 'N': {
      const jumps: [number, number][] = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1],
      ];
      for (const [dr, dc] of jumps) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc) && board[nr][nc]?.color !== piece.color) {
          moves.push([nr, nc]);
        }
      }
      break;
    }
    case 'B':
      slide([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
      break;
    case 'R':
      slide([[-1, 0], [1, 0], [0, -1], [0, 1]]);
      break;
    case 'Q':
      slide([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
      break;
    case 'K': {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (inBounds(nr, nc) && board[nr][nc]?.color !== piece.color) {
            moves.push([nr, nc]);
          }
        }
      }
      break;
    }
  }
  return moves;
}

export default function ChessGame() {
  const sessionId = useCallStore((s) => s.sessionId);
  const localUser = useCallStore((s) => s.localUser);
  const leftParticipants = useCallStore((s) => s.leftParticipants);
  const rightParticipants = useCallStore((s) => s.rightParticipants);

  const [board, setBoard] = useState<Board>(() => createInitialBoard());
  const [turn, setTurn] = useState<PieceColor>('w');
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [winner, setWinner] = useState<PieceColor | null>(null);
  const [lastMove, setLastMove] = useState<string>('');

  // Left frame = White ('w'), Right frame = Black ('b')
  const myColor: PieceColor | null = useMemo(() => {
    if (!localUser) return null;
    if (leftParticipants.some((p) => p.id === localUser.id)) return 'w';
    if (rightParticipants.some((p) => p.id === localUser.id)) return 'b';
    return null;
  }, [localUser, leftParticipants, rightParticipants]);

  const legalMoves = useMemo(() => {
    if (!selected) return new Set<string>();
    const [r, c] = selected;
    return new Set(getPseudoMoves(board, r, c).map(([nr, nc]) => `${nr},${nc}`));
  }, [board, selected]);

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    const handleAction = (payload: any) => {
      if (payload?.game !== 'chess') return;
      if (payload.action === 'MOVE' && payload.board) {
        setBoard(payload.board);
        setTurn(payload.nextTurn);
        setWinner(payload.winner ?? null);
        setLastMove(payload.lastMove || '');
        setSelected(null);
      } else if (payload.action === 'RESET') {
        setBoard(createInitialBoard());
        setTurn('w');
        setWinner(null);
        setLastMove('');
        setSelected(null);
      }
    };
    ws.on('GAME_ACTION', handleAction);
    return () => ws.off('GAME_ACTION', handleAction);
  }, []);

  const handleSquareClick = (r: number, c: number) => {
    if (winner || myColor !== turn) return;
    const clicked = board[r][c];

    if (selected) {
      const [sr, sc] = selected;
      if (sr === r && sc === c) {
        setSelected(null);
        return;
      }

      if (legalMoves.has(`${r},${c}`)) {
        const nextBoard = board.map((row) => [...row]);
        const moving = { ...nextBoard[sr][sc]! };
        const captured = nextBoard[r][c];

        // Auto-promote Pawn to Queen
        if (moving.type === 'P' && (r === 0 || r === 7)) {
          moving.type = 'Q';
        }

        nextBoard[r][c] = moving;
        nextBoard[sr][sc] = null;

        const nextWinner = captured?.type === 'K' ? turn : null;
        const nextTurn: PieceColor = turn === 'w' ? 'b' : 'w';
        const moveText = `${PIECE_UNICODE[moving.color + moving.type]} ${String.fromCharCode(97 + sc)}${8 - sr} → ${String.fromCharCode(97 + c)}${8 - r}`;

        setBoard(nextBoard);
        setTurn(nextTurn);
        setWinner(nextWinner);
        setLastMove(moveText);
        setSelected(null);

        WebSocketService.getInstance().sendEvent('GAME_ACTION', {
          game: 'chess',
          action: 'MOVE',
          sessionId,
          board: nextBoard,
          nextTurn,
          winner: nextWinner,
          lastMove: moveText,
        });
        return;
      }
    }

    if (clicked && clicked.color === myColor) {
      setSelected([r, c]);
    } else {
      setSelected(null);
    }
  };

  const handleReset = () => {
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'chess',
      action: 'RESET',
      sessionId,
    });
  };

  const handleStopGame = () => {
    if (!sessionId) return;
    WebSocketService.getInstance().sendEvent('GAME_STOP', { sessionId });
  };

  // Flip board for Black player so their pieces are at the bottom
  const rows = myColor === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const cols = myColor === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '12px', padding: '12px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: '460px', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>👑 Chess Arena</h2>
          <div style={{ fontSize: '0.82rem', color: '#475569' }}>
            {winner
              ? `Pemenang: ${winner === 'w' ? 'Putih (Frame Kiri)' : 'Hitam (Frame Kanan)'}!`
              : `Giliran: ${turn === 'w' ? 'Putih' : 'Hitam'} • Anda: ${myColor === 'w' ? 'Putih' : myColor === 'b' ? 'Hitam' : 'Penonton'}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleReset} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#fff', fontWeight: 600, cursor: 'pointer', color: '#0F172A' }}>
            Reset
          </button>
          <button onClick={handleStopGame} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            Stop Game
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          width: '100%',
          maxWidth: '440px',
          aspectRatio: '1 / 1',
          border: '3px solid #1E293B',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 12px 24px rgba(15,23,42,0.18)',
        }}
      >
        {rows.map((r) =>
          cols.map((c) => {
            const piece = board[r][c];
            const isLight = (r + c) % 2 === 0;
            const isSelected = selected?.[0] === r && selected?.[1] === c;
            const isLegal = legalMoves.has(`${r},${c}`);

            return (
              <button
                key={`${r}-${c}`}
                type="button"
                onClick={() => handleSquareClick(r, c)}
                style={{
                  position: 'relative',
                  border: 'none',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'clamp(1.3rem, 4.5vw, 2.2rem)',
                  cursor: myColor === turn && !winner ? 'pointer' : 'default',
                  background: isSelected
                    ? '#FACC15'
                    : isLight
                    ? '#F8FAFC'
                    : '#64748B',
                  color: piece?.color === 'w' ? '#0F172A' : '#020617',
                  textShadow: piece?.color === 'w' ? '0 1px 2px rgba(255,255,255,0.9)' : 'none',
                }}
              >
                {piece ? PIECE_UNICODE[piece.color + piece.type] : ''}
                {isLegal && (
                  <span
                    style={{
                      position: 'absolute',
                      width: piece ? '82%' : '28%',
                      height: piece ? '82%' : '28%',
                      borderRadius: '50%',
                      border: piece ? '3px solid rgba(14,165,233,0.85)' : 'none',
                      background: piece ? 'transparent' : 'rgba(14,165,233,0.65)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </button>
            );
          })
        )}
      </div>

      {lastMove && (
        <div style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 600 }}>
          Langkah terakhir: {lastMove}
        </div>
      )}
    </div>
  );
}
