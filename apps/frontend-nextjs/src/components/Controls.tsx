'use client';

interface Props {
  onNext: () => void;
  onLeave: () => void;
  onMic: () => void;
  onCam: () => void;
  isMicOn: boolean;
  isCamOn: boolean;
}

export default function Controls({ onNext, onLeave, onMic, onCam, isMicOn, isCamOn }: Props) {
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-zinc-900/90 backdrop-blur-md px-6 py-3 rounded-2xl flex flex-wrap items-center justify-center gap-3 border border-zinc-800 shadow-2xl z-30">
      <button onClick={onNext} className="bg-sky-500 hover:bg-sky-600 px-5 py-2 rounded-xl text-sm font-bold active:scale-95 transition-all">🔄 Next Frame</button>
      <button onClick={onLeave} className="bg-red-600 hover:bg-red-700 px-5 py-2 rounded-xl text-sm font-bold active:scale-95 transition-all">🚪 Leave Frame</button>
      <button onClick={onMic} className={`px-5 py-2 rounded-xl text-sm font-medium ${isMicOn ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-amber-600'}`}>{isMicOn ? '🎙️ Mic' : '🔇 Muted'}</button>
      <button onClick={onCam} className={`px-5 py-2 rounded-xl text-sm font-medium ${isCamOn ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-amber-600'}`}>{isCamOn ? '📷 Cam' : '❌ Cam Off'}</button>
    </div>
  );
}