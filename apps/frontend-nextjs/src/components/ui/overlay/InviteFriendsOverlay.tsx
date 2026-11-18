'use client';

import { useState, useEffect } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { ApiService } from '@/services/api.service';

interface InviteFriendsOverlayProps {
    onClose: () => void;
}

export default function InviteFriendsOverlay({ onClose }: InviteFriendsOverlayProps) {
    const [inviteLink, setInviteLink] = useState('');
    const frameId = useCallStore((state) => state.frameId);
    const sessionId = useCallStore((state) => state.sessionId);
    const api = ApiService.getInstance();

    useEffect(() => {
        let cancelled = false;
        const generateLink = async () => {
            if (frameId) {
                const link = await api.generateInviteLink(frameId, sessionId || 'no-session');
                if (!cancelled) setInviteLink(link);
            }
        };
        generateLink();
        return () => {
            cancelled = true;
        };
    }, [frameId, sessionId, api]);

    const copyLink = async () => {
        if (!inviteLink) return;
        try {
            await navigator.clipboard.writeText(inviteLink);
            useCallStore.getState().showCustomAlert('Tautan undangan berhasil disalin!', 'success');
        } catch {
            useCallStore.getState().showCustomAlert('Gagal menyalin tautan. Salin manual dari kolom input.', 'error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000]" onClick={onClose}>
            <div className="bg-white border border-zinc-100 rounded-xl p-6 max-w-[480px] w-[90%] shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-xl font-semibold text-slate-900 m-0">Invite Friends</h2>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-zinc-600 hover:text-slate-900 text-2xl cursor-pointer p-1 leading-none transition-colors"
                        aria-label="Close dialog"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex flex-col gap-4">
                    <p className="text-sm text-zinc-600 m-0">
                        Share this secure temporary link to invite friends to join your frame.
                        Valid while you remain in this frame/session.
                    </p>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={inviteLink || 'Generating link...'}
                            readOnly
                            className="flex-1 bg-zinc-100 border border-zinc-200 focus:border-blue-500 rounded-lg px-3 py-2.5 text-slate-900 text-sm outline-none"
                        />
                        <button
                            onClick={copyLink}
                            disabled={!inviteLink}
                            className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white border-none px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors"
                        >
                            Copy
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
