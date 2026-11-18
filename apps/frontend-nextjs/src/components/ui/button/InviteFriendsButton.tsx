'use client';

import InviteFriendsIcon from '../../icons/InviteFriendsIcon';

interface InviteFriendsButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function InviteFriendsButton({ onClick, disabled = false }: InviteFriendsButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center justify-center gap-2 p-0 lg:px-5 lg:py-2.5 w-11 h-11 lg:w-auto lg:h-11 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500 text-white hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <InviteFriendsIcon />
            <span className="hidden lg:inline">Invite Friends</span>
        </button>
    );
}
