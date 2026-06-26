'use client';

import { useState } from 'react';
import Link from 'next/link';
import InviteFriendsButton from '../ui/button/InviteFriendsButton';
import InviteFriendsOverlay from '../ui/overlay/InviteFriendsOverlay';
import './navbar.css';
import '../ui/overlay/InviteFriendsOverlay.css'; // Ensure modal classes are loaded

export default function Navbar() {
    const [showInviteOverlay, setShowInviteOverlay] = useState(false);
    const [showFunChatModal, setShowFunChatModal] = useState(false);

    const handleFunChatClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setShowFunChatModal(true);
    };

    return (
        <>
            <nav className="navbar">
                {/* Left: Logo and Live indicator */}
                <div className="navbar-left">
                    <img
                        src="/logo-utama.png"
                        alt="FunFram"
                        className="navbar-logo"
                    />
                    <div className="navbar-live">
                        <div className="live-dot"></div>
                        <span className="live-text">Live</span>
                    </div>
                </div>

                {/* Center: Navigation */}
                <div className="navbar-center">
                    <Link href="/funvideo" className="nav-link active">
                        FunVideo
                    </Link>
                    <a href="/funchat" onClick={handleFunChatClick} className="nav-link">
                        FunChat
                    </a>
                </div>

                {/* Right: Invite Friends button */}
                <InviteFriendsButton
                    onClick={() => setShowInviteOverlay(true)}
                />
            </nav>

            {/* Invite Friends Overlay */}
            {showInviteOverlay && (
                <InviteFriendsOverlay onClose={() => setShowInviteOverlay(false)} />
            )}

            {/* FunChat disabled modal alert */}
            {showFunChatModal && (
                <div className="overlay-backdrop" onClick={() => setShowFunChatModal(false)}>
                    <div className="overlay-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center' }}>
                        <div className="overlay-header">
                            <h2 className="overlay-title">FunChat</h2>
                            <button onClick={() => setShowFunChatModal(false)} className="close-button" aria-label="Close dialog">
                                ✕
                            </button>
                        </div>
                        <div className="overlay-body" style={{ padding: '24px 16px' }}>
                            <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>💬</span>
                            <h3 style={{ color: 'white', marginBottom: '10px', fontSize: '18px' }}>Coming Soon!</h3>
                            <p className="overlay-description" style={{ fontSize: '14px', lineHeight: '1.5' }}>
                                FunChat is coming in the next version of FunFram. Stay tuned!
                            </p>
                            <button 
                                onClick={() => setShowFunChatModal(false)}
                                style={{
                                    marginTop: '20px',
                                    background: 'linear-gradient(to right, #08A7FD, #0052BE)',
                                    border: 'none',
                                    color: 'white',
                                    padding: '10px 24px',
                                    borderRadius: '20px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
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
