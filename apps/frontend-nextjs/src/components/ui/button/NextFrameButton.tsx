'use client';

import NextFrameIcon from '../../icons/NextFrameIcon';

interface NextFrameButtonProps {
    onClick?: () => void;
    disabled?: boolean;
    text?: string;
}

export default function NextFrameButton({ onClick, disabled = false, text = "Next Frame" }: NextFrameButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center justify-center gap-2 p-0 md:px-6 md:py-3 w-[52px] h-[52px] md:w-auto md:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-gradient-to-r from-indigo-500 to-violet-500 hover:enabled:from-indigo-600 hover:enabled:to-violet-600 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white"
        >
            <NextFrameIcon />
            <span className="hidden md:inline">{text}</span>
        </button>
    );
}
