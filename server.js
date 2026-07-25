const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve static HTML file from the current directory
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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
        if (activeUsers[data.passengerId] && activeUsers[data.riderId]) {
            io.to(activeUsers[data.passengerId].socketId).emit('request_accepted', { ...data, room: roomName });
            io.to(activeUsers[data.riderId].socketId).emit('request_accepted', { ...data, room: roomName });
        }
    });

    socket.on('chat_message', (msg) => {
        io.emit('chat_message', msg);
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
server.listen(PORT, () => { console.log('Server running on port ' + PORT); });