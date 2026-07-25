const cluster = require('cluster');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const redisAdapter = require('socket.io-redis');
const cors = require('cors');
const path = require('path');

const numCPUs = os.cpus().length;

// 1. Cluster Module: Server ke saare CPU cores ka use karne ke liye
if (cluster.isMaster && process.env.NODE_ENV === 'production' && numCPUs > 1) {
    console.log(`Master process ${process.pid} is running`);
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker process ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    const app = express();
    app.use(cors());
    app.use(express.static(__dirname));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: "*" } });

    // 2. Redis Adapter: Multiple CPU cores ke beech live traffic sync ke liye
    try {
        io.adapter(redisAdapter({ host: 'localhost', port: 6379 }));
    } catch (e) {
        console.log("Redis adapter warning, running on single node memory.");
    }

    let activeUsers = {};

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
        socket.emit('init_users', activeUsers);

        socket.on('update_location', (data) => {
            if (data && data.id) {
                activeUsers[data.id] = { ...data, socketId: socket.id };
                io.emit('live_broadcast', { user: activeUsers[data.id], counts: getGlobalCounts() });
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
            if (activeUsers[data.passengerId] && activeUsers[data.riderId]) {
                io.to(activeUsers[data.passengerId].socketId).emit('request_accepted', { ...data, room: roomName });
                io.to(activeUsers[data.riderId].socketId).emit('request_accepted', { ...data, room: roomName });
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
            for (let id in activeUsers) {
                if (activeUsers[id].socketId === socket.id) {
                    delete activeUsers[id];
                    io.emit('remove_user', { id: id, counts: getGlobalCounts() });
                    break;
                }
            }
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Worker ${process.pid} started and server running on port ${PORT}`);
    });
}