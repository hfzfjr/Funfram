'use client';

import { useState, useEffect } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { ApiService } from '@/services/api.service';
import './InviteFriendsOverlay.css';

interface InviteFriendsOverlayProps {
    onClose: () => void;
}

export default function InviteFriendsOverlay({ onClose }: InviteFriendsOverlayProps) {
    const [inviteLink, setInviteLink] = useState('');
    const frameId = useCallStore((state) => state.frameId);
    const sessionId = useCallStore((state) => state.sessionId);
    const api = ApiService.getInstance();

    useEffect(() => {
        const generateLink = async () => {
            if (frameId) {
                const link = await api.generateInviteLink(frameId, sessionId || 'no-session');
                setInviteLink(link);
            }
        };
        generateLink();
    }, [frameId, sessionId, api]);

    const copyLink = () => {
        if (!inviteLink) return;
        navigator.clipboard.writeText(inviteLink);
        alert('Secure invite link copied to clipboard!');
    };


    return (
        <div className="overlay-backdrop" onClick={onClose}>
            <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
                <div className="overlay-header">
                    <h2 className="overlay-title">Invite Friends</h2>
                    <button onClick={onClose} className="close-button" aria-label="Close dialog">
                        ✕
                    </button>
                </div>

                <div className="overlay-body">
                    <p className="overlay-description">
                        Share this secure temporary link to invite friends to join your frame.
                        Valid while you remain in this frame/session.
                    </p>

                    <div className="link-container">
                        <input
                            type="text"
                            value={inviteLink || "Generating link..."}
                            readOnly
                            className="link-input"
                        />
                        <button onClick={copyLink} disabled={!inviteLink} className="copy-button">
                            Copy
                        </button>
                    </div>


                </div>
            </div>
        </div>
    );
}
