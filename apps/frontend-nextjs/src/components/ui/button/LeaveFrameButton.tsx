'use client';

import LeaveFrameIcon from '../../icons/LeaveFrameIcon';
import './button.css';

interface LeaveFrameButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function LeaveFrameButton({ onClick, disabled = false }: LeaveFrameButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="button leave-frame-button"
        >
            <LeaveFrameIcon />
            <span>Leave Frame</span>
        </button>
    );
}
