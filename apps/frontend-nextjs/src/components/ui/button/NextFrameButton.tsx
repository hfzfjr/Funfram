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
            className="flex items-center justify-center gap-2 p-0 lg:px-5 lg:py-3 w-11 h-11 lg:w-auto lg:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-gradient-to-r from-indigo-500 to-violet-500 hover:enabled:from-indigo-600 hover:enabled:to-violet-600 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white"
        >
            <NextFrameIcon />
            <span className="hidden lg:inline">{text}</span>
        </button>
    );
}
