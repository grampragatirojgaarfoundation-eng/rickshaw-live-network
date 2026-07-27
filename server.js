const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const USERS_FILE = path.join(__dirname, 'users.json');

function readUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    try {
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

app.post('/verify-otp', (req, res) => {
    const { mobileNumber, enteredOtp } = req.body;
    const FIXED_OTP = "7317";

    if (!mobileNumber || mobileNumber.length < 10) {
        return res.json({ success: false, message: "Kripya sahi 10 ankon ka mobile number daalein." });
    }

    if (enteredOtp === FIXED_OTP) {
        let users = readUsers();
        const currentTime = new Date().toISOString();
        
        let user = users.find(u => u.mobile === mobileNumber);

        if (user) {
            user.lastActive = currentTime;
        } else {
            user = {
                mobile: mobileNumber,
                token: "token_" + Math.random().toString(36).substring(2),
                lastActive: currentTime
            };
            users.push(user);
        }

        writeUsers(users);

        return res.json({ 
            success: true, 
            message: "Login Successful!", 
            token: user.token 
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
    console.log('User connected:', socket.id);

    socket.emit('init_users', activeUsers);

    socket.on('update_location', (data) => {
        if (data && data.id) {
            activeUsers[data.id] = { ...data, socketId: socket.id };
            io.emit('live_broadcast', { user: activeUsers[data.id], counts: getGlobalCounts() });
        }
    });

    socket.on('deactivate_passenger', (data) => {
        if (data && data.id && activeUsers[data.id]) {
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