'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';

type CardColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
interface UnoCard {
  id: string;
  color: CardColor;
  value: string;
}

interface UnoFilteredState {
  myHand: UnoCard[];
  players: Array<{ id: string; handCount: number }>;
  topCard: UnoCard;
  currentColor: Exclude<CardColor, 'wild'>;
  currentPlayerId: string;
  direction: 1 | -1;
  winner: string | null;
  deckCount: number;
}

const COLOR_CLASS: Record<CardColor, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  wild: 'bg-slate-800',
};

function formatCardLabel(value: string): string {
  switch (value) {
    case 'skip':
      return 'Skip';
    case 'reverse':
      return 'Reverse';
    case 'draw2':
      return '+2';
    case 'wild':
      return 'Wild';
    case 'wild4':
      return 'Wild+4';
    default:
      return value;
  }
}

export default function UnoGame() {
  const sessionId = useCallStore((s) => s.sessionId);
  const localUser = useCallStore((s) => s.localUser);
  const leftParticipants = useCallStore((s) => s.leftParticipants);
  const rightParticipants = useCallStore((s) => s.rightParticipants);

  const allPlayers = useMemo(
    () => [...leftParticipants, ...rightParticipants],
    [leftParticipants, rightParticipants]
  );

  const [game, setGame] = useState<UnoFilteredState | null>(null);
  const [pendingWildCard, setPendingWildCard] = useState<UnoCard | null>(null);

  const playerNames = useMemo(
    () => Object.fromEntries(allPlayers.map((p) => [p.id, p.name])),
    [allPlayers]
  );

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    const handleAction = (payload: any) => {
      if (payload?.game !== 'uno') return;
      if (payload.action === 'SYNC' && payload.state) {
        setGame(payload.state);
        setPendingWildCard(null);
      }
    };
    ws.on('GAME_ACTION', handleAction);
    return () => ws.off('GAME_ACTION', handleAction);
  }, []);

  const handleStopGame = () => {
    if (!sessionId) return;
    WebSocketService.getInstance().sendEvent('GAME_STOP', { sessionId });
  };

  if (!game || !localUser) {
    return <div className="p-8 text-center font-semibold text-slate-700">Menyiapkan kartu UNO...</div>;
  }

  const isMyTurn = game.currentPlayerId === localUser.id && !game.winner;
  const myHand = game.myHand || [];
  const topCard = game.topCard;

  const canPlayCard = (card: UnoCard) => {
    if (card.color === 'wild') return true;
    return card.color === game.currentColor || card.value === topCard.value;
  };

  const playCard = (card: UnoCard, chosenColor?: Exclude<CardColor, 'wild'>) => {
    if (!isMyTurn || !canPlayCard(card)) return;
    if (card.color === 'wild' && !chosenColor) {
      setPendingWildCard(card);
      return;
    }

    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'uno',
      action: 'PLAY_CARD',
      sessionId,
      cardId: card.id,
      ...(chosenColor ? { chosenColor } : {}),
    });
    setPendingWildCard(null);
  };

  const handleDrawCard = () => {
    if (!isMyTurn) return;
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'uno',
      action: 'DRAW_CARD',
      sessionId,
    });
  };

  const handleRestart = () => {
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'uno',
      action: 'RESET',
      sessionId,
    });
  };

  return (
    <div className="flex flex-col flex-1 p-3.5 gap-3 overflow-y-auto">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div>
          <h2 className="m-0 text-[1.15rem] font-extrabold text-slate-900">🃏 Kartu UNO</h2>
          <div className="text-[0.82rem] text-slate-600">
            {game.winner
              ? `🎉 Pemenang: ${playerNames[game.winner] || 'Pemain'}!`
              : `Giliran: ${playerNames[game.currentPlayerId] || 'Pemain'} ${isMyTurn ? '(Giliran Kamu!)' : ''}`}
          </div>
        </div>
        {localUser.isOwner && (
          <div className="flex gap-2">
            <button
              onClick={handleRestart}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Main Lagi
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

      {/* Opponent card counts (strictly no opponent card values exposed) */}
      <div className="flex gap-2 flex-wrap">
        {game.players
          .filter((p) => p.id !== localUser.id)
          .map((p) => (
            <div key={p.id} className="px-3 py-1.5 rounded-[10px] bg-white border border-slate-300 text-[0.82rem] font-semibold">
              {playerNames[p.id] || 'Pemain'}: {p.handCount} kartu
            </div>
          ))}
      </div>

      {/* Center table */}
      <div className="flex items-center justify-center gap-5 p-4 bg-white/65 rounded-[14px]">
        <button
          type="button"
          disabled={!isMyTurn}
          onClick={handleDrawCard}
          className={`w-[76px] h-[110px] rounded-xl border-[3px] border-white bg-slate-900 text-white font-extrabold flex flex-col items-center justify-center ${
            isMyTurn ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-60'
          }`}
        >
          <span>AMBIL</span>
          <span className="text-[0.65rem] text-slate-300 mt-1">{game.deckCount}</span>
        </button>

        <div
          className={`w-[82px] h-[114px] rounded-xl border-[3px] border-white ${COLOR_CLASS[topCard.color]} text-white flex flex-col items-center justify-center font-extrabold text-[1.15rem] shadow-[0_8px_18px_rgba(0,0,0,0.18)]`}
        >
          <span>{formatCardLabel(topCard.value)}</span>
          <span className="text-[0.68rem] mt-1 uppercase">
            {game.currentColor}
          </span>
        </div>
      </div>

      {pendingWildCard && (
        <div className="flex justify-center gap-2 items-center">
          <span className="text-[0.85rem] font-bold">Pilih Warna:</span>
          {(['red', 'blue', 'green', 'yellow'] as const).map((col) => (
            <button
              key={col}
              onClick={() => playCard(pendingWildCard, col)}
              className={`w-8 h-8 rounded-full border-2 border-white ${COLOR_CLASS[col]} cursor-pointer`}
            />
          ))}
        </div>
      )}

      {/* Local player hand */}
      <div className="flex flex-wrap gap-2 justify-center pt-1.5">
        {myHand.map((card) => {
          const playable = isMyTurn && canPlayCard(card);
          return (
            <button
              key={card.id}
              type="button"
              disabled={!playable}
              onClick={() => playCard(card)}
              className={`w-16 h-[92px] rounded-[10px] ${
                playable
                  ? 'border-[3px] border-slate-900 cursor-pointer opacity-100 -translate-y-[3px]'
                  : 'border-2 border-white/80 cursor-not-allowed opacity-55'
              } ${COLOR_CLASS[card.color]} text-white font-extrabold text-[0.9rem] transition-transform duration-150`}
            >
              {formatCardLabel(card.value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
