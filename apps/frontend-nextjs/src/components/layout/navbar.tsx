'use client';

import { useState } from 'react';
import Link from 'next/link';
import InviteFriendsButton from '../ui/button/InviteFriendsButton';
import InviteFriendsOverlay from '../ui/overlay/InviteFriendsOverlay';
import './navbar.css';

export default function Navbar() {
    const [showInviteOverlay, setShowInviteOverlay] = useState(false);

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
                    <Link href="/funchat" className="nav-link">
                        FunChat
                    </Link>
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
        </>
    );
}
