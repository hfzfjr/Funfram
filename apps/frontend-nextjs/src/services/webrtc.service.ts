export class WebRtcService {
    private static instance: WebRtcService;
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private localStream: MediaStream | null = null;
    private onRemoteStreamCallback: ((participantId: string, stream: MediaStream) => void) | null = null;
    private signalingSocket: WebSocket | null = null;
    private currentRoomId: string | null = null;
    private iceServers: RTCIceServer[] = [];

    private constructor() { }

    public static getInstance(): WebRtcService {
        if (!WebRtcService.instance) {
            WebRtcService.instance = new WebRtcService();
        }
        return WebRtcService.instance;
    }

    public setLocalStream(stream: MediaStream | null) {
        this.localStream = stream;
    }

    public onRemoteStream(callback: (participantId: string, stream: MediaStream) => void) {
        this.onRemoteStreamCallback = callback;
    }

    /**
     * Connect to WebRTC signaling server
     */
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

    /**
     * Join a WebRTC room for peer-to-peer connection
     */
    public joinRoom(roomId: string) {
        if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) {
            console.error('[WebRtcService] Signaling socket not connected');
            return;
        }

        this.currentRoomId = roomId;
        this.signalingSocket.send(JSON.stringify({
            type: 'join',
            roomID: roomId,
        }));
    }

    /**
     * Handle signaling messages from server
     */
    private handleSignalingMessage(data: any) {
        console.log('[WebRtcService] Received signaling message:', data.type);

        switch (data.type) {
            case 'ice-servers':
                this.iceServers = data.iceServers;
                console.log('[WebRtcService] ICE servers configured');
                break;

            case 'user-joined':
                console.log('[WebRtcService] User joined:', data.userId);
                // Start peer connection when remote user joins
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

    /**
     * Create peer connection with remote participant
     */
    private async createPeerConnection(participantId: string, isInitiator: boolean): Promise<void> {
        console.log(`[WebRtcService] Creating peer connection with: ${participantId}`);

        const config: RTCConfiguration = {
            iceServers: this.iceServers.length > 0 ? this.iceServers : [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };

        const pc = new RTCPeerConnection(config);

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream!);
            });
        }

        // Handle remote stream
        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                console.log(`[WebRtcService] Remote stream received from: ${participantId}`);
                if (this.onRemoteStreamCallback) {
                    this.onRemoteStreamCallback(participantId, event.streams[0]);
                }
            }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                });
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log(`[WebRtcService] Connection state with ${participantId}:`, pc.connectionState);
        };

        this.peerConnections.set(participantId, pc);

        // If initiator, create and send offer
        if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignalingMessage({
                type: 'offer',
                offer: offer,
            });
        }
    }

    /**
     * Handle WebRTC offer from remote peer
     */
    private async handleOffer(offer: RTCSessionDescriptionInit, sender: string) {
        console.log(`[WebRtcService] Handling offer from: ${sender}`);

        let pc = this.peerConnections.get(sender);
        if (!pc) {
            await this.createPeerConnection(sender, false);
            pc = this.peerConnections.get(sender);
        }

        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.sendSignalingMessage({
                type: 'answer',
                answer: answer,
            });
        }
    }

    /**
     * Handle WebRTC answer from remote peer
     */
    private async handleAnswer(answer: RTCSessionDescriptionInit, sender: string) {
        console.log(`[WebRtcService] Handling answer from: ${sender}`);

        const pc = this.peerConnections.get(sender);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    /**
     * Handle ICE candidate from remote peer
     */
    private async handleIceCandidate(candidate: RTCIceCandidateInit, sender: string) {
        console.log(`[WebRtcService] Handling ICE candidate from: ${sender}`);

        const pc = this.peerConnections.get(sender);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    /**
     * Send message to signaling server
     */
    private sendSignalingMessage(data: any) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify(data));
        }
    }

    /**
     * Disconnects and releases RTCPeerConnection with a peer.
     */
    public disconnectPeer(participantId: string): void {
        const pc = this.peerConnections.get(participantId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(participantId);
            console.log(`[WebRtcService] Closed peer connection with: ${participantId}`);
        }
    }

    /**
     * Clears all Peer connections (leaves session).
     */
    public disconnectAll(): void {
        // Send leave message to server
        if (this.currentRoomId) {
            this.sendSignalingMessage({ type: 'leave' });
        }

        this.peerConnections.forEach((pc, id) => {
            pc.close();
            console.log(`[WebRtcService] Disconnected ${id}`);
        });
        this.peerConnections.clear();
        this.currentRoomId = null;

        if (this.signalingSocket) {
            this.signalingSocket.close();
            this.signalingSocket = null;
        }
    }
}
