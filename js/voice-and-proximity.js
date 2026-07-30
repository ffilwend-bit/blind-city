function makeInputSpeakable(input, label) {
  if (!input || input._speakableWired) return;
  input._speakableWired = true;
  const fieldLabel = label || input.getAttribute('aria-label') || input.placeholder || 'Champ de texte';
  let wordBuffer = '';
  // Prononciation d'un caractère isolé : on distingue clairement les MAJUSCULES
  // (sinon "A" et "a" s'entendent pareil, impossible de vérifier un code ou un
  // mot de passe sensible à la casse), et on nomme l'espace.
  const speakChar = (ch) => {
    if (ch === undefined || ch === null) return;
    if (ch === ' ') { speak('espace', 'interrupt'); return; }
    const isUpper = ch.length === 1 && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
    speak(isUpper ? `majuscule ${ch}` : ch, 'interrupt');
  };
  input.addEventListener('focus', () => {
    wordBuffer = '';
    const content = input.value ? `Contenu actuel : ${input.value}.` : 'Vide.';
    speak(`${fieldLabel}. ${content} Flèches gauche et droite pour relire caractère par caractère, flèche haut ou bas pour tout relire, Tabulation pour les boutons.`, 'interrupt');
  });
  input.addEventListener('keydown', (e) => {
    // Navigation de relecture façon NVDA : gauche/droite déplacent le curseur
    // et lisent le caractère sur lequel il arrive ; haut/bas relisent tout.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // On laisse le navigateur déplacer le curseur, puis on lit où il est.
      setTimeout(() => {
        const pos = input.selectionStart ?? 0;
        const ch = e.key === 'ArrowRight' ? input.value[pos - 1] : input.value[pos];
        if (ch === undefined) speak(e.key === 'ArrowRight' ? 'fin du texte' : 'début du texte', 'interrupt');
        else speakChar(ch);
      }, 0);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      speak(input.value ? `Contenu : ${input.value}` : 'Champ vide.', 'interrupt');
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Annonce le caractère réellement supprimé, pas juste "supprimé".
      const pos = input.selectionStart ?? 0;
      const removed = e.key === 'Backspace' ? input.value[pos - 1] : input.value[pos];
      wordBuffer = wordBuffer.slice(0, -1);
      speak(removed ? `${removed === ' ' ? 'espace' : removed} supprimé` : 'rien à supprimer', 'interrupt');
    } else if (e.key === ' ') {
      if (wordBuffer.trim()) speak(wordBuffer, 'interrupt');
      wordBuffer = '';
    } else if (e.key === 'Enter') {
      if (wordBuffer.trim()) speak(wordBuffer, 'interrupt');
      wordBuffer = '';
    } else if (e.key.length === 1) {
      // Une seule vraie touche de caractère (pas Shift, Tab, flèches...)
      wordBuffer += e.key;
      speakChar(e.key);
    }
  });
  // Relit tout le champ sur demande (utile pour vérifier avant d'envoyer).
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); speak(input.value ? `Contenu : ${input.value}` : 'Champ vide.', 'interrupt'); }
  });
}
window.makeInputSpeakable = makeInputSpeakable;

// Ancien nom conservé par compatibilité : pose simplement le focus et relie
// la narration de saisie autonome décrite ci-dessus.
function focusTextInput(input, label) {
  if (!input) return;
  makeInputSpeakable(input, label);
  input.focus();
}
window.focusTextInput = focusTextInput;


