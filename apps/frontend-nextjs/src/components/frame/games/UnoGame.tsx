'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';

type CardColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
interface UnoCard {
  id: string;
  color: CardColor;
  value: string; // '0'-'9', 'Skip', 'Reverse', '+2', 'Wild', 'Wild+4'
}

interface UnoSyncState {
  deck: UnoCard[];
  discard: UnoCard[];
  hands: Record<string, UnoCard[]>;
  playerOrder: string[];
  turnIndex: number;
  direction: 1 | -1;
  activeColor: Exclude<CardColor, 'wild'>;
  winnerId: string | null;
  lastAction: string;
}

const COLOR_CLASS: Record<CardColor, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  wild: 'bg-slate-800',
};

function createDeck(): UnoCard[] {
  const colors: Exclude<CardColor, 'wild'>[] = ['red', 'blue', 'green', 'yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
  const deck: UnoCard[] = [];
  let idx = 0;

  for (const color of colors) {
    for (const value of values) {
      deck.push({ id: `c-${idx++}`, color, value });
      if (value !== '0') {
        deck.push({ id: `c-${idx++}`, color, value });
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c-${idx++}`, color: 'wild', value: 'Wild' });
    deck.push({ id: `c-${idx++}`, color: 'wild', value: 'Wild+4' });
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function initUnoGame(playerIds: string[]): UnoSyncState {
  const deck = createDeck();
  const hands: Record<string, UnoCard[]> = {};
  for (const id of playerIds) {
    hands[id] = deck.splice(0, 7);
  }
  let top = deck.pop()!;
  while (top.color === 'wild') {
    deck.unshift(top);
    top = deck.pop()!;
  }
  return {
    deck,
    discard: [top],
    hands,
    playerOrder: playerIds,
    turnIndex: 0,
    direction: 1,
    activeColor: top.color as Exclude<CardColor, 'wild'>,
    winnerId: null,
    lastAction: 'Permainan UNO dimulai!',
  };
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

  const [game, setGame] = useState<UnoSyncState | null>(null);
  const [pendingWildCard, setPendingWildCard] = useState<UnoCard | null>(null);

  const playerNames = useMemo(
    () => Object.fromEntries(allPlayers.map((p) => [p.id, p.name])),
    [allPlayers]
  );

  // Host (first left participant) deals initial cards
  useEffect(() => {
    if (!sessionId || allPlayers.length < 2) return;
    const isHost = leftParticipants[0]?.id === localUser?.id;
    if (isHost && !game) {
      const initial = initUnoGame(allPlayers.map((p) => p.id));
      setGame(initial);
      WebSocketService.getInstance().sendEvent('GAME_ACTION', {
        game: 'uno',
        action: 'SYNC',
        sessionId,
        state: initial,
      });
    }
  }, [sessionId, allPlayers, leftParticipants, localUser?.id, game]);

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

  const syncState = (next: UnoSyncState) => {
    setGame(next);
    WebSocketService.getInstance().sendEvent('GAME_ACTION', {
      game: 'uno',
      action: 'SYNC',
      sessionId,
      state: next,
    });
  };

  const handleStopGame = () => {
    if (!sessionId) return;
    WebSocketService.getInstance().sendEvent('GAME_STOP', { sessionId });
  };

  if (!game || !localUser) {
    return <div className="p-8 text-center font-semibold">Menyiapkan kartu UNO...</div>;
  }

  const currentTurnId = game.playerOrder[game.turnIndex];
  const isMyTurn = currentTurnId === localUser.id && !game.winnerId;
  const myHand = game.hands[localUser.id] || [];
  const topCard = game.discard[game.discard.length - 1];

  const canPlayCard = (card: UnoCard) => {
    if (card.color === 'wild') return true;
    return card.color === game.activeColor || card.value === topCard.value;
  };

  const nextIndex = (from: number, step: number, dir: 1 | -1, len: number) =>
    (((from + step * dir) % len) + len) % len;

  const playCard = (card: UnoCard, chosenColor?: Exclude<CardColor, 'wild'>) => {
    if (!isMyTurn || !canPlayCard(card)) return;
    if (card.color === 'wild' && !chosenColor) {
      setPendingWildCard(card);
      return;
    }

    const nextHands = { ...game.hands };
    nextHands[localUser.id] = myHand.filter((c) => c.id !== card.id);
    const nextDeck = [...game.deck];
    const nextDiscard = [...game.discard, card];

    let nextDir = game.direction;
    let step = 1;
    const len = game.playerOrder.length;

    if (card.value === 'Reverse') {
      if (len === 2) {
        step = 2; // In 2-player UNO, Reverse acts like Skip
      } else {
        nextDir = (nextDir * -1) as 1 | -1;
      }
    } else if (card.value === 'Skip') {
      step = 2;
    }

    const nextColor = chosenColor || (card.color as Exclude<CardColor, 'wild'>);
    const winnerId = nextHands[localUser.id].length === 0 ? localUser.id : null;

    if (!winnerId && (card.value === '+2' || card.value === 'Wild+4')) {
      const targetIdx = nextIndex(game.turnIndex, 1, nextDir, len);
      const targetId = game.playerOrder[targetIdx];
      const drawCount = card.value === '+2' ? 2 : 4;
      const drawn: UnoCard[] = [];
      for (let i = 0; i < drawCount; i++) {
        if (nextDeck.length === 0 && nextDiscard.length > 1) {
          const recycled = nextDiscard.splice(0, nextDiscard.length - 1);
          nextDeck.push(...recycled);
        }
        const popped = nextDeck.pop();
        if (popped) drawn.push(popped);
      }
      nextHands[targetId] = [...(nextHands[targetId] || []), ...drawn];
      step = 2;
    }

    syncState({
      deck: nextDeck,
      discard: nextDiscard,
      hands: nextHands,
      playerOrder: game.playerOrder,
      turnIndex: nextIndex(game.turnIndex, step, nextDir, len),
      direction: nextDir,
      activeColor: nextColor,
      winnerId,
      lastAction: `${localUser.name} memainkan ${card.color === 'wild' ? '' : card.color.toUpperCase() + ' '}${card.value}`,
    });
    setPendingWildCard(null);
  };

  const handleDrawCard = () => {
    if (!isMyTurn) return;
    const nextDeck = [...game.deck];
    const nextDiscard = [...game.discard];
    if (nextDeck.length === 0 && nextDiscard.length > 1) {
      nextDeck.push(...nextDiscard.splice(0, nextDiscard.length - 1));
    }
    const drawn = nextDeck.pop();
    const nextHands = { ...game.hands };
    if (drawn) {
      nextHands[localUser.id] = [...myHand, drawn];
    }

    syncState({
      ...game,
      deck: nextDeck,
      discard: nextDiscard,
      hands: nextHands,
      turnIndex: nextIndex(game.turnIndex, 1, game.direction, game.playerOrder.length),
      lastAction: `${localUser.name} mengambil 1 kartu`,
    });
  };

  const handleRestart = () => {
    syncState(initUnoGame(allPlayers.map((p) => p.id)));
  };

  return (
    <div className="flex flex-col flex-1 p-3.5 gap-3 overflow-y-auto">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div>
          <h2 className="m-0 text-[1.15rem] font-extrabold text-slate-900">🃏 UNO Card Game</h2>
          <div className="text-[0.82rem] text-slate-600">
            {game.winnerId
              ? `🎉 Pemenang: ${playerNames[game.winnerId] || 'Player'}!`
              : `Giliran: ${playerNames[currentTurnId] || 'Player'} ${isMyTurn ? '(Giliran Anda!)' : ''}`}
          </div>
        </div>
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
      </div>

      {/* Opponent card counts */}
      <div className="flex gap-2 flex-wrap">
        {game.playerOrder
          .filter((id) => id !== localUser.id)
          .map((id) => (
            <div key={id} className="px-3 py-1.5 rounded-[10px] bg-white border border-slate-300 text-[0.82rem] font-semibold">
              {playerNames[id] || 'Player'}: {(game.hands[id] || []).length} kartu
            </div>
          ))}
      </div>

      {/* Center table */}
      <div className="flex items-center justify-center gap-5 p-4 bg-white/65 rounded-[14px]">
        <button
          type="button"
          disabled={!isMyTurn}
          onClick={handleDrawCard}
          className={`w-[76px] h-[110px] rounded-xl border-[3px] border-white bg-slate-900 text-white font-extrabold ${
            isMyTurn ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-60'
          }`}
        >
          AMBIL
        </button>

        <div
          className={`w-[82px] h-[114px] rounded-xl border-[3px] border-white ${COLOR_CLASS[topCard.color]} text-white flex flex-col items-center justify-center font-extrabold text-[1.15rem] shadow-[0_8px_18px_rgba(0,0,0,0.18)]`}
        >
          <span>{topCard.value}</span>
          <span className="text-[0.68rem] mt-1 uppercase">
            {game.activeColor}
          </span>
        </div>
      </div>

      <div className="text-center text-[0.82rem] text-slate-700 font-semibold">
        {game.lastAction}
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
              {card.value}
            </button>
          );
        })}
      </div>
    </div>
  );
}
