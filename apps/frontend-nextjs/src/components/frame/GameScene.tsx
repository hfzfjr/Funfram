import React, { useEffect, useMemo, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import Canvas from '@/components/frame/Canvas';
import GuessInput from '@/components/frame/GuessInput';
import ScoreBoard from '@/components/frame/ScoreBoard';
import GameVideoDock from '@/components/frame/GameVideoDock';
import ChessGame from '@/components/frame/games/ChessGame';
import UnoGame from '@/components/frame/games/UnoGame';
import LudoGame from '@/components/frame/games/LudoGame';

export default function GameScene() {
  const activeGameType = useCallStore(state => state.activeGameType);
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

  const containerClass =
    'flex flex-col md:flex-row h-full bg-transparent text-slate-900 rounded-lg overflow-hidden gap-3 px-4 pb-2';

  if (activeGameType === 'chess' || activeGameType === 'uno' || activeGameType === 'ludo') {
    return (
      <div className={containerClass}>
        <GameVideoDock />
        {activeGameType === 'chess' && <ChessGame />}
        {activeGameType === 'uno' && <UnoGame />}
        {activeGameType === 'ludo' && <LudoGame />}
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className={containerClass}>
        <GameVideoDock />
        <div className="flex-1 text-3xl text-center mt-8 font-semibold">Loading game...</div>
      </div>
    );
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
    <div className={containerClass}>
      <GameVideoDock />
      <div className="relative flex-[3] p-4 min-w-0">
        <Canvas events={gameState.canvasEvents} isDrawer={isDrawer} isActive={isDrawing} />
        {showCorrect && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg bg-green-600 text-slate-900 text-2xl font-extrabold animate-[popCorrect_1.4s_ease_both]">
            Correct!
          </div>
        )}
      </div>
      <div className="flex-1 bg-white/75 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-sm p-4 flex flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-2 p-3 border border-black/10 rounded-lg bg-white/60">
          <span className="text-xs font-bold text-blue-500 uppercase">{gameState.status}</span>
          <strong className="text-slate-900 text-xl leading-tight break-words">{wordLabel}</strong>
          {gameState.status === 'Reveal' && gameState.currentWord && (
            <span className="text-amber-600 text-[0.95rem]">Answer: {gameState.currentWord}</span>
          )}
          {canGuess && (
            <div className="mt-2">
              <GuessInput onSubmit={submitGuess} />
            </div>
          )}
        </div>
        <ScoreBoard scores={gameState.score} names={playerNames} />
        <div className="text-xl font-bold text-center">
          {gameState.status === 'Countdown' ? `Starts in: ${gameState.drawTimer}s` : `Time left: ${timer}s`}
        </div>
        <button
          type="button"
          className="w-full border-none rounded-lg p-3 bg-[#93000A] hover:bg-red-700 text-white font-bold cursor-pointer transition-colors"
          onClick={handleStopGame}
        >
          Stop Game
        </button>
      </div>
    </div>
  );
}
