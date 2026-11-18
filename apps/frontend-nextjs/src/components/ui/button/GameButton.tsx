'use client';

interface GameButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function GameButton({ onClick, disabled = false }: GameButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center justify-center gap-2 p-0 md:px-6 md:py-3 w-[52px] h-[52px] md:w-auto md:h-12 border-none rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap active:enabled:scale-95 ${
                disabled
                    ? 'bg-[#1b1d28] text-gray-600 opacity-50 cursor-not-allowed'
                    : 'bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 text-white cursor-pointer'
            }`}
            aria-label="Launch Game Room"
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="12" x2="10" y2="12" />
                <line x1="8" y1="10" x2="8" y2="14" />
                <line x1="15" y1="13" x2="15.01" y2="13" />
                <line x1="18" y1="11" x2="18.01" y2="11" />
                <rect x="2" y="6" width="20" height="12" rx="3" />
            </svg>
            <span className="hidden md:inline">Play Game</span>
        </button>
    );
}
