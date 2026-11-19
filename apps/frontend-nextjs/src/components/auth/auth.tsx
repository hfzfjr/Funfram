'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface AuthOverlayProps {
    onConfirm: (username: string) => void;
}

export default function AuthOverlay({ onConfirm }: AuthOverlayProps) {
    const [username, setUsername] = useState('');
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [isConfirmed, setIsConfirmed] = useState(false);

    useEffect(() => {
        const savedUsername = localStorage.getItem('funfram_username');
        if (savedUsername) {
            setUsername(savedUsername.slice(0, 24));
        }
        const savedConsent = localStorage.getItem('funfram_age_consent_at');
        if (savedConsent) {
            setAcceptedTerms(true);
        }
    }, []);

    const canSubmit = Boolean(username.trim()) && acceptedTerms;

    const handleConfirm = () => {
        if (!canSubmit) return;
        const cleanName = username.trim().slice(0, 24);
        localStorage.setItem('funfram_username', cleanName);
        localStorage.setItem('funfram_age_consent_at', new Date().toISOString());
        setIsConfirmed(true);
        onConfirm(cleanName);
    };

    if (isConfirmed) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-overlay-title"
            className="fixed inset-0 bg-slate-50/85 backdrop-blur-md flex items-center justify-center z-50 p-4"
        >
            <div className="bg-white rounded-3xl max-w-[400px] md:max-w-[850px] w-full flex flex-col md:flex-row overflow-hidden shadow-[0_25px_50px_-12px_rgba(14,165,233,0.15),0_0_0_1px_rgba(14,165,233,0.05)] animate-[modalEnter_0.4s_cubic-bezier(0.16,1,0.3,1)]">
                <div className="flex-1 bg-gradient-to-br from-sky-100 to-sky-200 flex items-center justify-center h-[200px] md:h-auto p-0 md:p-8 relative overflow-hidden">
                    <div className="relative w-full h-full md:h-[350px] flex items-center justify-center group">
                        <img
                            src="/mockup1.png"
                            alt="Pratinjau FunFram 1"
                            className="absolute rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)] transition-transform duration-300 object-cover w-[45%] md:w-[60%] left-[10%] md:left-[5%] top-[15%] md:top-[10%] z-[2] -rotate-4 group-hover:-rotate-2 group-hover:scale-105 group-hover:z-[3]"
                        />
                        <img
                            src="/mockup2.png"
                            alt="Pratinjau FunFram 2"
                            className="absolute rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)] transition-transform duration-300 object-cover w-[50%] md:w-[65%] right-[5%] bottom-[15%] md:bottom-[10%] z-[1] rotate-6 group-hover:rotate-4 group-hover:scale-105 group-hover:z-[3]"
                        />
                    </div>
                </div>
                <div className="flex-1 p-8 md:px-12 md:py-12 flex flex-col justify-center">
                    <h1 id="auth-overlay-title" className="text-[1.75rem] md:text-[2.1rem] font-extrabold text-slate-900 m-0 mb-2 tracking-[-0.02em]">
                        Selamat Datang di <span className="text-sky-500">FunFram</span>
                    </h1>
                    <p className="text-slate-500 text-base m-0 mb-6">
                        Ngobrol video bareng teman &amp; mainkan 4 mini-game seru secara langsung!
                    </p>

                    <div className="flex flex-col gap-5">
                        <div>
                            <label htmlFor="auth-username-input" className="block text-slate-700 font-semibold mb-2 text-[0.9rem]">
                                Nama Tampilan
                            </label>
                            <input
                                id="auth-username-input"
                                type="text"
                                maxLength={24}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Masukkan nama kamu..."
                                className="w-full bg-slate-50 text-slate-900 px-5 py-3.5 rounded-xl border border-slate-200 text-base transition-all duration-200 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
                            />
                        </div>

                        <label className="flex items-start gap-3 text-xs text-slate-600 cursor-pointer select-none leading-relaxed">
                            <input
                                type="checkbox"
                                checked={acceptedTerms}
                                onChange={(e) => setAcceptedTerms(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                            />
                            <span>
                                Saya menyatakan berusia <strong>18 tahun ke atas</strong> dan menyetujui{' '}
                                <Link href="/legal/terms" target="_blank" className="text-sky-600 font-semibold hover:underline">
                                    Syarat &amp; Ketentuan
                                </Link>{' '}
                                serta{' '}
                                <Link href="/legal/privacy" target="_blank" className="text-sky-600 font-semibold hover:underline">
                                    Kebijakan Privasi
                                </Link>
                                .
                            </span>
                        </label>

                        <button
                            onClick={handleConfirm}
                            disabled={!canSubmit}
                            className={`w-full font-bold text-base p-4 rounded-xl transition-all duration-200 border-none ${
                                canSubmit
                                    ? 'bg-gradient-to-br from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 text-white shadow-[0_10px_15px_-3px_rgba(14,165,233,0.3)] hover:shadow-[0_10px_20px_-3px_rgba(14,165,233,0.4)] cursor-pointer active:scale-[0.98]'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            Mulai Sekarang
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
