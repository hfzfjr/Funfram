import { useRef, useEffect } from 'react';

interface LobbyPanelProps {
    userName: string;
    participantCount: number;
    localStream: MediaStream | null;
    isCameraOn?: boolean;
}

export default function LobbyPanel({ userName, localStream, isCameraOn = true }: LobbyPanelProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            if (localStream && isCameraOn) {
                videoRef.current.srcObject = localStream;
            } else {
                videoRef.current.srcObject = null;
            }
        }
    }, [localStream, isCameraOn]);

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className="w-full h-full flex flex-col gap-3">
            <div className="flex-1 relative bg-slate-50 rounded-[28px] overflow-hidden">
                {localStream ? (
                    isCameraOn ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full bg-black"></div>
                    )
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100">
                        <span className="text-5xl font-semibold text-zinc-400">{getInitials(userName)}</span>
                        <span className="text-slate-900 text-lg font-medium">{userName}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
