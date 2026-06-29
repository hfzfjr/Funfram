export class WebRtcService {
    private static instance: WebRtcService;
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private localStream: MediaStream | null = null;
    private onRemoteStreamCallback: ((participantId: string, stream: MediaStream) => void) | null = null;
    private signalingSocket: WebSocket | null = null;
    private currentRoomId: string | null = null;
    private localUserId: string | null = null;
    private iceServers: RTCIceServer[] = [];
    
    // For Perfect Negotiation
    private makingOffer: Map<string, boolean> = new Map();
    private ignoreOffer: Map<string, boolean> = new Map();
    private isSettingRemoteAnswerPending: Map<string, boolean> = new Map();
    private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
    private remoteStreams: Map<string, MediaStream> = new Map();
    private iceRestarts: Map<string, number> = new Map();

    private constructor() { }

    public static getInstance(): WebRtcService {
        if (!WebRtcService.instance) {
            WebRtcService.instance = new WebRtcService();
        }
        return WebRtcService.instance;
    }

    public setLocalStream(stream: MediaStream | null) {
        this.localStream = stream;
        
        // Update existing peer connections if stream changes
        this.peerConnections.forEach((pc) => {
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
                        } else {
                            pc.addTrack(track, this.localStream!);
                        }
                    }
                });
            }
        });
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
                this.iceServers = data.iceServers;
                console.log('[WebRtcService] ICE servers configured');
                break;

            case 'user-joined':
                console.log('[WebRtcService] User joined:', data.userId);
                // When a new user joins, if our ID is 'greater', we act as polite, otherwise impolite.
                // We'll let both sides initiate Perfect Negotiation by having BOTH call createPeerConnection
                // but the polite peer logic resolves glare.
                this.createPeerConnection(data.userId, true);
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

    private createPeerConnection(participantId: string, isInitiator: boolean): RTCPeerConnection {
        if (this.peerConnections.has(participantId)) {
            return this.peerConnections.get(participantId)!;
        }

        const timestamp = new Date().toISOString();
        console.log(`[WebRtcService][${timestamp}] Creating peer connection with: ${participantId} - Match/Session ID: ${this.currentRoomId}`);

        // Selalu tambahkan STUN dan TURN gratis dari openrelay untuk berjaga-jaga jika backend gagal mengirimkan credentials yang benar
        const fallbackIceServers: RTCIceServer[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:openrelay.metered.ca:80' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ];

        // Gabungkan ICE Servers dari backend dengan fallback
        const finalIceServers = [...fallbackIceServers];
        if (this.iceServers.length > 0) {
            // Saring 'localhost' turn servers karena itu pasti salah konfigurasi dari backend
            const validBackendServers = this.iceServers.filter(server => {
                const urlString = Array.isArray(server.urls) ? server.urls.join(',') : server.urls;
                return !urlString.includes('localhost');
            });
            finalIceServers.push(...validBackendServers);
        }

        const config: RTCConfiguration = {
            iceServers: finalIceServers
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

        pc.ontrack = (event) => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] ontrack fired for ${participantId} - Match/Session ID: ${this.currentRoomId}, Track kind: ${event.track.kind}`);
            
            let stream: MediaStream;
            if (event.streams && event.streams.length > 0) {
                stream = event.streams[0];
            } else {
                stream = this.remoteStreams.get(participantId) || new MediaStream();
                stream.addTrack(event.track);
                this.remoteStreams.set(participantId, stream);
            }
            
            console.log(`[WebRtcService][${timestamp}] Remote stream updated from: ${participantId}`);
            if (this.onRemoteStreamCallback) {
                this.onRemoteStreamCallback(participantId, stream);
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

        pc.onsignalingstatechange = () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] Signaling state with ${participantId}: ${pc.signalingState} - Match/Session ID: ${this.currentRoomId}`);
        };

        pc.oniceconnectionstatechange = () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] ICE connection state with ${participantId}: ${pc.iceConnectionState} - Match/Session ID: ${this.currentRoomId}`);
        };

        // Perfect Negotiation logic on negotiationneeded
        pc.onnegotiationneeded = async () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] negotiationneeded for ${participantId} - Match/Session ID: ${this.currentRoomId}, State: ${pc.signalingState}`);
            try {
                this.makingOffer.set(participantId, true);
                await pc.setLocalDescription();
                const offer = pc.localDescription;
                if (!offer) return;
                
                console.log(`[WebRtcService][${timestamp}] setLocalDescription() success for ${participantId}`);
                this.sendSignalingMessage({
                    type: 'offer',
                    offer: offer,
                    targetId: participantId,
                });
            } catch (err) {
                console.error(`[WebRtcService][${timestamp}] Error during negotiation for ${participantId}:`, err);
            } finally {
                this.makingOffer.set(participantId, false);
            }
        };

        pc.onconnectionstatechange = () => {
            const timestamp = new Date().toISOString();
            console.log(`[WebRtcService][${timestamp}] Connection state with ${participantId}: ${pc.connectionState} - Match/Session ID: ${this.currentRoomId}`);
            if (pc.connectionState === 'failed') {
                const restarts = this.iceRestarts.get(participantId) || 0;
                if (restarts < 1) {
                    this.iceRestarts.set(participantId, restarts + 1);
                    console.log(`[WebRtcService][${timestamp}] Triggering ICE restart (attempt 1) for ${participantId} due to failed state.`);
                    pc.restartIce();
                } else {
                    console.error(`[WebRtcService][${timestamp}] ICE connection failed permanently for ${participantId}. No more ICE restarts to prevent negotiation loop.`);
                }
            } else if (pc.connectionState === 'connected') {
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
            }
        };

        this.peerConnections.set(participantId, pc);
        return pc;
    }

    private async handleOffer(offer: RTCSessionDescriptionInit, sender: string) {
        const timestamp = new Date().toISOString();
        console.log(`[WebRtcService][${timestamp}] Handling offer from: ${sender} - Match/Session ID: ${this.currentRoomId}`);
        const pc = this.getPeerConnection(sender);

        const polite = (this.localUserId || '') < sender;
        const offerCollision = this.makingOffer.get(sender) || pc.signalingState !== 'stable';

        this.ignoreOffer.set(sender, !polite && offerCollision);
        if (this.ignoreOffer.get(sender)) {
            console.log(`[WebRtcService][${timestamp}] Ignoring offer from ${sender} (collision, impolite)`);
            return;
        }

        try {
            console.log(`[WebRtcService][${timestamp}] setRemoteDescription(offer) starting for ${sender}`);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log(`[WebRtcService][${timestamp}] setRemoteDescription(offer) success for ${sender}`);
            
            // Flush pending ICE candidates
            await this.flushPendingIceCandidates(sender, pc);

            await pc.setLocalDescription();
            const answer = pc.localDescription;
            if (!answer) return;
            
            console.log(`[WebRtcService][${timestamp}] setLocalDescription(answer) success for ${sender}`);
            this.sendSignalingMessage({
                type: 'answer',
                answer: answer,
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
                    if (!this.ignoreOffer.get(sender)) {
                        console.error(`[WebRtcService][${timestamp}] Error adding buffered ice candidate for ${sender}:`, err);
                    }
                }
            }
            this.pendingCandidates.delete(sender);
        }
    }

    private async handleIceCandidate(candidate: RTCIceCandidateInit, sender: string) {
        const timestamp = new Date().toISOString();
        const pc = this.peerConnections.get(sender);
        if (pc) {
            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`[WebRtcService][${timestamp}] ICE candidate added for ${sender}`);
                } catch (err) {
                    if (!this.ignoreOffer.get(sender)) {
                        console.error(`[WebRtcService][${timestamp}] Error adding ice candidate for ${sender}:`, err);
                    }
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
        this.currentRoomId = null;

        if (this.signalingSocket) {
            this.signalingSocket.close();
            this.signalingSocket = null;
        }
    }
}
