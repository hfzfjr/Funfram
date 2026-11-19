const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const PORT = process.env.PORT || 5002;
const MAX_ROOMS = 10000;
const MAX_ROOM_SIZE = 4;
const GRACE_PERIOD_MS = 12000;

function log(level, msg, meta = {}) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        service: 'backend-webrtc',
        msg,
        ...meta,
    };
    if (level === 'error') {
        console.error(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

function getSignalingSecret() {
    const configured = (process.env.SIGNALING_HMAC_SECRET || process.env.TURN_TOKEN_HMAC_SECRET || '').trim();
    if (configured) return configured;
    const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
    if (appEnv !== 'production') {
        return 'funfram-dev-only-secret-do-not-use-in-prod';
    }
    return '';
}

function verifySignalingToken(token, expectedRoom) {
    const secret = getSignalingSecret();
    if (!secret || typeof token !== 'string') {
        return null;
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
        return null;
    }
    const [encodedPayload, encodedSig] = parts;
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(encodedPayload)
        .digest('base64url');

    const sigBuf = Buffer.from(encodedSig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
    }

    try {
        const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
        if (!claims || claims.scope !== 'signaling') return null;
        if (typeof claims.sub !== 'string' || !claims.sub) return null;
        if (typeof claims.room !== 'string' || claims.room !== expectedRoom) return null;
        if (typeof claims.exp !== 'number' || Math.floor(Date.now() / 1000) > claims.exp) return null;
        return claims;
    } catch {
        return null;
    }
}

function isAllowedOrigin(req) {
    const origin = (req.headers.origin || '').trim();
    const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
    const allowedRaw = (process.env.ALLOWED_ORIGINS || '').trim();

    if (!origin) {
        return appEnv === 'development' || appEnv === 'test' || (!appEnv && !allowedRaw);
    }

    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }

    if (appEnv === 'development' || appEnv === 'test' || (!appEnv && !allowedRaw)) {
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
            return true;
        }
    }

    if (allowedRaw) {
        const allowList = allowedRaw
            .split(',')
            .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
            .filter(Boolean);
        return allowList.includes(origin.toLowerCase());
    }

    if (req.headers.host && parsed.host.toLowerCase() === req.headers.host.toLowerCase()) {
        return true;
    }
    return false;
}

function extractClientIp(req) {
    const cfIp = (req.headers['cf-connecting-ip'] || '').toString().trim();
    if (cfIp) return cfIp;
    const realIp = (req.headers['x-real-ip'] || '').toString().trim();
    if (realIp) return realIp;
    const xff = (req.headers['x-forwarded-for'] || '').toString().trim();
    if (xff) return xff.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

const ipConnLimiter = new Map();
function allowNewIpConnection(ip) {
    const now = Date.now();
    if (ipConnLimiter.size > 10000) {
        for (const [k, v] of ipConnLimiter.entries()) {
            if (now > v.resetAt) ipConnLimiter.delete(k);
        }
        if (ipConnLimiter.size > 10000) ipConnLimiter.clear();
    }
    const rec = ipConnLimiter.get(ip);
    if (!rec || now > rec.resetAt) {
        ipConnLimiter.set(ip, { count: 1, resetAt: now + 60000 });
        return true;
    }
    if (rec.count >= 20) return false;
    rec.count += 1;
    return true;
}

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
    maxPayload: 64 * 1024,
    verifyClient: (info, done) => {
        if (!isAllowedOrigin(info.req)) {
            done(false, 403, 'Forbidden Origin');
            return;
        }
        const ip = extractClientIp(info.req);
        if (!allowNewIpConnection(ip)) {
            done(false, 429, 'Too Many Requests');
            return;
        }
        done(true);
    },
});

server.on('error', (err) => {
    log('error', 'HTTP server error', { error: err.message });
});

wss.on('error', (err) => {
    log('error', 'WebSocket server error', { error: err.message });
});

// roomID -> Set<WebSocket>
const rooms = new Map();
// `${roomID}:${appUserId}` -> Timeout
const pendingLeaves = new Map();

function safeSend(client, payload) {
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(payload);
    }
}

function allowMsgRate(ws) {
    const now = Date.now();
    if (!ws.msgWindow || now > ws.msgWindow.resetAt) {
        ws.msgWindow = { count: 1, resetAt: now + 10000 };
        return true;
    }
    if (ws.msgWindow.count >= 60) {
        return false;
    }
    ws.msgWindow.count += 1;
    return true;
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
        if (!allowMsgRate(ws)) {
            ws.close(4029, 'Rate limit exceeded');
            return;
        }

        try {
            const data = JSON.parse(message);
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                return;
            }

            switch (data.type) {
                case 'join':
                    handleJoin(ws, data.roomID, data.token);
                    break;
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    if (!ws.roomId || !ws.appUserId) {
                        ws.close(4001, 'Unauthorized');
                        return;
                    }
                    if (typeof data.targetId !== 'string' || !data.targetId) {
                        return;
                    }
                    forwardToPartner(ws, data);
                    break;
                case 'leave':
                    handleDisconnect(ws, true);
                    break;
                default:
                    log('warn', 'Unknown signaling message type', { type: String(data.type).slice(0, 32) });
            }
        } catch (err) {
            log('warn', 'Invalid JSON message', { error: err.message });
        }
    });

    ws.on('close', () => handleDisconnect(ws, false));
    ws.on('error', (err) => {
        log('warn', 'WebSocket error', { socketId: ws.id, error: err.message });
        handleDisconnect(ws, false);
    });
});

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            handleDisconnect(ws, false);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