const VoiceChat = {
  pc: null,
  localStream: null,
  remoteAudioEl: null,
  callId: null,
  isCaller: false,
  pendingIce: [],
  starting: false,

  async start(callId, isCaller) {
    if (this.starting || (this.pc && this.callId === callId)) return;
    this.starting = true;
    this.stop(); // ferme toute session précédente avant d'en ouvrir une nouvelle
    this.callId = callId;
    this.isCaller = isCaller;
    try {
      this.localStream = await requestMicrophoneAccess();
    } catch (e) {
      announce('Impossible d\'accéder au micro pour la voix directe. Si l\'autorisation n\'a jamais été accordée, activez temporairement votre lecteur d\'écran pour cliquer sur Autoriser dans la fenêtre du navigateur.', 'assertive');
      this.starting = false;
      return;
    }
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
    this.pc.onicecandidate = (e) => { if (e.candidate) Net.send({ type: 'rtc_ice', callId: this.callId, data: e.candidate }); };
    this.pc.ontrack = (e) => {
      if (!this.remoteAudioEl) { this.remoteAudioEl = new (window.Audio)(); this.remoteAudioEl.autoplay = true; }
      this.remoteAudioEl.srcObject = e.streams[0];
      this.remoteAudioEl.play().catch(() => {});
      announce('Voix directe connectée.', 'polite');
    };
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        announce('La voix directe a été coupée (connexion perdue).', 'polite');
      }
    };
    if (isCaller) {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      Net.send({ type: 'rtc_offer', callId: this.callId, data: offer });
    }
    this.starting = false;
  },

  async handleOffer(callId, data) {
    // La voix se connecte désormais automatiquement dès que l'appel est actif
    // (comme un vrai appel téléphonique) : plus besoin d'activer quoi que ce
    // soit manuellement des deux côtés avant de pouvoir s'entendre.
    if (callId !== Phone.activeCallId) return;
    if (!this.pc || this.callId !== callId) await this.start(callId, false);
    if (!this.pc) return; // micro refusé/indisponible : start() a déjà annoncé l'échec, on ne peut pas continuer
    await this.pc.setRemoteDescription(new RTCSessionDescription(data));
    this.flushIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    Net.send({ type: 'rtc_answer', callId, data: answer });
  },

  async handleAnswer(callId, data) {
    if (!this.pc || this.callId !== callId) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(data));
    this.flushIce();
  },

  async handleIce(callId, data) {
    if (!this.pc || this.callId !== callId) { this.pendingIce.push(data); return; }
    try { await this.pc.addIceCandidate(new RTCIceCandidate(data)); } catch (e) { /* candidat obsolète, sans gravité */ }
  },

  flushIce() {
    while (this.pendingIce.length) {
      const c = this.pendingIce.shift();
      try { this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { /* ignore */ }
    }
  },

  stop() {
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    if (this.pc) { try { this.pc.close(); } catch (e) { /* ignore */ } this.pc = null; }
    if (this.remoteAudioEl) { this.remoteAudioEl.srcObject = null; this.remoteAudioEl = null; }
    this.callId = null; this.pendingIce = [];
  },
  // Coupe/rétablit son propre micro sans raccrocher (voir Phone.toggleMic).
  setMuted(muted) {
    if (this.localStream) this.localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
  },
};
window.VoiceChat = VoiceChat;

/* ============================================================
   VOIX DE PROXIMITÉ ET VOIX RÉELLE DU TALKIE-WALKIE
   Contrairement à VoiceChat (1 à 1, lié à un appel), ce système gère
   PLUSIEURS connexions WebRTC en parallèle ("maillage") :
   - "prox" : micro ouvert/fermé au choix (Maj+V ou bouton 🗣️ Micro),
     entendu par TOUS les joueurs proches (même principe que les
     répliques des PNJ : tout le monde dans le rayon entend), sans
     passer par un appel.
   - "talkie" : voix réelle transmise à toute la ville sur la même
     fréquence de talkie-walkie (peu importe la distance), en
     appui-pour-parler (Ctrl+V ou bouton 📻 Talkie voix), et passée
     dans un filtre qui lui donne un vrai son de radio.
   Le serveur ne relaie que la signalisation (mesh_offer/answer/ice) ;
   l'audio circule directement entre les appareils une fois connectés.
============================================================ */
function createPeerVoiceMesh(opts) {
  return {
    channel: opts.channel,
    peers: new Map(), // peerId -> { pc, pendingIce, remoteEl, audioNodes }
    localStream: null,
    micEnabled: opts.defaultMicEnabled !== false, // false pour le talkie (silence tant que le PTT n'est pas tenu)

    async ensureLocalStream() {
      if (this.localStream) return this.localStream;
      try {
        this.localStream = await requestMicrophoneAccess();
        this.localStream.getAudioTracks().forEach(t => { t.enabled = this.micEnabled; });
      } catch (e) {
        announce('Micro indisponible. Si l\'autorisation n\'a jamais été accordée, activez temporairement votre lecteur d\'écran pour cliquer sur Autoriser dans la fenêtre du navigateur.', 'assertive');
        this.localStream = null;
      }
      return this.localStream;
    },

    async connect(peerId, isOfferer) {
      if (this.peers.has(peerId)) return;
      const stream = await this.ensureLocalStream();
      if (!stream) return;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const entry = { pc, pendingIce: [], remoteEl: null, audioNodes: null };
      this.peers.set(peerId, entry);
      pc.onicecandidate = (e) => { if (e.candidate) Net.send({ type: 'mesh_ice', toId: peerId, channel: this.channel, data: e.candidate }); };
      pc.ontrack = (e) => opts.onRemoteStream(peerId, e.streams[0], entry);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.disconnect(peerId);
      };
      if (isOfferer) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        Net.send({ type: 'mesh_offer', toId: peerId, channel: this.channel, data: offer });
      }
    },

    async handleOffer(fromId, data) {
      if (!this.peers.has(fromId)) await this.connect(fromId, false);
      const entry = this.peers.get(fromId);
      if (!entry) return; // pas de micro disponible localement
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
      this.flushIce(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      Net.send({ type: 'mesh_answer', toId: fromId, channel: this.channel, data: answer });
    },

    async handleAnswer(fromId, data) {
      const entry = this.peers.get(fromId);
      if (!entry) return;
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
      this.flushIce(entry);
    },

    async handleIce(fromId, data) {
      const entry = this.peers.get(fromId);
      if (!entry) { return; }
      if (!entry.pc.remoteDescription) { entry.pendingIce.push(data); return; }
      try { await entry.pc.addIceCandidate(new RTCIceCandidate(data)); } catch (e) { /* ignore */ }
    },

    flushIce(entry) {
      while (entry.pendingIce.length) {
        const c = entry.pendingIce.shift();
        try { entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { /* ignore */ }
      }
    },

    disconnect(peerId) {
      const entry = this.peers.get(peerId);
      if (!entry) return;
      try { entry.pc.close(); } catch (e) { /* ignore */ }
      if (opts.onRemoteClose) opts.onRemoteClose(peerId, entry);
      this.peers.delete(peerId);
    },

    // Coupe/rétablit ma propre voix sans fermer les connexions (utile pour
    // l'appui-pour-parler du talkie : on reste connecté, on ne transmet que le son).
    setLocalMuted(muted) {
      this.micEnabled = !muted;
      if (this.localStream) this.localStream.getAudioTracks().forEach(t => { t.enabled = this.micEnabled; });
    },

    // Ouvre les connexions manquantes vers les pairs désirés, ferme les autres.
    // L'offreur est toujours celui dont l'identifiant réseau est le plus petit
    // (comparaison déterministe) : ainsi les deux côtés sont toujours d'accord
    // sur qui envoie l'offre, sans négociation ni conflit possible.
    evaluate(desiredIds) {
      for (const peerId of desiredIds) {
        if (!this.peers.has(peerId)) this.connect(peerId, Net.id < peerId);
      }
      for (const peerId of Array.from(this.peers.keys())) {
        if (!desiredIds.has(peerId)) this.disconnect(peerId);
      }
    },

    stopAll() {
      for (const peerId of Array.from(this.peers.keys())) this.disconnect(peerId);
      if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    },
  };
}

