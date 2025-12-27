const myId = 'nantes'; // À changer en 'paris' sur l'autre PC
const targetId = 'paris'; // À changer en 'nantes' sur l'autre PC

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let pc;
let localStream;
const signaling = new WebSocket('wss://td-signaling-server-production.up.railway.app');

// 1. Initialisation de la caméra
async function startMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('identity').innerText = myId;
}

// 2. Connexion au serveur de signalement
signaling.onopen = () => {
    signaling.send(JSON.stringify({ type: 'login', name: myId }));
};

signaling.onmessage = async (message) => {
    const data = JSON.parse(message.data);

    switch (data.type) {
        case 'offer':
            await handleOffer(data.offer, data.from);
            break;
        case 'answer':
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
        case 'candidate':
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            break;
    }
};

// 3. Création de la connexion Peer-to-Peer
function createPeerConnection(remoteUser) {
    pc = new RTCPeerConnection(configuration);

    // Envoyer nos candidats réseau (ICE) à l'autre
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            signaling.send(JSON.stringify({
                type: 'candidate',
                target: remoteUser,
                candidate: event.candidate
            }));
        }
    };

    // Recevoir le flux vidéo de l'autre
    pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    // Ajouter notre flux local à la connexion
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
}

// 4. Lancer l'appel (Côté Nantes)
document.getElementById('startCall').onclick = async () => {
    createPeerConnection(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    signaling.send(JSON.stringify({
        type: 'offer',
        target: targetId,
        offer: offer,
        from: myId
    }));
};

// 5. Répondre à l'appel (Côté Paris)
async function handleOffer(offer, from) {
    createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    signaling.send(JSON.stringify({
        type: 'answer',
        target: from,
        answer: answer
    }));
}

startMedia();