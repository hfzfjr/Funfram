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
                <h1 className="auth-title">FunFram</h1>

                <div className="auth-form">
                    <div>
                        <label className="auth-label">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Masukkan username"
                            className="auth-input"
                        />
                    </div>

                    <button
                        onClick={handleConfirm}
                        disabled={!username.trim()}
                        className={`auth-button ${username.trim() ? 'enabled' : 'disabled'}`}
                    >
                        Konfirmasi
                    </button>
                </div>
            </div>
        </div>
    );
}
