export class WebRtcService {
    private static instance: WebRtcService;
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private localStream: MediaStream | null = null;
    private onRemoteStreamCallback: ((participantId: string, stream: MediaStream) => void) | null = null;

    private constructor() {}

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
     * Start WebRTC Peer connection signaling with a remote participant.
     */
    public async connectToPeer(participantId: string): Promise<void> {
        console.log(`[WebRtcService] Creating peer connection with participant: ${participantId}`);
        
        // Setup configuration (standard STUN servers)
        const config: RTCConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };

        const pc = new RTCPeerConnection(config);
        
        // Add local tracks if available
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                if (this.localStream) {
                    pc.addTrack(track, this.localStream);
                }
            });
        }

        // Listen for remote streams
        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                console.log(`[WebRtcService] Remote track received from peer: ${participantId}`);
                if (this.onRemoteStreamCallback) {
                    this.onRemoteStreamCallback(participantId, event.streams[0]);
                }
            }
        };

        // Handle ICE negotiation (stubbed)
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // In production, emit candidate to WebSocket signaling server
                console.log(`[WebRtcService] ICE candidate found for peer ${participantId}`);
            }
        };

        this.peerConnections.set(participantId, pc);
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
        this.peerConnections.forEach((pc, id) => {
            pc.close();
            console.log(`[WebRtcService] Disconnected ${id}`);
        });
        this.peerConnections.clear();
    }
}
