'use client';
import { useState, useEffect } from 'react';

interface Props {
  gameSocket: WebSocket | null;
}

export default function GameBoard({ gameSocket }: Props) {
  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [gameStatus, setGameStatus] = useState('Tic-Tac-Toe');
  const [mySymbol, setMySymbol] = useState<'X' | 'O' | null>(null);

  useEffect(() => {
    if (!gameSocket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        
        if (data.type === 'GAME_MOVE' && data.game === 'tictactoe') {
          const newBoard = [...board];
          newBoard[data.move as number] = data.sender === 'me' ? mySymbol : (mySymbol === 'X' ? 'O' : 'X');
          setBoard(newBoard);
          setIsMyTurn(true);
        }
      } catch (err) {
        console.error('Error parsing game message:', err);
      }
    };

    gameSocket.addEventListener('message', handleMessage);
    return () => gameSocket.removeEventListener('message', handleMessage);
  }, [gameSocket, board, mySymbol]);

  const handleCellClick = (index: number) => {
    if (!isMyTurn || board[index] || !gameSocket) return;

    const newBoard = [...board];
    newBoard[index] = mySymbol;
    setBoard(newBoard);
    setIsMyTurn(false);

    gameSocket.send(JSON.stringify({
      type: 'GAME_MOVE',
      game: 'tictactoe',
      move: index,
    }));
  };

  const checkWinner = () => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];

    for (const line of lines) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return null;
  };

  const winner = checkWinner();
  const isDraw = !winner && board.every(cell => cell !== null);

  if (winner || isDraw) {
    setGameStatus(winner ? `${winner} Menang!` : 'Seri!');
  }

  return (
    <div className="absolute top-4 right-4 bg-zinc-900/90 backdrop-blur-md p-4 rounded-2xl border border-zinc-800 shadow-2xl z-20">
      <h3 className="text-white font-bold mb-3 text-center">Tic-Tac-Toe</h3>
      <p className="text-zinc-400 text-sm mb-3 text-center">{gameStatus}</p>
      <div className="grid grid-cols-3 gap-2">
        {board.map((cell, index) => (
          <button
            key={index}
            onClick={() => handleCellClick(index)}
            disabled={!isMyTurn || cell !== null}
            className={`w-16 h-16 rounded-lg font-bold text-2xl transition-all ${
              cell === 'X' 
                ? 'bg-sky-500 text-white' 
                : cell === 'O' 
                ? 'bg-rose-500 text-white' 
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
            } ${!isMyTurn || cell !== null ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            {cell}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          setBoard(Array(9).fill(null));
          setGameStatus('Tic-Tac-Toe');
          setIsMyTurn(true);
          setMySymbol('X');
        }}
        className="w-full mt-3 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium py-2 rounded-lg transition-all"
      >
        Reset Game
      </button>
    </div>
  );
}