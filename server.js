const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Explicitly serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let activeUsers = {};

io.on('connection', (socket) => {
    console.log(`New user connected: ${socket.id}`);

    socket.on('update_location', (data) => {
        if (data && data.id) {
            activeUsers[data.id] = { ...data, socketId: socket.id };
            socket.broadcast.emit('live_broadcast', activeUsers[data.id]);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (let id in activeUsers) {
            if (activeUsers[id].socketId === socket.id) {
                io.emit('remove_user', id);
                delete activeUsers[id];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});