const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();
const PORT = process.env.PORT || 5002;

const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'backend-webrtc' }));
        return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

const wss = new WebSocket.Server({ server });

// State Management yang benar (Gunakan Map, bukan Object sembarangan)
const rooms = new Map(); // roomID -> Set of WebSocket clients

const FALLBACK_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID(); // Connection ID aman dari server
    ws.roomId = null; // Hanya 1 room per socket

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`Pesan dari ${ws.id}:`, data.type);
            
            switch (data.type) {
                case 'join':
                    handleJoin(ws, data.roomID, data.userId);
                    break;
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    // Teruskan pesan HANYA ke partner di room yang SAMA
                    forwardToPartner(ws, data);
                    break;
                case 'leave':
                    handleDisconnect(ws);
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', () => handleDisconnect(ws));
});

async function getIceServers() {
    if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
        try {
            const url = `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`;
            // Native fetch is available in Node.js 18+
            const res = await fetch(url);
            if (res.ok) {
                const meteredServers = await res.json();
                if (Array.isArray(meteredServers)) {
                    return meteredServers;
                }
            } else {
                console.error(`Metered API Error: ${res.status} ${res.statusText}`);
            }
        } catch (err) {
            console.error('Gagal mengambil Metered TURN:', err);
        }
    }

    // Fallback STUN (primary TURN diambil frontend melalui /api/turn-credentials)
    return FALLBACK_ICE_SERVERS;
}

function handleJoin(ws, roomID, userId) {
    if (!rooms.has(roomID)) {
        rooms.set(roomID, new Set());
    }
    
    const room = rooms.get(roomID);

    ws.roomId = roomID;
    ws.appUserId = userId || ws.id; // Pastikan selalu ada identitas
    room.add(ws);
    console.log(`User ${ws.id} masuk ke ${roomID}. Total anggota: ${room.size}`);

    // Ambil kredensial TURN (Metered atau Lokal), lalu lanjutkan proses room
    getIceServers().then(iceServers => {
        ws.send(JSON.stringify({
            type: 'ice-servers',
            iceServers: iceServers
        }));

        // Beritahu client lain di dalam ruangan
        forwardToPartner(ws, {
            type: 'user-joined',
            userId: ws.appUserId,
        });

        // Beritahu user yang baru join tentang semua orang yang SUDAH ADA di dalam room
        for (const existingClient of room) {
            if (existingClient !== ws) {
                // User yang baru join akan menjadi 'answerer' terhadap user yang sudah ada
                ws.send(JSON.stringify({ type: 'peer-ready', role: 'answerer', peerId: existingClient.appUserId }));
                // User yang sudah ada akan menjadi 'offerer' terhadap user yang baru join
                existingClient.send(JSON.stringify({ type: 'peer-ready', role: 'offerer', peerId: ws.appUserId }));
            }
        }
    });
}
function forwardToPartner(senderWs, data) {
    if (!senderWs.roomId || !rooms.has(senderWs.roomId)) return;
    
    const room = rooms.get(senderWs.roomId);
    
    // SANGAT PENTING: Sisipkan identitas pengirim agar penerima tahu ini dari siapa
    data.sender = senderWs.appUserId;

    for (const client of room) {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            // Jika pesan spesifik untuk satu target, kirim ke target itu saja
            if (data.targetId) {
                if (client.appUserId === data.targetId) {
                    client.send(JSON.stringify(data));
                }
            } else {
                // Jika tidak ada target spesifik, broadcast ke semua (contoh: user-joined)
                client.send(JSON.stringify(data));
            }
        }
    }
}
function handleDisconnect(ws) {
    if (!ws.roomId || !rooms.has(ws.roomId)) return;

    const room = rooms.get(ws.roomId);
    room.delete(ws);
    console.log(`User ${ws.id} keluar dari ${ws.roomId}. Sisa: ${room.size}`);

    // Beritahu sisa client bahwa partnernya kabur
    for (const client of room) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'user-left', userId: ws.appUserId }));
        }
    }

    // Hapus room dari memori jika kosong
    if (room.size === 0) {
        rooms.delete(ws.roomId);
        console.log(`Room ${ws.roomId} dihapus karena kosong`);
    }
    ws.roomId = null;
}

server.listen(PORT, () => {
    console.log(`WebRTC Signaling berjalan di port ${PORT}`);
});



