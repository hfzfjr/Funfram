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
            className="flex items-center justify-center gap-2 p-0 lg:px-5 lg:py-3 w-11 h-11 lg:w-auto lg:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-rose-500 hover:enabled:bg-rose-600 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white"
        >
            <LeaveFrameIcon />
            <span className="hidden lg:inline">Leave</span>
        </button>
    );
}