// Voix de proximité : lecture directe, sans filtre (comme entendre une vraie voix).
const ProxVoice = createPeerVoiceMesh({
  channel: 'prox',
  onRemoteStream(peerId, stream, entry) {
    if (!entry.remoteEl) { entry.remoteEl = new (window.Audio)(); entry.remoteEl.autoplay = true; }
    entry.remoteEl.srcObject = stream;
    entry.remoteEl.play().catch(() => {});
  },
  onRemoteClose(peerId, entry) { if (entry.remoteEl) entry.remoteEl.srcObject = null; },
});
window.ProxVoice = ProxVoice;

// Voix du talkie-walkie : passe dans un filtre passe-bande + légère saturation +
// compression pour sonner comme une vraie radio, jamais en son "propre".
const TalkieVoice = createPeerVoiceMesh({
  channel: 'talkie',
  defaultMicEnabled: false,
  onRemoteStream(peerId, stream, entry) {
    const ctx = Audio.ensure();
    const src = ctx.createMediaStreamSource(stream);
    const highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 400;
    const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 2600;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 3.2) * 0.85; }
    shaper.curve = curve; shaper.oversample = '2x';
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -26; compressor.ratio.value = 9; compressor.attack.value = 0.003; compressor.release.value = 0.12;
    const gain = ctx.createGain(); gain.gain.value = 1.5;
    src.connect(highpass).connect(lowpass).connect(shaper).connect(compressor).connect(gain).connect(Audio.master);
    entry.audioNodes = { src, highpass, lowpass, shaper, compressor, gain };
  },
  onRemoteClose(peerId, entry) {
    if (entry.audioNodes) { try { entry.audioNodes.gain.disconnect(); } catch (e) { /* ignore */ } }
  },
});
window.TalkieVoice = TalkieVoice;

const PROX_VOICE_RADIUS = 15; // même rayon que le chat RP texte
function evaluateProxVoice() {
  if (!Game.voiceOpen || !Net.connected) { if (ProxVoice.peers.size) ProxVoice.evaluate(new Set()); return; }
  const desired = new Set();
  Net.remotePlayers.forEach((p, pid) => {
    if (p.voiceOpen && UTIL.dist(Game, p) <= PROX_VOICE_RADIUS) desired.add(pid);
  });
  ProxVoice.evaluate(desired);
}
function evaluateTalkieVoice() {
  if (!Game.talkie.on || !Net.connected) { if (TalkieVoice.peers.size) TalkieVoice.evaluate(new Set()); return; }
  const desired = new Set();
  Net.remotePlayers.forEach((p, pid) => {
    if (p.talkieOn && Math.abs((p.talkieFrequency || 0) - Game.talkie.frequency) <= CONFIG.FREQ_TOLERANCE) desired.add(pid);
  });
  TalkieVoice.evaluate(desired);
}
setInterval(() => { evaluateProxVoice(); evaluateTalkieVoice(); }, 1000);

