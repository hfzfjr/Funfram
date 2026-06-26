'use client';

import './button.css';

interface GameButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function GameButton({ onClick, disabled = false }: GameButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`button game-button ${disabled ? 'disabled-game-btn' : ''}`}
            style={{
                background: disabled ? '#1b1d28' : 'linear-gradient(to right, #ec4899, #8b5cf6)',
                color: disabled ? '#4b5563' : 'white',
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
            }}
            aria-label="Launch Game Room"
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="12" x2="10" y2="12" />
                <line x1="8" y1="10" x2="8" y2="14" />
                <line x1="15" y1="13" x2="15.01" y2="13" />
                <line x1="18" y1="11" x2="18.01" y2="11" />
                <rect x="2" y="6" width="20" height="12" rx="3" />
            </svg>
            <span>Play Game</span>
        </button>
    );
}
