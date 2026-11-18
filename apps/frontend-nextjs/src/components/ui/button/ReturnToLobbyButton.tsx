'use client';

interface ReturnToLobbyButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function ReturnToLobbyButton({ onClick, disabled = false }: ReturnToLobbyButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center justify-center gap-2 p-0 lg:px-5 lg:py-3 w-11 h-11 lg:w-auto lg:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-slate-200 hover:enabled:bg-slate-300 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800"
        >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
            </svg>
            <span className="hidden lg:inline">Lobby</span>
        </button>
    );
}
