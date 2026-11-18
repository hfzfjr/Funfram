'use client';

import MicrophoneIcon from '../../icons/MicrophoneIcon';

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
            className={`flex items-center justify-center gap-2 p-0 lg:px-5 lg:py-3 w-11 h-11 lg:w-auto lg:h-12 border-none rounded-full text-sm font-semibold cursor-pointer transition-all duration-200 whitespace-nowrap active:enabled:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                isOn
                    ? 'bg-slate-200 hover:enabled:bg-slate-300 text-slate-800'
                    : 'bg-rose-500/20 hover:enabled:bg-rose-500/30 text-rose-500'
            }`}
            aria-label={isOn ? "Mute microphone" : "Unmute microphone"}
        >
            <MicrophoneIcon />
            <span className="hidden lg:inline">Microphone</span>
        </button>
    );
}
