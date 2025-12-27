const videoSelect = document.querySelector('select#videoSource');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const titleElement = document.getElementById('title');

let localStream;
// REMPLACÉ : On utilise un objet pour stocker plusieurs connexions
let peerConnections = {}; 

const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const signaling = new WebSocket('wss://railway-webrtc-production.up.railway.app');

function initPage() {
    if (titleElement) titleElement.innerText = "Poste : " + MY_ID.toUpperCase();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('ndi')) {
        document.body.classList.add('ndi-mode');
        signaling.addEventListener('open', () => {
            setTimeout(() => {
                const btn = document.getElementById('startCall');
                if (btn) btn.click();
            }, 3000);
        });
    }
}

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
        video: { deviceId: videoSelect.value ? { exact: videoSelect.value } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true
    };
    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
    } catch (e) { console.error(e); }
}

videoSelect.onchange = startStream;

signaling.onopen = () => signaling.send(JSON.stringify({ type: 'login', name: MY_ID }));

signaling.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    
    // On récupère la connexion spécifique à l'envoyeur
    let pc = peerConnections[data.from];

    if (data.type === 'offer') {
        await handleOffer(data.offer, data.from);
    } else if (data.type === 'answer') {
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'candidate') {
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
};

// Modifié pour accepter un ID cible
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

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    // On enregistre cette connexion dans notre dictionnaire
    peerConnections[target] = pc;
    return pc;
}

document.getElementById('startCall').onclick = async () => {
    if (signaling.readyState !== WebSocket.OPEN) {
        console.error("❌ Serveur non connecté");
        return;
    }
    
    // On définit les cibles. Vérifiez bien l'orthographe !
    const targets = [TARGET_ID, 'obs_nantes']; 
    
    console.log("📢 DÉBUT DU BROADCAST...");

    for (const target of targets) {
        console.log("👉 Tentative d'offre vers : " + target);
        
        try {
            const pc = createPeerConnection(target);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            const message = { 
                type: 'offer', 
                target: target, 
                offer: offer, 
                from: MY_ID 
            };
            
            signaling.send(JSON.stringify(message));
            console.log("✅ Message envoyé au serveur pour : " + target);
        } catch (err) {
            console.error("❌ Échec vers " + target, err);
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

initPage();
navigator.mediaDevices.ondevicechange = getDevices;
getDevices().then(startStream);