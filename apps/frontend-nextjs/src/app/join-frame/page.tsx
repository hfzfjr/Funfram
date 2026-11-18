import { Suspense } from 'react';
import JoinFrameClient from './JoinFrameClient';

export const dynamic = 'force-dynamic';

export default function JoinFramePage() {
    return (
        <Suspense fallback={<div className="min-h-screen grid place-items-center">Loading invite...</div>}>
            <JoinFrameClient />
        </Suspense>
    );
}
