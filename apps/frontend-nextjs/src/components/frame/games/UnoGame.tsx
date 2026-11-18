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

const COLOR_HEX: Record<CardColor, string> = {
  red: '#EF4444',
  blue: '#3B82F6',
  green: '#22C55E',
  yellow: '#EAB308',
  wild: '#1E293B',
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
    return <div style={{ padding: '2rem', textAlign: 'center', fontWeight: 600 }}>Menyiapkan kartu UNO...</div>;
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '14px', gap: '12px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>🃏 UNO Card Game</h2>
          <div style={{ fontSize: '0.82rem', color: '#475569' }}>
            {game.winnerId
              ? `🎉 Pemenang: ${playerNames[game.winnerId] || 'Player'}!`
              : `Giliran: ${playerNames[currentTurnId] || 'Player'} ${isMyTurn ? '(Giliran Anda!)' : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleRestart} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#fff', fontWeight: 600, cursor: 'pointer', color: '#0F172A' }}>
            Main Lagi
          </button>
          <button onClick={handleStopGame} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            Stop Game
          </button>
        </div>
      </div>

      {/* Opponent card counts */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {game.playerOrder
          .filter((id) => id !== localUser.id)
          .map((id) => (
            <div key={id} style={{ padding: '6px 12px', borderRadius: '10px', background: '#fff', border: '1px solid #CBD5E1', fontSize: '0.82rem', fontWeight: 600 }}>
              {playerNames[id] || 'Player'}: {(game.hands[id] || []).length} kartu
            </div>
          ))}
      </div>

      {/* Center table */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '16px', background: 'rgba(255,255,255,0.65)', borderRadius: '14px' }}>
        <button
          type="button"
          disabled={!isMyTurn}
          onClick={handleDrawCard}
          style={{
            width: '76px',
            height: '110px',
            borderRadius: '12px',
            border: '3px solid #fff',
            background: '#0F172A',
            color: '#fff',
            fontWeight: 800,
            cursor: isMyTurn ? 'pointer' : 'not-allowed',
            opacity: isMyTurn ? 1 : 0.6,
          }}
        >
          AMBIL
        </button>

        <div
          style={{
            width: '82px',
            height: '114px',
            borderRadius: '12px',
            border: '3px solid #fff',
            background: COLOR_HEX[topCard.color],
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.15rem',
            boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
          }}
        >
          <span>{topCard.value}</span>
          <span style={{ fontSize: '0.68rem', marginTop: '4px', textTransform: 'uppercase' }}>
            {game.activeColor}
          </span>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: '0.82rem', color: '#334155', fontWeight: 600 }}>
        {game.lastAction}
      </div>

      {pendingWildCard && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Pilih Warna:</span>
          {(['red', 'blue', 'green', 'yellow'] as const).map((col) => (
            <button
              key={col}
              onClick={() => playCard(pendingWildCard, col)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: '2px solid #fff',
                background: COLOR_HEX[col],
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}

      {/* Local player hand */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', paddingTop: '6px' }}>
        {myHand.map((card) => {
          const playable = isMyTurn && canPlayCard(card);
          return (
            <button
              key={card.id}
              type="button"
              disabled={!playable}
              onClick={() => playCard(card)}
              style={{
                width: '64px',
                height: '92px',
                borderRadius: '10px',
                border: playable ? '3px solid #0F172A' : '2px solid rgba(255,255,255,0.8)',
                background: COLOR_HEX[card.color],
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: playable ? 'pointer' : 'not-allowed',
                opacity: playable ? 1 : 0.55,
                transform: playable ? 'translateY(-3px)' : 'none',
                transition: 'transform 0.15s',
              }}
            >
              {card.value}
            </button>
          );
        })}
      </div>
    </div>
  );
}
