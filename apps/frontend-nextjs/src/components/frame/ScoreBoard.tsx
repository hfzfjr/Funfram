import React from 'react';

interface ScoreBoardProps {
  scores: Record<string, number>;
  names?: Record<string, string>;
}

export default function ScoreBoard({ scores, names = {} }: ScoreBoardProps) {
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return (
      <div className="p-4 bg-white/10 backdrop-blur-md rounded-xl text-slate-900">
        No scores yet.
      </div>
    );
  }
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return (
    <div className="p-4 bg-white/10 backdrop-blur-md rounded-xl text-slate-900">
      <h3 className="m-0 mb-2 text-lg font-semibold">Scores</h3>
      <ul className="list-none m-0 p-0">
        {sorted.map(([playerId, score]) => (
          <li key={playerId} className="flex justify-between py-1 border-b border-black/10">
            <span className="font-medium">{names[playerId] || 'Player'}</span>
            <span className="font-bold">{score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
