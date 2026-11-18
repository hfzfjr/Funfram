import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';

async function requestUserMedia(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 1280 },
        facingMode: { ideal: 'user' },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    },
    { video: true, audio: true },
    { video: true, audio: false },
  ];

  let lastError: unknown = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function useLocalMedia() {
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);

  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef<Promise<MediaStream | null> | null>(null);

  const setLocalStreamInStore = useCallStore((state) => state.setLocalStream);

  const stopLocalMedia = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    videoTrackRef.current = null;
    audioTrackRef.current = null;
    setLocalStreamInStore(null);
  };

  // Start camera after auth/user action. Guarding prevents overlapping getUserMedia calls.
  const startCamera = async (): Promise<MediaStream | null> => {
    if (localStreamRef.current?.active) return localStreamRef.current;
    if (cameraRequestRef.current) return cameraRequestRef.current;

    cameraRequestRef.current = (async () => {
      try {
        stopLocalMedia();

        console.log('🎥 Requesting camera/mic...');
        const stream = await requestUserMedia();
        console.log('✅ Camera/mic stream obtained:', stream);
        localStreamRef.current = stream;
        setLocalStreamInStore(stream);
        videoTrackRef.current = stream.getVideoTracks()[0] ?? null;
        audioTrackRef.current = stream.getAudioTracks()[0] ?? null;
        setIsCamOn(Boolean(videoTrackRef.current));
        setIsMicOn(Boolean(audioTrackRef.current));
        console.log('📹 Video track:', videoTrackRef.current);
        console.log('🎤 Audio track:', audioTrackRef.current);

        // Update local user stream in store after camera is ready
        const store = useCallStore.getState();
        console.log('👤 Local user before update:', store.localUser);
        if (store.localUser) {
          store.setLocalUser({
            ...store.localUser,
            stream,
          });
          console.log('✅ Local user stream updated');
        }

        return stream;
      } catch (error) {
        console.error('❌ Camera not available:', error);
        setIsCamOn(false);
        setIsMicOn(false);
        setLocalStreamInStore(null);
        return null;
      } finally {
        cameraRequestRef.current = null;
      }
    })();

    return cameraRequestRef.current;
  };

  // Sync stream to participant whenever camera/mic state changes
  useEffect(() => {
    console.log('🔄 Stream sync effect triggered, isCamOn:', isCamOn, 'isMicOn:', isMicOn);
    if (localStreamRef.current) {
      const store = useCallStore.getState();
      console.log('👤 Syncing stream to local user:', store.localUser?.id);
      if (store.localUser) {
        store.setLocalUser({
          ...store.localUser,
          stream: localStreamRef.current,
        });
        console.log('✅ Local user stream synced');
        if (store.leftParticipants.length > 0) {
          useCallStore.setState({
            localUser: store.localUser ? { ...store.localUser, stream: localStreamRef.current } : null,
            leftParticipants: store.leftParticipants.map((p) =>
              p.id === store.localUser?.id ? { ...p, stream: localStreamRef.current } : p
            ),
          });
          console.log('✅ LeftParticipants array updated');
        }
      }
    } else {
      console.log('⚠️ No stream to sync');
    }
  }, [isCamOn, isMicOn]);

  const handleMic = () => {
    if (audioTrackRef.current) {
      const nextMicEnabled = !isMicOn;
      audioTrackRef.current.enabled = nextMicEnabled;
      setIsMicOn(nextMicEnabled);

      const store = useCallStore.getState();
      if (store.localUser?.id) {
        store.muteParticipant(store.localUser.id, !nextMicEnabled);
        WebSocketService.getInstance().sendEvent('DEVICE_STATE_CHANGE', {
          sessionId: store.sessionId,
          userId: store.localUser.id,
          cameraEnabled: !store.localUser.isCameraOff,
          microphoneEnabled: nextMicEnabled,
        });
      }
    }
  };

  const handleCam = async () => {
    if (!videoTrackRef.current) {
      await startCamera();
      const store = useCallStore.getState();
      if (store.localUser?.id) {
        store.toggleCamera(store.localUser.id, false);
        WebSocketService.getInstance().sendEvent('DEVICE_STATE_CHANGE', {
          sessionId: store.sessionId,
          userId: store.localUser.id,
          cameraEnabled: true,
          microphoneEnabled: !store.localUser.isMuted,
        });
      }
      return;
    }

    if (videoTrackRef.current) {
      const nextCamEnabled = !isCamOn;
      videoTrackRef.current.enabled = nextCamEnabled;
      setIsCamOn(nextCamEnabled);

      const store = useCallStore.getState();
      if (store.localUser?.id) {
        store.toggleCamera(store.localUser.id, !nextCamEnabled);
        WebSocketService.getInstance().sendEvent('DEVICE_STATE_CHANGE', {
          sessionId: store.sessionId,
          userId: store.localUser.id,
          cameraEnabled: nextCamEnabled,
          microphoneEnabled: !store.localUser.isMuted,
        });
      }
    }
  };

  return {
    isMicOn,
    isCamOn,
    localStreamRef,
    videoTrackRef,
    audioTrackRef,
    startCamera,
    stopLocalMedia,
    handleMic,
    handleCam,
  };
}
