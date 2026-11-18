interface PlaceholderTileProps {
    showLogo?: boolean;
    text?: string | null;
}

export default function PlaceholderTile({ showLogo = true, text = null }: PlaceholderTileProps) {
    const isSearching = !showLogo && text?.includes('Searching');

    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-white rounded-lg gap-3 sm:gap-4 lg:gap-5 p-6 overflow-hidden relative border border-black/8">
            {isSearching && (
                <div
                    className="absolute -inset-1/2 w-[200%] h-[200%] opacity-15 z-0 pointer-events-none animate-[noiseAnimation_0.2s_steps(2)_infinite]"
                    style={{
                        backgroundImage:
                            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
                    }}
                />
            )}
            {showLogo ? (
                <img
                    src="/logo-utama.png"
                    alt="FunFram"
                    className="w-[140px] sm:w-[180px] lg:w-[220px] h-auto object-contain opacity-100 select-none pointer-events-none"
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
            ) : (
                <div className="z-[1] relative flex items-center justify-center mb-2">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500 relative animate-[pulseGlow_2s_infinite_cubic-bezier(0.4,0,0.2,1)] before:content-[''] before:absolute before:-inset-4 before:rounded-full before:border-2 before:border-blue-500/40 before:animate-[pulseRing_2s_infinite_cubic-bezier(0.4,0,0.2,1)]">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white sm:w-12 sm:h-12">
                            <path d="M23 7l-7 5 7 5V7z" />
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                    </div>
                </div>
            )}

            <div className="z-[1] flex flex-col items-center gap-1.5 text-center max-w-[260px] sm:max-w-[320px]">
                {text && (
                    <span className="text-slate-700 text-sm sm:text-base lg:text-lg font-semibold tracking-[0.01em]">
                        {isSearching ? 'Searching for a new friend...' : text}
                    </span>
                )}
                {isSearching && (
                    <span className="text-slate-500 text-xs sm:text-sm font-medium">
                        The next person will appear soon
                    </span>
                )}
            </div>
        </div>
    );
}
