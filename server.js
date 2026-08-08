const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ZERO DISK I/O - OTP Authentication in Memory Only
app.post('/verify-otp', (req, res) => {
    const { mobileNumber, enteredOtp } = req.body;
    const FIXED_OTP = "7317";

    if (!mobileNumber || mobileNumber.length < 10) {
        return res.json({ success: false, message: "Kripya sahi 10 ankon ka mobile number daalein." });
    }

    if (enteredOtp === FIXED_OTP) {
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
// REDIS CLIENT & ADAPTER SETUP
// ==========================================
const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

let isRedisConnected = false;

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    isRedisConnected = true;
    console.log("🚀 Redis Connected Successfully! Multi-Core Clustering Active.");
}).catch((err) => {
    console.error("❌ Redis Connection Error:", err);
});

// Redis Helper Keys
const REDIS_USERS_HASH = 'active_users';           // Hash: userId -> user JSON string
const REDIS_SOCKET_HASH = 'socket_to_user';         // Hash: socketId -> userId
const REDIS_GEO_KEY = 'user_locations';             // GEO index
const REDIS_RIDERS_COUNT = 'global_riders_count';   // Atomic Counter
const REDIS_SAWARIS_COUNT = 'global_sawaris_count'; // Atomic Counter

// Helper functions for updating counters atomically across all PM2 Cores
async function incrementRoleCount(role) {
    if (!isRedisConnected) return;
    if (role === 'rider' || role === 'bike_rider') {
        await pubClient.incr(REDIS_RIDERS_COUNT);
    }
    if (role === 'sawari' || role === 'bike_sawari') {
        await pubClient.incr(REDIS_SAWARIS_COUNT);
    }
}

async function decrementRoleCount(role) {
    if (!isRedisConnected) return;
    if (role === 'rider' || role === 'bike_rider') {
        const val = await pubClient.decr(REDIS_RIDERS_COUNT);
        if (val < 0) await pubClient.set(REDIS_RIDERS_COUNT, 0);
    }
    if (role === 'sawari' || role === 'bike_sawari') {
        const val = await pubClient.decr(REDIS_SAWARIS_COUNT);
        if (val < 0) await pubClient.set(REDIS_SAWARIS_COUNT, 0);
    }
}

async function getGlobalCounts() {
    if (!isRedisConnected) return { riders: 0, sawaris: 0 };
    const riders = parseInt(await pubClient.get(REDIS_RIDERS_COUNT) || '0', 10);
    const sawaris = parseInt(await pubClient.get(REDIS_SAWARIS_COUNT) || '0', 10);
    return { 
        riders: Math.max(0, riders), 
        sawaris: Math.max(0, sawaris) 
    };
}

// Distance Calculation Helper
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Save User state in Redis
async function saveUserInRedis(user) {
    if (!isRedisConnected) return;
    
    // Save user Object in Hash
    await pubClient.hSet(REDIS_USERS_HASH, user.id, JSON.stringify(user));
    // Map Socket ID to User ID
    await pubClient.hSet(REDIS_SOCKET_HASH, user.socketId, user.id);
    
    // Add/Update in Redis GEO Index (Longitude, Latitude, Member)
    await pubClient.geoAdd(REDIS_GEO_KEY, {
        longitude: user.lng,
        latitude: user.lat,
        member: user.id
    });
}

// Get User by ID
async function getUserFromRedis(userId) {
    if (!isRedisConnected || !userId) return null;
    const userData = await pubClient.hGet(REDIS_USERS_HASH, userId);
    return userData ? JSON.parse(userData) : null;
}

// Get User by Socket ID
async function getUserBySocketId(socketId) {
    if (!isRedisConnected || !socketId) return null;
    const userId = await pubClient.hGet(REDIS_SOCKET_HASH, socketId);
    if (!userId) return null;
    return await getUserFromRedis(userId);
}

// Remove User State from Redis
async function removeUserFromRedis(userId, socketId) {
    if (!isRedisConnected || !userId) return;
    
    await pubClient.hDel(REDIS_USERS_HASH, userId);
    if (socketId) {
        await pubClient.hDel(REDIS_SOCKET_HASH, socketId);
    }
    await pubClient.zRem(REDIS_GEO_KEY, userId);
}

// Find nearby user IDs (15km radius using Redis GEO Engine)
async function getNearbyUserIds(lat, lng, radiusKm = 15) {
    if (!isRedisConnected) return [];
    try {
        const nearbyIds = await pubClient.geoSearch(
            REDIS_GEO_KEY,
            { longitude: lng, latitude: lat },
            { radius: radiusKm, unit: 'km' }
        );
        return nearbyIds || [];
    } catch (err) {
        console.error("GeoSearch Error:", err);
        return [];
    }
}

// Broadcasts (Spreading via Redis Pub/Sub through Socket.io Adapter)
async function broadcastSpatialUpdate(user) {
    if (!user || user.lat === undefined || user.lng === undefined) return;
    const globalCounts = await getGlobalCounts();
    
    // Emit event globally; client checks distance or processes update
    io.emit('live_broadcast', { user: user, counts: globalCounts });
}

async function broadcastSpatialRemoval(user) {
    if (!user) return;
    const globalCounts = await getGlobalCounts();
    io.emit('remove_user', { id: user.id, counts: globalCounts });
}

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {

    socket.on('update_location', async (data) => {
        // 🔥 FIX 1: हर यूजर को उसकी अपनी ID वाले रूम में जोड़ें
        socket.join(data.id);

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

        // Save to Centralized Redis
        await saveUserInRedis(data);

        if (isNewUser) {
            // Find nearby user IDs within 15 km using Redis GEO
            const nearbyIds = await getNearbyUserIds(data.lat, data.lng, 15);
            let nearbyUsers = {};

            for (let targetId of nearbyIds) {
                if (targetId !== data.id) {
                    let tUser = await getUserFromRedis(targetId);
                    if (tUser && calculateDistance(data.lat, data.lng, tUser.lat, tUser.lng) <= 15) {
                        nearbyUsers[targetId] = tUser;
                    }
                }
            }

            socket.emit('init_users', nearbyUsers);
            const counts = await getGlobalCounts();
            socket.emit('live_broadcast', { counts });
        }

        await broadcastSpatialUpdate(data);
    });

    socket.on('disconnect', async () => {
        const user = await getUserBySocketId(socket.id);
        if (user) {
            await decrementRoleCount(user.role);
            await removeUserFromRedis(user.id, socket.id);
            await broadcastSpatialRemoval(user);
        }
    });

    socket.on('deactivate_passenger', async (data) => {
        const user = await getUserFromRedis(data.id);
        if (user) {
            await decrementRoleCount(user.role);
            await removeUserFromRedis(data.id, user.socketId);
            await broadcastSpatialRemoval(user);
        }
    });

    // 🔥 FIX 2: सीधे User ID पर मैसेज भेजें (Socket ID पर निर्भर न रहें)
    socket.on('send_sms_request', async (data) => {
        io.to(data.riderId).emit('receive_sms_request', { passengerId: data.passengerId, riderId: data.riderId });
    });

    socket.on('accept_sms_request', async (data) => {
        const room = 'room_' + data.passengerId + '_' + data.riderId;
        
        // 1. राइडर इस रूम में जुड़ेगा
        socket.join(room);
        
        // 2. पैसेंजर को उसकी User ID पर सीधे इवेंट भेजें ताकि उसका चैटबॉक्स खुले
        io.to(data.passengerId).emit('join_chat_room', { room, passengerId: data.passengerId, riderId: data.riderId });
        
        // 3. राइडर की स्क्रीन पर चैटबॉक्स खोलें
        socket.emit('request_accepted', { room, passengerId: data.passengerId, riderId: data.riderId });
    });

    socket.on('join_room_confirm', (data) => {
        socket.join(data.room);
    });

    socket.on('reject_sms_request', async (data) => {
        io.to(data.passengerId).emit('request_rejected', data);
    });

    socket.on('chat_message', (data) => {
        io.to(data.room).emit('chat_message', data);
    });

    socket.on('close_chat', (data) => {
        io.to(data.room).emit('chat_closed', { room: data.room });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});