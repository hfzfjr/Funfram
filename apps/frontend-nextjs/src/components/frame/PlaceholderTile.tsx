import styles from './PlaceholderTile.module.css';

interface PlaceholderTileProps {
    showLogo?: boolean;
    text?: string | null;
}

export default function PlaceholderTile({ showLogo = true, text = null }: PlaceholderTileProps) {
    return (
        <div className={styles.container}>
            {showLogo && (
                <img
                    src="/logo-utama.png"
                    alt="FunFram"
                    className={styles.logo}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
            )}
            {text && (
                <span className={styles.text}>
                    {text}
                </span>
            )}
        </div>
    );
}
