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
        ws.sendEvent('GAME_ACCEPT', { sessionId: gameInvite.sessionId });
        acceptGameInvite();
    };

    const handleDecline = () => {
        ws.sendEvent('GAME_DECLINE', { sessionId: gameInvite.sessionId });
        declineGameInvite();
    };

    return (
        <div style={{
            position: 'fixed',
            bottom: '100px',
            right: '24px',
            background: '#1f2937',
            border: '2px solid #8b5cf6',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
            borderRadius: '16px',
            padding: '20px',
            zIndex: 9999,
            width: '320px',
            animation: 'slideUp 0.3s ease-out',
            color: 'white',
        }}>
            <style jsx>{`
                @keyframes slideUp {
                    from { transform: translateY(50px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ fontSize: '28px' }}>🎮</span>
                <div>
                    <h4 style={{ margin: 0, fontWeight: '600', fontSize: '15px' }}>Incoming Game Invite</h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#9ca3af' }}>
                        From owner <strong style={{ color: '#ec4899' }}>{gameInvite.senderName}</strong>
                    </p>
                </div>
            </div>
            
            <p style={{ fontSize: '13px', color: '#d1d5db', margin: '0 0 16px 0' }}>
                They have invited you to play a round of <strong>Guess Drawing</strong>.
            </p>
            
            <div style={{ display: 'flex', gap: '10px' }}>
                <button
                    onClick={handleAccept}
                    style={{
                        flex: 1,
                        background: 'linear-gradient(to right, #ec4899, #8b5cf6)',
                        color: 'white',
                        border: 'none',
                        padding: '10px 16px',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'transform 0.1s'
                    }}
                    onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                    onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    Accept
                </button>
                <button
                    onClick={handleDecline}
                    style={{
                        flex: 1,
                        background: '#374151',
                        color: '#d1d5db',
                        border: '1px solid #4b5563',
                        padding: '10px 16px',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'transform 0.1s'
                    }}
                    onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                    onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    Decline
                </button>
            </div>
        </div>
    );
}
