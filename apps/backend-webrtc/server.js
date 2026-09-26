const WebSocket = require('ws');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();
const PORT = process.env.PORT || 5002;
const wss = new WebSocket.Server({ port: PORT });

// State Management yang benar (Gunakan Map, bukan Object sembarangan)
const rooms = new Map(); // roomID -> Set of WebSocket clients

// Rahasia TURN Server (Samakan dengan static-auth-secret di turnserver.conf)
const TURN_SECRET = process.env.TURN_SECRET || 'rahasia_funfram_super_aman_123';
const TURN_URLS = [
    'turn:turn.roomify.space:3478?transport=udp',
    'turn:turn.roomify.space:3478?transport=tcp',
    'turns:turn.roomify.space:443?transport=tcp' // Wajib ada sertifikat SSL di Coturn
];

// Fungsi Generate Ephemeral TURN Credentials (TURN REST API)
function getTurnCredentials() {
    const unixTimeStamp = Math.floor(Date.now() / 1000) + (24 * 3600); // Expired dalam 24 Jam
    const username = `${unixTimeStamp}:funfram_user`;
    
    const hmac = crypto.createHmac('sha1', TURN_SECRET);
    hmac.update(username);
    const credential = hmac.digest('base64');
    
    return { username, credential };
}

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
            const meteredServers = await res.json();
            return meteredServers;
        } catch (err) {
            console.error('Gagal mengambil Metered TURN:', err);
        }
    }

    // Fallback lokal (yang tertahan oleh CGNAT)
    const turnAuth = getTurnCredentials();
    return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: TURN_URLS, username: turnAuth.username, credential: turnAuth.credential }
    ];
}

function handleJoin(ws, roomID, userId) {
    if (!rooms.has(roomID)) {
        rooms.set(roomID, new Set());
    }
    
    const room = rooms.get(roomID);

    // Limit Maksimal 2 Orang per Room (PENTING untuk 1:1)
    if (room.size >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        return;
    }

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
            userId: ws.appUserId, // Memberitahu partner siapa yang bergabung
        });

        // Jika room sudah berisi 2 orang, saatnya menunjuk Peran (Offerer & Answerer)
        if (room.size === 2) {
            const clients = Array.from(room);
            const peerA = clients[0];
            const peerB = clients[1];

            // Wasit (Server) menunjuk siapa yang harus membuat Offer
            peerA.send(JSON.stringify({ type: 'peer-ready', role: 'offerer', peerId: peerB.appUserId }));
            peerB.send(JSON.stringify({ type: 'peer-ready', role: 'answerer', peerId: peerA.appUserId }));
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
            client.send(JSON.stringify(data));
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

console.log(`WebRTC Signaling berjalan di port ${PORT}`);