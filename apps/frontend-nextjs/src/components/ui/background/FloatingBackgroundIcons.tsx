const SVGS = [
    <svg key="smile" className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>,
    <svg key="hex" className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>,
    <svg key="wand" className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="6.5"></line></svg>,
    <svg key="music" className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>,
    <svg key="target" className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v8"></path><path d="M8 12h8"></path></svg>,
    <svg key="msg" className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
];

// Deterministic pseudo-random helper to keep SSR and client hydration identical
function seeded(i: number, salt: number): number {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

export default function FloatingBackgroundIcons() {
    const icons = Array.from({ length: 150 }).map((_, i) => {
        const svgIndex = i % SVGS.length;
        const size = 30 + seeded(i, 1) * 40;
        const left = seeded(i, 2) * 100;
        const top = seeded(i, 3) * 100;
        const duration = 15 + seeded(i, 4) * 25;
        const delay = seeded(i, 5) * -20;

        return (
            <div
                key={i}
                className="absolute text-slate-800 opacity-[0.08] animate-[drift_ease-in-out_infinite_alternate]"
                style={{
                    left: `${left.toFixed(2)}%`,
                    top: `${top.toFixed(2)}%`,
                    width: `${size.toFixed(1)}px`,
                    height: `${size.toFixed(1)}px`,
                    animationDuration: `${duration.toFixed(2)}s`,
                    animationDelay: `${delay.toFixed(2)}s`,
                }}
            >
                {SVGS[svgIndex]}
            </div>
        );
    });

    return (
        <div className="absolute -inset-[20%] w-[140%] h-[140%] pointer-events-none z-0 overflow-hidden">
            {icons}
        </div>
    );
}
