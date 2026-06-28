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

        console.log(`[WebRtcService] Creating peer connection with: ${participantId}`);

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
            if (event.streams && event.streams[0]) {
                console.log(`[WebRtcService] Remote stream received from: ${participantId}`);
                if (this.onRemoteStreamCallback) {
                    this.onRemoteStreamCallback(participantId, event.streams[0]);
                }
            } else {
                const inboundStream = new MediaStream([event.track]);
                if (this.onRemoteStreamCallback) {
                    this.onRemoteStreamCallback(participantId, inboundStream);
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

        // Perfect Negotiation logic on negotiationneeded
        pc.onnegotiationneeded = async () => {
            try {
                this.makingOffer.set(participantId, true);
                const offer = await pc.createOffer();
                if (pc.signalingState !== "stable") return; // avoid race conditions
                await pc.setLocalDescription(offer);
                this.sendSignalingMessage({
                    type: 'offer',
                    offer: pc.localDescription,
                    targetId: participantId,
                });
            } catch (err) {
                console.error('[WebRtcService] Error during negotiation:', err);
            } finally {
                this.makingOffer.set(participantId, false);
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`[WebRtcService] Connection state with ${participantId}:`, pc.connectionState);
            if (pc.connectionState === 'failed') {
                // Trigger ICE restart
                pc.restartIce();
            }
        };

        this.peerConnections.set(participantId, pc);
        return pc;
    }

    private async handleOffer(offer: RTCSessionDescriptionInit, sender: string) {
        console.log(`[WebRtcService] Handling offer from: ${sender}`);
        const pc = this.getPeerConnection(sender);

        const polite = (this.localUserId || '') < sender;
        const offerCollision = this.makingOffer.get(sender) || pc.signalingState !== 'stable';

        this.ignoreOffer.set(sender, !polite && offerCollision);
        if (this.ignoreOffer.get(sender)) {
            console.log(`[WebRtcService] Ignoring offer from ${sender} (collision, impolite)`);
            return;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.sendSignalingMessage({
                type: 'answer',
                answer: pc.localDescription,
                targetId: sender,
            });
        } catch (err) {
            console.error('[WebRtcService] Error handling offer:', err);
        }
    }

    private async handleAnswer(answer: RTCSessionDescriptionInit, sender: string) {
        console.log(`[WebRtcService] Handling answer from: ${sender}`);
        const pc = this.peerConnections.get(sender);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (err) {
                console.error('[WebRtcService] Error handling answer:', err);
            }
        }
    }

    private async handleIceCandidate(candidate: RTCIceCandidateInit, sender: string) {
        const pc = this.peerConnections.get(sender);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                if (!this.ignoreOffer.get(sender)) {
                    console.error('[WebRtcService] Error adding ice candidate:', err);
                }
            }
        }
    }

    private sendSignalingMessage(data: any) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify(data));
        }
    }

    public disconnectPeer(participantId: string): void {
        const pc = this.peerConnections.get(participantId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(participantId);
            this.makingOffer.delete(participantId);
            this.ignoreOffer.delete(participantId);
            this.isSettingRemoteAnswerPending.delete(participantId);
            console.log(`[WebRtcService] Closed peer connection with: ${participantId}`);
        }
    }

    public disconnectAll(): void {
        if (this.currentRoomId) {
            this.sendSignalingMessage({ type: 'leave' });
        }

        this.peerConnections.forEach((pc, id) => {
            pc.close();
            console.log(`[WebRtcService] Disconnected ${id}`);
        });
        this.peerConnections.clear();
        this.makingOffer.clear();
        this.ignoreOffer.clear();
        this.isSettingRemoteAnswerPending.clear();
        this.currentRoomId = null;

        if (this.signalingSocket) {
            this.signalingSocket.close();
            this.signalingSocket = null;
        }
    }
}
