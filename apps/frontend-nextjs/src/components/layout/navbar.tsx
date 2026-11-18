'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCallStore } from '@/store/useCallStore';
import InviteFriendsButton from '../ui/button/InviteFriendsButton';
import InviteFriendsOverlay from '../ui/overlay/InviteFriendsOverlay';

export default function Navbar() {
    const [showInviteOverlay, setShowInviteOverlay] = useState(false);
    const [showFunChatModal, setShowFunChatModal] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);

    const handleFunChatClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setShowFunChatModal(true);
        setShowMobileMenu(false);
    };

    return (
        <>
            <nav className="w-full h-16 md:h-[95px] bg-transparent flex items-center justify-between px-4 md:px-8 relative z-[1000] box-border">
                {/* Left: Hamburger, Logo and Live indicator */}
                <div className="flex items-center gap-2 md:gap-4">
                    <button
                        className="flex md:hidden items-center justify-center bg-transparent border-none text-slate-900 cursor-pointer p-2 mr-2"
                        onClick={() => setShowMobileMenu(true)}
                        aria-label="Open menu"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                    <img
                        src="/logo-utama.png"
                        alt="FunFram"
                        className="hidden md:block h-8 w-auto object-contain"
                    />
                    <div className="bg-green-500/15 border border-green-500/30 px-3.5 py-1.5 rounded-full flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
                        <span className="text-sm font-semibold text-slate-900">Live</span>
                    </div>
                </div>

                {/* Center: Navigation (Hidden on mobile) */}
                <div className="hidden md:flex items-center gap-12 absolute left-1/2 -translate-x-1/2">
                    <Link
                        href="/funvideo"
                        className="relative text-base font-semibold text-slate-900 no-underline pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-gradient-to-br after:from-[#00C6FF] after:via-blue-500 after:to-purple-500 after:rounded-sm"
                    >
                        FunVideo
                    </Link>
                    <a
                        href="/funchat"
                        onClick={handleFunChatClick}
                        className="relative text-base font-medium text-slate-400 hover:text-slate-600 no-underline pb-2 transition-colors"
                    >
                        FunChat
                    </a>
                </div>

                {/* Right: Invite Friends button */}
                <div className="flex items-center gap-4">
                    <InviteFriendsButton
                        onClick={() => {
                            const { fsmState, showCustomAlert } = useCallStore.getState();
                            if (fsmState === 'FRAME') {
                                setShowInviteOverlay(true);
                            } else {
                                showCustomAlert('Kamu sedang mencari/berada di dalam match. Kembali ke lobby (tekan tombol Lobby) terlebih dahulu untuk mengundang teman.', 'error');
                            }
                        }}
                    />
                </div>
            </nav>

            {/* Mobile Sidebar */}
            {showMobileMenu && (
                <div className="fixed inset-0 bg-black/70 z-[2000] animate-[fadeIn_0.2s_ease-out]" onClick={() => setShowMobileMenu(false)}>
                    <div
                        className="absolute top-0 left-0 w-[280px] h-screen bg-white flex flex-col p-6 animate-[slideInLeft_0.3s_ease-out]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-12">
                            <img src="/logo-utama.png" alt="FunFram" className="h-8 w-auto object-contain" />
                            <button
                                className="bg-transparent border-none text-slate-900 text-2xl cursor-pointer"
                                onClick={() => setShowMobileMenu(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex flex-col gap-6">
                            <Link
                                href="/funvideo"
                                className="relative text-lg font-semibold text-slate-900 no-underline pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-gradient-to-br after:from-[#00C6FF] after:via-blue-500 after:to-purple-500 after:rounded-sm"
                                onClick={() => setShowMobileMenu(false)}
                            >
                                FunVideo
                            </Link>
                            <a
                                href="/funchat"
                                onClick={handleFunChatClick}
                                className="relative text-lg font-medium text-slate-400 hover:text-slate-600 no-underline pb-2 transition-colors"
                            >
                                FunChat
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* Invite Friends Overlay */}
            {showInviteOverlay && (
                <InviteFriendsOverlay onClose={() => setShowInviteOverlay(false)} />
            )}

            {/* FunChat disabled modal alert */}
            {showFunChatModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000]" onClick={() => setShowFunChatModal(false)}>
                    <div
                        className="bg-white border border-zinc-100 rounded-xl p-6 max-w-[400px] w-[90%] text-center shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-xl font-semibold text-slate-900 m-0">FunChat</h2>
                            <button
                                onClick={() => setShowFunChatModal(false)}
                                className="bg-transparent border-none text-zinc-600 hover:text-slate-900 text-2xl cursor-pointer p-1 leading-none transition-colors"
                                aria-label="Close dialog"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex flex-col gap-4 py-6 px-4">
                            <span className="text-5xl block mb-2">💬</span>
                            <h3 className="text-slate-900 mb-2 text-lg font-bold">Coming Soon!</h3>
                            <p className="text-sm text-zinc-600 leading-relaxed m-0">
                                FunChat is coming in the next version of FunFram. Stay tuned!
                            </p>
                            <button
                                onClick={() => setShowFunChatModal(false)}
                                className="mt-5 bg-gradient-to-r from-[#08A7FD] to-[#0052BE] border-none text-white px-6 py-2.5 rounded-[20px] font-semibold cursor-pointer"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
