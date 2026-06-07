'use client';

import MicrophoneIcon from '../../icons/MicrophoneIcon';
import './button.css';

interface MicrophoneButtonProps {
    onClick?: () => void;
    isOn?: boolean;
    disabled?: boolean;
}

export default function MicrophoneButton({ onClick, isOn = true, disabled = false }: MicrophoneButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="button toggle-button"
        >
            <MicrophoneIcon />
            <span>Microphone</span>
        </button>
    );
}
