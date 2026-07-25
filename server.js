const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Rickshaw & Bike Live Network</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: sans-serif; }
        html, body, #map { height: 100%; width: 100%; overflow: hidden; background: #e5e3df; }

        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.9); display: flex; justify-content: center; align-items: center; z-index: 99999; }
        .modal-box { background: #ffffff; padding: 24px; border-radius: 20px; text-align: center; width: 90%; max-width: 350px; }
        .modal-box h2 { font-size: 20px; margin-bottom: 8px; color: #111; }
        .modal-box p { font-size: 13px; color: #666; margin-bottom: 20px; }
        .btn-group { display: flex; flex-direction: column; gap: 12px; }
        .role-btn { padding: 14px; border: none; border-radius: 12px; font-size: 15px; font-weight: bold; color: #fff; cursor: pointer; }
        .btn-auto { background: #e63946; }
        .btn-sawari { background: #2a9d8f; }
        .btn-bike-rider { background: #d97706; }
        .btn-bike-sawari { background: #7c3aed; }

        .status-card { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #fff; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: bold; display: none; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
        
        .chat-overlay { display: none; position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%); width: 90%; max-width: 350px; background: #fff; z-index: 2000; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.3); padding: 12px; }
        .chat-box { max-height: 120px; overflow-y: auto; border: 1px solid #ddd; padding: 6px; font-size: 11px; margin-bottom: 8px; background: #f9f9f9; }
        .chat-input-row { display: flex; gap: 6px; }
        .chat-input { flex: 1; padding: 6px; font-size: 11px; border: 1px solid #ccc; border-radius: 4px; }
        .chat-send-btn { background: #7c3aed; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }

        .request-popup { display: none; position: fixed; top: 60px; left: 50%; transform: translateX(-50%); z-index: 2000; background: #fff; padding: 12px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); text-align: center; width: 90%; max-width: 320px; }
        
        .custom-pin { width: 30px; height: 30px; border-radius: 50%; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
        .pin-self { background-color: #1d4ed8; }
        .pin-auto { background-color: #e63946; }
        .pin-bike-rider { background-color: #d97706; }
        .pin-bike-sawari { background-color: #7c3aed; }
        .pin-sawari { background-color: #2a9d8f; }
        .direction-arrow { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 12px solid #fff; }
        .sawari-inner { width: 8px; height: 8px; background: #fff; border-radius: 50%; }
    </style>
</head>
<body>

    <div class="modal-overlay" id="roleModal">
        <div class="modal-box">
            <h2>Select Your Mode</h2>
            <p>Aap kis rup me kaam karna chahte hain?</p>
            <div class="btn-group">
                <button class="role-btn btn-auto" onclick="selectRole('rider')">Auto / E-Rickshaw Rider</button>
                <button class="role-btn btn-sawari" onclick="selectRole('sawari')">Auto Passenger (Sawari)</button>
                <button class="role-btn btn-bike-rider" onclick="selectRole('bike_rider')">🏍️ Bike Rider (6 AM - 6 PM)</button>
                <button class="role-btn btn-bike-sawari" onclick="selectRole('bike_sawari')">🙋‍♂️ Bike Passenger (6 AM - 6 PM)</button>
            </div>
        </div>
    </div>

    <div class="status-card" id="statusBar">Connecting...</div>

    <div class="request-popup" id="requestPopup">
        <p id="reqText" style="font-size: 12px; font-weight: bold; margin-bottom: 8px;"></p>
        <button onclick="acceptReq()" style="background:#16a34a; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">Accept</button>
        <button onclick="rejectReq()" style="background:#dc2626; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer; margin-left:6px;">Reject</button>
    </div>

    <div class="chat-overlay" id="chatOverlay">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <b style="font-size:11px; color:#7c3aed;">Private Chat</b>
            <button onclick="document.getElementById('chatOverlay').style.display='none'" style="border:none; background:none; cursor:pointer;">✕</button>
        </div>
        <div class="chat-box" id="chatMsgs"></div>
        <div class="chat-input-row">
            <input type="text" id="chatTxt" class="chat-input" placeholder="Message likhein...">
            <button class="chat-send-btn" onclick="sendMsg()">Send</button>
        </div>
    </div>

    <div id="map"></div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script>
        let myId = 'u_' + Math.floor(Math.random() * 1000000);
        let myRole = null, map = null, marker = null;
        let lat = 28.6139, lng = 77.2090, socket = null;
        let pendingReq = null, activeRoom = null;

        function selectRole(role) {
            if (role.includes('bike')) {
                let h = new Date().getHours();
                if (h < 6 || h >= 18) {
                    alert('Bike Mode sirf Subah 6 AM se Shaam 6 PM tak chalta hai!');
                    return;
                }
            }
            myRole = role;
            document.getElementById('roleModal').style.display = 'none';
            document.getElementById('statusBar').style.display = 'block';
            document.getElementById('statusBar').innerText = role.toUpperCase() + ' Active';
            
            initMap();
            initSocket();
        }

        function getMarkerIcon(r, isSelf) {
            let cls = 'pin-sawari', inner = '<div class="sawari-inner"></div>';
            if (isSelf) { cls = 'pin-self'; inner = '<div class="direction-arrow"></div>'; }
            else if (r === 'rider') { cls = 'pin-auto'; inner = '<div class="direction-arrow"></div>'; }
            else if (r === 'bike_rider') { cls = 'pin-bike-rider'; inner = '<div class="direction-arrow"></div>'; }
            else if (r === 'bike_sawari') { cls = 'pin-bike-sawari'; }
            return L.divIcon({ className: '', html: '<div class="custom-pin ' + cls + '">' + inner + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
        }

        function initMap() {
            map = L.map('map', { zoomControl: false }).setView([lat, lng], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
            marker = L.marker([lat, lng], { icon: getMarkerIcon(myRole, true) }).addTo(map);

            if (navigator.geolocation) {
                navigator.geolocation.watchPosition(pos => {
                    lat = pos.coords.latitude;
                    lng = pos.coords.longitude;
                    if (map) {
                        map.setView([lat, lng], 15);
                        marker.setLatLng([lat, lng]);
                    }
                }, e => {}, { enableHighAccuracy: true });
            }
        }

        function initSocket() {
            socket = io({ transports: ['websocket'] });
            
            setInterval(() => {
                if (socket && socket.connected) {
                    socket.emit('update_loc', { id: myId, role: myRole, lat: lat, lng: lng });
                }
            }, 2500);

            socket.on('broadcast', user => {
                // Handle live users if needed
            });

            socket.on('sms_req', data => {
                if (myRole === 'bike_rider') {
                    pendingReq = data;
                    document.getElementById('reqText').innerText = 'Nayi Bike Sawari Request aayi hai!';
                    document.getElementById('requestPopup').style.display = 'block';
                }
            });

            socket.on('req_accepted', data => {
                if (myId === data.pId || myId === data.rId) {
                    activeRoom = data.room;
                    document.getElementById('requestPopup').style.display = 'none';
                    document.getElementById('chatOverlay').style.display = 'block';
                }
            });

            socket.on('chat', msg => {
                if (activeRoom === msg.room) {
                    let box = document.getElementById('chatMsgs');
                    box.innerHTML += '<div><b>' + msg.sender + ':</b> ' + msg.text + '</div>';
                    box.scrollTop = box.scrollHeight;
                }
            });
        }

        function acceptReq() {
            document.getElementById('requestPopup').style.display = 'none';
            if (pendingReq) socket.emit('accept_req', pendingReq);
        }

        function rejectReq() {
            document.getElementById('requestPopup').style.display = 'none';
            pendingReq = null;
        }

        function sendMsg() {
            let txt = document.getElementById('chatTxt').value;
            if (!txt || !activeRoom) return;
            socket.emit('chat', { room: activeRoom, sender: myRole, text: txt });
            document.getElementById('chatTxt').value = '';
        }
    </script>
</body>
</html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
let users = {};

io.on('connection', socket => {
    socket.on('update_loc', data => {
        if (data && data.id) {
            users[data.id] = { ...data, sId: socket.id };
            socket.broadcast.emit('broadcast', users[data.id]);
        }
    });
    socket.on('accept_req', data => {
        let room = 'room_' + data.pId + '_' + data.rId;
        if (users[data.pId] && users[data.rId]) {
            io.to(users[data.pId].sId).emit('req_accepted', { ...data, room });
            io.to(users[data.rId].sId).emit('req_accepted', { ...data, room });
        }
    });
    socket.on('chat', msg => io.emit('chat', msg));
    socket.on('disconnect', () => {
        for (let id in users) {
            if (users[id].sId === socket.id) { delete users[id]; break; }
        }
    });
});

server.listen(process.env.PORT || 3000);