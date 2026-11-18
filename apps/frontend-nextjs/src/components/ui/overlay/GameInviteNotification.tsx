'use client';

import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';

export default function GameInviteNotification() {
    const ws = WebSocketService.getInstance();
    const gameInvite = useCallStore((state) => state.gameInvite);
    const acceptGameInvite = useCallStore((state) => state.acceptGameInvite);
    const declineGameInvite = useCallStore((state) => state.declineGameInvite);

    if (!gameInvite) return null;

    const handleAccept = () => {
        acceptGameInvite();
    };

    const handleDecline = () => {
        declineGameInvite();
    };

    return (
        <div className="fixed bottom-[100px] right-6 bg-white border border-slate-200 shadow-xl rounded-2xl p-5 z-[9999] w-80 animate-[slideUp_0.3s_ease-out] text-slate-900">
            <div className="flex items-center gap-3 mb-3">
                <span className="text-[28px] leading-none">🎮</span>
                <div>
                    <h4 className="m-0 font-semibold text-[15px]">Incoming Game Invite</h4>
                    <p className="mt-0.5 mb-0 text-xs text-slate-500">
                        From owner <strong className="text-pink-500">{gameInvite.senderName}</strong>
                    </p>
                </div>
            </div>
            
            <p className="text-[13px] text-slate-600 mt-0 mb-4">
                Mengajak bermain{' '}
                <strong>
                    {gameInvite.gameType === 'uno'
                        ? 'UNO Card Game'
                        : gameInvite.gameType === 'chess'
                        ? 'Chess Arena'
                        : gameInvite.gameType === 'ludo'
                        ? 'Ludo Party'
                        : 'Guess Drawing'}
                </strong>
                {(!gameInvite.gameType || gameInvite.gameType === 'guess_drawing') && (
                    <span>
                        {' '}• <strong>{gameInvite.rounds || 1} Ronde</strong>
                    </span>
                )}
                .
            </p>
            
            <div className="flex gap-2.5">
                <button
                    onClick={handleAccept}
                    className="flex-1 bg-gradient-to-r from-pink-500 to-violet-500 text-white border-none px-4 py-2.5 rounded-lg font-semibold text-[13px] cursor-pointer transition-transform duration-100 active:scale-95"
                >
                    Accept
                </button>
                <button
                    onClick={handleDecline}
                    className="flex-1 bg-slate-100 text-slate-700 border border-slate-200 px-4 py-2.5 rounded-lg font-semibold text-[13px] cursor-pointer transition-transform duration-100 active:scale-95"
                >
                    Decline
                </button>
            </div>
        </div>
    );
}


