const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Poora Live Tracking App + Server ek hi jagah par
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Rickshaw Live Network</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: sans-serif; }
        html, body, #map { height: 100%; width: 100%; overflow: hidden; background: #e5e3df; }
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.88); display: flex; justify-content: center; align-items: center; z-index: 99999; }
        .modal-box { background: #fff; padding: 28px 24px; border-radius: 20px; text-align: center; width: 88%; max-width: 350px; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
        .role-btn { width: 100%; padding: 16px; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; margin-top: 10px; }
        .btn-rider { background: #e63946; }
        .btn-sawari { background: #2a9d8f; }
        
        .pay-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 100000; justify-content: center; align-items: center; }
        .pay-box { background: #fff; padding: 20px; border-radius: 16px; width: 90%; max-width: 320px; text-align: center; }
        .pay-btn-close { background: #e63946; color: #fff; border: none; padding: 12px; width: 100%; border-radius: 10px; font-size: 15px; font-weight: bold; cursor: pointer; margin-top: 15px; }

        .status-card { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #fff; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 700; display: none; box-shadow: 0 4px 18px rgba(0,0,0,0.18); align-items: center; gap: 10px; }
        .badge { width: 12px; height: 12px; border-radius: 50%; }
        .badge-rider { background: #e63946; }
        .badge-sawari { background: #2a9d8f; }
    </style>
</head>
<body>
    <div class="modal-overlay" id="roleModal">
        <div class="modal-box">
            <h2>Select Your Mode</h2>
            <p style="font-size:13px; color:#666; margin:10px 0 20px;">Aap kis rup me login karna chahte hain?</p>
            <button class="role-btn btn-rider" onclick="handleRoleSelection('rider')">Auto / E-Rickshaw (Rider)</button>
            <button class="role-btn btn-sawari" onclick="handleRoleSelection('sawari')">Passenger (Sawari - Free)</button>
        </div>
    </div>

    <div class="pay-modal" id="paymentModal">
        <div class="pay-box">
            <h3 style="margin-bottom: 4px; color: #111; font-size: 18px;">Rider Pass (₹5)</h3>
            <p style="font-size: 12px; color: #666; margin-bottom: 10px;">UPI App se scan karke ₹5 pay karein</p>
            <p style="font-size: 11px; color: #444; margin-top: 6px; font-weight: bold; background:#f1f1f1; padding:8px; border-radius:6px;">UPI ID: 8840176141@ptyes</p>
            <button class="pay-btn-close" onclick="closePaymentAndStart()">App Shuru Karein</button>
        </div>
    </div>

    <div class="status-card" id="statusBar">
        <div id="statusDot" class="badge"></div>
        <span id="statusText">Connected</span>
    </div>

    <div id="map"></div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script>
        let map = null, socket = null, myId = 'user_' + Math.floor(Math.random() * 1000000);
        let myRole = null, selfMarker = null, myLat = 20.5937, myLng = 78.9629, myHeading = 0;
        let activeMarkers = {};

        function handleRoleSelection(role) {
            myRole = role;
            document.getElementById('roleModal').style.display = 'none';
            if (myRole === 'rider') {
                document.getElementById('paymentModal').style.display = 'flex';
                return;
            }
            startSystem();
        }

        function closePaymentAndStart() {
            document.getElementById('paymentModal').style.display = 'none';
            startSystem();
        }

        function startSystem() {
            const statusBar = document.getElementById('statusBar');
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');

            statusBar.style.display = 'flex';
            if (myRole === 'rider') {
                statusDot.className = 'badge badge-rider';
                statusText.innerText = 'Rider Mode Active';
            } else {
                statusDot.className = 'badge badge-sawari';
                statusText.innerText = 'Sawari Mode Active';
            }

            setTimeout(() => {
                map = L.map('map', { zoomControl: false }).setView([myLat, myLng], 15);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
                L.control.zoom({ position: 'bottomright' }).addTo(map);
            }, 200);

            if ("geolocation" in navigator) {
                navigator.geolocation.watchPosition((pos) => {
                    myLat = pos.coords.latitude;
                    myLng = pos.coords.longitude;
                    myHeading = pos.coords.heading || 0;

                    if (map) {
                        map.setView([myLat, myLng], 16);
                        if (selfMarker) {
                            selfMarker.setLatLng([myLat, myLng]);
                        } else {
                            selfMarker = L.marker([myLat, myLng]).addTo(map).bindPopup('<b>Aapki Live Location</b>');
                        }
                    }
                    syncPosition();
                }, err => {}, { enableHighAccuracy: true });
            }

            connectSocket();
        }

        function connectSocket() {
            socket = io({ transports: ['websocket'] });

            socket.on('live_broadcast', (user) => {
                if (user && user.id !== myId && map) {
                    if (activeMarkers[user.id]) {
                        activeMarkers[user.id].setLatLng([user.lat, user.lng]);
                    } else {
                        activeMarkers[user.id] = L.marker([user.lat, user.lng]).addTo(map)
                            .bindPopup('<b>' + user.role.toUpperCase() + '</b>');
                    }
                }
            });

            socket.on('remove_user', (id) => {
                if (activeMarkers[id]) {
                    map.removeLayer(activeMarkers[id]);
                    delete activeMarkers[id];
                }
            });
        }

        function syncPosition() {
            if (socket && socket.connected) {
                socket.emit('update_location', { id: myId, role: myRole, lat: myLat, lng: myLng, heading: myHeading });
            }
        }

        setInterval(() => { syncPosition(); }, 2000);
    </script>
</body>
</html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let activeUsers = {};
io.on('connection', (socket) => {
    socket.on('update_location', (data) => {
        if (data && data.id) {
            activeUsers[data.id] = { ...data, socketId: socket.id };
            socket.broadcast.emit('live_broadcast', activeUsers[data.id]);
        }
    });

    socket.on('disconnect', () => {
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
server.listen(PORT, () => { console.log('Server running on port ' + PORT); });