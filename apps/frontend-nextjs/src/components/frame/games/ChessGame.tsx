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
  const localFrameRole = useCallStore((s) => s.localFrameRole);

  const [board, setBoard] = useState<Board>(() => createInitialBoard());
  const [turn, setTurn] = useState<PieceColor>('w');
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [winner, setWinner] = useState<PieceColor | null>(null);
  const [lastMove, setLastMove] = useState<string>('');

  // Canonical server frame role: Frame A = White ('w'), Frame B = Black ('b')
  const myColor: PieceColor | null = useMemo(() => {
    if (!localUser) return null;
    return localFrameRole === 'A' ? 'w' : 'b';
  }, [localUser, localFrameRole]);

  const legalMoves = useMemo(() => {
    if (!selected) return new Set<string>();
    const [r, c] = selected;
    return new Set(getPseudoMoves(board, r, c).map(([nr, nc]) => `${nr},${nc}`));
  }, [board, selected]);

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    const parseServerBoard = (rawBoard: any): Board =>
      rawBoard.map((row: any[]) =>
        row.map((cell: any) => {
          if (!cell) return null;
          if (typeof cell === 'string' && cell.length >= 2) {
            return { color: cell[0] as PieceColor, type: cell[1] as PieceType };
          }
          return cell;
        })
      );

    const handleAction = (payload: any) => {
      if (payload?.game !== 'chess') return;
      if (payload.action === 'MOVE' && payload.board) {
        setBoard(parseServerBoard(payload.board));
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
        setSelected(null);
        WebSocketService.getInstance().sendEvent('GAME_ACTION', {
          game: 'chess',
          action: 'MOVE',
          sessionId,
          fromRow: sr,
          fromCol: sc,
          toRow: r,
          toCol: c,
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
    <div className="flex flex-col items-center justify-center flex-1 gap-3 p-3 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between w-full max-w-[460px] gap-2">
        <div>
          <h2 className="m-0 text-[1.15rem] font-extrabold text-slate-900">👑 Chess Arena</h2>
          <div className="text-[0.82rem] text-slate-600">
            {winner
              ? `Pemenang: ${winner === 'w' ? 'Putih (Frame Kiri)' : 'Hitam (Frame Kanan)'}!`
              : `Giliran: ${turn === 'w' ? 'Putih' : 'Hitam'} • Anda: ${myColor === 'w' ? 'Putih' : myColor === 'b' ? 'Hitam' : 'Penonton'}`}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
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
      </div>

      <div className="grid grid-cols-8 w-full max-w-[440px] aspect-square border-[3px] border-slate-800 rounded-lg overflow-hidden shadow-[0_12px_24px_rgba(15,23,42,0.18)]">
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
                className={`relative border-none p-0 flex items-center justify-center text-[clamp(1.3rem,4.5vw,2.2rem)] ${
                  myColor === turn && !winner ? 'cursor-pointer' : 'cursor-default'
                } ${
                  isSelected
                    ? 'bg-yellow-400'
                    : isLight
                    ? 'bg-slate-50'
                    : 'bg-slate-500'
                } ${
                  piece?.color === 'w'
                    ? 'text-slate-900 [text-shadow:0_1px_2px_rgba(255,255,255,0.9)]'
                    : 'text-slate-950'
                }`}
              >
                {piece ? PIECE_UNICODE[piece.color + piece.type] : ''}
                {isLegal && (
                  <span
                    className={`absolute rounded-full pointer-events-none ${
                      piece
                        ? 'w-[82%] h-[82%] border-[3px] border-sky-500/85 bg-transparent'
                        : 'w-[28%] h-[28%] bg-sky-500/65'
                    }`}
                  />
                )}
              </button>
            );
          })
        )}
      </div>

      {lastMove && (
        <div className="text-[0.82rem] text-slate-700 font-semibold">
          Langkah terakhir: {lastMove}
        </div>
      )}
    </div>
  );
}
