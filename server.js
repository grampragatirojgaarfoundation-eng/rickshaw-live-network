const express = require('express');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const geohash = require('ngeohash');

const app = express();

// ==========================================
// SECURITY & CLOUDFLARE PROXY CONFIGURATION
// ==========================================
// Cloudflare Proxy / Nginx se real user IP read karne ke liye:
app.set('trust proxy', 1);

// 1. General Rate Limiter (Har IP ke liye 15 minute me max 100 requests)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Bahut zyada requests bhej di gayi hain. Kripya 15 minute baad prayas karein."
    }
});

// 2. Strict OTP / Login Limiter (Brute-force protection: 15 min me max 5 attempts)
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Aapne bahut baar galat OTP try kiya hai. Kripya 15 minute baad prayas karein."
    }
});

// Rate limiters apply karein
app.use(apiLimiter);
app.use('/verify-otp', otpLimiter);

// Standard Express Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ZERO DISK I/O - OTP Authentication in Memory Only
app.post('/verify-otp', (req, res) => {
    const { mobileNumber, enteredOtp } = req.body || {};
    const FIXED_OTP = "7317";

    if (!mobileNumber || String(mobileNumber).length < 10) {
        return res.json({ success: false, message: "Kripya sahi 10 ankon ka mobile number daalein." });
    }

    if (String(enteredOtp) === FIXED_OTP) {
        return res.json({ 
            success: true, 
            message: "Login Successful!", 
            token: "token_" + Math.random().toString(36).substring(2)
        });
    } else {
        return res.json({ 
            success: false, 
            message: "Galat OTP hai! Kripya '7317' daalein." 
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ==========================================
// REDIS CLIENT & ADAPTER SETUP (RECONNECT & FAULT TOLERANT)
// ==========================================
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisOptions = {
    url: redisUrl,
    socket: {
        reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 100, 3000);
            console.log(`🔄 Reconnecting to Redis... Attempt #${retries} (Delay: ${delay}ms)`);
            return delay;
        }
    }
};

const pubClient = createClient(redisOptions);
const subClient = pubClient.duplicate();

let isRedisConnected = false;

// Event listeners for Redis Pub/Sub Clients
pubClient.on('ready', () => {
    isRedisConnected = true;
    console.log("🚀 Redis Connected & Ready! Multi-Core Clustering & GeoSearch Active.");
});

pubClient.on('error', (err) => {
    isRedisConnected = false;
    console.error("❌ Redis Client Error:", err.message);
});

pubClient.on('reconnecting', () => {
    isRedisConnected = false;
    console.log("⏳ Redis Client Reconnecting...");
});

subClient.on('error', (err) => {
    console.error("❌ Redis SubClient Error:", err.message);
});

// Connection Handshake with PM2 Auto-Restart Guard
async function connectRedis() {
    try {
        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
    } catch (err) {
        console.error("💥 Fatal: Redis Initial Connection Failed!", err);
        process.exit(1); // Exit trigger so PM2 cluster automatically reboots this core
    }
}

connectRedis();

// Redis Helper Keys
const REDIS_USERS_HASH = 'active_users';           // Hash: userId -> user JSON string
const REDIS_SOCKET_HASH = 'socket_to_user';         // Hash: socketId -> userId
const REDIS_GEO_KEY = 'user_locations';             // GEO index
const REDIS_RIDERS_COUNT = 'global_riders_count';   // Atomic Counter
const REDIS_SAWARIS_COUNT = 'global_sawaris_count'; // Atomic Counter
const REDIS_ACTIVE_CHATS_HASH = 'active_chats';     // Hash: userId -> { room, partnerId }

// Helper functions for updating counters atomically across all PM2 Cores
async function incrementRoleCount(role) {
    if (!isRedisConnected) return;
    try {
        if (role === 'rider' || role === 'bike_rider') {
            await pubClient.incr(REDIS_RIDERS_COUNT);
        }
        if (role === 'sawari' || role === 'bike_sawari') {
            await pubClient.incr(REDIS_SAWARIS_COUNT);
        }
    } catch (err) {
        console.error("Error in incrementRoleCount:", err);
    }
}

async function decrementRoleCount(role) {
    if (!isRedisConnected) return;
    try {
        if (role === 'rider' || role === 'bike_rider') {
            const val = await pubClient.decr(REDIS_RIDERS_COUNT);
            if (val < 0) await pubClient.set(REDIS_RIDERS_COUNT, 0);
        }
        if (role === 'sawari' || role === 'bike_sawari') {
            const val = await pubClient.decr(REDIS_SAWARIS_COUNT);
            if (val < 0) await pubClient.set(REDIS_SAWARIS_COUNT, 0);
        }
    } catch (err) {
        console.error("Error in decrementRoleCount:", err);
    }
}

async function getGlobalCounts() {
    if (!isRedisConnected) return { riders: 0, sawaris: 0 };
    try {
        const ridersStr = await pubClient.get(REDIS_RIDERS_COUNT);
        const sawarisStr = await pubClient.get(REDIS_SAWARIS_COUNT);
        const riders = parseInt(ridersStr || '0', 10);
        const sawaris = parseInt(sawarisStr || '0', 10);
        return { 
            riders: Math.max(0, isNaN(riders) ? 0 : riders), 
            sawaris: Math.max(0, isNaN(sawaris) ? 0 : sawaris) 
        };
    } catch (err) {
        console.error("Error in getGlobalCounts:", err);
        return { riders: 0, sawaris: 0 };
    }
}

// Save User state in Redis
async function saveUserInRedis(user) {
    if (!isRedisConnected || !user || !user.id) return;
    try {
        await pubClient.hSet(REDIS_USERS_HASH, user.id, JSON.stringify(user));
        if (user.socketId) {
            await pubClient.hSet(REDIS_SOCKET_HASH, user.socketId, user.id);
        }
        
        if (typeof user.lng === 'number' && typeof user.lat === 'number') {
            await pubClient.geoAdd(REDIS_GEO_KEY, {
                longitude: user.lng,
                latitude: user.lat,
                member: user.id
            });
        }
    } catch (err) {
        console.error("Error in saveUserInRedis:", err);
    }
}

// Get User by ID (Safely parsed)
async function getUserFromRedis(userId) {
    if (!isRedisConnected || !userId) return null;
    try {
        const userData = await pubClient.hGet(REDIS_USERS_HASH, userId);
        return userData ? JSON.parse(userData) : null;
    } catch (err) {
        console.error("Error in getUserFromRedis:", err);
        return null;
    }
}

// Get User by Socket ID
async function getUserBySocketId(socketId) {
    if (!isRedisConnected || !socketId) return null;
    try {
        const userId = await pubClient.hGet(REDIS_SOCKET_HASH, socketId);
        if (!userId) return null;
        return await getUserFromRedis(userId);
    } catch (err) {
        console.error("Error in getUserBySocketId:", err);
        return null;
    }
}

// Remove User State from Redis
async function removeUserFromRedis(userId, socketId) {
    if (!isRedisConnected || !userId) return;
    try {
        await pubClient.hDel(REDIS_USERS_HASH, userId);
        if (socketId) {
            await pubClient.hDel(REDIS_SOCKET_HASH, socketId);
        }
        await pubClient.zRem(REDIS_GEO_KEY, userId);
    } catch (err) {
        console.error("Error in removeUserFromRedis:", err);
    }
}

// ==========================================
// SERVER-SIDE REDIS GEO-SEARCH ENGINE (15KM Radius)
// ==========================================
async function getNearbyUserIds(lat, lng, radiusKm = 15) {
    if (!isRedisConnected || typeof lat !== 'number' || typeof lng !== 'number') return [];
    try {
        const nearbyIds = await pubClient.geoSearch(
            REDIS_GEO_KEY,
            { longitude: lng, latitude: lat },
            { radius: radiusKm, unit: 'km' }
        );
        return nearbyIds || [];
    } catch (err) {
        console.error("❌ Redis GeoSearch Error:", err);
        return [];
    }
}

// Cleanup active chat session when a user disconnects or deactivates
async function handleUserChatDisconnect(userId) {
    if (!isRedisConnected || !userId) return;
    try {
        const chatDataStr = await pubClient.hGet(REDIS_ACTIVE_CHATS_HASH, userId);
        if (chatDataStr) {
            const chatData = JSON.parse(chatDataStr);
            if (chatData && chatData.room) {
                io.to(chatData.room).emit('chat_closed', { room: chatData.room, disconnectedUser: userId });
            }
            await pubClient.hDel(REDIS_ACTIVE_CHATS_HASH, userId);
            if (chatData && chatData.partnerId) {
                await pubClient.hDel(REDIS_ACTIVE_CHATS_HASH, chatData.partnerId);
            }
        }
    } catch (err) {
        console.error("Error in handleUserChatDisconnect:", err);
    }
}

// ==========================================
// OPTIMIZED GEOHASH BROADCASTING LOGIC
// ==========================================
async function broadcastSpatialUpdate(user) {
    if (!user || typeof user.lat !== 'number' || typeof user.lng !== 'number') return;
    try {
        const globalCounts = await getGlobalCounts();
        
        // 5-Character Geohash (~4.9km x 4.9km grid)
        const centerHash = geohash.encode(user.lat, user.lng, 5);
        const neighbors = geohash.neighbors(centerHash);
        const targetRooms = [centerHash, ...neighbors].map(h => 'geo_' + h);

        // Broadcast only to users present in these local 9 grids
        io.to(targetRooms).emit('live_broadcast', { user: user, counts: globalCounts });
    } catch (err) {
        console.error("Error in broadcastSpatialUpdate:", err);
    }
}

async function broadcastSpatialRemoval(user) {
    if (!user) return;
    try {
        const globalCounts = await getGlobalCounts();

        if (typeof user.lat === 'number' && typeof user.lng === 'number') {
            const centerHash = geohash.encode(user.lat, user.lng, 5);
            const neighbors = geohash.neighbors(centerHash);
            const targetRooms = [centerHash, ...neighbors].map(h => 'geo_' + h);
            io.to(targetRooms).emit('remove_user', { id: user.id, counts: globalCounts });
        } else {
            io.emit('remove_user', { id: user.id, counts: globalCounts });
        }
    } catch (err) {
        console.error("Error in broadcastSpatialRemoval:", err);
    }
}

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {

    socket.on('update_location', async (data) => {
        if (!data || !data.id) return;

        try {
            const existingUser = await getUserFromRedis(data.id);
            const isNewUser = !existingUser;

            if (!isNewUser && existingUser.role !== data.role) {
                await decrementRoleCount(existingUser.role);
                await incrementRoleCount(data.role);
            } else if (isNewUser) {
                await incrementRoleCount(data.role);
            }

            data.socketId = socket.id;
            data.lastUpdated = Date.now();

            // Save location to Centralized Redis GEO Index & Hash
            await saveUserInRedis(data);

            // Dynamic Geohash Room Management
            if (typeof data.lat === 'number' && typeof data.lng === 'number') {
                const currentHash = geohash.encode(data.lat, data.lng, 5);
                const newGeoRoom = 'geo_' + currentHash;

                if (socket.currentGeoRoom && socket.currentGeoRoom !== newGeoRoom) {
                    socket.leave(socket.currentGeoRoom);
                }
                socket.join(newGeoRoom);
                socket.currentGeoRoom = newGeoRoom;
            }

            // Jab Naya User Connect Ho - Direct Server-Side Redis GeoSearch Se 15km Users Nikalein
            if (isNewUser && typeof data.lat === 'number' && typeof data.lng === 'number') {
                const nearbyIds = await getNearbyUserIds(data.lat, data.lng, 15);
                let nearbyUsers = {};

                for (let targetId of nearbyIds) {
                    if (targetId !== data.id) {
                        let tUser = await getUserFromRedis(targetId);
                        if (tUser) {
                            nearbyUsers[targetId] = tUser;
                        }
                    }
                }

                // Client ko keval 15km ke daayre wale users hi bhejein
                socket.emit('init_users', nearbyUsers);
                const counts = await getGlobalCounts();
                socket.emit('live_broadcast', { counts });
            }

            // Local Geohash Room Broadcasting
            await broadcastSpatialUpdate(data);
        } catch (err) {
            console.error("Error in socket update_location:", err);
        }
    });

    socket.on('disconnect', async () => {
        try {
            const user = await getUserBySocketId(socket.id);
            if (user) {
                await handleUserChatDisconnect(user.id);
                await decrementRoleCount(user.role);
                await removeUserFromRedis(user.id, socket.id);
                await broadcastSpatialRemoval(user);
            }
        } catch (err) {
            console.error("Error in socket disconnect:", err);
        }
    });

    socket.on('deactivate_passenger', async (data) => {
        if (!data || !data.id) return;
        try {
            const user = await getUserFromRedis(data.id);
            if (user) {
                await handleUserChatDisconnect(user.id);
                await decrementRoleCount(user.role);
                await removeUserFromRedis(data.id, user.socketId || socket.id);
                await broadcastSpatialRemoval(user);
            }
        } catch (err) {
            console.error("Error in socket deactivate_passenger:", err);
        }
    });

    // Chat & Request Logic
    socket.on('send_sms_request', async (data) => {
        if (!data || !data.riderId || !data.passengerId) return;
        try {
            const rider = await getUserFromRedis(data.riderId);
            if (rider && rider.socketId) {
                io.to(rider.socketId).emit('receive_sms_request', { passengerId: data.passengerId, riderId: data.riderId });
            }
        } catch (err) {
            console.error("Error in send_sms_request:", err);
        }
    });

    socket.on('accept_sms_request', async (data) => {
        if (!data || !data.passengerId || !data.riderId) return;
        try {
            const room = 'room_' + data.passengerId + '_' + data.riderId;
            
            socket.join(room);
            
            const passenger = await getUserFromRedis(data.passengerId);
            const rider = await getUserFromRedis(data.riderId);

            if (passenger && passenger.socketId) {
                await io.in(passenger.socketId).socketsJoin(room);
            }
            if (rider && rider.socketId) {
                await io.in(rider.socketId).socketsJoin(room);
            }

            const chatDataPassenger = JSON.stringify({ room: room, partnerId: data.riderId });
            const chatDataRider = JSON.stringify({ room: room, partnerId: data.passengerId });
            await pubClient.hSet(REDIS_ACTIVE_CHATS_HASH, data.passengerId, chatDataPassenger);
            await pubClient.hSet(REDIS_ACTIVE_CHATS_HASH, data.riderId, chatDataRider);

            const payload = { room: room, passengerId: data.passengerId, riderId: data.riderId };

            io.to(room).emit('request_accepted', payload);
            if (passenger && passenger.socketId) {
                io.to(passenger.socketId).emit('request_accepted', payload);
            }
            if (rider && rider.socketId) {
                io.to(rider.socketId).emit('request_accepted', payload);
            }
        } catch (err) {
            console.error("Error in accept_sms_request:", err);
        }
    });

    socket.on('reject_sms_request', async (data) => {
        if (!data || !data.passengerId) return;
        try {
            const passenger = await getUserFromRedis(data.passengerId);
            if (passenger && passenger.socketId) {
                io.to(passenger.socketId).emit('request_rejected', data);
            }
        } catch (err) {
            console.error("Error in reject_sms_request:", err);
        }
    });

    socket.on('chat_message', (data) => {
        if (data && data.room) {
            io.to(data.room).emit('chat_message', data);
        }
    });

    socket.on('close_chat', async (data) => {
        try {
            if (data && data.room) {
                io.to(data.room).emit('chat_closed', { room: data.room });
            }
            if (data && data.userId) {
                await handleUserChatDisconnect(data.userId);
            }
        } catch (err) {
            console.error("Error in close_chat:", err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});