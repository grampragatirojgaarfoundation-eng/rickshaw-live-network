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
    <title>Rickshaw & Bike Live Network - Enterprise</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        html, body, #map { height: 100%; width: 100%; overflow: hidden; background: #e5e3df; }

        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.88); display: flex; justify-content: center; align-items: center; z-index: 99999; backdrop-filter: blur(8px); }
        .modal-box { background: #ffffff; padding: 24px 20px; border-radius: 20px; text-align: center; width: 90%; max-width: 360px; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
        .modal-box h2 { font-size: 20px; color: #111; margin-bottom: 6px; font-weight: 800; }
        .modal-box p { font-size: 12px; color: #666; margin-bottom: 18px; line-height: 1.4; }
        .btn-group { display: flex; flex-direction: column; gap: 10px; }
        .role-btn { padding: 14px; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; color: #ffffff; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .role-btn:active { transform: scale(0.97); }
        .btn-auto { background: #e63946; }
        .btn-bike-rider { background: #d97706; }
        .btn-bike-sawari { background: #7c3aed; }
        .btn-sawari { background: #2a9d8f; }

        .status-card { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #ffffff; padding: 10px 18px; border-radius: 30px; font-size: 12px; font-weight: 700; box-shadow: 0 4px 18px rgba(0,0,0,0.18); display: none; align-items: center; gap: 8px; }
        .badge { width: 10px; height: 10px; border-radius: 50%; }

        .traffic-counter { position: fixed; top: 14px; right: 14px; z-index: 1000; background: rgba(0, 0, 0, 0.75); color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 10px; font-weight: 600; display: none; }

        .chat-overlay { display: none; position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); width: 90%; max-width: 360px; background: #fff; z-index: 2000; border-radius: 16px; box-shadow: 0 8px 25px rgba(0,0,0,0.3); padding: 14px; }
        .chat-box { max-height: 150px; overflow-y: auto; border: 1px solid #ddd; padding: 8px; border-radius: 8px; margin-bottom: 10px; font-size: 12px; background: #f9f9f9; }
        .chat-input-row { display: flex; gap: 6px; }
        .chat-input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px; }
        .chat-send-btn { background: #7c3aed; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; }

        .request-popup { display: none; position: fixed; top: 70px; left: 50%; transform: translateX(-50%); z-index: 2000; background: #fff; padding: 12px 18px; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.3); text-align: center; width: 90%; max-width: 340px; }
        .req-btn-group { display: flex; gap: 10px; margin-top: 8px; justify-content: center; }
        .btn-accept { background: #16a34a; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .btn-reject { background: #dc2626; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; }

        .custom-pin { width: 32px; height: 32px; border-radius: 50%; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(0,0,0,0.4); }
        .pin-self { background-color: #1d4ed8; }
        .pin-auto { background-color: #e63946; }
        .pin-bike-rider { background-color: #d97706; }
        .pin-bike-sawari { background-color: #7c3aed; }
        .pin-sawari { background-color: #2a9d8f; }
        .direction-arrow { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 14px solid #ffffff; }
        .sawari-inner { width: 10px; height: 10px; background: #ffffff; border-radius: 50%; }
    </style>
</head>
<body>

    <div class="modal-overlay" id="roleModal">
        <div class="modal-box">
            <h2>Select Your Mode</h2>
            <p>Aap kis rup me kaam karna chahte hain?</p>
            <div class="btn-group">
                <button class="role-btn btn-auto" onclick="handleRoleSelection('rider')">Auto / E-Rickshaw Rider</button>
                <button class="role-btn btn-sawari" onclick="handleRoleSelection('sawari')">Auto Passenger (Sawari)</button>
                <button class="role-btn btn-bike-rider" onclick="handleRoleSelection('bike_rider')">🏍️ Bike Rider (6 AM - 6 PM)</button>
                <button class="role-btn btn-bike-sawari" onclick="handleRoleSelection('bike_sawari')">🙋‍♂️ Bike Passenger (6 AM - 6 PM)</button>
            </div>
        </div>
    </div>

    <div class="status-card" id="statusBar">
        <div id="statusDot" class="badge"></div>
        <span id="statusText">Connecting...</span>
    </div>

    <div class="traffic-counter" id="trafficCounter">
        🌍 Traffic Active
    </div>

    <div class="request-popup" id="requestPopup">
        <p id="reqText" style="font-size: 12px; font-weight: bold; color: #111;"></p>
        <div class="req-btn-group">
            <button class="btn-accept" onclick="acceptRequest()">Accept SMS</button>
            <button class="btn-reject" onclick="rejectRequest()">Reject</button>
        </div>
    </div>

    <div class="chat-overlay" id="chatOverlay">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size: 11px; font-weight: bold; color: #7c3aed;">💬 Private SMS Negotiation</span>
            <button onclick="closeChat()" style="background:none; border:none; font-weight:bold; cursor:pointer; color:#666;">✕ Close</button>
        </div>
        <div class="chat-box" id="chatMessages"></div>
        <div class="chat-input-row">
            <input type="text" id="chatInput" class="chat-input" placeholder="Kahan jana hai & kitna paisa?">
            <button class="chat-send-btn" onclick="sendChatMessage()">Send</button>
        </div>
    </div>

    <div id="map"></div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>

    <script>
        let map = null, socket = null, myId = 'user_' + Math.floor(Math.random() * 1000000);
        let myRole = null, selfMarker = null, myLat = 20.5937, myLng = 78.9629, myHeading = 0;
        let activeMarkers = {}, isMapCentered = false;
        let incomingReqData = null, activeChatRoom = null;

        function handleRoleSelection(role) {
            if (role === 'bike_rider' || role === 'bike_sawari') {
                const currentHour = new Date().getHours();
                if (currentHour < 6 || currentHour >= 18) {
                    alert('⚠️ Bike Mode sirf Subah 6 AM se Shaam 6 PM tak hi active rehta hai!');
                    return;
                }
            }

            myRole = role;
            document.getElementById('roleModal').style.display = 'none';
            startSystem();
        }

        function getIcon(role, heading = 0, isSelf = false) {
            let bgClass = 'pin-sawari';
            let innerElement = '<div class="sawari-inner"></div>';

            if (isSelf) {
                bgClass = 'pin-self';
                innerElement = '<div class="direction-arrow" style="transform: rotate(' + heading + 'deg);"></div>';
            } else if (role === 'rider') {
                bgClass = 'pin-auto';
                innerElement = '<div class="direction-arrow" style="transform: rotate(' + heading + 'deg);"></div>';
            } else if (role === 'bike_rider') {
                bgClass = 'pin-bike-rider';
                innerElement = '<div class="direction-arrow" style="transform: rotate(' + heading + 'deg);"></div>';
            } else if (role === 'bike_sawari') {
                bgClass = 'pin-bike-sawari';
            }

            return L.divIcon({
                className: '',
                html: '<div class="custom-pin ' + bgClass + '">' + innerElement + '</div>',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });
        }

        function startSystem() {
            const statusBar = document.getElementById('statusBar');
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');

            statusBar.style.display = 'flex';
            document.getElementById('trafficCounter').style.display = 'block';
            statusText.innerText = myRole.toUpperCase() + ' Mode Active';

            // Initialize Map immediately
            map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([myLat, myLng], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

            connectSocketServer();
            startLiveGPS();

            let intervalTime = (myRole && myRole.includes('bike')) ? 2000 : 3000;
            setInterval(() => { syncPosition(); }, intervalTime);
        }

        function startLiveGPS() {
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        myLat = pos.coords.latitude;
                        myLng = pos.coords.longitude;
                        myHeading = pos.coords.heading || 0;
                        if (map) {
                            map.setView([myLat, myLng], 15);
                            selfMarker = L.marker([myLat, myLng], { icon: getIcon(myRole, myHeading, true) }).addTo(map).bindPopup('<b>Aapki Location</b>');
                        }
                    },
                    (err) => { console.log("GPS Error, using default location"); },
                    { enableHighAccuracy: true, timeout: 5000 }
                );

                navigator.geolocation.watchPosition(
                    (pos) => {
                        myLat = pos.coords.latitude;
                        myLng = pos.coords.longitude;
                        myHeading = pos.coords.heading || 0;

                        if (map) {
                            if (!isMapCentered) {
                                map.setView([myLat, myLng], 15);
                                isMapCentered = true;
                            }
                            if (selfMarker) {
                                selfMarker.setLatLng([myLat, myLng]);
                                selfMarker.setIcon(getIcon(myRole, myHeading, true));
                            } else {
                                selfMarker = L.marker([myLat, myLng], { icon: getIcon(myRole, myHeading, true) }).addTo(map).bindPopup('<b>Aapki Location</b>');
                            }
                        }
                        syncPosition();
                    },
                    (err) => {},
                    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
                );
            }
        }

        function connectSocketServer() {
            if (socket) return;
            socket = io({ transports: ['websocket'], reconnection: true });

            socket.on('connect', () => { syncPosition(); });

            socket.on('init_users', (users) => {
                for (let id in users) { if (id !== myId) processIncomingUser(users[id]); }
            });

            socket.on('live_broadcast', (user) => { 
                if (user && user.id !== myId) processIncomingUser(user); 
            });

            socket.on('remove_user', (id) => { removeUser(id); });

            socket.on('receive_sms_request', (data) => {
                if (myRole === 'bike_rider') {
                    incomingReqData = data;
                    document.getElementById('reqText').innerText = '🙋‍♂️ Nayi Bike Sawari Request aayi hai!';
                    document.getElementById('requestPopup').style.display = 'block';
                }
            });

            socket.on('request_accepted', (data) => {
                if (myId === data.passengerId || myId === data.riderId) {
                    activeChatRoom = data.room;
                    document.getElementById('requestPopup').style.display = 'none';
                    document.getElementById('chatOverlay').style.display = 'block';
                    appendChatMessage('System', 'Aapas mein connect ho gaye hain. Ab chat shuru karein.');
                }
            });

            socket.on('chat_message', (msg) => {
                if (activeChatRoom === msg.room) {
                    appendChatMessage(msg.senderRole.toUpperCase(), msg.text);
                }
            });
        }

        function syncPosition() {
            if (socket && socket.connected && myLat !== null && myLng !== null && myRole !== null) {
                socket.emit('update_location', { id: myId, role: myRole, lat: myLat, lng: myLng, heading: myHeading });
            }
        }

        function calculateDistance(lat1, lon1, lat2, lon2) {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        function processIncomingUser(user) {
            if (!myLat || !myLng || !map || !myRole) return;
            const distance = calculateDistance(myLat, myLng, user.lat, user.lng);

            let maxRadius = 10;
            if (myRole === 'bike_rider') {
                if (user.role !== 'bike_sawari') { removeUser(user.id); return; }
                maxRadius = 5;
            } else if (myRole === 'bike_sawari') {
                if (user.role !== 'bike_rider') { removeUser(user.id); return; }
                maxRadius = 5;
            } else if (myRole === 'rider' || myRole === 'sawari') {
                if (user.role && user.role.includes('bike')) { removeUser(user.id); return; }
            }

            if (distance > maxRadius) {
                removeUser(user.id);
                return;
            }

            if (activeMarkers[user.id]) {
                activeMarkers[user.id].setLatLng([user.lat, user.lng]);
                activeMarkers[user.id].setIcon(getIcon(user.role, user.heading || 0, false));
            } else {
                let markerObj = L.marker([user.lat, user.lng], { icon: getIcon(user.role, user.heading || 0, false) }).addTo(map);
                let popupHtml = '<b>' + user.role.toUpperCase() + '</b><br>Doori: ' + distance.toFixed(1) + ' KM';
                if (myRole === 'bike_sawari' && user.role === 'bike_rider' && distance <= 2) {
                    popupHtml += '<br><button onclick="sendSmsRequest(\'' + user.id + '\')" style="background:#7c3aed; color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:6px; cursor:pointer;">📲 SMS Request Bhejein</button>';
                }
                markerObj.bindPopup(popupHtml);
                activeMarkers[user.id] = markerObj;
            }
        }

        function sendSmsRequest(riderId) {
            socket.emit('send_sms_request', { passengerId: myId, riderId: riderId });
            alert('SMS Request Rider ko bhej di gayi hai!');
        }

        function acceptRequest() {
            document.getElementById('requestPopup').style.display = 'none';
            if (incomingReqData) {
                socket.emit('accept_sms_request', incomingReqData);
            }
        }

        function rejectRequest() {
            document.getElementById('requestPopup').style.display = 'none';
            incomingReqData = null;
        }

        function sendChatMessage() {
            const text = document.getElementById('chatInput').value;
            if (!text || !activeChatRoom) return;
            socket.emit('chat_message', { room: activeChatRoom, senderRole: myRole, text: text });
            document.getElementById('chatInput').value = '';
        }

        function appendChatMessage(sender, text) {
            const box = document.getElementById('chatMessages');
            box.innerHTML += '<div><b>' + sender + ':</b> ' + text + '</div>';
            box.scrollTop = box.scrollHeight;
        }

        function closeChat() {
            document.getElementById('chatOverlay').style.display = 'none';
            activeChatRoom = null;
        }

        function removeUser(id) {
            if (activeMarkers[id]) { map.removeLayer(activeMarkers[id]); delete activeMarkers[id]; }
        }
    </script>
</body>
</html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let activeUsers = {};

io.on('connection', (socket) => {
    socket.emit('init_users', activeUsers);

    socket.on('update_location', (data) => {
        if (data && data.id) {
            activeUsers[data.id] = { ...data, socketId: socket.id };
            socket.broadcast.emit('live_broadcast', activeUsers[data.id]);
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
                io.emit('remove_user', id);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('Server running on port ' + PORT); });