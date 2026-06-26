'use client';

import { WebSocketService } from '@/services/websocket.service';
import { useCallStore } from '@/store/useCallStore';
import './InviteFriendsOverlay.css'; // Reuse overlay classes for consistent styling

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
        { id: 'uno', name: 'UNO Card Game', icon: '🃏', available: false, desc: 'Classic color and number matching card game.' },
        { id: 'chess', name: 'Chess Arena', icon: '👑', available: false, desc: 'Engage in a 1v1 battle of deep logical tactics.' },
        { id: 'ludo', name: 'Ludo Party', icon: '🎲', available: false, desc: 'Roll dice, move tokens, and reach the home base.' }
    ];

    return (
        <div className="overlay-backdrop" onClick={onClose}>
            <div className="overlay-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                <div className="overlay-header">
                    <h2 className="overlay-title">Launch Game</h2>
                    <button onClick={onClose} className="close-button">✕</button>
                </div>

                <div className="overlay-body">
                    <p className="overlay-description" style={{ marginBottom: '20px' }}>
                        Select an interactive game to play with the opponent frame.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {games.map(game => (
                            <button
                                key={game.id}
                                disabled={!game.available}
                                onClick={() => handleSelectGame(game.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    padding: '16px',
                                    borderRadius: '12px',
                                    border: '1px solid #2a2a2a',
                                    background: game.available ? '#2a2d3d' : '#1e1f29',
                                    textAlign: 'left',
                                    cursor: game.available ? 'pointer' : 'not-allowed',
                                    opacity: game.available ? 1 : 0.6,
                                    transition: 'all 0.2s',
                                    width: '100%'
                                }}
                                className={game.available ? 'hover:border-blue-500 hover:scale-[1.02]' : ''}
                            >
                                <span style={{ fontSize: '32px' }}>{game.icon}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: '600', color: 'white', fontSize: '15px' }}>{game.name}</span>
                                        {!game.available && (
                                            <span style={{
                                                fontSize: '10px',
                                                background: '#4b5563',
                                                color: '#d1d5db',
                                                padding: '2px 6px',
                                                borderRadius: '4px'
                                            }}>SOON</span>
                                        )}
                                    </div>
                                    <p style={{ fontSize: '12px', color: '#a1a1aa', margin: '4px 0 0 0' }}>{game.desc}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