function toggleProxVoice() {
  Game.voiceOpen = !Game.voiceOpen;
  announce(Game.voiceOpen ? 'Micro de proximité activé : les gens autour de vous vous entendent.' : 'Micro de proximité coupé.', 'assertive');
  const btn = document.getElementById('touchProxMic');
  if (btn) btn.className = Game.voiceOpen ? 'touch-btn mic-btn listening' : 'touch-btn mic-btn';
  if (!Game.voiceOpen) ProxVoice.stopAll();
  else evaluateProxVoice();
}
window.toggleProxVoice = toggleProxVoice;

// Mains levées : se rendre pour qu'un autre joueur puisse vous fouiller.
// L'état est diffusé aux autres via Net.sendState() (voir champ handsUp).
function toggleHandsUp() {
  Game.handsUp = !Game.handsUp;
  announce(Game.handsUp
    ? 'Vous levez les mains. Un autre joueur à proximité peut maintenant vous fouiller.'
    : 'Vous baissez les mains.', 'assertive');
  updateHud();
}
window.toggleHandsUp = toggleHandsUp;

// Fouille d'un vrai joueur (mains levées) : demande son inventaire, puis
// propose le même menu de choix que pour un PNJ. Le retrait réel se fait côté
// cible (chacun reste maître de son propre inventaire), le serveur ne relaie
// que les messages et vérifie que la cible a bien les mains levées.
const PlayerSearch = { pendingTargetId: null };
function searchNearbyPlayer() {
  if (!Net.connected) return announce('Fouille de joueur : nécessite une connexion au serveur.', 'assertive');
  const nearby = Array.from(Net.remotePlayers.entries())
    .filter(([, p]) => p.handsUp && UTIL.dist(p, Game) < 3)
    .sort((a, b) => UTIL.dist(a[1], Game) - UTIL.dist(b[1], Game))[0];
  if (!nearby) return announce('Aucun joueur avec les mains levées à proximité.', 'assertive');
  PlayerSearch.pendingTargetId = nearby[0];
  Net.send({ type: 'search_request', targetId: nearby[0] });
  announce('Demande de fouille envoyée...', 'polite');
}
window.searchNearbyPlayer = searchNearbyPlayer;
// Reçu par la CIBLE : quelqu'un demande à me fouiller alors que j'ai les mains levées.
function onSearchRequest(fromId) {
  if (!Game.handsUp) return; // sécurité côté client aussi
  Net.send({ type: 'search_data', targetId: fromId, data: { money: Game.money, inventory: Game.inventory || [] } });
}
// Reçu par le FOUILLEUR : voici l'inventaire de la cible, on ouvre le menu de choix.
function onSearchData(fromId, data) {
  openSearchMenu({ name: 'ce joueur', money: data.money || 0, inventory: data.inventory || [], remotePlayerId: fromId });
}
// Reçu par la CIBLE : le fouilleur a pris tel objet/montant, on se l'enlève réellement.
function onLootTake(data) {
  if (data.kind === 'money') Game.money = Math.max(0, Game.money - data.amount);
  else if (data.kind === 'item' && Game.inventory) {
    const it = Game.inventory.find(i => i.id === data.itemId);
    if (it) { it.q -= data.amount; if (it.q <= 0) Game.inventory = Game.inventory.filter(i => i !== it); }
  }
  updateHud();
}
window.onSearchRequest = onSearchRequest; window.onSearchData = onSearchData; window.onLootTake = onLootTake;

let talkiePTTHeld = false;
function talkieVoiceStart() {
  if (talkiePTTHeld) return;
  if (!Game.talkie.owned || !Game.talkie.on) { announce('Allumez d\'abord votre talkie-walkie.', 'assertive'); return; }
  talkiePTTHeld = true;
  evaluateTalkieVoice();
  TalkieVoice.setLocalMuted(false);
  const btn = document.getElementById('touchTalkieVoice'); if (btn) btn.classList.add('listening');
  announce(`Micro talkie ouvert sur ${Game.talkie.frequency.toFixed(3)} mégahertz.`, 'polite');
}
function talkieVoiceStop() {
  if (!talkiePTTHeld) return;
  talkiePTTHeld = false;
  TalkieVoice.setLocalMuted(true);
  const btn = document.getElementById('touchTalkieVoice'); if (btn) btn.classList.remove('listening');
}
window.talkieVoiceStart = talkieVoiceStart; window.talkieVoiceStop = talkieVoiceStop;

