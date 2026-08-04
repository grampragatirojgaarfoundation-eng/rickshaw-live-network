const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

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
// REDIS ADAPTER SETUP (AUTOMATIC FALLBACK)
// ==========================================
try {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');

    const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
        io.adapter(createAdapter(pubClient, subClient));
        console.log("🚀 Redis Adapter Connected Successfully! Multi-Core Clustering Active.");
    }).catch((err) => {
        console.log("⚠️ Redis connection skipped (Running in Standalone Memory Mode).");
    });
} catch (e) {
    console.log("⚠️ Redis package missing or skipped. Running in Standalone Mode.");
}

let activeUsers = {};

// ==========================================
// SPATIAL GRID INDEXING LOGIC (50,000+ TRAFFIC ENGINE)
// Grid Cell Size: 0.05 degrees (~5.5 km x 5.5 km)
// ==========================================
const GRID_SIZE = 0.05; 
let spatialGrid = {};

function getCellKey(lat, lng) {
    const gridLat = Math.floor(lat / GRID_SIZE);
    const gridLng = Math.floor(lng / GRID_SIZE);
    return `${gridLat}_${gridLng}`;
}

function getNeighborCellKeys(lat, lng) {
    const gridLat = Math.floor(lat / GRID_SIZE);
    const gridLng = Math.floor(lng / GRID_SIZE);
    const keys = [];
    
    // 5x5 grid cells around user (~25km radius coverage)
    for (let dLat = -2; dLat <= 2; dLat++) {
        for (let dLng = -2; dLng <= 2; dLng++) {
            keys.push(`${gridLat + dLat}_${gridLng + dLng}`);
        }
    }
    return keys;
}

function updateUserInGrid(user) {
    const newCellKey = getCellKey(user.lat, user.lng);
    
    if (user.currentGridKey && user.currentGridKey !== newCellKey) {
        if (spatialGrid[user.currentGridKey]) {
            delete spatialGrid[user.currentGridKey][user.id];
            if (Object.keys(spatialGrid[user.currentGridKey]).length === 0) {
                delete spatialGrid[user.currentGridKey];
            }
        }
    }
    
    user.currentGridKey = newCellKey;
    if (!spatialGrid[newCellKey]) {
        spatialGrid[newCellKey] = {};
    }
    spatialGrid[newCellKey][user.id] = user;
}

function removeUserFromGrid(userId) {
    const user = activeUsers[userId];
    if (user && user.currentGridKey && spatialGrid[user.currentGridKey]) {
        delete spatialGrid[user.currentGridKey][userId];
        if (Object.keys(spatialGrid[user.currentGridKey]).length === 0) {
            delete spatialGrid[user.currentGridKey];
        }
    }
}

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

function getGlobalCounts() {
    let riders = 0;
    let sawaris = 0;
    for (let id in activeUsers) {
        if (activeUsers[id].role === 'rider' || activeUsers[id].role === 'bike_rider') riders++;
        if (activeUsers[id].role === 'sawari' || activeUsers[id].role === 'bike_sawari') sawaris++;
    }
    return { riders, sawaris };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('init_users', activeUsers);

    socket.on('update_location', (data) => {
        if (data && data.id && data.lat !== undefined && data.lng !== undefined) {
            const userData = { ...data, socketId: socket.id };
            activeUsers[data.id] = userData;
            
            // Grid Bucket अपडेट करें
            updateUserInGrid(userData);

            const globalCounts = getGlobalCounts();
            const neighborKeys = getNeighborCellKeys(data.lat, data.lng);
            const notifiedSockets = new Set();
            
            for (let key of neighborKeys) {
                if (spatialGrid[key]) {
                    for (let targetId in spatialGrid[key]) {
                        const targetUser = spatialGrid[key][targetId];
                        if (targetUser && targetUser.socketId && !notifiedSockets.has(targetUser.socketId)) {
                            notifiedSockets.add(targetUser.socketId);
                            
                            const dist = calculateDistance(data.lat, data.lng, targetUser.lat, targetUser.lng);
                            // 25 से घटाकर 15 KM किया गया
                            if (dist <= 15 || targetId === data.id) {
                                io.to(targetUser.socketId).emit('live_broadcast', {
                                    user: userData,
                                    counts: globalCounts
                                });
                            }
                        }
                    }
                }
            }
        }
    });

    socket.on('deactivate_passenger', (data) => {
        if (data && data.id && activeUsers[data.id]) {
            removeUserFromGrid(data.id);
            delete activeUsers[data.id];
            io.emit('remove_user', { id: data.id, counts: getGlobalCounts() });
        }
    });

    socket.on('send_sms_request', (data) => {
        if (activeUsers[data.riderId]) {
            io.to(activeUsers[data.riderId].socketId).emit('receive_sms_request', data);
        }
    });

    socket.on('accept_sms_request', (data) => {
        const roomName = 'room_' + data.passengerId + '_' + data.riderId;
        socket.join(roomName);

        if (activeUsers[data.passengerId]) {
            const passengerSocket = io.sockets.sockets.get(activeUsers[data.passengerId].socketId);
            if (passengerSocket) passengerSocket.join(roomName);
        }

        if (activeUsers[data.passengerId] && activeUsers[data.riderId]) {
            io.to(roomName).emit('request_accepted', { ...data, room: roomName });
        }
    });

    socket.on('reject_sms_request', (data) => {
        if (activeUsers[data.passengerId]) {
            io.to(activeUsers[data.passengerId].socketId).emit('request_rejected', data);
        }
    });

    socket.on('chat_message', (msg) => {
        if (msg && msg.room) {
            io.to(msg.room).emit('chat_message', msg);
        }
    });

    socket.on('close_chat', (data) => {
        if (data && data.room) {
            io.to(data.room).emit('chat_closed', data);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let id in activeUsers) {
            if (activeUsers[id].socketId === socket.id) {
                removeUserFromGrid(id);
                delete activeUsers[id];
                io.emit('remove_user', { id: id, counts: getGlobalCounts() });
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});