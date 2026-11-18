import { MutableRefObject, useEffect, useRef } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { WebRtcService } from '@/services/webrtc.service';
import { Participant } from '@/types/participant';
import { CanvasEvent } from '@/types/game';

interface UseCallSignalingOptions {
  localStreamRef: MutableRefObject<MediaStream | null>;
  videoTrackRef: MutableRefObject<MediaStreamTrack | null>;
  audioTrackRef: MutableRefObject<MediaStreamTrack | null>;
  stopLocalMedia: () => void;
  onLeave: () => void;
  onTopAlert: (message: string | null) => void;
}

export function useCallSignaling({
  localStreamRef,
  videoTrackRef,
  audioTrackRef,
  stopLocalMedia,
  onLeave,
  onTopAlert,
}: UseCallSignalingOptions) {
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  const stopLocalMediaRef = useRef(stopLocalMedia);
  stopLocalMediaRef.current = stopLocalMedia;

  const onTopAlertRef = useRef(onTopAlert);
  onTopAlertRef.current = onTopAlert;

  // Register server-event handlers once. The socket is opened only after username confirmation.
  useEffect(() => {
    const ws = WebSocketService.getInstance();
    sessionStorage.removeItem('funfram_session');
    useCallStore.getState().reset();

    // Setup network change listeners for early detection
    ws.setupNetworkListeners();

    // Sync stream to local user participant when stream changes
    const syncStreamToParticipant = () => {
      const store = useCallStore.getState();
      if (localStreamRef.current && store.localUser) {
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
    };

    const streamInterval = setInterval(() => {
      if (localStreamRef.current) {
        syncStreamToParticipant();
        clearInterval(streamInterval);
      }
    }, 100);

    // Prefetch TURN credentials and warm up WebRTC signaling socket early
    const webrtcUrl = process.env.NEXT_PUBLIC_WS_WEBRTC_URL || 'ws://localhost:5002';
    void WebRtcService.getInstance().fetchCloudflareIceServers();
    void WebRtcService.getInstance().connectToSignalingServer(webrtcUrl).catch(() => {});

    let playerJoinAlertTimeout: ReturnType<typeof setTimeout> | null = null;
    let webrtcConnectGeneration = 0;

    const connectWebRTC = async (roomId: string) => {
      const currentGeneration = ++webrtcConnectGeneration;
      const webrtc = WebRtcService.getInstance();
      const store = useCallStore.getState();

      // Use cached ICE servers when available; only await if not yet fetched
      if (!webrtc.hasCachedIceServers()) {
        await webrtc.fetchCloudflareIceServers();
      }

      // Abort if a newer connectWebRTC call started while fetching ICE servers
      if (currentGeneration !== webrtcConnectGeneration) {
        return;
      }

      // Putuskan peer connection lama tanpa menutup WebSocket signaling agar reconnect instan
      webrtc.leaveCurrentRoom();

      webrtc.setLocalStream(localStreamRef.current);
      webrtc.onRemoteStream((participantId, stream) => {
        const currentStore = useCallStore.getState();
        const leftIndex = currentStore.leftParticipants.findIndex((p) => p.id === participantId);
        if (leftIndex !== -1) {
          useCallStore.setState({
            leftParticipants: currentStore.leftParticipants.map((p) =>
              p.id === participantId ? { ...p, stream } : p
            ),
          });
          return;
        }

        const rightIndex = currentStore.rightParticipants.findIndex((p) => p.id === participantId);
        if (rightIndex !== -1) {
          useCallStore.setState({
            rightParticipants: currentStore.rightParticipants.map((p) =>
              p.id === participantId ? { ...p, stream } : p
            ),
          });
          return;
        }

        console.warn('[WebRTC] Participant not found in any list, adding to right:', participantId);
        currentStore.addParticipant('right', {
          id: participantId,
          stream,
          name: 'Remote User',
          isMuted: false,
          isCameraOff: false,
          isOwner: false,
          presence: 'ONLINE',
          joinOrder: 99,
        });
      });

      webrtc
        .connectToSignalingServer(webrtcUrl)
        .then(() => {
          webrtc.joinRoom(roomId, store.localUser?.id || '');
        })
        .catch((err) => {
          console.error('WebRTC connection failed:', err);
        });
    };

    // ── FRAME_CREATED: server confirms lobby was created ──────────────────
    const onFrameCreated = (payload: any) => {
      const store = useCallStore.getState();
      const currentStream = localStreamRef.current;
      const local: Participant = {
        id: payload.ownerId,
        stream: currentStream,
        name: store.localUser?.name ?? 'You',
        isMuted: audioTrackRef.current ? !audioTrackRef.current.enabled : (store.localUser?.isMuted ?? false),
        isCameraOff: videoTrackRef.current ? !videoTrackRef.current.enabled : (store.localUser?.isCameraOff ?? false),
        isOwner: true,
        presence: 'ONLINE',
        joinOrder: 1,
      };

      useCallStore.setState({
        localUser: local,
        fsmState: 'FRAME',
        frameOwnerId: payload.ownerId,
        frameId: payload.frameId,
        inviteToken: null,
        leftParticipants: [local],
      });

      sessionStorage.setItem(
        'funfram_session',
        JSON.stringify({
          userId: payload.ownerId,
          username: local.name,
          frameId: payload.frameId,
          isOwner: true,
        })
      );

      connectWebRTC(payload.frameId);
    };

    // ── FRAME_JOINED: server confirms someone joined ──────────────────────
    const onFrameJoined = (payload: any) => {
      const store = useCallStore.getState();

      const members = payload.members.map((m: any) => ({
        id: m.id || m.userId,
        stream: (m.id || m.userId) === payload.joinedUserId ? localStreamRef.current : null,
        name: m.name ?? m.username ?? 'User',
        isMuted: m.isMuted ?? false,
        isCameraOff: m.isCameraOff ?? false,
        isOwner: m.isOwner ?? false,
        presence: m.presence ?? 'ONLINE',
        joinOrder: m.joinOrder ?? 1,
      }));

      const local = members.find((m: any) => m.id === payload.joinedUserId) || {
        id: payload.joinedUserId,
        stream: localStreamRef.current,
        name: store.localUser?.name ?? 'You',
        isMuted: false,
        isCameraOff: false,
        isOwner: false,
        presence: 'ONLINE',
        joinOrder: 2,
      };

      store.setLocalUser(local);
      store.setFsmState('FRAME');
      store.setFrameOwnerId(payload.ownerId);
      useCallStore.setState({ frameId: payload.frameId, inviteToken: null, leftParticipants: members });

      sessionStorage.setItem(
        'funfram_session',
        JSON.stringify({
          userId: payload.joinedUserId,
          username: local.name,
          frameId: payload.frameId,
          isOwner: false,
        })
      );

      if (localStreamRef.current) {
        store.setLocalUser({
          ...local,
          stream: localStreamRef.current,
        });
        useCallStore.setState((state) => ({
          leftParticipants: state.leftParticipants.map((p) =>
            p.id === local.id ? { ...p, stream: localStreamRef.current } : p
          ),
        }));
      }

      connectWebRTC(payload.frameId);
    };

    // ── PLAYER_JOIN: a peer joined our lobby ─────────────────────────────
    const onPlayerJoin = (payload: any) => {
      const p = payload.participant;
      if (!p) return;
      const participantName = p.name ?? p.username ?? 'Seseorang';
      const participant: Participant = {
        id: p.id,
        stream: null,
        name: participantName,
        isMuted: p.isMuted ?? false,
        isCameraOff: p.isCameraOff ?? false,
        isOwner: p.isOwner ?? false,
        presence: 'ONLINE',
        joinOrder: p.joinOrder ?? 2,
      };
      useCallStore.getState().addParticipant('left', participant);

      onTopAlertRef.current(`${participantName} bergabung dalam frame`);
      if (playerJoinAlertTimeout) {
        clearTimeout(playerJoinAlertTimeout);
      }
      playerJoinAlertTimeout = setTimeout(() => {
        onTopAlertRef.current(null);
      }, 5000);
    };

    // ── MATCH_FOUND: matched with another frame ───────────────────────────
    const onMatchFound = (payload: any) => {
      const store = useCallStore.getState();
      store.setSession(payload);
      useCallStore.setState({ generalChat: [] });
      connectWebRTC(payload.sessionId);
    };

    // ── MATCH_LEFT: opponent frame left ──────────────────────────────────
    const onMatchLeft = () => {
      useCallStore.getState().handleOpponentLeft({});
    };

    const onMatchmakingStarted = () => {
      const store = useCallStore.getState();
      store.setFsmState('SEARCHING');
      useCallStore.setState({ matchmakingState: 'Searching' });
    };

    const onPlayerLeft = (payload: any) => {
      const store = useCallStore.getState();
      const userId = payload.userId;
      if (!userId) return;

      const isLeft = store.leftParticipants.some((p) => p.id === userId);
      const isRight = store.rightParticipants.some((p) => p.id === userId);

      if (isLeft) {
        store.removeParticipant('left', userId);
      } else if (isRight) {
        store.removeParticipant('right', userId);
      }

      WebRtcService.getInstance().disconnectPeer(userId);
    };

    const onDeviceStateChange = (payload: any) => {
      const store = useCallStore.getState();
      if (!payload?.userId) return;
      store.setDeviceState(
        payload.userId,
        payload.cameraEnabled ?? true,
        payload.microphoneEnabled ?? true
      );
    };

    const onMuteUpdate = (payload: any) => {
      const store = useCallStore.getState();
      if (!payload?.userId) return;
      store.muteParticipant(payload.userId, Boolean(payload.isMuted));
    };

    const onGameInviteReceived = (payload: any) => {
      useCallStore.getState().receiveGameInvite(payload);
    };

    // ── GAME_START ────────────────────────────────────────────────────────
    const onGameStart = (payload?: any) => {
      const store = useCallStore.getState();
      const gameType = payload?.gameType || 'guess_drawing';
      store.setActiveGameType(gameType);
      store.setFsmState('PLAYING');
      store.updateGameState({ status: 'Waiting' });
    };

    const onDrawStart = (payload: any) => {
      const store = useCallStore.getState();
      store.updateGameState({
        currentDrawerId: payload.drawerId,
        currentWord: payload.secretWord || '',
        wordHint: payload.wordHint || '',
        status: 'Countdown',
        drawTimer: 10,
        timeRemaining: payload.timeLimit || 60,
        canvasEvents: [],
        guessEvents: [],
      });
    };

    const onGameStateUpdate = (payload: any) => {
      const safePayload = { ...payload };
      delete safePayload.canvasEvents;
      delete safePayload.guessEvents;
      useCallStore.getState().updateGameState(safePayload);
    };

    const onRoundEnd = (payload: any) => {
      useCallStore.getState().updateGameState({
        status: 'Reveal',
        currentWord: payload.answer || '',
        winner: payload.winnerId || null,
      });
    };

    const onScoreUpdate = (payload: any) => {
      useCallStore.getState().updateGameState({ score: payload.scores || {} });
    };

    const onChatMessage = (payload: any) => {
      useCallStore.getState().addGeneralMessage({
        id: payload.id || `msg-${Date.now()}`,
        senderId: payload.senderId,
        senderName: payload.senderName || 'User',
        text: payload.text || '',
        side: payload.side || 'left',
        timestamp: payload.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    };

    const onGameEnd = () => {
      const store = useCallStore.getState();
      store.updateGameState({ status: 'Finished' });
      store.setFsmState('MATCHED');
    };

    const onCanvasEvent = (payload: CanvasEvent) => {
      useCallStore.getState().receiveCanvasEvent(payload);
    };

    const onGameAction = (payload: any) => {
      if (payload?.game === 'guess_drawing' && payload?.action === 'SYNC_CANVAS' && Array.isArray(payload.events)) {
        useCallStore.getState().updateGameState({ canvasEvents: payload.events });
      }
    };

    const onFrameDestroyed = () => {
      useCallStore.getState().showCustomAlert('Pemilik frame telah menutup frame ini. Anda akan dikembalikan ke lobi.');
      onLeaveRef.current();
    };

    const onError = (payload: any) => {
      const errorMsg = payload.error || payload.message;
      console.error('Server error:', errorMsg);

      if (errorMsg === 'lobby not found') {
        useCallStore
          .getState()
          .showCustomAlert('Tautan undangan sudah tidak valid karena pemilik telah keluar atau frame kadaluarsa.');
        onLeaveRef.current();
      } else if (errorMsg === 'lobby is full' || errorMsg === 'lobby is not accepting new players') {
        useCallStore.getState().showCustomAlert(
          'Maaf, room frame ini sudah penuh (maksimal 2 orang). Klik Oke untuk masuk ke lobby Anda sendiri.',
          'info',
          {
            confirmText: 'Oke',
            onConfirm: () => onLeaveRef.current(),
          }
        );
      } else if (errorMsg === 'frame idle timeout') {
        useCallStore.getState().showCustomAlert('Frame ditutup karena sudah lebih dari 5 menit tidak ada aktivitas.');
        onLeaveRef.current();
      }
    };

    const onLobbyReturned = () => {
      // Kembali ke lobby: teman tetap di frame, hanya match/search yang dibatalkan
      useCallStore.setState({
        fsmState: 'FRAME',
        matchmakingState: 'Waiting',
        sessionId: null,
        rightParticipants: [],
        gameState: null,
        gameInvite: null,
        generalChat: [],
      });
      // Reconnect WebRTC untuk lobby (supaya audio/video teman tetap jalan)
      const store = useCallStore.getState();
      if (store.frameId) {
        connectWebRTC(store.frameId);
      }
    };

    const onWsReconnected = () => {
      const store = useCallStore.getState();
      if (store.localUser?.id && store.localUser.id !== 'pending' && store.frameId) {
        ws.sendEvent('REJOIN_SESSION', {
          userId: store.localUser.id,
          frameId: store.frameId,
          username: store.localUser.name,
        });
      }
    };

    const onOnlineCount = (payload: any) => {
      const count = typeof payload?.count === 'number' ? payload.count : 0;
      useCallStore.getState().setOnlineCount(count);
    };

    ws.on('ERROR', onError);
    ws.on('FRAME_CREATED', onFrameCreated);
    ws.on('FRAME_JOINED', onFrameJoined);
    ws.on('PLAYER_JOIN', onPlayerJoin);
    ws.on('MATCH_FOUND', onMatchFound);
    ws.on('MATCH_LEFT', onMatchLeft);
    ws.on('MATCHMAKING_STARTED', onMatchmakingStarted);
    ws.on('PLAYER_LEFT', onPlayerLeft);
    ws.on('DEVICE_STATE_CHANGE', onDeviceStateChange);
    ws.on('MUTE_UPDATE', onMuteUpdate);
    ws.on('GAME_INVITE_RECEIVED', onGameInviteReceived);
    ws.on('GAME_START', onGameStart);
    ws.on('DRAW_START', onDrawStart);
    ws.on('GAME_STATE_UPDATE', onGameStateUpdate);
    ws.on('ROUND_END', onRoundEnd);
    ws.on('SCORE_UPDATE', onScoreUpdate);
    ws.on('CHAT_MESSAGE', onChatMessage);
    ws.on('GAME_END', onGameEnd);
    ws.on('CANVAS_START', onCanvasEvent);
    ws.on('CANVAS_MOVE', onCanvasEvent);
    ws.on('CANVAS_END', onCanvasEvent);
    ws.on('GAME_ACTION', onGameAction);
    ws.on('LOBBY_RETURNED', onLobbyReturned);
    ws.on('FRAME_DESTROYED', onFrameDestroyed);
    ws.on('WS_RECONNECTED', onWsReconnected);
    ws.on('ONLINE_COUNT', onOnlineCount);

    return () => {
      clearInterval(streamInterval);
      if (playerJoinAlertTimeout) {
        clearTimeout(playerJoinAlertTimeout);
      }
      webrtcConnectGeneration++;
      ws.off('FRAME_CREATED', onFrameCreated);
      ws.off('FRAME_JOINED', onFrameJoined);
      ws.off('PLAYER_JOIN', onPlayerJoin);
      ws.off('MATCH_FOUND', onMatchFound);
      ws.off('MATCH_LEFT', onMatchLeft);
      ws.off('PLAYER_LEFT', onPlayerLeft);
      ws.off('DEVICE_STATE_CHANGE', onDeviceStateChange);
      ws.off('MUTE_UPDATE', onMuteUpdate);
      ws.off('GAME_INVITE_RECEIVED', onGameInviteReceived);
      ws.off('GAME_START', onGameStart);
      ws.off('DRAW_START', onDrawStart);
      ws.off('GAME_STATE_UPDATE', onGameStateUpdate);
      ws.off('ROUND_END', onRoundEnd);
      ws.off('SCORE_UPDATE', onScoreUpdate);
      ws.off('CHAT_MESSAGE', onChatMessage);
      ws.off('GAME_END', onGameEnd);
      ws.off('CANVAS_START', onCanvasEvent);
      ws.off('CANVAS_MOVE', onCanvasEvent);
      ws.off('CANVAS_END', onCanvasEvent);
      ws.off('GAME_ACTION', onGameAction);
      ws.off('FRAME_DESTROYED', onFrameDestroyed);
      ws.off('LOBBY_RETURNED', onLobbyReturned);
      ws.off('WS_RECONNECTED', onWsReconnected);
      ws.off('ONLINE_COUNT', onOnlineCount);
      ws.off('ERROR', onError);
      ws.off('MATCHMAKING_STARTED', onMatchmakingStarted);
      WebRtcService.getInstance().disconnectAll();
      stopLocalMediaRef.current();
      ws.removeNetworkListeners();
      ws.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
