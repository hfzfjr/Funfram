import { Suspense } from 'react';
import JoinFrameClient from './JoinFrameClient';

export const dynamic = 'force-dynamic';

export default function JoinFramePage() {
    return (
        <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Loading invite...</div>}>
            <JoinFrameClient />
        </Suspense>
    );
}
