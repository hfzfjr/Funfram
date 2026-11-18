'use client';

import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';

interface GameInviteModalProps {
    onClose: () => void;
}

export default function GameInviteModal({ onClose }: GameInviteModalProps) {
    const ws = WebSocketService.getInstance();
    const sessionId = useCallStore((state) => state.sessionId);

    const handleSelectGame = (gameType: string) => {
        if (!sessionId) return;
        ws.sendEvent('GAME_INVITE', { sessionId, gameType });
        onClose();
    };

    const games = [
        { id: 'guess_drawing', name: 'Guess Drawing', icon: '🎨', available: true, desc: 'Draw a secret word and compete to guess it first!' },
        { id: 'uno', name: 'UNO Card Game', icon: '🃏', available: true, desc: 'Classic color and number matching card game.' },
        { id: 'chess', name: 'Chess Arena', icon: '👑', available: true, desc: 'Engage in a 1v1 battle of deep logical tactics.' },
        { id: 'ludo', name: 'Ludo Party', icon: '🎲', available: true, desc: 'Roll dice, move tokens, and reach the home base.' }
    ];

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000]" onClick={onClose}>
            <div className="bg-white border border-zinc-100 rounded-xl p-6 max-w-[480px] w-[90%] shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-xl font-semibold text-slate-900 m-0">Launch Game</h2>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-zinc-600 hover:text-slate-900 text-2xl cursor-pointer p-1 leading-none transition-colors"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex flex-col gap-4">
                    <p className="text-sm text-zinc-600 m-0 mb-1">
                        Select an interactive game to play with the opponent frame.
                    </p>

                    <div className="flex flex-col gap-3">
                        {games.map((game) => (
                            <button
                                key={game.id}
                                disabled={!game.available}
                                onClick={() => handleSelectGame(game.id)}
                                className={`flex items-center gap-4 p-4 rounded-xl border border-slate-200 text-left w-full transition-all duration-200 ${
                                    game.available
                                        ? 'bg-sky-100 hover:border-blue-500 hover:scale-[1.02] cursor-pointer'
                                        : 'bg-slate-100 opacity-60 cursor-not-allowed'
                                }`}
                            >
                                <span className="text-[32px]">{game.icon}</span>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-slate-900 text-[15px]">{game.name}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1 mb-0">{game.desc}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
