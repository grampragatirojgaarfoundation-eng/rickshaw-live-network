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
    <title>Rickshaw Live Network - All India Enterprise</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        html, body, #map { height: 100%; width: 100%; overflow: hidden; background: #e5e3df; }

        /* Startup Selection Modal */
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.88); display: flex; justify-content: center; align-items: center; z-index: 99999; backdrop-filter: blur(8px); }
        .modal-box { background: #ffffff; padding: 28px 24px; border-radius: 20px; text-align: center; width: 88%; max-width: 350px; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
        .modal-box h2 { font-size: 22px; color: #111; margin-bottom: 6px; font-weight: 800; }
        .modal-box p { font-size: 13px; color: #666; margin-bottom: 22px; line-height: 1.4; }
        .btn-group { display: flex; flex-direction: column; gap: 14px; }
        .role-btn { padding: 16px; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; color: #ffffff; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .role-btn:active { transform: scale(0.97); }
        .btn-rider { background: #e63946; box-shadow: 0 4px 12px rgba(230, 57, 70, 0.3); }
        .btn-sawari { background: #2a9d8f; box-shadow: 0 4px 12px rgba(42, 157, 143, 0.3); }

        /* Top Live Bar */
        .status-card { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #ffffff; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 700; box-shadow: 0 4px 18px rgba(0,0,0,0.18); display: none; align-items: center; gap: 10px; }
        .badge { width: 12px; height: 12px; border-radius: 50%; }
        .badge-rider { background: #e63946; }
        .badge-sawari { background: #2a9d8f; }

        /* Global Traffic Counter (Corner Widget) */
        .traffic-counter { position: fixed; top: 14px; right: 14px; z-index: 1000; background: rgba(0, 0, 0, 0.75); color: #fff; padding: 8px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; display: none; backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }

        /* Destination Control Card */
        .dest-card { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #ffffff; padding: 12px 18px; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); font-size: 13px; font-weight: 600; color: #222; display: none; align-items: center; gap: 12px; width: 90%; max-width: 360px; justify-content: space-between; }
        .btn-reset { background: #e63946; color: white; border: none; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 700; }

        /* Marker Pin Styling (Self = Blue, Rider = Red, Sawari = Green) */
        .custom-pin { width: 34px; height: 34px; border-radius: 50%; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 12px rgba(0,0,0,0.4); }
        .pin-self { background-color: #1d4ed8; }
        .pin-rider { background-color: #e63946; }
        .pin-sawari { background-color: #2a9d8f; }
        .direction-arrow { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 16px solid #ffffff; transition: transform 0.15s linear; }
        .sawari-inner { width: 12px; height: 12px; background: #ffffff; border-radius: 50%; }
    </style>
</head>
<body>

    <div class="modal-overlay" id="roleModal">
        <div class="modal-box">
            <h2>Select Your Mode</h2>
            <p>Aap kis rup me login karna chahte hain?</p>
            <div class="btn-group">
                <button class="role-btn btn-rider" onclick="handleRoleSelection('rider')">Auto / E-Rickshaw (Rider)</button>
                <button class="role-btn btn-sawari" onclick="handleRoleSelection('sawari')">Passenger (Sawari - Free)</button>
            </div>
        </div>
    </div>

    <div class="status-card" id="statusBar">
        <div id="statusDot" class="badge"></div>
        <span id="statusText">Connecting...</span>
    </div>

    <!-- All India Traffic Counter Widget -->
    <div class="traffic-counter" id="trafficCounter">
        🌍 Riders: <span id="totalRiders">0</span> | Sawari: <span id="totalSawaris">0</span>
    </div>

    <div class="dest-card" id="destCard">
        <span id="destStatus">Map par tap karke destination set karein</span>
        <button class="btn-reset" onclick="resetDestination()">Reset Route</button>
    </div>

    <div id="map"></div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>

    <script>
        let map = null, socket = null, myId = 'user_' + Math.floor(Math.random() * 1000000);
        let myRole = null, selfMarker = null, myLat = null, myLng = null, myHeading = 0, myDestination = null;
        let destMarker = null, destLine = null, activeMarkers = {}, activeRoutes = {}, isMapCentered = false, wakeLock = null;

        function handleRoleSelection(role) {
            myRole = role;
            document.getElementById('roleModal').style.display = 'none';
            startSystem();
        }

        function getIcon(role, heading = 0, isSelf = false) {
            let bgClass = '';
            let innerElement = '';

            if (isSelf) {
                bgClass = 'pin-self'; // Khud ki location hamesha Blue
                innerElement = '<div class="direction-arrow" style="transform: rotate(' + heading + 'deg);"></div>';
            } else if (role === 'rider') {
                bgClass = 'pin-rider'; // Doosre Riders Red
                innerElement = '<div class="direction-arrow" style="transform: rotate(' + heading + 'deg);"></div>';
            } else {
                bgClass = 'pin-sawari'; // Passengers Green
                innerElement = '<div class="sawari-inner"></div>';
            }

            return L.divIcon({
                className: '',
                html: '<div class="custom-pin ' + bgClass + '">' + innerElement + '</div>',
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            });
        }

        async function requestWakeLock() {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            } catch (err) {}
        }

        function startSystem() {
            const statusBar = document.getElementById('statusBar');
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');

            statusBar.style.display = 'flex';
            document.getElementById('trafficCounter').style.display = 'block';

            if (myRole === 'rider') {
                statusDot.className = 'badge badge-rider';
                statusText.innerText = 'Rider Mode (25km - 2s Sync)';
            } else {
                statusDot.className = 'badge badge-sawari';
                statusText.innerText = 'Sawari Mode (10km - 3s Sync)';
                document.getElementById('destCard').style.display = 'flex';
            }

            setTimeout(() => {
                if (!map) {
                    map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([20.5937, 78.9629], 5);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
                    L.control.zoom({ position: 'bottomright' }).addTo(map);

                    if (myRole === 'sawari') {
                        map.on('click', setDestination);
                    }
                }
                map.invalidateSize();
            }, 300);

            requestWakeLock();
            connectSocketServer();
            startLiveGPS();

            // Dynamic Sync Interval: Rider = 2s, Sawari = 3s
            const syncIntervalTime = (myRole === 'rider') ? 2000 : 3000;
            setInterval(() => { syncPosition(); }, syncIntervalTime);
        }

        function setDestination(e) {
            if (!myLat || !myLng) return;
            myDestination = { lat: e.latlng.lat, lng: e.latlng.lng };

            if (destMarker) map.removeLayer(destMarker);
            if (destLine) map.removeLayer(destLine);

            destMarker = L.marker([myDestination.lat, myDestination.lng]).addTo(map).bindPopup('<b>Aapki Manzil</b>').openPopup();
            destLine = L.polyline([[myLat, myLng], [myDestination.lat, myDestination.lng]], { color: '#2a9d8f', weight: 4, dashArray: '6, 8' }).addTo(map);

            document.getElementById('destStatus').innerText = 'Destination Set!';
            syncPosition();
        }

        function resetDestination() {
            myDestination = null;
            if (destMarker) map.removeLayer(destMarker);
            if (destLine) map.removeLayer(destLine);
            document.getElementById('destStatus').innerText = 'Map par tap karke destination set karein';
            syncPosition();
        }

        function startLiveGPS() {
            if ("geolocation" in navigator) {
                navigator.geolocation.watchPosition(
                    (pos) => {
                        myLat = pos.coords.latitude;
                        myLng = pos.coords.longitude;
                        myHeading = pos.coords.heading || 0;

                        if (map && !isMapCentered) {
                            map.setView([myLat, myLng], 16);
                            isMapCentered = true;
                        }

                        if (map) {
                            if (selfMarker) {
                                selfMarker.setLatLng([myLat, myLng]);
                                selfMarker.setIcon(getIcon(myRole, myHeading, true)); // true matlab khud ka marker (Blue)
                            } else {
                                selfMarker = L.marker([myLat, myLng], { icon: getIcon(myRole, myHeading, true) }).addTo(map).bindPopup('<b>Aapki Location (Aap)</b>');
                            }
                        }

                        if (myDestination && destLine) {
                            destLine.setLatLngs([[myLat, myLng], [myDestination.lat, myDestination.lng]]);
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

            socket.on('connect', () => { 
                syncPosition(); 
            });

            socket.on('init_users', (users) => {
                updateTrafficCounts(users);
                for (let id in users) {
                    if (id !== myId) processIncomingUser(users[id]);
                }
            });

            socket.on('live_broadcast', (data) => { 
                if (data && data.user && data.user.id !== myId) {
                    processIncomingUser(data.user);
                }
                if (data && data.counts) {
                    document.getElementById('totalRiders').innerText = data.counts.riders;
                    document.getElementById('totalSawaris').innerText = data.counts.sawaris;
                }
            });

            socket.on('remove_user', (data) => { 
                removeUser(data.id);
                if (data && data.counts) {
                    document.getElementById('totalRiders').innerText = data.counts.riders;
                    document.getElementById('totalSawaris').innerText = data.counts.sawaris;
                }
            });
        }

        function updateTrafficCounts(users) {
            let rCount = 0, sCount = 0;
            for (let id in users) {
                if (users[id].role === 'rider') rCount++;
                if (users[id].role === 'sawari') sCount++;
            }
            document.getElementById('totalRiders').innerText = rCount;
            document.getElementById('totalSawaris').innerText = sCount;
        }

        function syncPosition() {
            if (socket && socket.connected && myLat !== null && myLng !== null) {
                socket.emit('update_location', { id: myId, role: myRole, lat: myLat, lng: myLng, heading: myHeading, destination: myDestination });
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
            if (!myLat || !myLng || !map) return;
            const distance = calculateDistance(myLat, myLng, user.lat, user.lng);
            let maxRadius = (myRole === 'rider') ? 25 : 10;

            if (myRole === 'sawari' && user.role === 'sawari') {
                removeUser(user.id);
                return;
            }

            if (distance > maxRadius) {
                removeUser(user.id);
                return;
            }

            if (activeMarkers[user.id]) {
                activeMarkers[user.id].setLatLng([user.lat, user.lng]);
                activeMarkers[user.id].setIcon(getIcon(user.role, user.heading || 0, false));
            } else {
                activeMarkers[user.id] = L.marker([user.lat, user.lng], { icon: getIcon(user.role, user.heading || 0, false) }).addTo(map)
                    .bindPopup('<b>' + user.role.toUpperCase() + '</b><br>Doori: ' + distance.toFixed(1) + ' KM');
            }

            if (myRole === 'rider' && user.role === 'sawari' && user.destination) {
                if (activeRoutes[user.id]) {
                    activeRoutes[user.id].setLatLngs([[user.lat, user.lng], [user.destination.lat, user.destination.lng]]);
                } else {
                    activeRoutes[user.id] = L.polyline([[user.lat, user.lng], [user.destination.lat, user.destination.lng]], { color: '#2a9d8f', weight: 4, dashArray: '6, 8' }).addTo(map);
                }
            }
        }

        function removeUser(id) {
            if (activeMarkers[id]) { map.removeLayer(activeMarkers[id]); delete activeMarkers[id]; }
            if (activeRoutes[id]) { map.removeLayer(activeRoutes[id]); delete activeRoutes[id]; }
        }
    </script>
</body>
</html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let activeUsers = {};

function getGlobalCounts() {
    let riders = 0;
    let sawaris = 0;
    for (let id in activeUsers) {
        if (activeUsers[id].role === 'rider') riders++;
        if (activeUsers[id].role === 'sawari') sawaris++;
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