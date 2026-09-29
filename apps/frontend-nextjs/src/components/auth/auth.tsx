'use client';

import { useEffect, useState } from 'react';
import './auth.css';

interface AuthOverlayProps {
    onConfirm: (username: string) => void;
}

export default function AuthOverlay({ onConfirm }: AuthOverlayProps) {
    const [username, setUsername] = useState('');
    const [isConfirmed, setIsConfirmed] = useState(false);

    useEffect(() => {
        const savedUsername = localStorage.getItem('funfram_username');
        if (savedUsername) {
            setUsername(savedUsername);
        }
    }, []);

    const handleConfirm = () => {
        if (username.trim()) {
            localStorage.setItem('funfram_username', username.trim());
            setIsConfirmed(true);
            onConfirm(username.trim());
        }
    };

    if (isConfirmed) return null;

    return (
        <div className="auth-overlay">
            <div className="auth-modal">
                <div className="auth-modal-left">
                    <div className="auth-image-collage">
                        <img src="/mockup1.png" alt="Mockup 1" className="auth-img img1" />
                        <img src="/mockup2.png" alt="Mockup 2" className="auth-img img2" />
                    </div>
                </div>
                <div className="auth-modal-right">
                    <h1 className="auth-title">Welcome to <span style={{color: '#0ea5e9'}}>FunFram</span></h1>
                    <p className="auth-subtitle">Connect, play, and interact in real-time!</p>

                    <div className="auth-form">
                        <div>
                            <label className="auth-label">Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Enter your username..."
                                className="auth-input"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
                            />
                        </div>

                        <button
                            onClick={handleConfirm}
                            disabled={!username.trim()}
                            className={`auth-button ${username.trim() ? 'enabled' : 'disabled'}`}
                        >
                            Get Started
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
