'use client';

import NextFrameIcon from '../../icons/NextFrameIcon';
import './button.css';

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
            className="button next-frame-button"
        >
            <NextFrameIcon />
            <span>{text}</span>
        </button>
    );
}
