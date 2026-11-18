import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { WebRtcService } from '@/services/webrtc.service';

export type FacingMode = 'user' | 'environment';

interface MediaDeviceStoreState {
  facingMode: FacingMode;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoId: string;
  selectedAudioId: string;
  flipCamera: () => Promise<void>;
  selectDevices: (videoDeviceId?: string, audioDeviceId?: string) => Promise<void>;
}

export const useMediaDeviceStore = create<MediaDeviceStoreState>(() => ({
  facingMode: 'user',
  videoDevices: [],
  audioDevices: [],
  selectedVideoId: '',
  selectedAudioId: '',
  flipCamera: async () => {},
  selectDevices: async () => {},
}));

async function requestUserMedia(options?: {
  facingMode?: FacingMode;
  videoDeviceId?: string;
  audioDeviceId?: string;
}): Promise<MediaStream> {
  const facing = options?.facingMode ?? 'user';
  const videoConstraint: MediaTrackConstraints = options?.videoDeviceId
    ? {
        deviceId: { exact: options.videoDeviceId },
        width: { ideal: 1280 },
        height: { ideal: 1280 },
      }
    : {
        width: { ideal: 1280 },
        height: { ideal: 1280 },
        facingMode: { ideal: facing },
      };

  const audioConstraint: MediaTrackConstraints | boolean = options?.audioDeviceId
    ? {
        deviceId: { exact: options.audioDeviceId },
        echoCancellation: true,
        noiseSuppression: true,
      }
    : {
        echoCancellation: true,
        noiseSuppression: true,
      };

  const attempts: MediaStreamConstraints[] = [
    { video: videoConstraint, audio: audioConstraint },
    { video: options?.videoDeviceId ? { deviceId: { exact: options.videoDeviceId } } : { facingMode: facing }, audio: true },
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

  const refreshDevices = async (stream?: MediaStream | null) => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      const audioDevices = devices.filter((d) => d.kind === 'audioinput');
      const activeVideoId = stream?.getVideoTracks()[0]?.getSettings().deviceId || '';
      const activeAudioId = stream?.getAudioTracks()[0]?.getSettings().deviceId || '';
      useMediaDeviceStore.setState({
        videoDevices,
        audioDevices,
        ...(activeVideoId ? { selectedVideoId: activeVideoId } : {}),
        ...(activeAudioId ? { selectedAudioId: activeAudioId } : {}),
      });
    } catch {
      // Ignore enumerateDevices errors on restricted browsers
    }
  };

  const applyNewStream = async (stream: MediaStream) => {
    localStreamRef.current = stream;
    setLocalStreamInStore(stream);

    const newVideoTrack = stream.getVideoTracks()[0] ?? null;
    const newAudioTrack = stream.getAudioTracks()[0] ?? null;

    if (newVideoTrack) newVideoTrack.enabled = isCamOn;
    if (newAudioTrack) newAudioTrack.enabled = isMicOn;

    videoTrackRef.current = newVideoTrack;
    audioTrackRef.current = newAudioTrack;

    const store = useCallStore.getState();
    if (store.localUser) {
      const updatedUser = { ...store.localUser, stream };
      useCallStore.setState({
        localUser: updatedUser,
        leftParticipants: store.leftParticipants.map((p) =>
          p.id === store.localUser?.id ? { ...p, stream } : p
        ),
      });
    }

    WebRtcService.getInstance().setLocalStream(stream);
    await refreshDevices(stream);
  };

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

        const { facingMode } = useMediaDeviceStore.getState();
        console.log('🎥 Requesting camera/mic...');
        const stream = await requestUserMedia({ facingMode });
        console.log('✅ Camera/mic stream obtained:', stream);
        localStreamRef.current = stream;
        setLocalStreamInStore(stream);
        videoTrackRef.current = stream.getVideoTracks()[0] ?? null;
        audioTrackRef.current = stream.getAudioTracks()[0] ?? null;
        setIsCamOn(Boolean(videoTrackRef.current));
        setIsMicOn(Boolean(audioTrackRef.current));

        const store = useCallStore.getState();
        if (store.localUser) {
          store.setLocalUser({
            ...store.localUser,
            stream,
          });
        }

        await refreshDevices(stream);
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

  const flipCamera = async () => {
    const currentFacing = useMediaDeviceStore.getState().facingMode;
    const nextFacing: FacingMode = currentFacing === 'user' ? 'environment' : 'user';
    const { selectedAudioId } = useMediaDeviceStore.getState();

    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await requestUserMedia({
        facingMode: nextFacing,
        audioDeviceId: selectedAudioId || undefined,
      });
      useMediaDeviceStore.setState({ facingMode: nextFacing });
      await applyNewStream(stream);
    } catch (error) {
      console.error('❌ Failed to flip camera:', error);
      useCallStore.getState().showCustomAlert('Gagal mengganti kamera depan/belakang pada perangkat ini.');
    }
  };

  const selectDevices = async (videoDeviceId?: string, audioDeviceId?: string) => {
    const state = useMediaDeviceStore.getState();
    const targetVideoId = videoDeviceId ?? state.selectedVideoId;
    const targetAudioId = audioDeviceId ?? state.selectedAudioId;

    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await requestUserMedia({
        facingMode: state.facingMode,
        videoDeviceId: targetVideoId || undefined,
        audioDeviceId: targetAudioId || undefined,
      });
      useMediaDeviceStore.setState({
        selectedVideoId: targetVideoId,
        selectedAudioId: targetAudioId,
      });
      await applyNewStream(stream);
    } catch (error) {
      console.error('❌ Failed to switch media device:', error);
      useCallStore.getState().showCustomAlert('Gagal mengganti perangkat kamera atau mikrofon.');
    }
  };

  // Register device actions and listen for device changes
  useEffect(() => {
    useMediaDeviceStore.setState({ flipCamera, selectDevices });

    const handleDeviceChange = () => {
      void refreshDevices(localStreamRef.current);
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCamOn, isMicOn]);

  // Sync stream to participant whenever camera/mic state changes
  useEffect(() => {
    if (localStreamRef.current) {
      const store = useCallStore.getState();
      if (store.localUser) {
        store.setLocalUser({
          ...store.localUser,
          stream: localStreamRef.current,
        });
        if (store.leftParticipants.length > 0) {
          useCallStore.setState({
            localUser: store.localUser ? { ...store.localUser, stream: localStreamRef.current } : null,
            leftParticipants: store.leftParticipants.map((p) =>
              p.id === store.localUser?.id ? { ...p, stream: localStreamRef.current } : p
            ),
          });
        }
      }
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
