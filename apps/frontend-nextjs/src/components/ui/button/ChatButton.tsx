'use client';

import ChatIcon from '../../icons/ChatIcon';
import './button.css';

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
            className="button chat-button"
        >
            <ChatIcon />
            <span>Chat</span>
            {hasUnread && <div className="unread-badge"></div>}
        </button>
    );
}
