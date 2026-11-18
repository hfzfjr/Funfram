'use client';

import ChatIcon from '../../icons/ChatIcon';

interface ChatButtonProps {
    onClick?: () => void;
    disabled?: boolean;
    hasUnread?: boolean;
}

export default function ChatButton({ onClick, disabled = false, hasUnread = false }: ChatButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="relative flex items-center justify-center gap-2 p-0 lg:px-5 lg:py-3 w-11 h-11 lg:w-auto lg:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-transparent hover:enabled:bg-slate-100 text-slate-700 hover:enabled:text-slate-900 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <ChatIcon />
            <span className="hidden lg:inline">Chat</span>
            {hasUnread && <div className="absolute top-1.5 right-1.5 lg:top-2.5 lg:right-3.5 w-2 h-2 bg-rose-500 rounded-full"></div>}
        </button>
    );
}
