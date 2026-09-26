const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    // STUN servers (lightweight, no auth)
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
    private iceServers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS];
    private iceServersReady: boolean = true;
    private pendingUserJoins: string[] = [];

    // For Perfect Negotiation
    private makingOffer: Map<string, boolean> = new Map();
    private ignoreOffer: Map<string, boolean> = new Map();
    private isSettingRemoteAnswerPending: Map<string, boolean> = new Map();
    private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
    private remoteStreams: Map<string, MediaStream> = new Map();
    private iceRestarts: Map<string, number> = new Map();
    private statsPollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
    private wasConnected: Map<string, boolean> = new Map();

    private constructor() { }

    private classifyNetworkQuality(packetLoss: number, rtt: number): 'good' | 'medium' | 'poor' {
        if (packetLoss < 2 && rtt < 150) return 'good';
        if (packetLoss < 5 && rtt < 300) return 'medium';
        return 'poor';
    }

    private startStatsPolling(participantId: string, pc: RTCPeerConnection) {
        // Clear existing interval if any
        this.stopStatsPolling(participantId);

        const interval = setInterval(async () => {
            if (pc.connectionState !== 'connected') {
                this.stopStatsPolling(participantId);
                return;
            }

            try {
                const stats = await pc.getStats();
                let packetsLost = 0;
                let packetsReceived = 0;
                let currentRoundTripTime = 0;
                let jitter = 0;

                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        packetsLost = report.packetsLost || 0;
                        packetsReceived = report.packetsReceived || 0;
                        jitter = report.jitter || 0;
                    }
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        currentRoundTripTime = report.currentRoundTripTime || 0;
                    }
                });

                const packetLossPercent = packetsReceived > 0 ? (packetsLost / packetsReceived) * 100 : 0;
                const rttMs = currentRoundTripTime * 1000; // Convert to milliseconds

                const quality = this.classifyNetworkQuality(packetLossPercent, rttMs);

                // Update store with network quality
                import('@/store/useCallStore').then(module => {
                    module.useCallStore.getState().updateParticipantNetworkQuality(participantId, quality);
                });
            } catch (error) {
                console.error('[WebRtcService] Error getting stats:', error);
            }
        }, 4000); // Poll every 4 seconds

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

        // Update existing peer connections if stream changes
        this.peerConnections.forEach((pc, participantId) => {
            if (this.localStream) {
                // If we have transceivers, we can replace the track
                const senders = pc.getSenders();
                const transceivers = pc.getTransceivers();
                this.localStream.getTracks().forEach(track => {
                    const sender = senders.find(s => s.track?.kind === track.kind);
                    if (sender) {
                        sender.replaceTrack(track);
                    } else {
                        const emptyTransceiver = transceivers.find(t => t.sender.track === null && t.receiver.track.kind === track.kind);
                        if (emptyTransceiver) {
                            emptyTransceiver.sender.replaceTrack(track);
                            emptyTransceiver.direction = 'sendrecv'; // Force upgrade
                        } else {
                            pc.addTrack(track, this.localStream!);
                        }
                    }
                });
            }
        });
    }

    private async forceRenegotiate(participantId: string) {
        const pc = this.getPeerConnection(participantId);
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignalingMessage({
                type: 'offer',
                offer: pc.localDescription,
                targetId: participantId,
            });
        } catch (err) {
            console.error('[WebRtcService] Error forcing renegotiation:', err);
        }
    }

    public onRemoteStream(callback: (participantId: string, stream: MediaStream) => void) {
        this.onRemoteStreamCallback = callback;
    }

    public connectToSignalingServer(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.signalingSocket = new WebSocket(url);

                this.signalingSocket.onopen = () => {
                    console.log('[WebRtcService] Connected to signaling server');
                    resolve();
                };

                this.signalingSocket.onerror = (error) => {
                    console.error('[WebRtcService] Signaling socket error:', error);
                    reject(error);
                };

                this.signalingSocket.onmessage = (event) => {
                    this.handleSignalingMessage(JSON.parse(event.data));
                };

                this.signalingSocket.onclose = () => {
                    console.log('[WebRtcService] Signaling socket closed');
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    public joinRoom(roomId: string, userId: string) {
        if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) {
            console.error('[WebRtcService] Signaling socket not connected');
            return;
        }

        this.currentRoomId = roomId;
        this.localUserId = userId;
        this.signalingSocket.send(JSON.stringify({
            type: 'join',
            roomID: roomId,
            userId: userId,
        }));
    }

    private handleSignalingMessage(data: any) {
        console.log('[WebRtcService] Received signaling message:', data.type);

        switch (data.type) {
            case 'ice-servers':
                if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
                    const validServers = data.iceServers.filter((s: any) => {
                        const urlString = Array.isArray(s.urls) ? s.urls.join(',') : s.urls;
                        return !urlString.includes('localhost');
                    });
                    this.iceServers = [...DEFAULT_ICE_SERVERS, ...validServers];
                    this.iceServersReady = true;
                    console.log('[WebRtcService] ICE servers configured:', this.iceServers.length, 'servers');
                    // Perbarui konfigurasi pada peer connection yang sudah berjalan
                    this.peerConnections.forEach((pc, id) => {
                        try {
                            pc.setConfiguration({ iceServers: this.iceServers });
                            console.log(`[WebRtcService] Updated ICE servers on existing PC for: ${id}`);
                        } catch (e) {
                            console.warn('[WebRtcService] Error updating ice servers:', e);
                        }
                    });
                }
                // Proses user-joined yang tertunda jika ada
                for (const userId of this.pendingUserJoins) {
                    console.log('[WebRtcService] Processing deferred user-joined:', userId);
                    this.createPeerConnection(userId, true);
                }
                this.pendingUserJoins = [];
                break;

            case 'user-joined':
                console.log('[WebRtcService] User joined:', data.userId);
                // Inisialisasi awal tanpa negosiasi (menunggu peer-ready)
                this.createPeerConnection(data.userId, false);
                break;

            case 'peer-ready':
                console.log(`[WebRtcService] Peer ready. Role: ${data.role}, PeerId: ${data.peerId}`);
                // Proactively create PC so it's ready for offer/answer
                this.createPeerConnection(data.peerId, false);
                
                if (data.role === 'offerer') {
                    this.initiateOffer(data.peerId);
                }
                break;

            case 'offer':
                this.handleOffer(data.offer, data.sender);
                break;

            case 'answer':
                this.handleAnswer(data.answer, data.sender);
                break;

            case 'ice-candidate':
                this.handleIceCandidate(data.candidate, data.sender);
                break;

            case 'user-left':
                console.log('[WebRtcService] User left:', data.userId);
                this.disconnectPeer(data.userId);
                break;

            default:
                console.log('[WebRtcService] Unknown message type:', data.type);
        }
    }

    private getPeerConnection(participantId: string): RTCPeerConnection {
        let pc = this.peerConnections.get(participantId);
        if (!pc) {
            pc = this.createPeerConnection(participantId, false);
        }
        return pc;
    }

    private async initiateOffer(participantId: string) {
        const timestamp = new Date().toISOString();
        const pc = this.getPeerConnection(participantId);
        try {
            console.log(`[WebRtcService][${timestamp}] Server assigned as offerer. Creating offer for ${participantId}`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.sendSignalingMessage({
                type: 'offer',
                offer: pc.localDescription,
                targetId: participantId,
            });
        } catch (err) {
            console.error(`[WebRtcService][${timestamp}] Error creating offer for ${participantId}:`, err);
        }
    }

    private createPeerConnection(participantId: string, isInitiator: boolean): RTCPeerConnection {
        if (this.peerConnections.has(participantId)) {
            return this.peerConnections.get(participantId)!;
        }

        const timestamp = new Date().toISOString();
        console.log(`[WebRtcService][${timestamp}] Creating peer connection with: ${participantId} - Match/Session ID: ${this.currentRoomId}`);

        // Gunakan gabungan ICE Servers lengkap (STUN Google + Coturn)
        const validServers = (this.iceServers || []).filter(server => {
            const urlString = Array.isArray(server.urls) ? server.urls.join(',') : server.urls;
            return !urlString.includes('localhost');
        });

        // Debug mode: force relay if localStorage flag is set
        const forceRelay = typeof window !== 'undefined' && localStorage.getItem('FORCE_RELAY') === 'true';

        const config: RTCConfiguration = {
            iceServers: validServers.length > 0 ? validServers : DEFAULT_ICE_SERVERS,
            iceCandidatePoolSize: 10,
            ...(forceRelay ? { iceTransportPolicy: 'relay' } : {}),
        };

        const pc = new RTCPeerConnection(config);

        // Perfect Negotiation states
        this.makingOffer.set(participantId, false);
        this.ignoreOffer.set(participantId, false);
        this.isSettingRemoteAnswerPending.set(participantId, false);
        this.iceRestarts.set(participantId, 0);

        // Add local tracks via transceivers for robust negotiation
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTransceiver(track, { direction: 'sendrecv', streams: [this.localStream!] });
            });
        } else {
            pc.addTransceiver('video', { direction: 'sendrecv' });
            pc.addTransceiver('audio', { direction: 'sendrecv' });
        }

        // Helper to bind a track when it actually receives media
        const bindTrack = (track: MediaStreamTrack) => {
            console.log(`[WebRtcService] Binding active/unmuted track for ${participantId}: ${track.kind}`);
            let stream = this.remoteStreams.get(participantId);
            if (!stream) {
                stream = new MediaStream();
            } else {
                stream = new MediaStream(stream.getTracks());
            }
            if (!stream.getTracks().includes(track)) {
                stream.addTrack(track);
            }
            this.remoteStreams.set(participantId, stream);
            if (this.onRemoteStreamCallback) {
                this.onRemoteStreamCallback(participantId, stream);
            }
        };

        // IMPORTANT FIX: ontrack does NOT fire for transceivers created locally via addTransceiver.
        // We must listen for the 'unmute' event on the receiver tracks to know when media is actually flowing.
        const receiverTracks = pc.getReceivers().map(r => r.track);
        receiverTracks.forEach(track => {
            if (!track.muted) {
                bindTrack(track);
            }
            track.onunmute = () => {
                bindTrack(track);
            };
        });

        pc.ontrack = (event) => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] ontrack fired for ${participantId} - Match/Session ID: ${this.currentRoomId}, Track kind: ${event.track.kind}`);
            bindTrack(event.track);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // Debug logging for ICE candidates (temporary for verification)
                console.log(`[WebRtcService] ICE Candidate for ${participantId}:`, {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    port: event.candidate.port,
                    address: event.candidate.address,
                    candidate: event.candidate.candidate
                });

                this.sendSignalingMessage({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    targetId: participantId,
                });
            }
        };

        pc.onsignalingstatechange = () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] Signaling state with ${participantId}: ${pc.signalingState} - Match/Session ID: ${this.currentRoomId}`);
        };

        pc.oniceconnectionstatechange = () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] ICE connection state with ${participantId}: ${pc.iceConnectionState} - Match/Session ID: ${this.currentRoomId}`);

            const wasPreviouslyConnected = this.wasConnected.get(participantId) || false;
            const isNowConnected = pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';

            if (isNowConnected && !wasPreviouslyConnected) {
                this.wasConnected.set(participantId, true);
            } else if (!isNowConnected && wasPreviouslyConnected) {
                // Was connected, now disconnected - mark as reconnecting
                import('@/store/useCallStore').then(module => {
                    module.useCallStore.getState().updateParticipantConnectionState(participantId, 'reconnecting');
                });
            }

            // Perbarui state di store (gunakan dinamis import atau event emitter)
            import('@/store/useCallStore').then(module => {
                module.useCallStore.getState().updateParticipantConnectionState(participantId, pc.iceConnectionState);
            });

            // Auto ICE restart jika iceConnectionState failed
            if (pc.iceConnectionState === 'failed') {
                const restarts = this.iceRestarts.get(participantId) || 0;
                if (restarts < 3) {
                    this.iceRestarts.set(participantId, restarts + 1);
                    console.log(`[WebRtcService][${timestamp}] Triggering ICE restart (attempt ${restarts + 1}/3) for ${participantId} due to failed ICE.`);
                    import('@/store/useCallStore').then(module => {
                        module.useCallStore.getState().updateParticipantConnectionState(participantId, 'ice-restarting');
                    });
                    try {
                        pc.restartIce();
                    } catch (e) {
                        console.error('[WebRtcService] restartIce error:', e);
                    }
                }
            }
        };

        // Role-based negotiation - We wait for 'peer-ready' from signaling server
        // pc.onnegotiationneeded = async () => { ... } is removed to avoid glare/collisions.
        
        // Alat diagnostik tingkat lanjut untuk ICE
        (pc as any).onicecandidateerror = (event: any) => {
            console.error('[ICE ERROR]', JSON.stringify({ 
                url: event.url, 
                errorCode: event.errorCode, 
                errorText: event.errorText 
            }));
        };

        pc.onconnectionstatechange = () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] Connection state with ${participantId}: ${pc.connectionState} - Match/Session ID: ${this.currentRoomId}`);
            if (pc.connectionState === 'failed' as any) {
                const restarts = this.iceRestarts.get(participantId) || 0;
                if (restarts < 3) {
                    this.iceRestarts.set(participantId, restarts + 1);
                    console.log(`[WebRtcService][${timestamp}] Triggering ICE restart (attempt ${restarts + 1}/3) for ${participantId} due to failed state.`);
                    try {
                        pc.restartIce();
                    } catch (e) {
                        console.error('[WebRtcService] restartIce error:', e);
                    }
                } else {
                    console.error(`[WebRtcService][${timestamp}] ICE connection failed permanently for ${participantId}. No more ICE restarts to prevent negotiation loop.`);
                }
            } else if (pc.connectionState === 'connected') {
                // Start periodic stats polling
                this.startStatsPolling(participantId, pc);

                // Log initial ICE pair info
                pc.getStats().then(stats => {
                    stats.forEach(report => {
                        if (report.type === 'transport' && report.selectedCandidatePairId) {
                            const pair = stats.get(report.selectedCandidatePairId);
                            if (pair) {
                                const local = stats.get(pair.localCandidateId);
                                const remote = stats.get(pair.remoteCandidateId);
                                console.log(`[WebRtcService][${timestamp}] Selected ICE Pair for ${participantId}: Local(${local?.candidateType}) -> Remote(${remote?.candidateType})`);
                            }
                        }
                    });
                });
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                // Stop stats polling when connection is not connected
                this.stopStatsPolling(participantId);
            }
        };

        this.peerConnections.set(participantId, pc);
        return pc;
    }

    private async handleOffer(offer: RTCSessionDescriptionInit, sender: string) {
        const timestamp = new Date().toISOString();
        console.log(`[WebRtcService][${timestamp}] Handling offer from: ${sender} - Match/Session ID: ${this.currentRoomId}`);
        const pc = this.getPeerConnection(sender);

        try {
            console.log(`[WebRtcService][${timestamp}] setRemoteDescription(offer) starting for ${sender}`);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log(`[WebRtcService][${timestamp}] setRemoteDescription(offer) success for ${sender}`);

            // Flush pending ICE candidates
            await this.flushPendingIceCandidates(sender, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            console.log(`[WebRtcService][${timestamp}] setLocalDescription(answer) success for ${sender}`);
            this.sendSignalingMessage({
                type: 'answer',
                answer: pc.localDescription,
                targetId: sender,
            });
        } catch (err) {
            console.error(`[WebRtcService][${timestamp}] Error handling offer from ${sender}:`, err);
        }
    }

    private async handleAnswer(answer: RTCSessionDescriptionInit, sender: string) {
        const timestamp = new Date().toISOString();
        console.log(`[WebRtcService][${timestamp}] Handling answer from: ${sender} - Match/Session ID: ${this.currentRoomId}`);
        const pc = this.peerConnections.get(sender);
        if (pc) {
            try {
                console.log(`[WebRtcService][${timestamp}] setRemoteDescription(answer) starting for ${sender}`);
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log(`[WebRtcService][${timestamp}] setRemoteDescription(answer) success for ${sender}`);

                // Flush pending ICE candidates
                await this.flushPendingIceCandidates(sender, pc);
            } catch (err) {
                console.error(`[WebRtcService][${timestamp}] Error handling answer from ${sender}:`, err);
            }
        }
    }

    private async flushPendingIceCandidates(sender: string, pc: RTCPeerConnection) {
        const pending = this.pendingCandidates.get(sender);
        if (pending && pending.length > 0) {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] Flushing ${pending.length} pending ICE candidates for ${sender}`);
            for (const c of pending) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(c));
                } catch (err) {
                    console.error(`[WebRtcService][${timestamp}] Error adding buffered ice candidate for ${sender}:`, err);
                }
            }
            this.pendingCandidates.delete(sender);
        }
    }

    private async handleIceCandidate(candidate: RTCIceCandidateInit, sender: string) {
        const timestamp = new Date().toISOString();
        const pc = this.getPeerConnection(sender);
        if (pc) {
            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`[WebRtcService][${timestamp}] ICE candidate added for ${sender}`);
                } catch (err) {
                    console.error(`[WebRtcService][${timestamp}] Error adding ice candidate for ${sender}:`, err);
                }
            } else {
                console.log(`[WebRtcService][${timestamp}] Buffering ICE candidate for ${sender} (remote description not set yet)`);
                let pending = this.pendingCandidates.get(sender) || [];
                pending.push(candidate);
                this.pendingCandidates.set(sender, pending);
            }
        }
    }

    private sendSignalingMessage(data: any) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify(data));
        }
    }

    public disconnectPeer(participantId: string): void {
        const timestamp = new Date().toISOString();
        const pc = this.peerConnections.get(participantId);
        if (pc) {
            console.log(`[WebRtcService][${timestamp}] Closing peer connection with: ${participantId} - Match/Session ID: ${this.currentRoomId}`);
            this.stopStatsPolling(participantId);
            this.wasConnected.delete(participantId);
            pc.close();
            this.peerConnections.delete(participantId);
            this.makingOffer.delete(participantId);
            this.ignoreOffer.delete(participantId);
            this.isSettingRemoteAnswerPending.delete(participantId);
            this.pendingCandidates.delete(participantId);
            this.remoteStreams.delete(participantId);
            this.iceRestarts.delete(participantId);
            console.log(`[WebRtcService][${timestamp}] Closed peer connection with: ${participantId}`);
        }
    }

    public disconnectAll(): void {
        const timestamp = new Date().toISOString();
        if (this.currentRoomId) {
            this.sendSignalingMessage({ type: 'leave' });
        }

        this.peerConnections.forEach((pc, id) => {
            console.log(`[WebRtcService][${timestamp}] Closing peer connection with: ${id} - Match/Session ID: ${this.currentRoomId}`);
            this.stopStatsPolling(id);
            pc.close();
            console.log(`[WebRtcService][${timestamp}] Disconnected ${id}`);
        });
        this.peerConnections.clear();
        this.makingOffer.clear();
        this.ignoreOffer.clear();
        this.isSettingRemoteAnswerPending.clear();
        this.pendingCandidates.clear();
        this.remoteStreams.clear();
        this.iceRestarts.clear();
        this.statsPollingIntervals.clear();
        this.wasConnected.clear();
        this.currentRoomId = null;
        // Do NOT reset iceServers to ensure TURN configuration persists across matches
        // this.iceServers = [...DEFAULT_ICE_SERVERS];
        // this.iceServersReady = true;
        this.pendingUserJoins = [];

        if (this.signalingSocket) {
            this.signalingSocket.close();
            this.signalingSocket = null;
        }
    }
}
