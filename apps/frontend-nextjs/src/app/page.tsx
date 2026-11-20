'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Navigation from '@/components/layout/Navigation';
import AuthOverlay from '@/components/auth/auth';
import MeetingScene from '@/components/frame/MeetingScene';
import GameScene from '@/components/frame/GameScene';
import GameInviteNotification from '@/components/ui/overlay/GameInviteNotification';
import FloatingBackgroundIcons from '@/components/ui/background/FloatingBackgroundIcons';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { WebRtcService } from '@/services/webrtc.service';
import { ApiService } from '@/services/api.service';
import { useLocalMedia } from '@/hooks/useLocalMedia';
import { useCallSignaling } from '@/hooks/useCallSignaling';

function FunFramContent() {
  const searchParams = useSearchParams();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [topAlert, setTopAlert] = useState<string | null>(null);
  const autoStartHandledRef = useRef(false);

  const fsmState = useCallStore((state) => state.fsmState);

  const {
    isMicOn,
    localStreamRef,
    videoTrackRef,
    audioTrackRef,
    startCamera,
    stopLocalMedia,
    handleMic,
  } = useLocalMedia();

  const handleLeave = () => {
    const store = useCallStore.getState();
    WebRtcService.getInstance().disconnectAll();
    if (store.frameId) {
      WebSocketService.getInstance().sendEvent('FRAME_LEAVE', {
        frameId: store.frameId,
        sessionId: store.sessionId,
        userId: store.localUser?.id,
      });
    }

    const newLocalUser = store.localUser ? { ...store.localUser, isOwner: true } : null;

    // Return to lobby (FRAME state) instead of HOME
    useCallStore.setState({
      frameId: null,
      sessionId: null,
      rightParticipants: [],
      leftParticipants: newLocalUser ? [newLocalUser] : [],
      localUser: newLocalUser,
      fsmState: 'FRAME',
      matchmakingState: 'Waiting',
      gameState: null,
      gameInvite: null,
      generalChat: [],
      frameOwnerId: newLocalUser?.id,
    });

    // Clear query params only if present so Next.js router doesn't unnecessarily re-sync
    if (window.location.search) {
      window.history.replaceState({}, '', '/');
    }

    // Request a new frame from the backend so we get a valid frameId
    if (newLocalUser) {
      WebSocketService.getInstance().sendWhenOpen('FRAME_CREATE', { username: newLocalUser.name });
    }

    // Don't stop media - keep camera active in lobby
    sessionStorage.removeItem('funfram_autostart');
  };

  useCallSignaling({
    localStreamRef,
    videoTrackRef,
    audioTrackRef,
    stopLocalMedia,
    onLeave: handleLeave,
    onTopAlert: setTopAlert,
  });

  useEffect(() => {
    if (isAuthenticated || autoStartHandledRef.current) {
      return;
    }

    const savedUsername = localStorage.getItem('funfram_username');
    const shouldAutoStart = sessionStorage.getItem('funfram_autostart') === '1';
    if (savedUsername && shouldAutoStart) {
      autoStartHandledRef.current = true;
      sessionStorage.removeItem('funfram_autostart');
      void handleAuthConfirm(savedUsername);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ── Auth confirm handler ─────────────────────────────────────────────────
  const handleAuthConfirm = async (confirmedUsername: string) => {
    setIsAuthenticated(true);
    localStorage.setItem('funfram_username', confirmedUsername);
    sessionStorage.removeItem('funfram_autostart');

    // Store username early so FRAME_CREATED handler can read it
    useCallStore.setState({
      localUser: {
        id: 'pending',
        stream: null,
        name: confirmedUsername,
        isMuted: false,
        isCameraOff: false,
        isOwner: false,
        presence: 'ONLINE',
        joinOrder: 1,
      },
    });

    const ws = WebSocketService.getInstance();
    const wsUrl = process.env.NEXT_PUBLIC_WS_GAME_URL || 'ws://localhost:5001';
    ws.connect(wsUrl);

    // Start camera right after auth (user gesture satisfies browser policy)
    await startCamera();

    const inviteToken = searchParams.get('token') || searchParams.get('invite');
    const frameId = searchParams.get('frameId');

    if (inviteToken && frameId) {
      ws.sendWhenOpen('PLAYER_JOIN', {
        frameId,
        inviteToken,
        username: confirmedUsername,
      });
    } else {
      // Normal create-frame flow; backend responds with FRAME_CREATED
      ws.sendWhenOpen('FRAME_CREATE', { username: confirmedUsername });
    }
  };

  const handleReturnToLobby = () => {
    const store = useCallStore.getState();
    // Putuskan WebRTC match — akan dikoneksi ulang ke lobby oleh LOBBY_RETURNED handler
    WebRtcService.getInstance().disconnectAll();
    // Kirim event ke backend: bersihkan match/search, kembalikan ke lobby
    if (store.frameId) {
      WebSocketService.getInstance().sendEvent('RETURN_TO_LOBBY', {
        frameId: store.frameId,
        sessionId: store.sessionId,
      });
    }
    // Hapus query params hanya jika ada
    if (window.location.search) {
      window.history.replaceState({}, '', '/');
    }
  };

  return (
    <>
      {!isAuthenticated && <AuthOverlay onConfirm={handleAuthConfirm} />}

      <div
        className="w-full h-dvh bg-transparent flex flex-col overflow-hidden relative shadow-[inset_0_0_100px_rgba(14,165,233,0.1)]"
      >
        <FloatingBackgroundIcons />

        <div className="flex-1 flex flex-col pb-[82px] md:pb-24 overflow-hidden relative">
          {topAlert && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-800 text-sky-500 px-6 py-3 rounded-2xl font-semibold z-[1000] animate-[fadeIn_0.2s_forwards]">
              {topAlert}
            </div>
          )}
          {fsmState === 'PLAYING' || fsmState === 'RESULT' ? (
            <GameScene />
          ) : (
            <MeetingScene />
          )}
        </div>

        {isAuthenticated && (
          <Navigation
            onLeave={handleLeave}
            onReturnToLobby={handleReturnToLobby}
            onMic={handleMic}
            isMicOn={isMicOn}
          />
        )}
      </div>

      <GameInviteNotification />
    </>
  );
}

export default function FunFramPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#1F2028] text-white font-sans">
          Loading FunFram...
        </div>
      }
    >
      <FunFramContent />
    </Suspense>
  );
}
