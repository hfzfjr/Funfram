'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiService } from '@/services/api.service';

import '@/components/auth/auth.css';

export default function JoinFrameClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [username, setUsername] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const invitePayload = useMemo(() => {
        return {
            invite: searchParams.get('invite') || '',
            frameId: searchParams.get('frameId') || '',
            sessionId: searchParams.get('sessionId') || '',
            expire: searchParams.get('expire') || '',
            nonce: searchParams.get('nonce') || '',
        };
    }, [searchParams]);

    useEffect(() => {
        const savedUsername = localStorage.getItem('funfram_username');
        if (savedUsername) {
            setUsername(savedUsername);
        }
    }, []);

    const handleJoin = async () => {
        setError(null);
        const trimmedUsername = username.trim();
        if (!trimmedUsername) {
            setError('Masukkan username dulu.');
            return;
        }

        if (!invitePayload.invite || !invitePayload.frameId || !invitePayload.expire || !invitePayload.nonce) {
            setError('Link undangan tidak lengkap.');
            return;
        }

        try {
            setIsChecking(true);
            const api = ApiService.getInstance();
            const verification = await api.verifyInviteLink(
                invitePayload.frameId,
                invitePayload.sessionId || 'no-session',
                invitePayload.expire,
                invitePayload.nonce,
                invitePayload.invite,
            );

            if (!verification.isValid) {
                setError('Undangan sudah tidak valid atau kedaluwarsa.');
                return;
            }

            localStorage.setItem('funfram_username', trimmedUsername);
            sessionStorage.setItem('funfram_autostart', '1');

            const { useCallStore } = await import('@/store/useCallStore');
            useCallStore.getState().setLocalUser({
                id: crypto.randomUUID(),
                stream: null,
                name: trimmedUsername,
                isMuted: false,
                isCameraOff: false,
                isOwner: false,
                presence: 'ONLINE',
                joinOrder: 2,
            });

            const nextParams = new URLSearchParams({
                invite: invitePayload.invite,
                frameId: invitePayload.frameId,
                sessionId: invitePayload.sessionId || 'no-session',
                expire: invitePayload.expire,
                nonce: invitePayload.nonce,
            });

            router.replace(`/funvideo?${nextParams.toString()}`);
        } finally {
            setIsChecking(false);
        }
    };

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
                            disabled={isChecking}
                        />
                        {error && (
                            <div style={{ marginTop: '8px', color: '#fca5a5', fontSize: '0.9rem' }}>
                                {error}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleJoin}
                        disabled={!username.trim() || isChecking}
                        className={`auth-button ${username.trim() && !isChecking ? 'enabled' : 'disabled'}`}
                    >
                        {isChecking ? 'Memeriksa...' : 'Konfirmasi'}
                    </button>
                </div>
            </div>
        </div>
    );
}
