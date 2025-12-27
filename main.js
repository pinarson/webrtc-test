// Détection du mode NDI
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('ndi')) {
    document.body.classList.add('ndi-mode');
}

// Optionnel : Lancement automatique si mode NDI
if (urlParams.has('ndi')) {
    signaling.addEventListener('open', () => {
        setTimeout(() => {
            console.log("Auto-start NDI...");
            document.getElementById('startCall').click();
        }, 2000);
    });
}

const videoSelect = document.querySelector('select#videoSource');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
document.getElementById('title').innerText = "Poste : " + MY_ID.toUpperCase();

let localStream;
let pc;
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const signaling = new WebSocket('wss://railway-webrtc-production.up.railway.app');

// --- 1. GESTION DES SOURCES VIDEO ---
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
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    const videoSource = videoSelect.value;
    const constraints = {
        video: { deviceId: videoSource ? { exact: videoSource } : undefined },
        audio: true
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
}

videoSelect.onchange = startStream;

// --- 2. SIGNALEMENT ---
signaling.onopen = () => {
    signaling.send(JSON.stringify({ type: 'login', name: MY_ID }));
};

signaling.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    if (data.type === 'offer') {
        await handleOffer(data.offer, data.from);
    } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'candidate') {
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
};

// --- 3. WEBRTC ---
function createPeerConnection(target) {
    pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            signaling.send(JSON.stringify({ type: 'candidate', target: target, candidate: event.candidate }));
        }
    };

    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
}

document.getElementById('startCall').onclick = async () => {
    if (signaling.readyState !== WebSocket.OPEN) {
        alert("Le serveur de signalement n'est pas encore prêt. Attendez 2 secondes.");
        return;
    }
    
    console.log("Tentative d'appel vers :", TARGET_ID);
    createPeerConnection(TARGET_ID);
    
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.send(JSON.stringify({ 
            type: 'offer', 
            target: TARGET_ID, 
            offer: offer, 
            from: MY_ID 
        }));
    } catch (err) {
        console.error("Erreur lors de la création de l'offre :", err);
    }
};

async function handleOffer(offer, from) {
    createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: 'answer', target: from, answer: answer }));
}

// Lancement
navigator.mediaDevices.ondevicechange = getDevices;
getDevices().then(startStream);