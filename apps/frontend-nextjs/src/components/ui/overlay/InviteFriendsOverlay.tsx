'use client';

import './InviteFriendsOverlay.css';

interface InviteFriendsOverlayProps {
    onClose: () => void;
}

export default function InviteFriendsOverlay({ onClose }: InviteFriendsOverlayProps) {
    const copyLink = () => {
        // Copy current URL to clipboard
        navigator.clipboard.writeText(window.location.href);
        alert('Link copied!');
    };

    return (
        <div className="overlay-backdrop" onClick={onClose}>
            <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
                <div className="overlay-header">
                    <h2 className="overlay-title">Invite Friends</h2>
                    <button onClick={onClose} className="close-button">
                        ✕
                    </button>
                </div>

                <div className="overlay-body">
                    <p className="overlay-description">
                        Share this link with your friends to invite them to join your frame.
                    </p>

                    <div className="link-container">
                        <input
                            type="text"
                            value={window.location.href}
                            readOnly
                            className="link-input"
                        />
                        <button onClick={copyLink} className="copy-button">
                            Copy
                        </button>
                    </div>

                    <div className="social-buttons">
                        <button className="social-button">
                            Share on WhatsApp
                        </button>
                        <button className="social-button">
                            Share on Telegram
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
