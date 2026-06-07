'use client';

import InviteFriendsIcon from '../../icons/InviteFriendsIcon';
import './button.css';

interface InviteFriendsButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function InviteFriendsButton({ onClick, disabled = false }: InviteFriendsButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="invite-button"
        >
            <InviteFriendsIcon />
            <span>Invite Friends</span>
        </button>
    );
}
