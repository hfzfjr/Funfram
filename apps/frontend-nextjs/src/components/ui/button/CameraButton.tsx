'use client';

import CameraIcon from '../../icons/CameraIcon';
import './button.css';

interface CameraButtonProps {
    onClick?: () => void;
    isOn?: boolean;
    disabled?: boolean;
}

export default function CameraButton({ onClick, isOn = true, disabled = false }: CameraButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`button toggle-button ${isOn ? 'active-state' : 'inactive-state'}`}
            aria-label={isOn ? "Turn off camera" : "Turn on camera"}
        >
            <CameraIcon />
            <span>Camera</span>
        </button>
    );
}
