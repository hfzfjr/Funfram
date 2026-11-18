'use client';

import LeaveFrameIcon from '../../icons/LeaveFrameIcon';

interface LeaveFrameButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function LeaveFrameButton({ onClick, disabled = false }: LeaveFrameButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center justify-center gap-2 p-0 md:px-6 md:py-3 w-[52px] h-[52px] md:w-auto md:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-rose-500 hover:enabled:bg-rose-600 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white"
        >
            <LeaveFrameIcon />
            <span className="hidden md:inline">Leave</span>
        </button>
    );
}
