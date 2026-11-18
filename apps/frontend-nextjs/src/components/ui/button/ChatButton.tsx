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
            className="relative flex items-center justify-center gap-2 p-0 md:px-6 md:py-3 w-[52px] h-[52px] md:w-auto md:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-transparent hover:enabled:bg-slate-100 text-slate-700 hover:enabled:text-slate-900 active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <ChatIcon />
            <span className="hidden md:inline">Chat</span>
            {hasUnread && <div className="absolute top-2 right-2 md:top-2.5 md:right-3.5 w-2 h-2 bg-rose-500 rounded-full"></div>}
        </button>
    );
}
