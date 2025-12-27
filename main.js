// --- 0. VARIABLES GLOBALES ---
const videoSelect = document.querySelector('select#videoSource');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const titleElement = document.getElementById('title');

let localStream;
let pc;
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const signaling = new WebSocket('wss://railway-webrtc-production.up.railway.app');

// --- 1. INITIALISATION & MODE NDI ---
function initPage() {
    if (titleElement) titleElement.innerText = "Poste : " + MY_ID.toUpperCase();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('ndi')) {
        console.log("🚀 Mode NDI activé");
        document.body.classList.add('ndi-mode');
        
        // Auto-start uniquement si on est en mode NDI
        signaling.addEventListener('open', () => {
            console.log("📡 Serveur prêt, lancement de l'appel auto dans 3s...");
            setTimeout(() => {
                const btn = document.getElementById('startCall');
                if (btn) btn.click();
            }, 3000);
        });
    }
}

// --- 2. GESTION DES SOURCES VIDEO ---
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
        video: { 
            deviceId: videoSource ? { exact: videoSource } : undefined,
            width: { ideal: 1920 }, // On demande de la HD
            height: { ideal: 1080 }
        },
        audio: true
    };
    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
    } catch (e) {
        console.error("Erreur caméra:", e);
    }
}

videoSelect.onchange = startStream;

// --- 3. SIGNALEMENT ---
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

// --- 4. WEBRTC LOGIQUE ---
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
    if (signaling.readyState !== WebSocket.OPEN) return;
    
    // LISTE DES DESTINATAIRES
    // On envoie à l'ami ('paris') ET aux récepteurs OBS
    const targets = [TARGET_ID, 'obs_nantes', 'obs_paris'];
    
    console.log("🚀 Envoi du flux vers :", targets);

    for (const target of targets) {
        // IMPORTANT : On crée une connexion NEUVE pour chaque cible
        const pcTarget = new RTCPeerConnection(configuration);
        
        // On gère les candidats ICE pour cette cible précise
        pcTarget.onicecandidate = (event) => {
            if (event.candidate) {
                signaling.send(JSON.stringify({ 
                    type: 'candidate', target: target, candidate: event.candidate 
                }));
            }
        };

        // On ajoute ta caméra à cette connexion
        localStream.getTracks().forEach(track => pcTarget.addTrack(track, localStream));

        // On crée l'offre pour cette cible
        const offer = await pcTarget.createOffer();
        await pcTarget.setLocalDescription(offer);
        
        signaling.send(JSON.stringify({ 
            type: 'offer', target: target, offer: offer, from: MY_ID 
        }));
    }
};

async function handleOffer(offer, from) {
    createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: 'answer', target: from, answer: answer }));
}

// --- 5. LANCEMENT FINAL ---
initPage();
navigator.mediaDevices.ondevicechange = getDevices;
getDevices().then(startStream);