function handleJoin(ws, roomID, token) {
    if (typeof roomID !== 'string' || roomID.trim() === '' || roomID.length > 128) {
        ws.close(4001, 'Invalid roomID');
        return;
    }

    const claims = verifySignalingToken(token, roomID);
    if (!claims) {
        ws.close(4001, 'Unauthorized signaling token');
        return;
    }

    const verifiedUserId = claims.sub;
    if (ws.roomId === roomID && ws.appUserId === verifiedUserId) {
        return;
    }

    if (ws.roomId && ws.roomId !== roomID) {
        handleDisconnect(ws, true);
    }

    if (!rooms.has(roomID)) {
        if (rooms.size >= MAX_ROOMS) {
            ws.close(4003, 'Server room capacity reached');
            return;
        }
        rooms.set(roomID, new Set());
    }

    const room = rooms.get(roomID);
    const hasExistingSameUser = Array.from(room).some((c) => c.appUserId === verifiedUserId);
    if (!hasExistingSameUser && room.size >= MAX_ROOM_SIZE) {
        ws.close(4003, 'Room is full');
        return;
    }

    // Cancel pending 12s grace-period leave if user reconnected in time
    const graceKey = `${roomID}:${verifiedUserId}`;
    const wasGraceReconnect = pendingLeaves.has(graceKey);
    if (wasGraceReconnect) {
        clearTimeout(pendingLeaves.get(graceKey));
        pendingLeaves.delete(graceKey);
    }

    for (const existing of room) {
        if (existing !== ws && existing.appUserId === verifiedUserId) {
            room.delete(existing);
            existing.roomId = null;
            try {
                existing.close(1000, 'Replaced by newer connection');
            } catch {
                // ignore
            }
        }
    }

    ws.roomId = roomID;
    ws.appUserId = verifiedUserId;
    room.add(ws);
    log('info', 'Peer joined room', { roomId: roomID, userId: verifiedUserId, size: room.size });

    if (!wasGraceReconnect) {
        const joinPayload = JSON.stringify({
            type: 'user-joined',
            userId: ws.appUserId,
            sender: ws.appUserId,
        });
        for (const client of room) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(joinPayload);
            }
        }
    }

    for (const existingClient of room) {
        if (existingClient !== ws && existingClient.readyState === WebSocket.OPEN) {
            safeSend(ws, JSON.stringify({ type: 'peer-ready', role: 'answerer', peerId: existingClient.appUserId }));
            safeSend(existingClient, JSON.stringify({ type: 'peer-ready', role: 'offerer', peerId: ws.appUserId }));
        }
    }
}

function forwardToPartner(senderWs, data) {
    if (!senderWs.roomId || !rooms.has(senderWs.roomId)) return;
    const room = rooms.get(senderWs.roomId);

    let cleanPayload;
    if (data.type === 'offer') {
        cleanPayload = { type: 'offer', offer: data.offer, targetId: data.targetId, sender: senderWs.appUserId };
    } else if (data.type === 'answer') {
        cleanPayload = { type: 'answer', answer: data.answer, targetId: data.targetId, sender: senderWs.appUserId };
    } else if (data.type === 'ice-candidate') {
        cleanPayload = { type: 'ice-candidate', candidate: data.candidate, targetId: data.targetId, sender: senderWs.appUserId };
    } else {
        return;
    }

    const serialized = JSON.stringify(cleanPayload);
    for (const client of room) {
        if (client !== senderWs && client.readyState === WebSocket.OPEN && client.appUserId === data.targetId) {
            client.send(serialized);
            break;
        }
    }
}

function finalizeLeave(roomId, appUserId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const stillPresent = Array.from(room).some((c) => c.appUserId === appUserId);
    if (!stillPresent && appUserId) {
        const leavePayload = JSON.stringify({ type: 'user-left', userId: appUserId });
        for (const client of room) {
            safeSend(client, leavePayload);
        }
    }
    if (room.size === 0) {
        rooms.delete(roomId);
    }
}

function handleDisconnect(ws, isExplicit) {
    if (!ws.roomId || !rooms.has(ws.roomId)) return;

    const roomId = ws.roomId;
    const appUserId = ws.appUserId;
    const room = rooms.get(roomId);
    room.delete(ws);
    ws.roomId = null;

    if (isExplicit || !appUserId) {
        const graceKey = `${roomId}:${appUserId}`;
        if (pendingLeaves.has(graceKey)) {
            clearTimeout(pendingLeaves.get(graceKey));
            pendingLeaves.delete(graceKey);
        }
        finalizeLeave(roomId, appUserId);
        return;
    }

    const stillPresent = Array.from(room).some((c) => c.appUserId === appUserId);
    if (stillPresent) return;

    const graceKey = `${roomId}:${appUserId}`;
    if (pendingLeaves.has(graceKey)) {
        clearTimeout(pendingLeaves.get(graceKey));
    }
    const timeoutId = setTimeout(() => {
        pendingLeaves.delete(graceKey);
        finalizeLeave(roomId, appUserId);
    }, GRACE_PERIOD_MS);
    pendingLeaves.set(graceKey, timeoutId);
}

function shutdown() {
    log('info', 'Shutting down WebRTC signaling server');
    clearInterval(heartbeatInterval);
    for (const t of pendingLeaves.values()) {
        clearTimeout(t);
    }
    pendingLeaves.clear();
    wss.close(() => {
        server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
    log('info', 'WebRTC signaling server started', { port: PORT });
});
