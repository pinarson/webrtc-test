// --- 0. VARIABLES GLOBALES ---
const videoSelect = document.querySelector('select#videoSource');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const titleElement = document.getElementById('title');

let localStream;
let peerConnections = {}; 

const configuration = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ] 
};

const signaling = new WebSocket('wss://railway-webrtc-production.up.railway.app');

// --- 1. INITIALISATION ---
function initPage() {
    if (titleElement) titleElement.innerText = "Poste : " + MY_ID.toUpperCase();
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('ndi')) {
        document.body.classList.add('ndi-mode');
        signaling.onopen = () => {
            setTimeout(() => {
                const btn = document.getElementById('startCall');
                if (btn) btn.click();
            }, 3000);
        };
    }
}

// --- 2. CAPTURE VIDÉO ---
async function getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoSelect.innerHTML = '';
    devices.forEach(device => {
        if (device.kind === 'videoinput') {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Caméra ${videoSelect.length + 1}`;
            videoSelect.appendChild(option);
        }
    });
}

async function startStream() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    
    const constraints = {
        video: { 
            deviceId: videoSelect.value ? { exact: videoSelect.value } : undefined, 
            width: { ideal: 1280 }, 
            height: { ideal: 720 } 
        },
        audio: true
    };

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        console.log("✅ Caméra chargée");
    } catch (e) { 
        console.error("❌ Erreur caméra:", e); 
    }
}

videoSelect.onchange = startStream;

// --- 3. SIGNALISATION ---
signaling.onopen = () => {
    signaling.send(JSON.stringify({ type: 'login', name: MY_ID }));
    console.log("🔌 Connecté au serveur Railway");
};

signaling.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    let pc = peerConnections[data.from];

    if (data.type === 'offer') {
        await handleOffer(data.offer, data.from);
    } else if (data.type === 'answer') {
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'candidate') {
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
};

// --- 4. LOGIQUE WEBRTC ---
function createPeerConnection(target) {
    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            signaling.send(JSON.stringify({ type: 'candidate', target: target, candidate: event.candidate }));
        }
    };

    pc.ontrack = (event) => {
        if (remoteVideo) remoteVideo.srcObject = event.streams[0];
    };

    // On ajoute les pistes seulement si elles existent
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    peerConnections[target] = pc;
    return pc;
}

// --- 5. BOUTON LANCER LE DIRECT ---
document.getElementById('startCall').onclick = async () => {
    if (signaling.readyState !== WebSocket.OPEN) return;
    if (!localStream) await startStream();

    const targets = [TARGET_ID, 'obs_nantes', 'obs_paris']; 
    console.log("📢 Diffusion vers :", targets);

    for (const target of targets) {
        if (target === MY_ID) continue; // Ne pas s'appeler soi-même

        try {
            const pc = createPeerConnection(target);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            signaling.send(JSON.stringify({ 
                type: 'offer', target: target, offer: offer, from: MY_ID 
            }));
            
            console.log("📨 Offre envoyée à : " + target);
            // Petit délai pour ne pas brusquer le serveur Railway
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            console.error("❌ Erreur vers " + target, err);
        }
    }
};

async function handleOffer(offer, from) {
    const pc = createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: 'answer', target: from, answer: answer }));
}

// Lancement
initPage();
navigator.mediaDevices.ondevicechange = getDevices;
getDevices().then(startStream);