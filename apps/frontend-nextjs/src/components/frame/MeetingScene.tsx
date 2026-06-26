'use client';

import { useCallStore } from '@/store/useCallStore';
import FramePanel from './FramePanel';
import PlaceholderTile from './PlaceholderTile';
import styles from './CallLayout.module.css';

export default function MeetingScene() {
    const fsmState = useCallStore((state) => state.fsmState);
    const matchmakingState = useCallStore((state) => state.matchmakingState);

    // Differentiate placeholder texts
    let placeholderText: string | null = null;
    let showLogo = true;

    if (fsmState === 'SEARCHING' || matchmakingState === 'Searching') {
        placeholderText = "Searching for an opponent frame...";
        showLogo = false;
    } else if (matchmakingState === 'Cooldown') {
        placeholderText = "Preparing connection...";
        showLogo = false;
    } else if (fsmState === 'FRAME') {
        placeholderText = "Waiting for match...";
        showLogo = true;
    }

    const showRightFrame = fsmState === 'MATCHED';

    return (
        <div className={styles.container}>
            {/* Left Frame: Local Frame (Frame A) always shown */}
            <div className={styles.side}>
                <FramePanel side="left" />
            </div>

            {/* Right Side: Remote Frame (Frame B) or Placeholder */}
            <div className={styles.side}>
                {showRightFrame ? (
                    <FramePanel side="right" />
                ) : (
                    <PlaceholderTile showLogo={showLogo} text={placeholderText} />
                )}
            </div>
        </div>
    );
}
