const WebSocket = require('ws');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();
const PORT = process.env.PORT || 5002;

// Buat server WebSocket khusus WebRTC
const wss = new WebSocket.Server({ port: PORT });

// Variabel untuk menyimpan daftar ruangan dan anggotanya
// Format: { "match-123": [client1, client2] }
const rooms = {};

// STUN servers configuration
const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
];

// Add TURN server if configured
if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
        urls: process.env.TURN_SERVER_URL,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
    });
}

wss.on('connection', (ws) => {
    console.log('Klien WebRTC baru terhubung');
    ws.id = Math.random().toString(36).substr(2, 9);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`Pesan dari ${ws.id}:`, data.type);

            switch (data.type) {
                case 'join':
                    const roomID = data.roomID;
                    ws.roomID = roomID;

                    if (!rooms[roomID]) {
                        rooms[roomID] = [];
                    }
                    rooms[roomID].push(ws);
                    console.log(`User ${ws.id} masuk ke ${roomID}. Total anggota: ${rooms[roomID].length}`);

                    // Send ICE servers configuration
                    ws.send(JSON.stringify({
                        type: 'ice-servers',
                        iceServers: iceServers,
                    }));

                    // Notify other clients in the room
                    broadcastToRoom(roomID, {
                        type: 'user-joined',
                        userId: ws.id,
                    }, ws);
                    break;

                case 'offer':
                    if (ws.roomID && rooms[ws.roomID]) {
                        broadcastToRoom(ws.roomID, {
                            type: 'offer',
                            offer: data.offer,
                            sender: ws.id,
                        }, ws);
                    }
                    break;

                case 'answer':
                    if (ws.roomID && rooms[ws.roomID]) {
                        broadcastToRoom(ws.roomID, {
                            type: 'answer',
                            answer: data.answer,
                            sender: ws.id,
                        }, ws);
                    }
                    break;

                case 'ice-candidate':
                    if (ws.roomID && rooms[ws.roomID]) {
                        broadcastToRoom(ws.roomID, {
                            type: 'ice-candidate',
                            candidate: data.candidate,
                            sender: ws.id,
                        }, ws);
                    }
                    break;

                case 'leave':
                    handleDisconnect(ws);
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        handleDisconnect(ws);
    });
});

function broadcastToRoom(roomID, message, excludeWs = null) {
    if (!rooms[roomID]) return;

    rooms[roomID].forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

function handleDisconnect(ws) {
    if (ws.roomID && rooms[ws.roomID]) {
        rooms[ws.roomID] = rooms[ws.roomID].filter(client => client !== ws);
        console.log(`User ${ws.id} keluar dari ${ws.roomID}. Sisa: ${rooms[ws.roomID].length}`);

        // Notify other clients
        broadcastToRoom(ws.roomID, {
            type: 'user-left',
            userId: ws.id,
        });

        // Hapus room dari memori jika sudah kosong
        if (rooms[ws.roomID].length === 0) {
            delete rooms[ws.roomID];
            console.log(`Room ${ws.roomID} dihapus karena kosong`);
        }
    }
    ws.roomID = null;
}

console.log(`WebRTC Signaling Server berjalan di port ${PORT}...`);
console.log('STUN servers:', iceServers.filter(s => s.urls.includes('stun')).map(s => s.urls));
if (process.env.TURN_SERVER_URL) {
    console.log('TURN server:', process.env.TURN_SERVER_URL);
}
