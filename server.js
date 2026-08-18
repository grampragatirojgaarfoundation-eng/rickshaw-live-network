const express = require('express');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const geohash = require('ngeohash');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');

const app = express();

app.set('trust proxy', 1);

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

app.use(apiLimiter);
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// VPS LOCAL AUDIO STORAGE CONFIGURATION
// ==========================================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.webm`;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Max 5MB
});

app.post('/upload-audio', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "File upload nahi hui" });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, fileUrl: fileUrl });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "https://rickshaw24.co.in" } });

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

async function connectRedis() {
    try {
        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
    } catch (err) {
        console.error("💥 Fatal: Redis Initial Connection Failed!", err);
        process.exit(1);
    }
}

connectRedis();

// ==========================================
// SOCKET RATE LIMITER (rate-limiter-flexible)
// ==========================================
let locationRateLimiter = null;
setTimeout(() => {
    if (isRedisConnected) {
        locationRateLimiter = new RateLimiterRedis({
            storeClient: pubClient,
            keyPrefix: 'socket_limit_loc',
            points: 2, // 1 सेकंड में अधिकतम 2 बार
            duration: 1, // प्रति 1 सेकंड
        });
    }
}, 2000);

const REDIS_USERS_HASH = 'active_users';           
const REDIS_SOCKET_HASH = 'socket_to_user';         
const REDIS_GEO_KEY = 'user_locations';             
const REDIS_RIDERS_COUNT = 'global_riders_count';   
const REDIS_SAWARIS_COUNT = 'global_sawaris_count'; 
const REDIS_ACTIVE_CHATS_HASH = 'active_chats';     

async function incrementRoleCount(role) { /* Empty - Now Dynamic */ }
async function decrementRoleCount(role) { /* Empty - Now Dynamic */ }

async function getGlobalCounts() {
    if (!isRedisConnected) return { riders: 0, sawaris: 0 };
    try {
        const allUsers = await pubClient.hGetAll(REDIS_USERS_HASH);
        let riders = 0;
        let sawaris = 0;
        for (let id in allUsers) {
            try {
                const user = JSON.parse(allUsers[id]);
                if (user.role === 'rider' || user.role === 'bike_rider') riders++;
                if (user.role === 'sawari' || user.role === 'bike_sawari') sawaris++;
            } catch (e) {}
        }
        return { riders, sawaris };
    } catch (err) {
        return { riders: 0, sawaris: 0 };
    }
}

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

async function getNearbyUserIds(lat, lng, radiusKm = 5) {
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

async function broadcastSpatialUpdate(user) {
    if (!user || typeof user.lat !== 'number' || typeof user.lng !== 'number') return;
    try {
        const globalCounts = await getGlobalCounts();
        
        const centerHash = geohash.encode(user.lat, user.lng, 5);
        const neighbors = geohash.neighbors(centerHash);
        const targetRooms = [centerHash, ...neighbors].map(h => 'geo_' + h);

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

io.on('connection', (socket) => {

    socket.on('heartbeat', async (data) => {
        if (!data || !data.id) return;
        try {
            const user = await getUserFromRedis(data.id);
            if (user) {
                user.lastUpdated = Date.now();
                await saveUserInRedis(user);
            }
        } catch (err) {
            console.error("Error in Heartbeat:", err);
        }
    });

    socket.on('update_location', async (data) => {
        if (!data || !data.id) return;

        // Rate Limiter Check (1 सेकंड में अधिकतम 2 पैकेट)
        if (locationRateLimiter) {
            try {
                await locationRateLimiter.consume(data.id);
            } catch (rateLimiterRes) {
                // सीमा पार होने पर अतिरिक्त पैकेट को तुरंत ड्रॉप (डस्टबिन में) कर दिया जाएगा
                return;
            }
        }

        try {
            data.socketId = socket.id;
            data.lastUpdated = Date.now();

            await saveUserInRedis(data);

            if (typeof data.lat === 'number' && typeof data.lng === 'number') {
                const currentHash = geohash.encode(data.lat, data.lng, 5);
                const newGeoRoom = 'geo_' + currentHash;

                if (socket.currentGeoRoom && socket.currentGeoRoom !== newGeoRoom) {
                    socket.leave(socket.currentGeoRoom);
                }
                socket.join(newGeoRoom);
                socket.currentGeoRoom = newGeoRoom;
            }

            const isNewUser = !(await getUserFromRedis(data.id));
            if (isNewUser && typeof data.lat === 'number' && typeof data.lng === 'number') {
                const nearbyIds = await getNearbyUserIds(data.lat, data.lng, 5);
                let nearbyUsers = {};

                for (let targetId of nearbyIds) {
                    if (targetId !== data.id) {
                        let tUser = await getUserFromRedis(targetId);
                        if (tUser) {
                            nearbyUsers[targetId] = tUser;
                        }
                    }
                }

                socket.emit('init_users', nearbyUsers);
                const counts = await getGlobalCounts();
                socket.emit('live_broadcast', { counts });
            }

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
                await removeUserFromRedis(data.id, user.socketId || socket.id);
                await broadcastSpatialRemoval(user);
            }
        } catch (err) {
            console.error("Error in socket deactivate_passenger:", err);
        }
    });

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

// ==========================================
// 10 सेकंड का सख्त Redis TTL / ऑटो-डिलीट वर्कर
// ==========================================
const instanceId = process.env.NODE_APP_INSTANCE || '0';
if (instanceId === '0') {
    setInterval(async () => {
        if (!isRedisConnected) return;
        try {
            const allUsers = await pubClient.hGetAll(REDIS_USERS_HASH);
            const currentTime = Date.now();
            const TIMEOUT_LIMIT = 10000; 

            for (let userId in allUsers) {
                const userData = JSON.parse(allUsers[userId]);
                if (currentTime - (userData.lastUpdated || 0) > TIMEOUT_LIMIT) {
                    console.log(`⏱️ Redis TTL Expired: Immediately Deleting Inactive User ${userId}`);
                    
                    await handleUserChatDisconnect(userId);
                    await removeUserFromRedis(userId, userData.socketId);
                    await broadcastSpatialRemoval(userData);
                }
            }
        } catch (err) {
            console.error("Error in 10s TTL Cleanup Worker:", err);
        }
    }, 3000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});