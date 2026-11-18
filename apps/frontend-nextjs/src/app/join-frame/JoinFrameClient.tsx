'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiService } from '@/services/api.service';
import FloatingBackgroundIcons from '@/components/ui/background/FloatingBackgroundIcons';

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

            router.replace(`/?${nextParams.toString()}`);
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-50/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <FloatingBackgroundIcons />
            <div className="relative z-10 bg-white rounded-3xl max-w-[400px] md:max-w-[850px] w-full flex flex-col md:flex-row overflow-hidden shadow-[0_25px_50px_-12px_rgba(14,165,233,0.15),0_0_0_1px_rgba(14,165,233,0.05)] animate-[modalEnter_0.4s_cubic-bezier(0.16,1,0.3,1)]">
                <div className="flex-1 bg-gradient-to-br from-sky-100 to-sky-200 flex items-center justify-center h-[200px] md:h-auto p-0 md:p-8 relative overflow-hidden">
                    <div className="relative w-full h-full md:h-[350px] flex items-center justify-center group">
                        <img
                            src="/mockup1.png"
                            alt="FunFram Preview 1"
                            className="absolute rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)] transition-transform duration-300 object-cover w-[45%] md:w-[60%] left-[10%] md:left-[5%] top-[15%] md:top-[10%] z-[2] -rotate-4 group-hover:-rotate-2 group-hover:scale-105 group-hover:z-[3]"
                        />
                        <img
                            src="/mockup2.png"
                            alt="FunFram Preview 2"
                            className="absolute rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)] transition-transform duration-300 object-cover w-[50%] md:w-[65%] right-[5%] bottom-[15%] md:bottom-[10%] z-[1] rotate-6 group-hover:rotate-4 group-hover:scale-105 group-hover:z-[3]"
                        />
                    </div>
                </div>
                <div className="flex-1 p-8 md:px-12 md:py-14 flex flex-col justify-center">
                    <h1 className="text-[1.75rem] md:text-[2.2rem] font-extrabold text-slate-900 m-0 mb-2 tracking-[-0.02em]">
                        Join <span className="text-sky-500">FunFram</span>
                    </h1>
                    <p className="text-slate-500 text-base m-0 mb-8">Enter your username to join your friend&apos;s frame!</p>

                    <div className="flex flex-col gap-6">
                        <div>
                            <label className="block text-slate-700 font-semibold mb-2 text-[0.9rem]">Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Enter your username..."
                                className="w-full bg-slate-50 text-slate-900 px-5 py-4 rounded-xl border border-slate-200 text-base transition-all duration-200 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                                disabled={isChecking}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && username.trim() && !isChecking) {
                                        handleJoin();
                                    }
                                }}
                            />
                            {error && (
                                <div className="mt-2 text-red-600 text-[0.88rem] font-medium">
                                    {error}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleJoin}
                            disabled={!username.trim() || isChecking}
                            className={`w-full font-bold text-base p-4 rounded-xl transition-all duration-200 border-none mt-2 ${
                                username.trim() && !isChecking
                                    ? 'bg-gradient-to-br from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 text-white shadow-[0_10px_15px_-3px_rgba(14,165,233,0.3)] hover:shadow-[0_10px_20px_-3px_rgba(14,165,233,0.4)] cursor-pointer active:scale-[0.98]'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            {isChecking ? 'Memeriksa...' : 'Join Frame'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
