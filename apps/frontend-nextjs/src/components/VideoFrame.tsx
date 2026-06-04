'use client';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  label: string;
  statusText?: string;
  isCameraOn?: boolean;
}

export default function VideoFrame({ videoRef, label, statusText, isCameraOn = true }: Props) {
  return (
    <div className="flex-1 bg-zinc-900 rounded-2xl overflow-hidden relative border border-zinc-800 shadow-lg">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
      
      {!isCameraOn && (
        <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center z-10 text-4xl">📷❌</div>
      )}

      {statusText && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-10 text-center p-6">
          <p className="text-xl font-semibold text-zinc-400">{statusText}</p>
        </div>
      )}
      
      <span className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-4 py-1.5 rounded-full text-sm font-medium z-20">{label}</span>
    </div>
  );
}