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
    connecting: new Set(), // peerId en cours de connexion (évite les connect() en double)
    localStream: null,
    micEnabled: opts.defaultMicEnabled !== false, // false pour le talkie (silence tant que le PTT n'est pas tenu)
    micFailedAt: 0, // dernier échec de getUserMedia, pour temporiser les nouvelles tentatives
    micFailAnnounced: false, // l'échec n'est annoncé QU'UNE fois, pas à chaque joueur qui passe à proximité

    async ensureLocalStream() {
      if (this.localStream) return this.localStream;
      // Source non-microphone (ex. MusicVoice, qui capture la lecture de
      // MusicPlayer) : rien à demander comme permission, pas de message
      // "micro indisponible" qui n'aurait aucun sens ici.
      if (opts.getLocalStream) { this.localStream = opts.getLocalStream() || null; return this.localStream; }
      // evaluate() tourne toutes les secondes : sans temporisation, un micro
      // indisponible (permission refusée, périphérique déjà utilisé...) faisait
      // retenter getUserMedia() CHAQUE seconde, indéfiniment.
      const now = Date.now();
      if (now - this.micFailedAt < 8000) return null;
      try {
        this.localStream = await requestMicrophoneAccess();
        this.localStream.getAudioTracks().forEach(t => { t.enabled = this.micEnabled; });
        this.micFailedAt = 0;
        this.micFailAnnounced = false;
      } catch (e) {
        this.micFailedAt = now;
        this.localStream = null;
        // Sans autorisation déjà accordée, chaque joueur qui passait à
        // proximité relançait une tentative (toutes les 8 s tant qu'il
        // restait là) et réannonçait l'échec en boucle — on ne le dit
        // qu'UNE fois par activation du micro ; les tentatives silencieuses
        // continuent en arrière-plan au cas où l'autorisation serait
        // accordée entre-temps.
        if (!this.micFailAnnounced) {
          this.micFailAnnounced = true;
          announce('Micro indisponible. Si l\'autorisation n\'a jamais été accordée, activez temporairement votre lecteur d\'écran pour cliquer sur Autoriser dans la fenêtre du navigateur.', 'assertive');
        }
      }
      return this.localStream;
    },

    async connect(peerId, isOfferer) {
      // Garde anti-doublon : evaluate() peut être rappelé (toutes les secondes)
      // avant qu'un connect() précédent pour ce même pair n'ait fini d'attendre
      // le micro — sans ça, chaque tick relançait un getUserMedia() concurrent
      // en plus du précédent, encore jamais terminé.
      if (this.peers.has(peerId) || this.connecting.has(peerId)) return;
      this.connecting.add(peerId);
      let stream = null;
      try {
        // La toute première connexion d'une session peut survenir avant que
        // /ice-servers (voir menus-and-ui.js loadIceServers) ait répondu —
        // sans cette attente, ICE_SERVERS ne contient encore que le repli
        // local (STUN + TURN gratuit openrelay, sans le relais Cloudflare),
        // moins fiable sur données mobiles/CGNAT. Plafonnée à 4 s, ne bloque
        // donc jamais durablement une tentative de connexion.
        if (window.iceServersReady) await window.iceServersReady;
        // On ne réclame le micro (et sa permission navigateur) QUE si on a
        // réellement l'intention d'émettre sur ce canal (opts.wantsToSend —
        // pour ProxVoice, Game.voiceOpen). Sans ça, un joueur qui n'a JAMAIS
        // activé son propre micro se voyait quand même demander la
        // permission micro dès qu'un joueur proche parlait — juste pour
        // pouvoir l'ÉCOUTER. On peut recevoir de l'audio sans en envoyer
        // (transceiver recvonly plus bas), donc pas besoin de micro local
        // pour ça.
        const wantsToSend = opts.wantsToSend ? opts.wantsToSend() : true;
        if (wantsToSend) {
          stream = await this.ensureLocalStream();
          if (!stream) return; // on voulait émettre mais le micro a échoué : comportement inchangé, on annule
        }
      } finally { this.connecting.delete(peerId); }
      if (this.peers.has(peerId)) return; // connecté entre-temps par l'autre côté
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      // Écoute seule (pas de micro voulu ici) : un transceiver recvonly
      // permet de recevoir l'audio de l'autre côté sans jamais rien envoyer,
      // sans avoir eu besoin du moindre accès micro local.
      if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
      else if (pc.addTransceiver) pc.addTransceiver('audio', { direction: 'recvonly' });
      // sending : mémorise si CETTE connexion a été ouverte avec ma propre
      // piste micro ou en pure écoute — sert à evaluateProxVoice/toggleProxVoice
      // pour savoir quelles connexions ré-ouvrir quand j'active mon micro
      // après coup (une connexion recvonly ne se transforme pas toute seule
      // en sendrecv si je décide de parler plus tard).
      const entry = { pc, pendingIce: [], remoteEl: null, audioNodes: null, announcedState: null, sending: !!stream };
      this.peers.set(peerId, entry);
      pc.onicecandidate = (e) => { if (e.candidate) Net.send({ type: 'mesh_ice', toId: peerId, channel: this.channel, data: e.candidate }); };
      pc.ontrack = (e) => opts.onRemoteStream(peerId, e.streams[0], entry);
      // Diagnostic vocal manquant jusque-là : la connexion échouait EN
      // SILENCE (juste this.disconnect(peerId), aucun retour). Impossible de
      // distinguer "ça sonne mais personne ne parle" de "la connexion audio
      // n'a jamais abouti" — d'où des signalements de micro muet sans piste
      // pour savoir où ça coince réellement. Pour le canal 'prox'
      // uniquement (celui qu'on essaie de diagnostiquer, pour ne pas noyer
      // le talkie/la musique d'annonces).
      //
      // pc.connectionState (utilisé seul jusqu'ici) n'est PAS fiable sur tous
      // les navigateurs/versions (certains Safari/iOS et WebView Android plus
      // anciens ne le déclenchent jamais, ou le laissent bloqué à "new") — ce
      // qui expliquerait un signalement "aucune des deux annonces jamais
      // entendue" même si la négociation ICE, elle, aboutit bien ou échoue
      // bien. pc.oniceconnectionstatechange (iceConnectionState) existe
      // depuis les tout débuts de WebRTC et reste le signal le plus
      // largement supporté : on écoute désormais les DEUX évènements, avec
      // un verrou (entry.announcedState) pour ne jamais annoncer deux fois
      // la même transition si les deux se déclenchent pour le même état.
      const reportState = (state) => {
        if (state === entry.announcedState) return;
        if (state !== 'connected' && state !== 'failed') return; // seuls ces deux états nous intéressent ici
        entry.announcedState = state;
        if (this.channel === 'prox') {
          const p = Net.remotePlayers.get(peerId);
          const name = p ? `${p.firstName} ${p.lastName}` : 'un joueur proche';
          if (state === 'connected') announce(`Connexion audio établie avec ${name}.`, 'polite');
          else announce(`Connexion audio impossible avec ${name} (échec réseau).`, 'polite');
        }
        if (state === 'failed') this.disconnect(peerId);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' || pc.connectionState === 'failed') reportState(pc.connectionState);
        if (pc.connectionState === 'closed') this.disconnect(peerId);
      };
      pc.oniceconnectionstatechange = () => {
        // 'completed' compte comme connecté (ICE a fini de vérifier toutes
        // les paires de candidats, l'audio circule déjà depuis 'connected').
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') reportState('connected');
        else if (pc.iceConnectionState === 'failed') reportState('failed');
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
      // Pas de micro disponible localement (permission refusée, périphérique
      // occupé...) : avant, l'offre était jetée EN SILENCE — l'offreur restait
      // bloqué à attendre indéfiniment une réponse qui n'arriverait jamais,
      // sans le moindre indice de son côté pour comprendre pourquoi. On
      // prévient maintenant explicitement l'offreur (mesh_reject) pour qu'il
      // puisse l'annoncer et arrêter d'attendre.
      if (!entry) { Net.send({ type: 'mesh_reject', toId: fromId, channel: this.channel }); return; }
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
      this.flushIce(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      Net.send({ type: 'mesh_answer', toId: fromId, channel: this.channel, data: answer });
    },

    // Reçu par l'OFFREUR : le pair visé n'a pas pu répondre (pas de micro
    // disponible de son côté). On avait déjà créé notre propre entrée dans
    // this.peers en envoyant l'offre (voir connect() ci-dessus) — on la
    // referme proprement au lieu de la laisser pendre indéfiniment.
    onRejected(peerId) {
      if (this.channel === 'prox') {
        const p = Net.remotePlayers.get(peerId);
        const name = p ? `${p.firstName} ${p.lastName}` : 'un joueur proche';
        announce(`Connexion audio impossible avec ${name} (micro indisponible de son côté).`, 'polite');
      }
      this.disconnect(peerId);
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
    // L'offreur est normalement celui dont l'identifiant réseau est le plus
    // petit (comparaison déterministe) : quand les DEUX côtés désirent la
    // connexion (cas symétrique classique, micro ouvert des deux côtés), ça
    // suffit à départager sans négociation ni conflit possible.
    //
    // forceOffererIds (optionnel) : pour ProxVoice, désirer un pair peut
    // désormais être asymétrique — j'écoute quelqu'un qui diffuse sans avoir
    // moi-même mon micro ouvert. Dans ce cas, LUI ne me désire pas de son
    // côté (son propre calcul ne me voit pas comme diffuseur) : il n'appelle
    // donc jamais connect() vers moi, et si l'ordre des identifiants me
    // désignait comme répondeur, personne n'enverrait jamais d'offre — la
    // connexion resterait bloquée pour toujours. Pour ces pairs-là, je dois
    // être l'offreur inconditionnellement, peu importe l'ordre des identifiants.
    evaluate(desiredIds, forceOffererIds) {
      for (const peerId of desiredIds) {
        if (!this.peers.has(peerId)) {
          const isOfferer = (forceOffererIds && forceOffererIds.has(peerId)) ? true : Net.id < peerId;
          this.connect(peerId, isOfferer);
        }
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

// Voix de proximité : sans filtre de timbre (comme entendre une vraie voix),
// mais routée par le graphe Web Audio (comme TalkieVoice ci-dessous) pour
// pouvoir faire varier le volume ET le panoramique EN DIRECT selon la
// distance/position réelles — avant, un <audio> lu à volume fixe ne faisait
// AUCUNE différence entre quelqu'un juste à côté et quelqu'un à la limite du
// rayon d'écoute, puis la connexion se fermait d'un coup en sortant du rayon
// (comme un appel qui raccroche), au lieu de s'estomper progressivement.
const ProxVoice = createPeerVoiceMesh({
  channel: 'prox',
  // Je n'émets (et ne réclame le micro) que si MON micro de proximité est
  // activé — voir evaluateProxVoice ci-dessous : on peut désormais désirer
  // une connexion uniquement pour ÉCOUTER quelqu'un qui diffuse, sans avoir
  // ouvert le sien (connect() bascule alors sur un transceiver recvonly).
  wantsToSend: () => Game.voiceOpen,
  onRemoteStream(peerId, stream, entry) {
    const ctx = Audio.ensure();
    const src = ctx.createMediaStreamSource(stream);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gain = ctx.createGain(); gain.gain.value = 1;
    if (panner) src.connect(panner).connect(gain).connect(Audio.master);
    else src.connect(gain).connect(Audio.master);
    entry.audioNodes = { src, panner, gain };
  },
  onRemoteClose(peerId, entry) {
    if (entry.audioNodes) { try { entry.audioNodes.gain.disconnect(); } catch (e) { /* ignore */ } }
  },
});
window.ProxVoice = ProxVoice;
// Volume ET panoramique mis à jour en direct selon la distance/position
// réelle de chaque pair connecté — appelé au même rythme qu'evaluateProxVoice
// (voir plus bas). Estompage progressif jusqu'au bord du rayon d'écoute
// plutôt qu'un volume constant suivi d'une coupure nette.
function updateProxVoiceSpatial() {
  ProxVoice.peers.forEach((entry, peerId) => {
    if (!entry.audioNodes) return;
    const p = Net.remotePlayers.get(peerId);
    if (!p) return;
    const d = UTIL.dist(Game, p);
    const ctx = Audio.ensure();
    const now = ctx.currentTime;
    entry.audioNodes.gain.gain.setTargetAtTime(UTIL.clamp(1 - d / PROX_VOICE_RADIUS, 0.05, 1), now, 0.2);
    if (entry.audioNodes.panner) entry.audioNodes.panner.pan.setTargetAtTime(Game.panForPoint(p.x, p.y), now, 0.2);
  });
}

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

// Musique personnelle (MusicPlayer) diffusée aux joueurs réels à portée —
// avant, elle ne jouait QUE chez celui qui l'avait lancée : personne d'autre
// ne l'entendait, enceinte fixe ou radio portable. Même mécanisme que
// ProxVoice/TalkieVoice (maillage WebRTC), mais la "voix" locale envoyée est
// captée depuis la lecture de MusicPlayer (HTMLMediaElement.captureStream)
// au lieu du microphone — rien à autoriser, pas de message d'erreur micro.
const MusicVoice = createPeerVoiceMesh({
  channel: 'music',
  getLocalStream: () => (window.MusicPlayer && MusicPlayer.audioEl && MusicPlayer.audioEl.captureStream) ? MusicPlayer.audioEl.captureStream() : null,
  onRemoteStream(peerId, stream, entry) {
    const ctx = Audio.ensure();
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain(); gain.gain.value = 0.5;
    src.connect(gain).connect(Audio.master);
    entry.audioNodes = { src, gain };
  },
  onRemoteClose(peerId, entry) {
    if (entry.audioNodes) { try { entry.audioNodes.gain.disconnect(); } catch (e) { /* ignore */ } }
  },
});
window.MusicVoice = MusicVoice;
// Même rayon d'atténuation que MusicPlayer.updateSpatialGain() (dehors), pour
// rester cohérent entre ce qu'entend celui qui diffuse et ceux qui écoutent.
const MUSIC_VOICE_RADIUS = 25;
function evaluateMusicVoice() {
  if (!window.MusicPlayer || !MusicPlayer.playing || typeof Net === 'undefined' || !Net.connected) {
    if (MusicVoice.peers.size) MusicVoice.evaluate(new Set());
    return;
  }
  // Position de la source : l'enceinte fixe (maison), sinon le joueur
  // lui-même (radio portable/autoradio, qui le suit partout).
  const src = (MusicPlayer.sourceRef && MusicPlayer.sourceRef.house) ? MusicPlayer.sourceRef.house : Game;
  const desired = new Set();
  Net.remotePlayers.forEach((p, pid) => { if (UTIL.dist(src, p) <= MUSIC_VOICE_RADIUS) desired.add(pid); });
  MusicVoice.evaluate(desired);
  MusicVoice.peers.forEach((entry, peerId) => {
    if (!entry.audioNodes) return;
    const p = Net.remotePlayers.get(peerId);
    if (!p) return;
    const ctx = Audio.ensure();
    entry.audioNodes.gain.gain.setTargetAtTime(MusicPlayer.volume * Math.max(0, 1 - UTIL.dist(src, p) / MUSIC_VOICE_RADIUS), ctx.currentTime, 0.3);
  });
}

// Type de connexion réseau (Wi-Fi / données mobiles) : utile pour diagnostiquer
// soi-même pourquoi la voix de proximité passe ou pas — en données mobiles, le
// lien direct échoue souvent (NAT symétrique/CGNAT) et tout repose sur le
// relais TURN de secours (voir ICE_SERVERS), moins fiable. Repose sur l'API
// Network Information, pas disponible partout (Firefox, Safari/iOS ne
// l'implémentent pas) : dans ce cas on l'indique clairement au lieu de deviner.
function getNetworkTypeLabel() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn || !conn.type) return null;
  const labels = { wifi: 'Wi-Fi', cellular: 'données mobiles', ethernet: 'câble Ethernet', bluetooth: 'Bluetooth', wimax: 'WiMAX', none: 'hors ligne', other: 'connexion inconnue', unknown: 'connexion inconnue' };
  return labels[conn.type] || null;
}
window.getNetworkTypeLabel = getNetworkTypeLabel;

// Revenu à la valeur d'origine (15 cases, 60 m) à la demande, après deux
// réductions (60 -> 20 -> 40 m) qui n'ont pas réglé le vrai problème
// signalé : silence TOTAL même juste à côté de l'autre joueur (distance
// quasi nulle). Or le calcul de volume ci-dessous (updateProxVoiceSpatial)
// donne un gain MAXIMAL (1 - d/RADIUS ≈ 1) quand d ≈ 0, quel que soit
// RADIUS — la portée ne peut donc PAS expliquer un silence à bout portant.
// Le vrai coupable est ailleurs (connexion WebRTC qui ne s'établit jamais,
// ou permission micro jamais réellement accordée d'un côté ou de l'autre)
// — remis à 60 m pour retirer complètement la distance de l'équation
// pendant qu'on isole la vraie cause.
const PROX_VOICE_RADIUS = 15;
// Diagnostic supplémentaire : si personne à portée n'a désiré de connexion
// (donc ProxVoice.connect() n'est JAMAIS appelé), aucune des deux annonces
// "Connexion établie/impossible" ci-dessus ne peut se déclencher — silence
// total, sans le moindre indice pour distinguer "vraiment seul" de "l'autre
// joueur croit avoir activé son micro mais ça n'a pas marché de son côté".
// On ne l'annonce qu'UNE fois par entrée dans cet état (pas à chaque tick).
let proxReachabilityAnnounced = false;
// Écoute désormais indépendante de mon PROPRE micro : je peux entendre un
// joueur proche qui diffuse (p.voiceOpen) même si Game.voiceOpen est faux
// chez moi — je ne fais qu'écouter, sans jamais émettre ni réclamer de
// permission micro pour ça (voir wantsToSend sur ProxVoice et le transceiver
// recvonly dans connect()). Mon propre Game.voiceOpen ne contrôle donc plus
// que si LES AUTRES m'entendent, pas si MOI j'entends les autres.
function evaluateProxVoice() {
  if (!Net.connected) { if (ProxVoice.peers.size) ProxVoice.evaluate(new Set()); proxReachabilityAnnounced = false; return; }
  const desired = new Set();
  // Pairs où JE dois forcément être l'offreur : je les désire (ils
  // diffusent) mais je n'émets pas moi-même, donc EUX ne me désirent pas de
  // leur côté et n'enverront jamais d'offre en premier (voir evaluate() plus
  // haut) — sans ça la connexion resterait bloquée indéfiniment.
  const listenOnly = new Set();
  const nearbyMicOff = [];
  Net.remotePlayers.forEach((p, pid) => {
    const d = UTIL.dist(Game, p);
    if (d > PROX_VOICE_RADIUS) return;
    if (p.voiceOpen) {
      desired.add(pid);
      if (!Game.voiceOpen) listenOnly.add(pid);
    } else if (Game.voiceOpen) {
      nearbyMicOff.push(p);
    }
  });
  ProxVoice.evaluate(desired, listenOnly);
  updateProxVoiceSpatial();
  // Ce diagnostic ne concerne que mon PROPRE micro (activé mais personne à
  // portée ne peut donc m'entendre) : n'a de sens que si Game.voiceOpen est
  // activé — écouter sans émettre n'a pas besoin de cet avertissement.
  if (Game.voiceOpen && desired.size === 0 && nearbyMicOff.length) {
    if (!proxReachabilityAnnounced) {
      proxReachabilityAnnounced = true;
      const names = nearbyMicOff.slice(0, 3).map(p => `${p.firstName} ${p.lastName}`).join(', ');
      const plural = nearbyMicOff.length > 1;
      announce(`${names} ${plural ? 'sont à portée mais n\'ont pas activé leur' : 'est à portée mais n\'a pas activé son'} micro de proximité.`, 'polite');
    }
  } else {
    proxReachabilityAnnounced = false;
  }
}
function evaluateTalkieVoice() {
  if (!Game.talkie.on || !Net.connected) { if (TalkieVoice.peers.size) TalkieVoice.evaluate(new Set()); return; }
  const desired = new Set();
  Net.remotePlayers.forEach((p, pid) => {
    if (p.talkieOn && Math.abs((p.talkieFrequency || 0) - Game.talkie.frequency) <= CONFIG.FREQ_TOLERANCE) desired.add(pid);
  });
  TalkieVoice.evaluate(desired);
}
setInterval(() => { evaluateProxVoice(); evaluateTalkieVoice(); evaluateMusicVoice(); }, 1000);

function toggleProxVoice() {
  Game.voiceOpen = !Game.voiceOpen;
  let msg = Game.voiceOpen
    ? 'Micro de proximité activé : les gens autour de vous vous entendent.'
    : 'Micro de proximité coupé : vous ne serez plus entendu, mais vous pouvez toujours entendre les joueurs proches qui ont le leur activé.';
  if (Game.voiceOpen) {
    const netType = getNetworkTypeLabel();
    msg += netType ? ` Votre connexion : ${netType}.` : ' Type de connexion non détectable par ce navigateur.';
  }
  announce(msg, 'assertive');
  const btn = document.getElementById('touchProxMic');
  if (btn) btn.className = Game.voiceOpen ? 'touch-btn mic-btn listening' : 'touch-btn mic-btn';
  // On ne ferme plus TOUTES les connexions en coupant son micro (stopAll) :
  // on peut désormais continuer à ÉCOUTER les joueurs proches qui diffusent
  // encore (voir evaluateProxVoice / wantsToSend). setLocalMuted coupe
  // seulement l'émission, immédiatement (sans attendre jusqu'à 1 s que le
  // prochain cycle evaluate() s'en aperçoive côté des autres joueurs).
  ProxVoice.setLocalMuted(!Game.voiceOpen);
  if (Game.voiceOpen) {
    ProxVoice.micFailAnnounced = false; // nouvelle activation volontaire : redonner une chance à l'annonce d'échec
    // Les connexions déjà ouvertes en pure écoute (entry.sending === false,
    // ouvertes avant que j'active mon micro) ne se transforment pas toutes
    // seules en connexions à double sens : on les referme pour qu'elles se
    // rouvrent avec ma piste micro cette fois, sinon je resterais entendu
    // par personne sur ces connexions précises tant qu'elles ne se coupent
    // pas d'elles-mêmes (changement de distance, déconnexion...).
    ProxVoice.peers.forEach((entry, peerId) => { if (!entry.sending) ProxVoice.disconnect(peerId); });
  }
  evaluateProxVoice();
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

// Libère un VRAI joueur piégé après avoir volé le véhicule d'un PNJ de
// circulation (voir Game.enterAsDriver / stuckInVehicle) : simple relais
// serveur, comme la fouille — c'est le joueur piégé qui reste seul maître de
// son propre état, on ne fait que le prévenir qu'on est venu l'aider.
function helpFreeTrappedPlayer(targetId, targetName) {
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  Net.send({ type: 'free_from_vehicle', targetId });
  announce(`Vous ouvrez la portière de l'extérieur pour libérer ${targetName || 'cette personne'}.`, 'assertive');
}
window.helpFreeTrappedPlayer = helpFreeTrappedPlayer;
// Reçu par le joueur PIÉGÉ : quelqu'un vient de le libérer depuis l'extérieur.
function onFreedFromVehicle(fromName) {
  if (!Game.stuckInVehicle) return;
  Game.stuckInVehicle = false;
  announce(`${fromName || 'Quelqu\'un'} vous libère : les portières se déverrouillent. Vous pouvez de nouveau sortir du véhicule.`, 'assertive');
  updateHud();
}
window.onFreedFromVehicle = onFreedFromVehicle;

// Reçu par le joueur VISÉ : un autre vrai joueur, arme sortie, vient de le
// verrouiller comme cible (voir Game.target). Son distinct pour être
// reconnu immédiatement, façon avertissement de verrouillage — permet de
// réagir (fuir, se planquer, riposter) au lieu de se faire tirer dessus sans
// le moindre signe avant-coureur.
function onPlayerTargetedMe(fromName) {
  if (window.Audio && Audio.targetedWarning) Audio.targetedWarning(0);
  // Priorité 'combat' : cette alerte est vitale, elle ne doit jamais rester
  // coincée derrière une annonce 'assertive' moins urgente déjà en attente
  // (santé, faim...) pendant que quelqu'un vous vise.
  announce(`${fromName || 'Quelqu\'un'} vous vise avec une arme !`, 'combat');
}
window.onPlayerTargetedMe = onPlayerTargetedMe;

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

