const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

export class WebRtcService {
    private static instance: WebRtcService;
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private localStream: MediaStream | null = null;
    private onRemoteStreamCallback: ((participantId: string, stream: MediaStream) => void) | null = null;
    private signalingSocket: WebSocket | null = null;
    private currentRoomId: string | null = null;
    private localUserId: string | null = null;
    private signalingToken: string | null = null;
    private turnToken: string | null = null;
    private iceServers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS];
    private iceServersReady: boolean = true;

    // Perfect Negotiation state
    private makingOffer: Map<string, boolean> = new Map();
    private ignoreOffer: Map<string, boolean> = new Map();
    private isSettingRemoteAnswerPending: Map<string, boolean> = new Map();
    private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
    private remoteStreams: Map<string, MediaStream> = new Map();
    private iceRestarts: Map<string, number> = new Map();
    private statsPollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
    private prevStats: Map<string, { lost: number; received: number; poorStreak: number }> = new Map();
    private peerIsRelay: Map<string, boolean> = new Map();
    private wasConnected: Map<string, boolean> = new Map();
    private isGameDockActive = false;

    private iceServersFetchedAt = 0;
    private iceFetchPromise: Promise<void> | null = null;
    private signalingUrl: string | null = null;
    private signalingConnectPromise: Promise<void> | null = null;
    private shouldReconnectSignaling = true;
    private signalingReconnectAttempts = 0;
    private signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;

    private constructor() { }

    public setTurnToken(token: string | null) {
        if (token && token !== this.turnToken) {
            this.turnToken = token;
            this.iceServersFetchedAt = 0; // force refresh with valid auth token
        } else {
            this.turnToken = token;
        }
    }

    public setGameDockActive(active: boolean) {
        if (this.isGameDockActive === active) return;
        this.isGameDockActive = active;
        void this.updateAllPeerBitrates();
    }

    public getCurrentRoomId(): string | null {
        return this.currentRoomId;
    }

    public hasCachedIceServers(): boolean {
        return this.iceServersReady && this.iceServersFetchedAt > 0 && Date.now() - this.iceServersFetchedAt < 12 * 60 * 1000;
    }

    public async fetchCloudflareIceServers(force = false): Promise<void> {
        if (!force && this.hasCachedIceServers()) {
            return;
        }
        if (!this.turnToken) {
            return;
        }
        if (this.iceFetchPromise) {
            return this.iceFetchPromise;
        }

        this.iceFetchPromise = (async () => {
            try {
                const res = await fetch('/api/turn-credentials', {
                    headers: {
                        'X-Funfram-Client': '1',
                        'Authorization': `Bearer ${this.turnToken}`,
                    },
                });
                if (!res.ok) {
                    return;
                }
                const data = await res.json();
                if (data.iceServers) {
                    const serversArray = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
                    const filteredServers = serversArray.map((server: RTCIceServer) => {
                        if (server.urls) {
                            const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
                            return {
                                ...server,
                                urls: urls.filter((url: string) => !url.includes(':53?')),
                            };
                        }
                        return server;
                    });
                    this.iceServers = [...DEFAULT_ICE_SERVERS, ...filteredServers];
                    this.iceServersReady = true;
                    this.iceServersFetchedAt = Date.now();

                    this.peerConnections.forEach((pc) => {
                        try {
                            pc.setConfiguration({ iceServers: this.iceServers });
                        } catch {
                            // ignore
                        }
                    });
                }
            } catch {
                // fallback to default STUN
            } finally {
                this.iceFetchPromise = null;
            }
        })();

        return this.iceFetchPromise;
    }

    private isPolite(participantId: string): boolean {
        return (this.localUserId || '') < participantId;
    }

    private classifyNetworkQuality(packetLoss: number, rtt: number): 'good' | 'medium' | 'poor' {
        if (packetLoss < 2 && rtt < 150) return 'good';
        if (packetLoss < 5 && rtt < 300) return 'medium';
        return 'poor';
    }

    private async applyAdaptiveVideoParameters(participantId: string, pc: RTCPeerConnection) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (!videoSender) return;

        try {
            const params = videoSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }

            const peerCount = this.peerConnections.size;
            const isRelay = this.peerIsRelay.get(participantId) || false;
            const poorStreak = this.prevStats.get(participantId)?.poorStreak || 0;

            let maxBitrate = 1_200_000;
            let scaleResolutionDownBy = 1.0;
            let maxFramerate = 30;

            if (this.isGameDockActive || poorStreak >= 2) {
                // Tier 4 (Game PiP / severe congestion)
                maxBitrate = 250_000;
                scaleResolutionDownBy = 2.5;
                maxFramerate = 20;
            } else if (peerCount > 1) {
                // Tier 3 (Co-Op 2v2 Mesh)
                maxBitrate = 450_000;
                scaleResolutionDownBy = 1.5;
                maxFramerate = 24;
            } else if (isRelay) {
                // Tier 2 (1v1 TURN Relay)
                maxBitrate = 750_000;
                scaleResolutionDownBy = 1.5;
                maxFramerate = 30;
            } else {
                // Tier 1 (1v1 Direct P2P)
                maxBitrate = 1_200_000;
                scaleResolutionDownBy = 1.0;
                maxFramerate = 30;
            }

            params.degradationPreference = 'maintain-framerate';
            params.encodings[0] = {
                ...params.encodings[0],
                maxBitrate,
                scaleResolutionDownBy,
                maxFramerate,
            };
            await videoSender.setParameters(params);
        } catch {
            // Some browsers may reject parameters before track negotiation completes
        }
    }

    public async updateAllPeerBitrates() {
        const updates: Promise<void>[] = [];
        this.peerConnections.forEach((pc, id) => {
            updates.push(this.applyAdaptiveVideoParameters(id, pc));
        });
        await Promise.allSettled(updates);
    }

    private startStatsPolling(participantId: string, pc: RTCPeerConnection) {
        this.stopStatsPolling(participantId);

        const interval = setInterval(async () => {
            if (pc.connectionState !== 'connected') {
                this.stopStatsPolling(participantId);
                return;
            }

            try {
                const stats = await pc.getStats();
                if (this.peerConnections.get(participantId) !== pc) {
                    this.stopStatsPolling(participantId);
                    return;
                }

                let totalLost = 0;
                let totalReceived = 0;
                let currentRoundTripTime = 0;
                let selectedPairId: string | undefined;

                stats.forEach((report) => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        totalLost = report.packetsLost || 0;
                        totalReceived = report.packetsReceived || 0;
                    }
                    if (report.type === 'transport' && report.selectedCandidatePairId) {
                        selectedPairId = report.selectedCandidatePairId;
                    }
                });

                if (selectedPairId) {
                    const pair = stats.get(selectedPairId);
                    if (pair) {
                        currentRoundTripTime = pair.currentRoundTripTime || 0;
                        const localCand = stats.get(pair.localCandidateId);
                        const remoteCand = stats.get(pair.remoteCandidateId);
                        const isRelay = localCand?.candidateType === 'relay' || remoteCand?.candidateType === 'relay';
                        if (this.peerIsRelay.get(participantId) !== isRelay) {
                            this.peerIsRelay.set(participantId, isRelay);
                            void this.applyAdaptiveVideoParameters(participantId, pc);
                        }
                    }
                }

                const prev = this.prevStats.get(participantId) || { lost: 0, received: 0, poorStreak: 0 };
                const deltaLost = Math.max(0, totalLost - prev.lost);
                const deltaReceived = Math.max(0, totalReceived - prev.received);
                const packetLossPercent = deltaReceived + deltaLost > 0
                    ? (deltaLost / (deltaReceived + deltaLost)) * 100
                    : 0;
                const rttMs = currentRoundTripTime * 1000;
                const quality = this.classifyNetworkQuality(packetLossPercent, rttMs);

                const nextPoorStreak = quality === 'poor' ? prev.poorStreak + 1 : 0;
                this.prevStats.set(participantId, {
                    lost: totalLost,
                    received: totalReceived,
                    poorStreak: nextPoorStreak,
                });

                if ((nextPoorStreak === 2) || (prev.poorStreak >= 2 && nextPoorStreak === 0)) {
                    void this.applyAdaptiveVideoParameters(participantId, pc);
                }

                import('@/store/useCallStore').then((module) => {
                    module.useCallStore.getState().updateParticipantNetworkQuality(participantId, quality);
                });
            } catch {
                // ignore stats errors on closing PC
            }
        }, 4000);

        this.statsPollingIntervals.set(participantId, interval);
    }

    private stopStatsPolling(participantId: string) {
        const interval = this.statsPollingIntervals.get(participantId);
        if (interval) {
            clearInterval(interval);
            this.statsPollingIntervals.delete(participantId);
        }
    }

    public static getInstance(): WebRtcService {
        if (!WebRtcService.instance) {
            WebRtcService.instance = new WebRtcService();
        }
        return WebRtcService.instance;
    }

    public setLocalStream(stream: MediaStream | null) {
        this.localStream = stream;

        this.peerConnections.forEach((pc, id) => {
            if (this.localStream) {
                const senders = pc.getSenders();
                const transceivers = pc.getTransceivers();
                this.localStream.getTracks().forEach((track) => {
                    const sender = senders.find((s) => s.track?.kind === track.kind);
                    if (sender) {
                        void sender.replaceTrack(track);
                    } else {
                        const emptyTransceiver = transceivers.find(
                            (t) => t.sender.track === null && t.receiver?.track?.kind === track.kind
                        );
                        if (emptyTransceiver) {
                            void emptyTransceiver.sender.replaceTrack(track);
                            emptyTransceiver.direction = 'sendrecv';
                        } else {
                            pc.addTrack(track, this.localStream!);
                        }
                    }
                });
                void this.applyAdaptiveVideoParameters(id, pc);
            } else {
                pc.getSenders().forEach((sender) => {
                    if (sender.track) {
                        sender.replaceTrack(null).catch(() => {});
                    }
                });
            }
        });
    }

    private async forceRenegotiate(participantId: string) {
        const pc = this.getPeerConnection(participantId);
        try {
            this.makingOffer.set(participantId, true);
            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') return;
            await pc.setLocalDescription(offer);
            this.sendSignalingMessage({
                type: 'offer',
                offer: pc.localDescription,
                targetId: participantId,
            });
        } catch (err) {
            console.error('[WebRtcService] Error forcing renegotiation:', err);
        } finally {
            this.makingOffer.set(participantId, false);
        }
    }

    public onRemoteStream(callback: (participantId: string, stream: MediaStream) => void) {
        this.onRemoteStreamCallback = callback;
        this.remoteStreams.forEach((stream, participantId) => {
            callback(participantId, stream);
        });
    }

    private clearSignalingReconnectTimer() {
        if (this.signalingReconnectTimer) {
            clearTimeout(this.signalingReconnectTimer);
            this.signalingReconnectTimer = null;
        }
    }

    private scheduleSignalingReconnect() {
        if (!this.shouldReconnectSignaling || !this.signalingUrl || this.signalingReconnectTimer) {
            return;
        }
        const delay = Math.min(1000 * Math.pow(2, this.signalingReconnectAttempts), 8000);
        this.signalingReconnectAttempts += 1;
        this.signalingReconnectTimer = setTimeout(() => {
            this.signalingReconnectTimer = null;
            if (!this.signalingUrl) return;
            this.connectToSignalingServer(this.signalingUrl)
                .then(() => {
                    if (this.currentRoomId && this.localUserId && this.signalingToken) {
                        this.joinRoom(this.currentRoomId, this.localUserId, this.signalingToken);
                    }
                })
                .catch(() => {});
        }, delay);
    }

    public connectToSignalingServer(url: string): Promise<void> {
        this.shouldReconnectSignaling = true;
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN && this.signalingUrl === url) {
            return Promise.resolve();
        }
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.CONNECTING && this.signalingUrl === url && this.signalingConnectPromise) {
            return this.signalingConnectPromise;
        }

        this.signalingUrl = url;
        this.signalingConnectPromise = new Promise((resolve, reject) => {
            try {
                if (this.signalingSocket) {
                    this.signalingSocket.onopen = null;
                    this.signalingSocket.onmessage = null;
                    this.signalingSocket.onerror = null;
                    this.signalingSocket.onclose = null;
                    this.signalingSocket.close();
                    this.signalingSocket = null;
                }

                this.signalingSocket = new WebSocket(url);

                this.signalingSocket.onopen = () => {
                    this.signalingReconnectAttempts = 0;
                    this.clearSignalingReconnectTimer();
                    this.signalingConnectPromise = null;
                    resolve();
                };

                this.signalingSocket.onerror = (error) => {
                    this.signalingConnectPromise = null;
                    reject(error);
                };

                this.signalingSocket.onmessage = (event) => {
                    try {
                        this.handleSignalingMessage(JSON.parse(event.data));
                    } catch {
                        // ignore invalid message
                    }
                };

                this.signalingSocket.onclose = (ev) => {
                    this.signalingConnectPromise = null;
                    if (ev.code === 4001 || ev.code === 4003) {
                        console.warn(`[WebRtcService] Signaling closed (${ev.code}): ${ev.reason || 'unauthorized'}`);
                        return;
                    }
                    this.scheduleSignalingReconnect();
                };
            } catch (error) {
                this.signalingConnectPromise = null;
                reject(error);
            }
        });

        return this.signalingConnectPromise;
    }

    public joinRoom(roomId: string, userId: string, signalingToken?: string | null) {
        if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        const token = signalingToken ?? this.signalingToken;
        if (!token) {
            return;
        }

        this.currentRoomId = roomId;
        this.localUserId = userId;
        this.signalingToken = token;
        this.signalingSocket.send(JSON.stringify({
            type: 'join',
            roomID: roomId,
            userId,
            token,
        }));
    }

    private handleSignalingMessage(data: any) {
        switch (data.type) {
            case 'ice-servers':
                break;

            case 'user-joined':
                this.createPeerConnection(data.userId);
                break;

            case 'peer-ready':
                this.createPeerConnection(data.peerId);
                if (data.role === 'offerer') {
                    void this.initiateOffer(data.peerId);
                }
                break;

            case 'offer':
                void this.handleOffer(data.offer, data.sender);
                break;

            case 'answer':
                void this.handleAnswer(data.answer, data.sender);
                break;

            case 'ice-candidate':
                void this.handleIceCandidate(data.candidate, data.sender);
                break;

            case 'user-left':
                this.disconnectPeer(data.userId);
                break;
        }
    }

    private getPeerConnection(participantId: string): RTCPeerConnection {
        let pc = this.peerConnections.get(participantId);
        if (!pc) {
            pc = this.createPeerConnection(participantId);
        }
        return pc;
    }

    private async initiateOffer(participantId: string) {
        const pc = this.getPeerConnection(participantId);
        try {
            this.makingOffer.set(participantId, true);
            const existingTransceivers = pc.getTransceivers();

            const ensureKind = (kind: 'video' | 'audio', track?: MediaStreamTrack) => {
                const existing = existingTransceivers.find(
                    (t) => t.sender.track?.kind === kind || t.receiver?.track?.kind === kind
                );
                if (existing) {
                    if (track && existing.sender.track !== track) {
                        void existing.sender.replaceTrack(track);
                    }
                    existing.direction = 'sendrecv';
                } else if (track && this.localStream) {
                    pc.addTransceiver(track, { direction: 'sendrecv', streams: [this.localStream] });
                } else {
                    pc.addTransceiver(kind, { direction: 'sendrecv' });
                }
            };

            const videoTrack = this.localStream?.getVideoTracks()[0];
            const audioTrack = this.localStream?.getAudioTracks()[0];
            ensureKind('video', videoTrack);
            ensureKind('audio', audioTrack);

            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') return;
            await pc.setLocalDescription(offer);

            this.sendSignalingMessage({
                type: 'offer',
                offer: pc.localDescription,
                targetId: participantId,
            });
            void this.applyAdaptiveVideoParameters(participantId, pc);
        } catch (err) {
            console.error(`[WebRtcService] Error creating offer for ${participantId}:`, err);
        } finally {
            this.makingOffer.set(participantId, false);
        }
    }

    private createPeerConnection(participantId: string): RTCPeerConnection {
        if (this.peerConnections.has(participantId)) {
            return this.peerConnections.get(participantId)!;
        }

        const validServers = (this.iceServers || []).filter((server) => {
            const urlString = Array.isArray(server.urls) ? server.urls.join(',') : server.urls;
            return !urlString.includes('localhost');
        });

        const forceRelay =
            process.env.NODE_ENV !== 'production' &&
            typeof window !== 'undefined' &&
            localStorage.getItem('FORCE_RELAY') === 'true';

        const config: RTCConfiguration = {
            iceServers: validServers.length > 0 ? validServers : DEFAULT_ICE_SERVERS,
            iceCandidatePoolSize: 2,
            ...(forceRelay ? { iceTransportPolicy: 'relay' } : {}),
        };

        const pc = new RTCPeerConnection(config);

        this.makingOffer.set(participantId, false);
        this.ignoreOffer.set(participantId, false);
        this.isSettingRemoteAnswerPending.set(participantId, false);
        this.iceRestarts.set(participantId, 0);

        pc.ontrack = (event) => {
            let stream = this.remoteStreams.get(participantId);
            let isNewStream = false;
            if (!stream) {
                stream = new MediaStream();
                isNewStream = true;
            }

            if (!stream.getTracks().includes(event.track)) {
                stream.addTrack(event.track);
                this.remoteStreams.set(participantId, stream);
                if (this.onRemoteStreamCallback) {
                    this.onRemoteStreamCallback(participantId, stream);
                }
            } else if (isNewStream) {
                this.remoteStreams.set(participantId, stream);
                if (this.onRemoteStreamCallback) {
                    this.onRemoteStreamCallback(participantId, stream);
                }
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    targetId: participantId,
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            const wasPreviouslyConnected = this.wasConnected.get(participantId) || false;
            const isNowConnected = pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';

            if (isNowConnected) {
                this.iceRestarts.set(participantId, 0);
                if (!wasPreviouslyConnected) {
                    this.wasConnected.set(participantId, true);
                }
                import('@/store/useCallStore').then((module) => {
                    module.useCallStore.getState().updateParticipantConnectionState(participantId, pc.iceConnectionState);
                });
            } else if (wasPreviouslyConnected && pc.iceConnectionState === 'disconnected') {
                import('@/store/useCallStore').then((module) => {
                    module.useCallStore.getState().updateParticipantConnectionState(participantId, 'reconnecting');
                });
            } else {
                import('@/store/useCallStore').then((module) => {
                    module.useCallStore.getState().updateParticipantConnectionState(participantId, pc.iceConnectionState);
                });
            }

            if (pc.iceConnectionState === 'failed') {
                const restarts = this.iceRestarts.get(participantId) || 0;
                if (restarts < 3) {
                    this.iceRestarts.set(participantId, restarts + 1);
                    import('@/store/useCallStore').then((module) => {
                        module.useCallStore.getState().updateParticipantConnectionState(participantId, 'ice-restarting');
                    });
                    try {
                        pc.restartIce();
                        void this.forceRenegotiate(participantId);
                    } catch {
                        // ignore
                    }
                }
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                this.startStatsPolling(participantId, pc);
                void this.updateAllPeerBitrates();
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                this.stopStatsPolling(participantId);
            }
        };

        this.peerConnections.set(participantId, pc);
        return pc;
    }

    private async handleOffer(offer: RTCSessionDescriptionInit, sender: string) {
        const pc = this.getPeerConnection(sender);
        const polite = this.isPolite(sender);
        const readyForOffer =
            !this.makingOffer.get(sender) &&
            (pc.signalingState === 'stable' || Boolean(this.isSettingRemoteAnswerPending.get(sender)));
        const offerCollision = !readyForOffer;
        const ignore = !polite && offerCollision;

        this.ignoreOffer.set(sender, ignore);
        if (ignore) {
            return;
        }

        try {
            if (offerCollision && pc.signalingState !== 'stable') {
                await Promise.all([
                    pc.setLocalDescription({ type: 'rollback' }),
                    pc.setRemoteDescription(new RTCSessionDescription(offer)),
                ]);
            } else {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
            }

            this.forceBindReceivers(sender, pc);

            if (this.localStream) {
                const transceivers = pc.getTransceivers();
                this.localStream.getTracks().forEach((track) => {
                    const emptyTransceiver = transceivers.find(
                        (t) => t.receiver?.track?.kind === track.kind && t.sender.track === null
                    );
                    if (emptyTransceiver) {
                        void emptyTransceiver.sender.replaceTrack(track);
                        if (emptyTransceiver.direction === 'recvonly') {
                            emptyTransceiver.direction = 'sendrecv';
                        }
                    } else if (!transceivers.some((t) => t.sender.track?.kind === track.kind)) {
                        pc.addTrack(track, this.localStream!);
                    }
                });
            }

            await this.flushPendingIceCandidates(sender, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.sendSignalingMessage({
                type: 'answer',
                answer: pc.localDescription,
                targetId: sender,
            });
            void this.applyAdaptiveVideoParameters(sender, pc);
        } catch (err) {
            console.error(`[WebRtcService] Error handling offer from ${sender}:`, err);
        }
    }

    private async handleAnswer(answer: RTCSessionDescriptionInit, sender: string) {
        const pc = this.peerConnections.get(sender);
        if (!pc) return;
        try {
            this.isSettingRemoteAnswerPending.set(sender, true);
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            this.forceBindReceivers(sender, pc);
            await this.flushPendingIceCandidates(sender, pc);
        } catch (err) {
            console.error(`[WebRtcService] Error handling answer from ${sender}:`, err);
        } finally {
            this.isSettingRemoteAnswerPending.set(sender, false);
        }
    }

    private forceBindReceivers(participantId: string, pc: RTCPeerConnection) {
        const tracks = pc.getReceivers().map((r) => r.track);
        if (tracks.length === 0) return;

        let stream = this.remoteStreams.get(participantId);
        let changed = false;

        if (!stream) {
            stream = new MediaStream();
            changed = true;
        }

        tracks.forEach((track) => {
            if (track && !stream!.getTracks().includes(track)) {
                stream!.addTrack(track);
                changed = true;
            }
        });

        if (changed) {
            this.remoteStreams.set(participantId, stream);
            if (this.onRemoteStreamCallback) {
                this.onRemoteStreamCallback(participantId, stream);
            }
        }
    }

    private async flushPendingIceCandidates(sender: string, pc: RTCPeerConnection) {
        const pending = this.pendingCandidates.get(sender);
        if (pending && pending.length > 0) {
            for (const c of pending) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(c));
                } catch {
                    // ignore invalid candidate
                }
            }
            this.pendingCandidates.delete(sender);
        }
    }

    private async handleIceCandidate(candidate: RTCIceCandidateInit, sender: string) {
        if (this.ignoreOffer.get(sender)) {
            return;
        }
        const pc = this.getPeerConnection(sender);
        if (pc.remoteDescription) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {
                // ignore
            }
        } else {
            const pending = this.pendingCandidates.get(sender) || [];
            pending.push(candidate);
            this.pendingCandidates.set(sender, pending);
        }
    }

    private sendSignalingMessage(data: any) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify(data));
        }
    }

    private clearPeerHandlers(pc: RTCPeerConnection) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.onsignalingstatechange = null;
        (pc as any).onicecandidateerror = null;
    }

    public disconnectPeer(participantId: string): void {
        const pc = this.peerConnections.get(participantId);
        if (pc) {
            this.stopStatsPolling(participantId);
            this.wasConnected.delete(participantId);
            this.prevStats.delete(participantId);
            this.peerIsRelay.delete(participantId);
            this.clearPeerHandlers(pc);
            pc.close();
            this.peerConnections.delete(participantId);
            this.makingOffer.delete(participantId);
            this.ignoreOffer.delete(participantId);
            this.isSettingRemoteAnswerPending.delete(participantId);
            this.pendingCandidates.delete(participantId);
            this.remoteStreams.delete(participantId);
            this.iceRestarts.delete(participantId);
            void this.updateAllPeerBitrates();
        }
    }

    public leaveCurrentRoom(): void {
        if (this.currentRoomId) {
            this.sendSignalingMessage({ type: 'leave' });
        }

        this.peerConnections.forEach((pc, id) => {
            this.stopStatsPolling(id);
            this.clearPeerHandlers(pc);
            pc.close();
        });
        this.peerConnections.clear();
        this.makingOffer.clear();
        this.ignoreOffer.clear();
        this.isSettingRemoteAnswerPending.clear();
        this.pendingCandidates.clear();
        this.remoteStreams.clear();
        this.iceRestarts.clear();
        this.statsPollingIntervals.clear();
        this.prevStats.clear();
        this.peerIsRelay.clear();
        this.wasConnected.clear();
        this.currentRoomId = null;
        this.signalingToken = null;
    }

    public disconnectAll(): void {
        this.shouldReconnectSignaling = false;
        this.clearSignalingReconnectTimer();
        this.leaveCurrentRoom();

        if (this.signalingSocket) {
            this.signalingSocket.onclose = null;
            this.signalingSocket.close();
            this.signalingSocket = null;
            this.signalingConnectPromise = null;
        }
    }
}
