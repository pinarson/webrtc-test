// --- 0. VARIABLES GLOBALES ---
const videoSelect = document.querySelector('select#videoSource');
const audioSelect = document.querySelector('select#audioSource'); // Ajout micro
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const titleElement = document.getElementById('title');

let localStream;
let peerConnections = {}; 
let watchdogTimers = {}; // Pour la relance auto

const configuration = { 
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] 
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

// --- 2. CAPTURE VIDÉO & AUDIO ---
async function getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (videoSelect) videoSelect.innerHTML = '';
    if (audioSelect) audioSelect.innerHTML = '';

    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        if (device.kind === 'videoinput' && videoSelect) {
            option.text = device.label || `Caméra ${videoSelect.length + 1}`;
            videoSelect.appendChild(option);
        } else if (device.kind === 'audioinput' && audioSelect) {
            option.text = device.label || `Micro ${audioSelect.length + 1}`;
            audioSelect.appendChild(option);
        }
    });
}

async function startStream() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    
    const constraints = {
        video: { 
            deviceId: videoSelect?.value ? { exact: videoSelect.value } : undefined, 
            width: { ideal: 1920 }, height: { ideal: 1080 } 
        },
        audio: { deviceId: audioSelect?.value ? { exact: audioSelect.value } : undefined }
    };

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        console.log("✅ Caméra & Micro chargés");

        // Switch à chaud si déjà connecté
        Object.values(peerConnections).forEach(pc => {
            localStream.getTracks().forEach(track => {
                const sender = pc.getSenders().find(s => s.track.kind === track.kind);
                if (sender) sender.replaceTrack(track);
            });
        });
    } catch (e) { console.error("❌ Erreur média:", e); }
}

if (videoSelect) videoSelect.onchange = startStream;
if (audioSelect) audioSelect.onchange = startStream;

// --- 3. SIGNALISATION ---
signaling.onopen = () => {
    signaling.send(JSON.stringify({ type: 'login', name: MY_ID }));
    console.log("🔌 Connecté au serveur Railway");
};

signaling.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    let pc = peerConnections[data.from];

    if (data.type === 'offer') {
        console.log("📩 Offre reçue de :", data.from);
        await handleOffer(data.offer, data.from);
    } else if (data.type === 'answer') {
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'candidate') {
        if (pc && pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {});
    }
};

// --- 4. LOGIQUE WEBRTC AVEC WATCHDOG ---
function createPeerConnection(target) {
    if (peerConnections[target]) peerConnections[target].close();

    const pc = new RTCPeerConnection(configuration);
    
    // WATCHDOG : Relance si déco > 5s
    pc.onconnectionstatechange = () => {
        console.log(`Statut [${target}]: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
            clearTimeout(watchdogTimers[target]);
            watchdogTimers[target] = null;
        } else if (['failed', 'disconnected'].includes(pc.connectionState)) {
            if (!watchdogTimers[target]) {
                watchdogTimers[target] = setTimeout(() => {
                    console.log(`🔄 Relance auto vers ${target}...`);
                    document.getElementById('startCall').click();
                }, 5000);
            }
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            signaling.send(JSON.stringify({ type: 'candidate', target: target, candidate: event.candidate }));
        }
    };

    pc.ontrack = (event) => {
        console.log("🎬 Flux reçu de :", target);
        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.warn("Attente interaction utilisateur pour le son"));
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    peerConnections[target] = pc;
    return pc;
}

// --- 5. DIFFUSION ---
document.getElementById('startCall').onclick = async () => {
    if (signaling.readyState !== WebSocket.OPEN) return;
    if (!localStream) await startStream();

    // FILTRE DES CIBLES : On envoie seulement à l'autre et aux récepteurs concernés
    const targets = [TARGET_ID, 'obs_paris', 'obs_nantes'].filter(id => id !== MY_ID);
    
    for (const target of targets) {
        try {
            const pc = createPeerConnection(target);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            signaling.send(JSON.stringify({ type: 'offer', target, offer, from: MY_ID }));
            await new Promise(r => setTimeout(r, 200));
        } catch (err) { console.error("❌ Erreur vers " + target, err); }
    }
};

async function handleOffer(offer, from) {
    const pc = createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: 'answer', target: from, answer, from: MY_ID }));
}

initPage();
getDevices().then(startStream);