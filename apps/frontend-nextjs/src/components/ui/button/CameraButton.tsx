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
            className="button toggle-button"
        >
            <CameraIcon />
            <span>Camera</span>
        </button>
    );
}
