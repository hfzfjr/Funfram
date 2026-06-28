import React, { useEffect, useMemo, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import Canvas from '@/components/frame/Canvas'; // placeholder, to be implemented later
import GuessInput from '@/components/frame/GuessInput';
import ScoreBoard from '@/components/frame/ScoreBoard'; // placeholder UI
import styles from './GameScene.module.css';

export default function GameScene() {
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
  

  // Local timer for display (optional)
  const [timer, setTimer] = useState<number>(0);
  const [showCorrect, setShowCorrect] = useState(false);
  useEffect(() => {
    if (!gameState) return;
    setTimer(gameState.timeRemaining);
    const interval = setInterval(() => {
      setTimer(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  useEffect(() => {
    const ws = WebSocketService.getInstance();
    const handleGuessFeedback = (payload: { correct?: boolean }) => {
      if (!payload.correct) return;
      setShowCorrect(true);
      window.setTimeout(() => setShowCorrect(false), 1400);
    };

    ws.on('GUESS_FEEDBACK', handleGuessFeedback);
    return () => ws.off('GUESS_FEEDBACK', handleGuessFeedback);
  }, []);



  if (!gameState) {
    return <div className={styles.loading}>Loading game...</div>;
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
    <div className={styles.container}>
      <div className={styles.canvasWrapper}>
        <Canvas events={gameState.canvasEvents} isDrawer={isDrawer} isActive={isDrawing} />
        {showCorrect && <div className={styles.correctToast}>Correct!</div>}
      </div>
      <div className={styles.sidebar}>
        <div className={styles.statusPanel}>
          <span className={styles.status}>{gameState.status}</span>
          <strong className={styles.word}>{wordLabel}</strong>
          {gameState.status === 'Reveal' && gameState.currentWord && (
            <span className={styles.answer}>Answer: {gameState.currentWord}</span>
          )}
          {canGuess && (
            <div style={{ marginTop: '8px' }}>
              <GuessInput onSubmit={submitGuess} />
            </div>
          )}
        </div>
        <ScoreBoard scores={gameState.score} names={playerNames} />
        <div className={styles.timer}>
          {gameState.status === 'Countdown' ? `Starts in: ${gameState.drawTimer}s` : `Time left: ${timer}s`}
        </div>
        <button type="button" className={styles.stopButton} onClick={handleStopGame}>
          Stop Game
        </button>
      </div>
    </div>
  );
}
