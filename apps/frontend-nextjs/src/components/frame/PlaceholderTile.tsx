import styles from './PlaceholderTile.module.css';

interface PlaceholderTileProps {
    showLogo?: boolean;
    text?: string | null;
}

export default function PlaceholderTile({ showLogo = true, text = null }: PlaceholderTileProps) {
    // Determine if it's the searching state based on text prop or showLogo
    const isSearching = !showLogo && text?.includes('Searching');

    return (
        <div className={styles.container}>
            {showLogo ? (
                <img
                    src="/logo-utama.png"
                    alt="FunFram"
                    className={styles.logo}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
            ) : (
                <div className={styles.searchingAnimationBox}>
                    <div className={styles.pulseCircle}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={styles.cameraIcon}>
                            <path d="M23 7l-7 5 7 5V7z" />
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                    </div>
                </div>
            )}
            
            <div className={styles.textContainer}>
                {text && <span className={styles.text}>{isSearching ? 'Searching for a new friend...' : text}</span>}
                {isSearching && <span className={styles.subtext}>The next person will appear soon</span>}
            </div>
        </div>
    );
}
