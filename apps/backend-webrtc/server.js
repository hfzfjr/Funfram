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

const wss = new WebSocket.Server({
    server,
    maxPayload: 64 * 1024, // 64 KB limit for signaling JSON
});

server.on('error', (err) => {
    console.error('HTTP server error:', err);
});

wss.on('error', (err) => {
    console.error('WebSocket server error:', err);
});

// State Management (roomID -> Set of WebSocket clients)
const rooms = new Map();

const FALLBACK_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

function safeSend(client, payload) {
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(payload);
    }
}

wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID();
    ws.roomId = null;
    ws.appUserId = null;
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                return;
            }
            console.log(`Pesan dari ${ws.id}:`, data.type);

            switch (data.type) {
                case 'join':
                    handleJoin(ws, data.roomID, data.userId);
                    break;
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    // Target wajib ada untuk signaling peer-to-peer
                    if (typeof data.targetId !== 'string' || !data.targetId) {
                        return;
                    }
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
    ws.on('error', (err) => {
        console.error(`WebSocket error (${ws.id}):`, err);
        handleDisconnect(ws);
    });
});

// Heartbeat untuk membersihkan koneksi half-open / putus diam-diam
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            handleDisconnect(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

async function getIceServers() {
    if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
        try {
            const url = `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
    if (typeof roomID !== 'string' || roomID.trim() === '' || roomID.length > 128) {
        return;
    }

    const normalizedUserId = (typeof userId === 'string' && userId.trim() !== '') ? userId.trim() : ws.id;

    // Jika sudah berada di room yang sama dengan userId yang sama, abaikan join duplikat
    if (ws.roomId === roomID && ws.appUserId === normalizedUserId) {
        return;
    }

    // Jika pindah room tanpa mengirim 'leave', bersihkan room lama terlebih dahulu
    if (ws.roomId && ws.roomId !== roomID) {
        handleDisconnect(ws);
    }

    if (!rooms.has(roomID)) {
        rooms.set(roomID, new Set());
    }

    const room = rooms.get(roomID);

    // Jika ada socket lama dengan appUserId sama di room ini (reconnect/tab lama),
    // keluarkan dari room dan tutup agar tidak memicu 'user-left' untuk sesi baru
    for (const existing of room) {
        if (existing !== ws && existing.appUserId === normalizedUserId) {
            room.delete(existing);
            existing.roomId = null;
            try {
                existing.close(1000, 'Replaced by newer connection');
            } catch (_) {
                // ignore close errors
            }
        }
    }

    ws.roomId = roomID;
    ws.appUserId = normalizedUserId;
    room.add(ws);
    console.log(`User ${ws.id} (${ws.appUserId}) masuk ke ${roomID}. Total anggota: ${room.size}`);

    getIceServers()
        .then((iceServers) => {
            // Pastikan socket masih terbuka dan masih berada di room yang sama
            if (ws.readyState !== WebSocket.OPEN || ws.roomId !== roomID || !room.has(ws)) {
                return;
            }

            safeSend(ws, JSON.stringify({
                type: 'ice-servers',
                iceServers
            }));

            forwardToPartner(ws, {
                type: 'user-joined',
                userId: ws.appUserId,
            });

            for (const existingClient of room) {
                if (existingClient !== ws && existingClient.readyState === WebSocket.OPEN) {
                    safeSend(ws, JSON.stringify({ type: 'peer-ready', role: 'answerer', peerId: existingClient.appUserId }));
                    safeSend(existingClient, JSON.stringify({ type: 'peer-ready', role: 'offerer', peerId: ws.appUserId }));
                }
            }
        })
        .catch((err) => {
            console.error(`Error in handleJoin for ${ws.id}:`, err);
        });
}

function forwardToPartner(senderWs, data) {
    if (!senderWs.roomId || !rooms.has(senderWs.roomId)) return;

    const room = rooms.get(senderWs.roomId);
    const payload = JSON.stringify({
        ...data,
        sender: senderWs.appUserId,
    });

    for (const client of room) {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            if (data.targetId) {
                if (client.appUserId === data.targetId) {
                    client.send(payload);
                }
            } else {
                client.send(payload);
            }
        }
    }
}

function handleDisconnect(ws) {
    if (!ws.roomId || !rooms.has(ws.roomId)) return;

    const roomId = ws.roomId;
    const room = rooms.get(roomId);
    room.delete(ws);
    ws.roomId = null;

    console.log(`User ${ws.id} keluar dari ${roomId}. Sisa: ${room.size}`);

    // Hanya broadcast user-left jika tidak ada socket lain dengan appUserId yang sama
    const stillPresent = Array.from(room).some((c) => c.appUserId === ws.appUserId);
    if (!stillPresent && ws.appUserId) {
        const leavePayload = JSON.stringify({ type: 'user-left', userId: ws.appUserId });
        for (const client of room) {
            safeSend(client, leavePayload);
        }
    }

    if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} dihapus karena kosong`);
    }
}

server.listen(PORT, () => {
    console.log(`WebRTC Signaling berjalan di port ${PORT}`);
});
