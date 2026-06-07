'use client';

import NextFrameIcon from '../../icons/NextFrameIcon';
import './button.css';

interface NextFrameButtonProps {
    onClick?: () => void;
    disabled?: boolean;
}

export default function NextFrameButton({ onClick, disabled = false }: NextFrameButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="button next-frame-button"
        >
            <NextFrameIcon />
            <span>Next Frame</span>
        </button>
    );
}
