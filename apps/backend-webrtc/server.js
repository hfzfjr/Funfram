const WebSocket = require('ws');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();
const PORT = process.env.PORT || 5002;

// Buat server WebSocket khusus WebRTC
const wss = new WebSocket.Server({ port: PORT });

// Variabel untuk menyimpan daftar ruangan dan anggotanya
const rooms = {};

// STUN servers configuration (Default bawaan Google)
const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
];

// MENGATASI BUG: Sinkronisasi dynamic credential dari .env untuk Docker
const turnUrl = process.env.TURN_SERVER_URL || 'turn:182.253.158.158:3478';
const turnUser = process.env.TURN_USERNAME || 'funfram';
const turnCred = process.env.TURN_CREDENTIAL || 'letsgooo_Funfram';

// Tambahkan TURN server ke list ICE servers
iceServers.push({
    urls: turnUrl,
    username: turnUser,
    credential: turnCred,
});

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
                    if (!ws.rooms) ws.rooms = new Set();
                    ws.rooms.add(roomID);

                    if (data.userId) {
                        ws.id = data.userId;
                    }

                    if (!rooms[roomID]) {
                        rooms[roomID] = [];
                    }
                    rooms[roomID].push(ws);
                    console.log(`User ${ws.id} masuk ke ${roomID}. Total anggota: ${rooms[roomID].length}`);

                    // Kirim konfigurasi ICE servers ke user yang baru bergabung
                    ws.send(JSON.stringify({
                        type: 'ice-servers',
                        iceServers: iceServers,
                    }));

                    // Beritahu client lain di dalam ruangan
                    broadcastToRoom(roomID, {
                        type: 'user-joined',
                        userId: ws.id,
                    }, ws);
                    break;

                case 'offer':
                    if (data.targetId) {
                        sendToUser(data.targetId, {
                            type: 'offer',
                            offer: data.offer,
                            sender: ws.id,
                        });
                    } else if (ws.rooms) {
                        for (const r of ws.rooms) {
                            broadcastToRoom(r, {
                                type: 'offer',
                                offer: data.offer,
                                sender: ws.id,
                            }, ws);
                        }
                    }
                    break;

                case 'answer':
                    if (data.targetId) {
                        sendToUser(data.targetId, {
                            type: 'answer',
                            answer: data.answer,
                            sender: ws.id,
                        });
                    } else if (ws.rooms) {
                        for (const r of ws.rooms) {
                            broadcastToRoom(r, {
                                type: 'answer',
                                answer: data.answer,
                                sender: ws.id,
                            }, ws);
                        }
                    }
                    break;

                case 'ice-candidate':
                    if (data.targetId) {
                        sendToUser(data.targetId, {
                            type: 'ice-candidate',
                            candidate: data.candidate,
                            sender: ws.id,
                        });
                    } else if (ws.rooms) {
                        for (const r of ws.rooms) {
                            broadcastToRoom(r, {
                                type: 'ice-candidate',
                                candidate: data.candidate,
                                sender: ws.id,
                            }, ws);
                        }
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

function sendToUser(targetId, message) {
    let target = null;
    for (const client of wss.clients) {
        if (client.id === targetId) {
            target = client;
            break;
        }
    }

    if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify(message));
    } else {
        console.log(`Target user ${targetId} not found or connection closed`);
    }
}

function handleDisconnect(ws) {
    if (ws.roomID && rooms[ws.roomID]) {
        rooms[ws.roomID] = rooms[ws.roomID].filter(client => client !== ws);
        console.log(`User ${ws.id} keluar dari ${ws.roomID}. Sisa: ${rooms[ws.roomID].length}`);

        broadcastToRoom(ws.roomID, {
            type: 'user-left',
            userId: ws.id,
        });

        if (rooms[ws.roomID].length === 0) {
            delete rooms[ws.roomID];
            console.log(`Room ${ws.roomID} dihapus karena kosong`);
        }
    }
    ws.roomID = null;
}

console.log(`WebRTC Signaling Server berjalan di port ${PORT}...`);
console.log('STUN servers:', iceServers.filter(s => s.urls.includes('stun')).map(s => s.urls));
console.log('TURN server terpasang:', turnUrl);