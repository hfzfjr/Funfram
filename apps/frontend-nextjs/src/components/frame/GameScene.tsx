'use client';

import React from 'react';
import { useCallStore } from '@/store/useCallStore';
import GameVideoDock from '@/components/frame/GameVideoDock';
import ChessGame from '@/components/frame/games/ChessGame';
import UnoGame from '@/components/frame/games/UnoGame';
import LudoGame from '@/components/frame/games/LudoGame';
import GuessDrawingGame from '@/components/frame/games/GuessDrawingGame';

export default function GameScene() {
  const activeGameType = useCallStore(state => state.activeGameType);

  return (
    <div className="flex flex-col md:flex-row md:h-full bg-transparent text-slate-900 rounded-lg md:overflow-hidden gap-3 px-4 pb-2">
      <GameVideoDock />
      {activeGameType === 'chess' && <ChessGame />}
      {activeGameType === 'uno' && <UnoGame />}
      {activeGameType === 'ludo' && <LudoGame />}
      {activeGameType !== 'chess' && activeGameType !== 'uno' && activeGameType !== 'ludo' && (
        <GuessDrawingGame />
      )}
    </div>
  );
}
