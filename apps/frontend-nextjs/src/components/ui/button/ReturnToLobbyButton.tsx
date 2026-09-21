'use client';

import './button.css';

interface ReturnToLobbyButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function ReturnToLobbyButton({ onClick, disabled = false }: ReturnToLobbyButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="button return-lobby-button"
        >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 14 4 9l5-5"/>
                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
            </svg>
            <span>Lobby</span>
        </button>
    );
}
