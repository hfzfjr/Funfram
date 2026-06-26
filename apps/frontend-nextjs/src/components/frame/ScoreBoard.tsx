import React from 'react';
import styles from './ScoreBoard.module.css';

interface ScoreBoardProps {
  scores: Record<string, number>;
  names?: Record<string, string>;
}

export default function ScoreBoard({ scores, names = {} }: ScoreBoardProps) {
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return <div className={styles.container}>No scores yet.</div>;
  }
  // Sort by descending score
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Scores</h3>
      <ul className={styles.list}>
        {sorted.map(([playerId, score]) => (
          <li key={playerId} className={styles.item}>
            <span className={styles.player}>{names[playerId] || 'Player'}</span>
            <span className={styles.points}>{score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
