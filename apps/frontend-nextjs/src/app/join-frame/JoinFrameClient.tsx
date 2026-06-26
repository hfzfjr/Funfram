'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiService } from '@/services/api.service';

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
        <main
            style={{
                minHeight: '100vh',
                display: 'grid',
                placeItems: 'center',
                background: 'radial-gradient(circle at top, #2a2f49, #111318 60%)',
                color: 'white',
                padding: '24px',
                fontFamily: 'Inter, sans-serif',
            }}
        >
            <section
                style={{
                    width: 'min(100%, 460px)',
                    borderRadius: '24px',
                    background: 'rgba(17, 19, 24, 0.88)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
                    padding: '28px',
                    backdropFilter: 'blur(16px)',
                }}
            >
                <div style={{ marginBottom: '20px' }}>
                    <p style={{ margin: 0, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: '12px' }}>
                        Join Frame
                    </p>
                    <h1 style={{ margin: '10px 0 8px', fontSize: '2rem', lineHeight: 1.1 }}>
                        Masuk ke frame teman
                    </h1>
                    <p style={{ margin: 0, color: 'rgba(255,255,255,0.72)', lineHeight: 1.6 }}>
                        Username akan disimpan di browser, lalu kamu diarahkan ke frame yang sama.
                    </p>
                </div>

                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Username
                </label>
                <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Masukkan username"
                    style={{
                        width: '100%',
                        borderRadius: '14px',
                        border: '1px solid rgba(255,255,255,0.14)',
                        background: 'rgba(255,255,255,0.06)',
                        color: 'white',
                        padding: '14px 16px',
                        fontSize: '1rem',
                        outline: 'none',
                    }}
                />

                {error && (
                    <div style={{ marginTop: '14px', color: '#fca5a5', fontSize: '0.95rem' }}>
                        {error}
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleJoin}
                    disabled={isChecking}
                    style={{
                        width: '100%',
                        marginTop: '20px',
                        border: 'none',
                        borderRadius: '999px',
                        padding: '14px 18px',
                        background: isChecking ? '#475569' : 'linear-gradient(135deg, #08A7FD, #0052BE)',
                        color: 'white',
                        fontWeight: 700,
                        cursor: isChecking ? 'wait' : 'pointer',
                    }}
                >
                    {isChecking ? 'Memeriksa undangan...' : 'Gabung Frame'}
                </button>
            </section>
        </main>
    );
}
