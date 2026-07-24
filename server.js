const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Poora HTML aur App code seedha server ke andar rakha gaya hai taaki blank aane ka koi chance na rahe
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
        .modal-box { background: #fff; padding: 28px 24px; border-radius: 20px; text-align: center; width: 88%; max-width: 350px; }
        .role-btn { width: 100%; padding: 16px; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; margin-top: 10px; }
        .btn-rider { background: #e63946; }
        .btn-sawari { background: #2a9d8f; }
        .status-card { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #fff; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 700; display: none; box-shadow: 0 4px 18px rgba(0,0,0,0.18); }
        .custom-pin { width: 34px; height: 34px; border-radius: 50%; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 12px rgba(0,0,0,0.4); }
        .pin-rider { background-color: #e63946; }
        .pin-sawari { background-color: #2a9d8f; }
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

    <div class="status-card" id="statusBar"><span id="statusText">Connected</span></div>
    <div id="map"></div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script>
        let map = null, socket = null, myId = 'user_' + Math.floor(Math.random() * 1000000);
        let myRole = null, selfMarker = null, myLat = null, myLng = null;

        function handleRoleSelection(role) {
            myRole = role;
            document.getElementById('roleModal').style.display = 'none';
            startSystem();
        }

        function startSystem() {
            document.getElementById('statusBar').style.display = 'flex';
            document.getElementById('statusText.innerText') = myRole.toUpperCase() + ' Mode Active';
            
            setTimeout(() => {
                if (!map) {
                    map = L.map('map', { zoomControl: false }).setView([20.5937, 78.9629], 5);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
                }
                map.invalidateSize();
            }, 300);

            if ("geolocation" in navigator) {
                navigator.geolocation.watchPosition((pos) => {
                    myLat = pos.coords.latitude;
                    myLng = pos.coords.longitude;
                    if (map) {
                        map.setView([myLat, myLng], 16);
                        if (selfMarker) {
                            selfMarker.setLatLng([myLat, myLng]);
                        } else {
                            selfMarker = L.marker([myLat, myLng]).addTo(map);
                        }
                    }
                }, err => {}, { enableHighAccuracy: true });
            }

            socket = io({ transports: ['websocket'] });
        }
    </script>
</body>
</html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('Server running on port ' + PORT); });