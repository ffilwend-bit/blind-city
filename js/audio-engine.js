/* ============================================================
   AUDIO ENGINE — spatial audio, TTS, procedural sound effects
   All sounds are synthesized locally; no external files needed.
============================================================ */
const Audio = {
  ctx: null,
  master: null,
  engine: { osc: null, gain: null, filter: null, active: false },
  road: { src: null, gain: null, pan: null, active: false },
  ambient: { src: null, gain: null },
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone({ freq = 440, type = 'sine', duration = 0.2, gain = 0.12, pan = 0, attack = 0.01, release = 0.15, fm = false }) {
    const c = this.ensure();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (fm) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 8 + Math.random() * 6;
      lg.gain.value = freq * 0.03;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t); lfo.stop(t + duration + release);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration + release);
    osc.connect(g); g.connect(p || this.master);
    if (p) { p.pan.value = pan; p.connect(this.master); }
    osc.start(t); osc.stop(t + duration + release + 0.02);
    return { osc, gain: g };
  },
  noise({ duration = 0.2, gain = 0.12, pan = 0, filterFreq = 1500, attack = 0.01, release = 0.15 } = {}) {
    const c = this.ensure();
    const t = c.currentTime;
    const len = Math.ceil(c.sampleRate * (duration + release + 0.05));
    const buffer = c.createBuffer(1, len, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = 0.8;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration + release);
    src.connect(f); f.connect(g); g.connect(p || this.master);
    if (p) { p.pan.value = pan; p.connect(this.master); }
    src.start(t); src.stop(t + duration + release + 0.05);
    return { src, gain: g };
  },
  playEngine(cls, speed) {
    const c = this.ensure();
    if (!this.engine.osc) {
      this.engine.osc = c.createOscillator();
      this.engine.gain = c.createGain();
      this.engine.filter = c.createBiquadFilter();
      this.engine.pan = c.createStereoPanner ? c.createStereoPanner() : null;
      this.engine.osc.type = cls.wave || 'sawtooth';
      this.engine.osc.frequency.value = cls.baseFreq || 50;
      this.engine.gain.gain.value = 0;
      this.engine.filter.type = 'lowpass'; this.engine.filter.frequency.value = 800;
      this.engine.osc.connect(this.engine.filter).connect(this.engine.gain);
      this.engine.gain.connect(this.engine.pan || this.master);
      if (this.engine.pan) { this.engine.pan.connect(this.master); }
      this.engine.osc.start();
      this.engine.active = true;
    }
    const t = c.currentTime;
    const freq = (cls.baseFreq || 50) + Math.max(0, speed) * (cls.mult || 40);
    this.engine.osc.frequency.setTargetAtTime(freq, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(speed > 0.02 ? 0.18 : 0.04, t, 0.1);
    this.engine.filter.frequency.setTargetAtTime(300 + Math.max(0, speed) * 900, t, 0.1);
  },
  stopEngine() {
    if (!this.engine.osc) return;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(0, t, 0.2);
    setTimeout(() => {
      // Déconnecte TOUTE la chaîne, pas seulement l'oscillateur : sinon
      // gain/filter/pan restaient connectés au master indéfiniment, et une
      // nouvelle chaîne se recréait à chaque relance (fuite de nœuds audio).
      const { osc, gain, filter, pan } = this.engine;
      try { osc.stop(); } catch (e) {}
      [osc, gain, filter, pan].forEach(n => { try { n && n.disconnect(); } catch (e) {} });
      this.engine.osc = null; this.engine.gain = null; this.engine.filter = null; this.engine.pan = null;
      this.engine.active = false;
    }, 400);
  },
  // Simulate road ambience using filtered noise loops for nearby traffic axes
  updateRoadAmbience(x, y, city) {
    const c = this.ensure();
    const axes = city.roadAxes || [];
    let nearest = Infinity, bestPan = 0, bestDensity = 0;
    for (const ax of axes) {
      let dist, pan;
      if (ax.axis === 'x') { dist = Math.abs(x - ax.pos); pan = (x - ax.pos) / 40; }
      else { dist = Math.abs(y - ax.pos); pan = (y - ax.pos) / 40; }
      if (dist < nearest) { nearest = dist; bestPan = Math.max(-1, Math.min(1, pan)); bestDensity = ax.density || 0.5; }
    }
    if (nearest < 30) {
      if (!this.road.src) {
        const len = Math.ceil(c.sampleRate * 2);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
        this.road.src = c.createBufferSource(); this.road.src.buffer = buf; this.road.src.loop = true;
        this.road.gain = c.createGain(); this.road.gain.gain.value = 0;
        this.road.pan = c.createStereoPanner ? c.createStereoPanner() : null;
        this.road.filter = c.createBiquadFilter(); this.road.filter.type = 'lowpass'; this.road.filter.frequency.value = 600;
        this.road.src.connect(this.road.filter).connect(this.road.gain);
        this.road.gain.connect(this.road.pan || this.master);
        if (this.road.pan) { this.road.pan.connect(this.master); }
        this.road.src.start();
      }
      // À l'intérieur d'un bâtiment / d'une cour (peu après avoir franchi une
      // porte), les bruits de la ville sont nettement assourdis.
      // Tant qu'on est à l'intérieur d'un lieu, l'ambiance de la ville reste
      // nettement assourdie (sans qu'on l'annonce), jusqu'à ressortir.
      const indoors = (typeof Game !== 'undefined' && !!Game.indoors && !Game.inVehicle);
      // En vol (altitude > 0), on ne doit pas entendre la circulation routière
      // du sol comme si l'on marchait dessus : on l'atténue selon l'altitude.
      const altitude = (typeof Game !== 'undefined' && Game.altitude) ? Game.altitude : 0;
      const flyFactor = altitude > 0 ? Math.max(0, 1 - altitude / 20) : 1;
      const vol = Math.max(0, 1 - nearest / 30) * bestDensity * 0.35 * (indoors ? 0.3 : 1) * flyFactor;
      const t = c.currentTime;
      this.road.gain.gain.setTargetAtTime(vol, t, 0.2);
      this.road.filter.frequency.setTargetAtTime(300 + vol * 2000, t, 0.2);
      if (this.road.pan) this.road.pan.pan.setTargetAtTime(bestPan, t, 0.2);
    } else if (this.road.src) {
      this.road.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      setTimeout(() => {
        // Déconnecte toute la chaîne (pas seulement src) : sinon gain/filter/pan
        // restaient connectés au master indéfiniment à chaque cycle (fuite).
        const { src, gain, filter, pan } = this.road;
        try { src.stop(); } catch (e) {}
        [src, gain, filter, pan].forEach(n => { try { n && n.disconnect(); } catch (e) {} });
        this.road.src = null; this.road.gain = null; this.road.filter = null; this.road.pan = null;
      }, 400);
    }
  },
  // heavy = true : porte un gilet pare-balles, le poids de l'équipement
  // s'entend (pas plus sourds et plus lents), sans changer de fichier son.
  footstep(surface = 'asphalt', heavy = false) {
    const group = FOOTSTEP_GROUPS[surface] || FOOTSTEP_GROUPS.concrete;
    const key = UTIL.pick(group);
    AudioLib.playOnce(key, { volume: heavy ? 0.65 : 0.5, rate: heavy ? 0.82 : 1 });
    return key; // permet de relayer le même pas aux autres joueurs (audio partagé)
  },
  screech(pan = 0) { this.noise({ duration: 0.25, gain: 0.22, pan, filterFreq: 2500, attack: 0.01, release: 0.2 }); },
  siren(vol = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(600, t); o1.frequency.linearRampToValueAtTime(900, t + 0.4); o1.frequency.linearRampToValueAtTime(600, t + 0.8);
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(700, t); o2.frequency.linearRampToValueAtTime(1000, t + 0.4); o2.frequency.linearRampToValueAtTime(700, t + 0.8);
    // exponentialRampToValueAtTime plante si la valeur de DÉPART est 0 (pas
    // seulement la cible) : on clampe donc à un minimum non nul plutôt qu'à 0.
    const g = this.ctx.createGain(); g.gain.setValueAtTime(Math.max(0.0001, vol * 0.3), t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.85);
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(t); o2.start(t); o1.stop(t + 0.85); o2.stop(t + 0.85);
  },
  gunshot(weaponName, pan = 0) {
    const base = weaponName && weaponName.includes('gros') ? 120 : 90;
    this.noise({ duration: 0.18, gain: 0.35, pan, filterFreq: 900 + base, attack: 0.005, release: 0.12 });
    this.tone({ freq: 80 + base, type: 'sawtooth', duration: 0.12, gain: 0.18, pan, attack: 0.005, release: 0.1, fm: true });
  },
  shellDrop(pan = 0) { this.tone({ freq: 1200 + Math.random() * 400, type: 'sine', duration: 0.07, gain: 0.05, pan, attack: 0.005, release: 0.06 }); },
  // Alerte « vous êtes pris pour cible » (voir Game.target / onPlayerTargetedMe) :
  // un vrai joueur qui vous vise arme sortie, dans l'intention de tirer. Son
  // volontairement distinct de tout le reste — trois bips aigus, montants et
  // rapprochés, façon avertissement de verrouillage — pour être reconnu
  // instantanément, sans confusion possible avec un autre son du jeu.
  targetedWarning(pan = 0) {
    [0, 90, 180].forEach((delay, i) => {
      setTimeout(() => this.tone({ freq: 1000 + i * 220, type: 'square', duration: 0.09, gain: 0.16, pan, attack: 0.003, release: 0.06 }), delay);
    });
  },
  impact(pan = 0) { this.noise({ duration: 0.1, gain: 0.15, pan, filterFreq: 600, attack: 0.005, release: 0.06 }); },
  // Le joueur encaisse un coup : protected = casque (tête) ou gilet (corps) a
  // absorbé le choc -> son sourd et étouffé (grave, filtré bas) ; sinon, impact
  // net et douloureux (plus aigu, sans filtrage grave).
  playerHit(protectedHit = false, pan = 0) {
    if (protectedHit) {
      this.noise({ duration: 0.12, gain: 0.22, pan, filterFreq: 220, attack: 0.005, release: 0.1 });
      this.tone({ freq: 90, type: 'sine', duration: 0.1, gain: 0.12, pan, attack: 0.005, release: 0.08 });
    } else {
      this.noise({ duration: 0.16, gain: 0.3, pan, filterFreq: 1400, attack: 0.003, release: 0.14 });
      this.tone({ freq: 320, type: 'sawtooth', duration: 0.14, gain: 0.16, pan, attack: 0.003, release: 0.1 });
    }
  },
  beep(pan = 0, freq = 880) { this.tone({ freq, type: 'square', duration: 0.12, gain: 0.08, pan, attack: 0.005, release: 0.05 }); },
  click(pan = 0) { this.tone({ freq: 1400, type: 'sine', duration: 0.04, gain: 0.06, pan, attack: 0.005, release: 0.03 }); },
  cash(pan = 0) { this.tone({ freq: 1200, type: 'sine', duration: 0.12, gain: 0.1, pan, attack: 0.005, release: 0.05 }); setTimeout(() => this.tone({ freq: 1600, type: 'sine', duration: 0.12, gain: 0.1, pan, attack: 0.005, release: 0.05 }), 100); },
  policeSiren(pan = 0) {
    const c = this.ensure(); const t = c.currentTime;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(600, t);
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(800, t);
    const g = c.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    const p = c.createStereoPanner ? c.createStereoPanner() : null; p && (p.pan.value = pan);
    o1.connect(g); o2.connect(g); g.connect(p || this.master); if (p) p.connect(this.master);
    o1.start(t); o1.stop(t + 1.2); o2.start(t); o2.stop(t + 1.2);
  },
  helicopterBlade(pan = 0) { this.noise({ duration: 0.6, gain: 0.22, pan, filterFreq: 400, attack: 0.05, release: 0.4 }); this.tone({ freq: 55, type: 'sawtooth', duration: 0.6, gain: 0.14, pan, attack: 0.05, release: 0.4 }); },
  airplaneEngine(pan = 0) { this.noise({ duration: 1.2, gain: 0.18, pan, filterFreq: 250, attack: 0.1, release: 0.8 }); this.tone({ freq: 80, type: 'sawtooth', duration: 1.2, gain: 0.12, pan, attack: 0.1, release: 0.8 }); },
  voiceHint(pan = 0) { this.tone({ freq: 520, type: 'sine', duration: 0.18, gain: 0.09, pan, attack: 0.01, release: 0.08 }); },
};

/* ============================================================
   AUDIOLIB — bibliothèque des vrais fichiers sonores fournis
   (à placer dans un dossier "sounds/" à côté de ce fichier HTML)
   Règles :
   - Les ambiances (nature, forêt, pluie, aéroport, feu, grillade...) et
     l'alarme antivol tournent EN BOUCLE tant qu'elles sont actives.
   - Les sons d'arme (rechargement, chargeur vide, rafale), l'explosion,
     la notification et le répondeur ne jouent qu'UNE SEULE FOIS.
   - Les sonneries d'appel bouclent pendant toute la durée de la sonnerie
     (30 secondes maximum), gérées par le système d'appel téléphonique.
============================================================ */
const SOUND_FILES = {
  amb_matin: 'sounds/amb_matin.mp3',
  amb_oiseaux: 'sounds/amb_oiseaux.mp3',
  amb_aeroport: 'sounds/amb_aeroport.mp3',
  amb_foret: 'sounds/amb_foret.mp3',
  amb_pluie: 'sounds/amb_pluie.mp3',
  amb_feu: 'sounds/amb_feu.mp3',
  sfx_grillade: 'sounds/sfx_grillade.mp3',
  sfx_recharge: 'sounds/sfx_recharge.mp3',
  sfx_arme_vide: 'sounds/sfx_arme_vide.mp3',
  sfx_rafale: 'sounds/sfx_rafale.mp3',
  // Enrayage (l'arme se bloque en tirant, voir Game.shoot/reload) et sons de
  // tir réels dédiés aux armes lourdes (sniper, fusil à pompe) — avant,
  // toutes les armes partageaient le même tir synthétisé (Audio.gunshot).
  sfx_arme_enrayee: 'sounds/sfx_arme_enrayee.wav',
  sfx_arme_lourd_sniper: 'sounds/sfx_arme_lourd_sniper.wav',
  sfx_arme_lourd_pompe: 'sounds/sfx_arme_lourd_pompe.wav',
  sfx_alarme_antivol: 'sounds/sfx_alarme_antivol.flac', // usage exclusif : antivol de véhicule (vol forcé)
  sfx_explosion: 'sounds/sfx_explosion.mp3',
  sfx_bienvenue: 'sounds/sfx_bienvenue.mp3',
  sfx_notification: 'sounds/sfx_notification.mp3',
  sfx_decompte: 'sounds/sfx_decompte.mp3', // anciennement "sfx_reveil" — utilisé pour tout compte à rebours (grenade, réveil à l'hôpital...)
  sfx_repondeur: 'sounds/sfx_repondeur.mp3',
  // Alerte envoyée UNIQUEMENT au téléphone de service des policiers, quand un
  // crime est signalé en ville (coups de feu, braquage...). Jamais sur un
  // téléphone personnel, et jamais réutilisée pour l'antivol.
  sfx_alerte_police: 'sounds/sfx_alerte_police.flac',
  // Bruits de pas réels, plusieurs variantes par surface pour que chaque pas
  // sonne un peu différemment (voir FOOTSTEP_GROUPS et Audio.footstep).
  pas_asphalt_01: 'sounds/pas_asphalt_01.flac', pas_asphalt_02: 'sounds/pas_asphalt_02.flac',
  pas_asphalt_03: 'sounds/pas_asphalt_03.flac', pas_asphalt_04: 'sounds/pas_asphalt_04.flac',
  pas_asphalt_05: 'sounds/pas_asphalt_05.flac', pas_asphalt_06: 'sounds/pas_asphalt_06.flac',
  pas_concrete_01: 'sounds/pas_concrete_01.flac', pas_concrete_02: 'sounds/pas_concrete_02.flac',
  pas_concrete_03: 'sounds/pas_concrete_03.flac', pas_concrete_04: 'sounds/pas_concrete_04.flac',
  pas_concrete_05: 'sounds/pas_concrete_05.flac', pas_concrete_06: 'sounds/pas_concrete_06.flac',
  pas_concrete_07: 'sounds/pas_concrete_07.flac', pas_concrete_08: 'sounds/pas_concrete_08.flac',
  pas_concrete_09: 'sounds/pas_concrete_09.flac', pas_concrete_10: 'sounds/pas_concrete_10.flac',
  pas_concrete_11: 'sounds/pas_concrete_11.flac',
  pas_grass_01: 'sounds/pas_grass_01.flac', pas_grass_02: 'sounds/pas_grass_02.flac',
  pas_grass_03: 'sounds/pas_grass_03.flac', pas_grass_04: 'sounds/pas_grass_04.flac',
  pas_grass_05: 'sounds/pas_grass_05.flac', pas_grass_06: 'sounds/pas_grass_06.flac',
  pas_dirt_01: 'sounds/pas_dirt_01.flac', pas_dirt_02: 'sounds/pas_dirt_02.flac',
  pas_dirt_03: 'sounds/pas_dirt_03.flac', pas_dirt_04: 'sounds/pas_dirt_04.flac',
  pas_dirt_05: 'sounds/pas_dirt_05.flac', pas_dirt_06: 'sounds/pas_dirt_06.flac',
  pas_dirt_07: 'sounds/pas_dirt_07.flac', pas_dirt_08: 'sounds/pas_dirt_08.flac',
  pas_interieur_01: 'sounds/pas_interieur_01.flac', pas_interieur_02: 'sounds/pas_interieur_02.flac',
  pas_interieur_03: 'sounds/pas_interieur_03.flac', pas_interieur_04: 'sounds/pas_interieur_04.flac',
  pas_interieur_05: 'sounds/pas_interieur_05.flac', pas_interieur_06: 'sounds/pas_interieur_06.flac',
  pas_interieur_07: 'sounds/pas_interieur_07.flac', pas_interieur_08: 'sounds/pas_interieur_08.flac',
  pas_interieur_09: 'sounds/pas_interieur_09.flac', pas_interieur_10: 'sounds/pas_interieur_10.flac',
  pas_interieur_11: 'sounds/pas_interieur_11.flac',
  // Sirènes réelles (véhicule police, moto police, véhicule hôpital)
  sirene_moto_police: 'sounds/sirene_moto_police.flac',
  sirene_vehicule_police: 'sounds/sirene_vehicule_police.flac',
  sirene_vehicule_hopital: 'sounds/sirene_vehicule_hopital.flac',
  // Joue chez L'EXPÉDITEUR quand il envoie un message depuis son téléphone (pas chez le destinataire).
  sfx_message_envoye: 'sounds/sfx_message_envoye.flac',
  // Ambiances en boucle, une par zone (voir AmbientZones)
  amb_ville: 'sounds/amb_ville.mp3',
  amb_centre_ville_route: 'sounds/amb_centre_ville_route.mp3',
  amb_interieur_couloir: 'sounds/amb_interieur_couloir.mp3',
  // Klaxons du joueur (selon le véhicule conduit)
  klaxon_voiture: 'sounds/klaxon_voiture.flac',
  klaxon_moto: 'sounds/klaxon_voiture.flac',
  klaxon_camion: 'sounds/klaxon_camion.flac',
  // Klaxons des véhicules PNJ (circulation ambiante, tirés au hasard)
  npc_klaxon_1: 'sounds/npc_klaxon_1.flac',
  npc_klaxon_2: 'sounds/npc_klaxon_2.flac',
  npc_klaxon_3: 'sounds/npc_klaxon_3.flac',
  npc_klaxon_4: 'sounds/npc_klaxon_4.flac',
  npc_klaxon_5: 'sounds/npc_klaxon_4.flac',
  sonnerie_1: 'sounds/sfx_sonnerie_1.mp3',
  sonnerie_2: 'sounds/sfx_sonnerie_2.mp3',
  sonnerie_3: 'sounds/sfx_sonnerie_3.mp3',
  sonnerie_4: 'sounds/sfx_sonnerie_4.mp3',
  notif_1: 'sounds/notif_1.flac',
  notif_2: 'sounds/notif_2.flac',
  notif_3: 'sounds/notif_3.flac',
  notif_4: 'sounds/notif_4.flac',
  // Téléphone : appel entre joueurs
  sfx_attente_appel: 'sounds/sfx_attente_appel.flac', // tonalité entendue par l'appelant tant que ça sonne
  sfx_correspondant_indisponible: 'sounds/sfx_correspondant_indisponible.flac', // correspondant hors ligne / mode avion
  // Voix PNJ — groupe "panique" (réactions des passants témoins de violence)
  npcv_au_secours: 'sounds/npcv_au_secours.mp3',
  npcv_pourquoi_ca: 'sounds/npcv_pourquoi_ca.mp3',
  npcv_attention_1: 'sounds/npcv_attention_1.mp3',
  npcv_attention_2: 'sounds/npcv_attention_2.mp3',
  npcv_pourquoi_court: 'sounds/npcv_pourquoi_court.mp3',
  npcv_pas_de_mal_2: 'sounds/npcv_pas_de_mal_2.mp3',
  npcv_malade_type: 'sounds/npcv_malade_type.mp3',
  npcv_maman: 'sounds/npcv_maman.mp3',
  npcv_aide_police: 'sounds/npcv_aide_police.mp3',
  npcv_encore_problemes: 'sounds/npcv_encore_problemes.mp3',
  npcv_impact_choc: 'sounds/npcv_impact_choc.mp3',
  npcv_detresse_1: 'sounds/npcv_detresse_1.mp3',
  npcv_detresse_2: 'sounds/npcv_detresse_2.mp3',
  npcv_detresse_3: 'sounds/npcv_detresse_3.mp3',
  npcv_je_me_casse: 'sounds/npcv_je_me_casse.mp3',
  npcv_mon_dieu: 'sounds/npcv_mon_dieu.mp3',
  npcv_impact_detresse: 'sounds/npcv_impact_detresse.mp3',
  // Voix PNJ — groupe "énervé" (PNJ hostiles/territoriaux : gangs, PNJ menacés ou provoqués)
  npcv_enerve_recule: 'sounds/npcv_enerve_recule.mp3',
  npcv_enerve_barre_toi: 'sounds/npcv_enerve_barre_toi.mp3',
  npcv_enerve_casser_2: 'sounds/npcv_enerve_casser_2.mp3',
  npcv_enerve_venez_faire_quoi: 'sounds/npcv_enerve_venez_faire_quoi.mp3',
  npcv_enerve_approche_plus: 'sounds/npcv_enerve_approche_plus.mp3',
  npcv_enerve_mon_territoire: 'sounds/npcv_enerve_mon_territoire.mp3',
  npcv_enerve_pas_repeter: 'sounds/npcv_enerve_pas_repeter.mp3',
  npcv_enerve_plus_malin: 'sounds/npcv_enerve_plus_malin.mp3',
  npcv_enerve_cherche_problemes: 'sounds/npcv_enerve_cherche_problemes.mp3',
  npcv_enerve_probleme_nouveau: 'sounds/npcv_enerve_probleme_nouveau.mp3',
  // Voix PNJ — groupe "impatient" (automobilistes bloqués dans la circulation à
  // cause du joueur : conduite dangereuse, véhicule à l'arrêt en pleine route...)
  npcv_impatient_bouge_caisse: 'sounds/npcv_impatient_bouge_caisse.flac',
  npcv_impatient_incompetents: 'sounds/npcv_impatient_incompetents.flac',
  npcv_impatient_degage_route: 'sounds/npcv_impatient_degage_route.flac',
  npcv_impatient_touriste: 'sounds/npcv_impatient_touriste.flac',
  npcv_impatient_clients_attendent: 'sounds/npcv_impatient_clients_attendent.flac',
  npcv_impatient_bouge_vehicule: 'sounds/npcv_impatient_bouge_vehicule.flac',
  npcv_impatient_constat: 'sounds/npcv_impatient_constat.flac',
  npcv_impatient_quil_fiche: 'sounds/npcv_impatient_quil_fiche.flac',
  npcv_impatient_aveugle: 'sounds/npcv_impatient_aveugle.flac',
  npcv_impatient_fatigue_nuls: 'sounds/npcv_impatient_fatigue_nuls.flac',
  npcv_impatient_bloque_quartier: 'sounds/npcv_impatient_bloque_quartier.flac',
  npcv_impatient_abimer_caisse: 'sounds/npcv_impatient_abimer_caisse.flac',
  npcv_impatient_idiot: 'sounds/npcv_impatient_idiot.flac',
  npcv_impatient_apprendre_rouler: 'sounds/npcv_impatient_apprendre_rouler.flac',
  npcv_impatient_ca_klaxonne: 'sounds/npcv_impatient_ca_klaxonne.flac',

  // ===== VRAI MOTEUR ENREGISTRÉ (véhicule "sport", RealEngine) =====
  // Démarrage / arrêt
  veh1_demarrage: 'sounds/veh1_demarrage.mp3',
  veh1_arret: 'sounds/veh1_arret.mp3',
  veh1_arret_variable: 'sounds/veh1_arret_variable.mp3',
  veh1_stop_brusque: 'sounds/veh1_stop_brusque.mp3',
  // Boucles de régime (crossfade selon la vitesse)
  veh1_cruise: 'sounds/veh1_cruise.mp3',
  veh1_vitesse_stable: 'sounds/veh1_vitesse_stable.mp3',
  // Pré-accélération (juste avant d'appuyer)
  veh1_pre_accel_1: 'sounds/veh1_pre_accel_1.mp3',
  veh1_pre_accel_2: 'sounds/veh1_pre_accel_2.mp3',
  veh1_pre_accel_3: 'sounds/veh1_pre_accel_3.mp3',
  veh1_pre_accel_petit: 'sounds/veh1_pre_accel_petit.mp3',
  // Accélérations (courtes, longues, fortes, progressives)
  veh1_accel_courte1: 'sounds/veh1_accel_courte1.mp3',
  veh1_accel_courte2: 'sounds/veh1_accel_courte2.mp3',
  veh1_accel_longue: 'sounds/veh1_accel_longue.mp3',
  veh1_accel_forte: 'sounds/veh1_accel_forte.mp3',
  veh1_accel_progressive1: 'sounds/veh1_accel_progressive1.mp3',
  veh1_accel_progressive2: 'sounds/veh1_accel_progressive2.mp3',
  // Décélérations
  veh1_decel_1: 'sounds/veh1_decel_1.mp3',
  veh1_decel_haute_vitesse: 'sounds/veh1_decel_haute_vitesse.mp3',
  veh1_decel_longue: 'sounds/veh1_decel_longue.mp3',
  veh1_petit_decel_1: 'sounds/veh1_petit_decel_1.mp3',
  veh1_petit_decel_2: 'sounds/veh1_petit_decel_2.mp3',
  // Variations et micro-accélérations pendant une croisière à haute vitesse
  veh1_variation_haute_1: 'sounds/veh1_variation_haute_1.mp3',
  veh1_variation_haute_2: 'sounds/veh1_variation_haute_2.mp3',
  veh1_micro_accel_1: 'sounds/veh1_micro_accel_1.mp3',
  veh1_micro_accel_2: 'sounds/veh1_micro_accel_2.mp3',
  veh1_micro_accel_3: 'sounds/veh1_micro_accel_3.mp3',
  veh1_micro_accel_4: 'sounds/veh1_micro_accel_4.mp3',
  veh1_micro_accel_5: 'sounds/veh1_micro_accel_5.mp3',
  // Turbo et effet de vitesse
  veh1_turbo_1: 'sounds/veh1_turbo_1.mp3',
  veh1_turbo_2: 'sounds/veh1_turbo_2.mp3',
  veh1_son_vitesse: 'sounds/veh1_son_vitesse.mp3',
  // Freinage (5 variantes, plus un freinage brusque à haute vitesse)
  veh1_frenage_1: 'sounds/veh1_frenage_1.mp3',
  veh1_frenage_2: 'sounds/veh1_frenage_2.mp3',
  veh1_frenage_3: 'sounds/veh1_frenage_3.mp3',
  veh1_frenage_4: 'sounds/veh1_frenage_4.mp3',
  veh1_frenage_5: 'sounds/veh1_frenage_5.mp3',
  veh1_frenage_brusque_haute_vitesse: 'sounds/veh1_frenage_brusque_haute_vitesse.mp3',
  // Portière et verrouillage (habitacle)
  veh1_fermeture_porte: 'sounds/veh1_fermeture_porte.mp3',
  veh1_ouverture_porte: 'sounds/veh1_ouverture_porte.mp3',
  veh1_verrouillage: 'sounds/veh1_verrouillage.mp3',
  sfx_porte_vehicule: 'sounds/sfx_porte_vehicule.wav', // signal des portières (choix de portière, balise de porte)
  // Chien guide (labrador) : aboiements de 1 à 5 fois selon l'intensité.
  chien_aboie_court: 'sounds/chien_aboie_court.wav', // repère de position discret
  chien_aboie_1: 'sounds/chien_aboie_1.wav',
  chien_aboie_2: 'sounds/chien_aboie_2.wav',
  chien_aboie_3: 'sounds/chien_aboie_3.wav',
  chien_aboie_5: 'sounds/chien_aboie_5.wav',       // alerte de danger
  chien_laisse: 'sounds/chien_laisse.wav',         // laisse tendue (boucle tant qu'on la tient)
  // Vélo : vrai système sonore (pédalage, roue libre, freins, clochette).
  velo_pedale: 'sounds/velo_pedale.wav',           // pédalage (boucle quand on avance)
  velo_point_mort: 'sounds/velo_point_mort.wav',   // roue libre (boucle quand on ralentit sans pédaler)
  velo_frein_1: 'sounds/velo_frein_1.wav',
  velo_frein_2: 'sounds/velo_frein_2.wav',
  velo_frein_3: 'sounds/velo_frein_3.wav',
  velo_clochette: 'sounds/velo_clochette.wav',     // sonnette d'avertissement
  // Sons annexes indépendants (pas encore intégrés à un système précis —
  // disponibles pour la suite : frein à main, ceinture, klaxon, essuie-glace,
  // clignotant, passage d'un véhicule/avion à l'extérieur).
  veh_frein_main: 'sounds/veh_frein_main.mp3',
  veh_ceinture_in: 'sounds/veh_ceinture_in.mp3',
  veh_ceinture_out: 'sounds/veh_ceinture_out.mp3',
  veh_passage_ext_50kmh: 'sounds/veh_passage_ext_50kmh.mp3',
  klaxon_luxe: 'sounds/klaxon_luxe.mp3',
  passage_avion_ciel: 'sounds/passage_avion_ciel.mp3',
  veh_essuie_glaces: 'sounds/veh_essuie_glaces.mp3',
  clignotant_voiture: 'sounds/clignotant_voiture.mp3',

  // ===== Rafale puissante (armes très rapides) =====
  rafale_puissante: 'sounds/rafale_puissante.mp3',

  // ===== Véhicule : trou/collision, vitre, navigation PNJ =====
  veh_collision_trou: 'sounds/veh_collision_trou.mp3',
  veh_vitre_monte_descend: 'sounds/veh_vitre_monte_descend.mp3',
  npc_veh_passage_1: 'sounds/npc_veh_passage_1.mp3',
  npc_veh_passage_20kmh: 'sounds/npc_veh_passage_20kmh.mp3',

  // ===== Combat : chute, coup de poing/pied, cris de PNJ (voix homme) =====
  bruit_chute: 'sounds/bruit_chute.mp3',
  son_coup_poing_pied: 'sounds/son_coup_poing_pied.mp3',
  cri_png_1: 'sounds/cri_png_1.mp3',
  cri_png_2: 'sounds/cri_png_2.mp3',
  cri_png_3: 'sounds/cri_png_3.mp3',
  cri_png_4: 'sounds/cri_png_4.mp3',
  cri_png_5: 'sounds/cri_png_5.mp3',
  cri_png_6: 'sounds/cri_png_6.mp3',
  cri_png_7: 'sounds/cri_png_7.mp3',

  // ===== Divers : talkie, ordinateur, intro, charrette =====
  son_talkie_bip: 'sounds/son_talkie_bip.mp3',
  son_nav_ordinateur: 'sounds/son_nav_ordinateur.mp3',
  son_intro_jeu: 'sounds/son_intro_jeu.mp3',
  son_char_tir: 'sounds/son_charrette.mp3',

  // ===== Eau : pas, plongeon, nage, boire, ambiances =====
  eau_pas_1: 'sounds/eau_pas_1.mp3',
  eau_pas_2: 'sounds/eau_pas_2.mp3',
  eau_pas_3: 'sounds/eau_pas_3.mp3',
  eau_pas_4: 'sounds/eau_pas_4.mp3',
  eau_plongeon: 'sounds/eau_plongeon.mp3',
  eau_mer_amb: 'sounds/eau_mer_amb.mp3',
  eau_nage_sous: 'sounds/eau_nage_sous.mp3',
  eau_boire: 'sounds/eau_boire.mp3',
  eau_riviere_amb: 'sounds/eau_riviere_amb.mp3',

  // ===== Avion / hélicoptère (vrai moteur enregistré) =====
  avion_stable: 'sounds/avion_stable.mp3',
  avion_arret: 'sounds/avion_arret.mp3',
  helico_arret: 'sounds/helico_arret.mp3',
  avion_helico_crache: 'sounds/avion_helico_crache.mp3',
  helico_demarrage: 'sounds/helico_demarrage.mp3',
  helico_stable: 'sounds/helico_stable.mp3',
  avion_demarrage: 'sounds/avion_demarrage.mp3',

  // ===== Moteur électrique (vrai moteur enregistré) =====
  veh_elec_demarrage: 'sounds/veh_elec_demarrage.mp3',
  veh_elec_apres_demarrage: 'sounds/veh_elec_apres_demarrage.mp3',
  veh_elec_arret: 'sounds/veh_elec_arret.mp3',
  veh_elec_vitesse_basse: 'sounds/veh_elec_vitesse_basse.mp3',
  veh_elec_vitesse_moyenne: 'sounds/veh_elec_vitesse_moyenne.mp3',
  veh_elec_vitesse_haute: 'sounds/veh_elec_vitesse_haute.mp3',
  veh_elec_vitesse_stable_grande: 'sounds/veh_elec_vitesse_stable_grande.mp3',
  veh_elec_repos_1: 'sounds/veh_elec_repos_1.mp3',
  veh_elec_repos_2: 'sounds/veh_elec_repos_2.mp3',
  veh_elec_transition: 'sounds/veh_elec_transition.mp3',
  veh_elec_accel_1: 'sounds/veh_elec_accel_1.mp3',
  veh_elec_accel_2: 'sounds/veh_elec_accel_2.mp3',
  veh_elec_accel_3: 'sounds/veh_elec_accel_3.mp3',
  veh_elec_accel_forte: 'sounds/veh_elec_accel_forte.mp3',
  veh_elec_accel_pendant_vitesse: 'sounds/veh_elec_accel_pendant_vitesse.mp3',
  veh_elec_petit_accel: 'sounds/veh_elec_petit_accel.mp3',
  veh_elec_ronflement: 'sounds/veh_elec_ronflement.mp3',
  veh_elec_decel_1: 'sounds/veh_elec_decel_1.mp3',
  veh_elec_decel_douce: 'sounds/veh_elec_decel_douce.mp3',
  veh_elec_decel_longue: 'sounds/veh_elec_decel_longue.mp3',
  veh_elec_relachement_1: 'sounds/veh_elec_relachement_1.mp3',
  veh_elec_relachement_2: 'sounds/veh_elec_relachement_2.mp3',
  veh_elec_relachement_turbo: 'sounds/veh_elec_relachement_turbo.mp3',

  // ===== Moteur "véhicule2" (BMW et autres véhicules non-sport, discrets) =====
  veh2_demarrage: 'sounds/veh2_demarrage.mp3',
  veh2_apres_demarrage: 'sounds/veh2_apres_demarrage.mp3',
  veh2_arret: 'sounds/veh2_arret.mp3',
  veh2_vitesse_basse: 'sounds/veh2_vitesse_basse.mp3',
  veh2_vitesse_moyenne: 'sounds/veh2_vitesse_moyenne.mp3',
  veh2_vitesse_haute: 'sounds/veh2_vitesse_haute.mp3',
  veh2_vitesse_stable: 'sounds/veh2_vitesse_stable.mp3',
  veh2_repos_1: 'sounds/veh2_repos_1.mp3',
  veh2_repos_2: 'sounds/veh2_repos_2.mp3',
  veh2_transition: 'sounds/veh2_transition.mp3',
  veh2_accel_1: 'sounds/veh2_accel_1.mp3',
  veh2_accel_2: 'sounds/veh2_accel_2.mp3',
  veh2_accel_3: 'sounds/veh2_accel_3.mp3',
  veh2_accel_forte: 'sounds/veh2_accel_forte.mp3',
  veh2_accel_pendant_vitesse: 'sounds/veh2_accel_pendant_vitesse.mp3',
  veh2_petit_accel: 'sounds/veh2_petit_accel.mp3',
  veh2_ronflement: 'sounds/veh2_ronflement.mp3',
  veh2_decel_1: 'sounds/veh2_decel_1.mp3',
  veh2_decel_douce: 'sounds/veh2_decel_douce.mp3',
  veh2_decel_longue: 'sounds/veh2_decel_longue.mp3',
  veh2_relachement_1: 'sounds/veh2_relachement_1.mp3',
  veh2_relachement_2: 'sounds/veh2_relachement_2.mp3',
  veh2_relachement_turbo: 'sounds/veh2_relachement_turbo.mp3',
  veh2_declic_avant_demarrage: 'sounds/veh2_declic_avant_demarrage.mp3',
  veh_alarme_position: 'sounds/veh_alarme_position.mp3',

  // ===== Collisions et trous (véhicule) =====
  veh_kolision_1: 'sounds/veh_kolision_1.mp3',
  veh_kolision_2: 'sounds/veh_kolision_2.mp3',
  veh_kolision_3: 'sounds/veh_kolision_3.mp3',
  veh_kolision_4_fort: 'sounds/veh_kolision_4_fort.mp3',
  veh_kolision_entre_2: 'sounds/veh_kolision_entre_2.mp3',
  veh_trou_1: 'sounds/veh_trou_1.mp3',
  veh_trou_2: 'sounds/veh_trou_2.mp3',
  veh_trou_3: 'sounds/veh_trou_3.mp3',
  veh_trou_gros_4: 'sounds/veh_trou_gros_4.mp3',

  // ===== Passants ambiants (chuchotements de rue, voir catalogs.js PASSANT_LINES) =====
  passant_carburant_h: 'sounds/passant_carburant_h.wav',
  passant_carburant_f: 'sounds/passant_carburant_f.wav',
  passant_pas_regarder_h: 'sounds/passant_pas_regarder_h.wav',
  passant_pas_regarder_f: 'sounds/passant_pas_regarder_f.wav',
  passant_cafe_quatorze_h: 'sounds/passant_cafe_quatorze_h.wav',
  passant_cafe_quatorze_f: 'sounds/passant_cafe_quatorze_f.wav',
  passant_pas_en_retard_h: 'sounds/passant_pas_en_retard_h.wav',
  passant_pas_en_retard_f: 'sounds/passant_pas_en_retard_f.wav',
  passant_nouvelle_boutique_h: 'sounds/passant_nouvelle_boutique_h.wav',
  passant_nouvelle_boutique_f: 'sounds/passant_nouvelle_boutique_f.wav',
  passant_prix_incroyables_h: 'sounds/passant_prix_incroyables_h.wav',
  passant_prix_incroyables_f: 'sounds/passant_prix_incroyables_f.wav',
  passant_marche_abimee_h: 'sounds/passant_marche_abimee_h.wav',
  passant_marche_abimee_f: 'sounds/passant_marche_abimee_f.wav',
  passant_ville_en_ruine_h: 'sounds/passant_ville_en_ruine_h.wav',
  passant_ville_en_ruine_f: 'sounds/passant_ville_en_ruine_f.wav',
  passant_ciel_gris_h: 'sounds/passant_ciel_gris_h.wav',
  passant_ciel_gris_f: 'sounds/passant_ciel_gris_f.wav',
  passant_parapluie_h: 'sounds/passant_parapluie_h.wav',
  passant_parapluie_f: 'sounds/passant_parapluie_f.wav',
  passant_ca_fait_une_eternite_h: 'sounds/passant_ca_fait_une_eternite_h.wav',
  passant_ca_fait_une_eternite_f: 'sounds/passant_ca_fait_une_eternite_f.wav',
  passant_comment_va_famille_h: 'sounds/passant_comment_va_famille_h.wav',
  passant_comment_va_famille_f: 'sounds/passant_comment_va_famille_f.wav',
  passant_tu_bosses_toujours_h: 'sounds/passant_tu_bosses_toujours_h.wav',
  passant_tu_bosses_toujours_f: 'sounds/passant_tu_bosses_toujours_f.wav',
  passant_marche_difficile_h: 'sounds/passant_marche_difficile_h.wav',
  passant_marche_difficile_f: 'sounds/passant_marche_difficile_f.wav',
  passant_tu_as_un_moment_h: 'sounds/passant_tu_as_un_moment_h.wav',
  passant_tu_as_un_moment_f: 'sounds/passant_tu_as_un_moment_f.wav',
  passant_je_suis_tout_ouie_h: 'sounds/passant_je_suis_tout_ouie_h.wav',
  passant_je_suis_tout_ouie_f: 'sounds/passant_je_suis_tout_ouie_f.wav',
  passant_rater_le_bus_h: 'sounds/passant_rater_le_bus_h.wav',
  passant_rater_le_bus_f: 'sounds/passant_rater_le_bus_f.wav',
  passant_je_cours_h: 'sounds/passant_je_cours_h.wav',
  passant_je_cours_f: 'sounds/passant_je_cours_f.wav',
  passant_trop_de_choses_h: 'sounds/passant_trop_de_choses_h.wav',
  passant_trop_de_choses_f: 'sounds/passant_trop_de_choses_f.wav',
  passant_bientot_le_weekend_h: 'sounds/passant_bientot_le_weekend_h.wav',
  passant_bientot_le_weekend_f: 'sounds/passant_bientot_le_weekend_f.wav',
  passant_projets_vacances_h: 'sounds/passant_projets_vacances_h.wav',
  passant_projets_vacances_f: 'sounds/passant_projets_vacances_f.wav',
  passant_rester_tranquille_h: 'sounds/passant_rester_tranquille_h.wav',
  passant_rester_tranquille_f: 'sounds/passant_rester_tranquille_f.wav',
  passant_je_suis_presse_h: 'sounds/passant_je_suis_presse_h.wav',
  passant_je_suis_presse_f: 'sounds/passant_je_suis_presse_f.wav',
  passant_pas_le_temps_h: 'sounds/passant_pas_le_temps_h.wav',
  passant_pas_le_temps_f: 'sounds/passant_pas_le_temps_f.wav',
  passant_oh_bonjour_h: 'sounds/passant_oh_bonjour_h.wav',
  passant_oh_bonjour_f: 'sounds/passant_oh_bonjour_f.wav',
  passant_bonne_journee_h: 'sounds/passant_bonne_journee_h.wav',
  passant_bonne_journee_f: 'sounds/passant_bonne_journee_f.wav',
  passant_temps_bizarre_h: 'sounds/passant_temps_bizarre_h.wav',
  passant_temps_bizarre_f: 'sounds/passant_temps_bizarre_f.wav',
  passant_tu_as_lheure_h: 'sounds/passant_tu_as_lheure_h.wav',
  passant_tu_as_lheure_f: 'sounds/passant_tu_as_lheure_f.wav',
  passant_je_suis_en_retard_h: 'sounds/passant_je_suis_en_retard_h.wav',
  passant_je_suis_en_retard_f: 'sounds/passant_je_suis_en_retard_f.wav',
  passant_ca_va_tranquille_h: 'sounds/passant_ca_va_tranquille_h.wav',
  passant_ca_va_tranquille_f: 'sounds/passant_ca_va_tranquille_f.wav',
  passant_a_plus_tard_h: 'sounds/passant_a_plus_tard_h.wav',
  passant_a_plus_tard_f: 'sounds/passant_a_plus_tard_f.wav',
  passant_quel_bazar_h: 'sounds/passant_quel_bazar_h.wav',
  passant_quel_bazar_f: 'sounds/passant_quel_bazar_f.wav',
  passant_mal_aux_pieds_h: 'sounds/passant_mal_aux_pieds_h.wav',
  passant_mal_aux_pieds_f: 'sounds/passant_mal_aux_pieds_f.wav',

  // ===== PNJ homme directement menacé/blessé (voir NPCVoiceGroups.menace_directe) =====
  npc_menace_a_l_aide_on_m_attaque: 'sounds/npc_menace_a_l_aide_on_m_attaque.wav',
  npc_menace_a_l_aide: 'sounds/npc_menace_a_l_aide.wav',
  npc_menace_a_l_assacin: 'sounds/npc_menace_a_l_assacin.wav',
  npc_menace_aah_non_arrette: 'sounds/npc_menace_aah_non_arrette.wav',
  npc_menace_aahhh_ai_ahh_c_est_torible: 'sounds/npc_menace_aahhh_ai_ahh_c_est_torible.wav',
  npc_menace_aahhhhh_c_est_affreu: 'sounds/npc_menace_aahhhhh_c_est_affreu.wav',
  npc_menace_aaii: 'sounds/npc_menace_aaii.wav',
  npc_menace_ah_eh_oh_la_police: 'sounds/npc_menace_ah_eh_oh_la_police.wav',
  npc_menace_aidez_moi_il_veux_me_tue: 'sounds/npc_menace_aidez_moi_il_veux_me_tue.wav',
  npc_menace_aidez_moi_par_pitie: 'sounds/npc_menace_aidez_moi_par_pitie.wav',
  npc_menace_aidez_moi_sil_vous_plais: 'sounds/npc_menace_aidez_moi_sil_vous_plais.wav',
  npc_menace_aii: 'sounds/npc_menace_aii.wav',
  npc_menace_au_voleur: 'sounds/npc_menace_au_voleur.wav',
  npc_menace_ai_ai_ai_ai_hum_hu_m: 'sounds/npc_menace_ai_ai_ai_ai_hum_hu_m.wav',
  npc_menace_ai_ai: 'sounds/npc_menace_ai_ai.wav',
  npc_menace_ai_aii: 'sounds/npc_menace_ai_aii.wav',
  npc_menace_ai_c_est_trop_ca_fait_ma_l: 'sounds/npc_menace_ai_c_est_trop_ca_fait_ma_l.wav',
  npc_menace_ai_ai_ai_c_est_pas_vrai_s: 'sounds/npc_menace_ai_ai_ai_c_est_pas_vrai_s.wav',
  npc_menace_ai_ca_brule: 'sounds/npc_menace_ai_ca_brule.wav',
  npc_menace_ai: 'sounds/npc_menace_ai.wav',
  npc_menace_ai_2: 'sounds/npc_menace_ai_2.wav',
  npc_menace_c_est_fini: 'sounds/npc_menace_c_est_fini.wav',
  npc_menace_c_est_torible: 'sounds/npc_menace_c_est_torible.wav',
  npc_menace_c_est_trop: 'sounds/npc_menace_c_est_trop.wav',
  npc_menace_c_est_un_cochemare: 'sounds/npc_menace_c_est_un_cochemare.wav',
  npc_menace_ehh_ooh: 'sounds/npc_menace_ehh_ooh.wav',
  npc_menace_haaah_c_est_la_fi_n: 'sounds/npc_menace_haaah_c_est_la_fi_n.wav',
  npc_menace_hau_mon_dieu: 'sounds/npc_menace_hau_mon_dieu.wav',
  npc_menace_ho_non_au_secoure: 'sounds/npc_menace_ho_non_au_secoure.wav',
  npc_menace_ho_non_c_est_un_cochemar: 'sounds/npc_menace_ho_non_c_est_un_cochemar.wav',
  npc_menace_ho_non_non_non_c_est_la_fin: 'sounds/npc_menace_ho_non_non_non_c_est_la_fin.wav',
  npc_menace_j_ai_mal: 'sounds/npc_menace_j_ai_mal.wav',
  npc_menace_je_n_est_rien_prenez_tous: 'sounds/npc_menace_je_n_est_rien_prenez_tous.wav',
  npc_menace_je_n_est_rien_fait: 'sounds/npc_menace_je_n_est_rien_fait.wav',
  npc_menace_je_ne_sans_plus_ma_jamb_e: 'sounds/npc_menace_je_ne_sans_plus_ma_jamb_e.wav',
  npc_menace_je_vais_mourir: 'sounds/npc_menace_je_vais_mourir.wav',
  npc_menace_je_voux_en_supli: 'sounds/npc_menace_je_voux_en_supli.wav',
  npc_menace_laissez_moi_la_vie_sauve: 'sounds/npc_menace_laissez_moi_la_vie_sauve.wav',
  npc_menace_laissez_moi_tranquile: 'sounds/npc_menace_laissez_moi_tranquile.wav',
  npc_menace_laisse_moi_partir_je_vous_en: 'sounds/npc_menace_laisse_moi_partir_je_vous_en.wav',
  npc_menace_laisse_moi_partir: 'sounds/npc_menace_laisse_moi_partir.wav',
  npc_menace_laisse_moi_tranquile_je_n_es: 'sounds/npc_menace_laisse_moi_tranquile_je_n_es.wav',
  npc_menace_ma_jambe_ca_seigne: 'sounds/npc_menace_ma_jambe_ca_seigne.wav',
  npc_menace_ma_jambe: 'sounds/npc_menace_ma_jambe.wav',
  npc_menace_ne_me_faites_pas_de_mal_lais: 'sounds/npc_menace_ne_me_faites_pas_de_mal_lais.wav',
  npc_menace_ne_me_tue_pas: 'sounds/npc_menace_ne_me_tue_pas.wav',
  npc_menace_ne_me_tue_pas_je_vous_s_en_s: 'sounds/npc_menace_ne_me_tue_pas_je_vous_s_en_s.wav',
  npc_menace_non_non_ne_faites_pas_ca: 'sounds/npc_menace_non_non_ne_faites_pas_ca.wav',
  npc_menace_non_hummmmmmm: 'sounds/npc_menace_non_hummmmmmm.wav',
  npc_menace_oh_mon_bras: 'sounds/npc_menace_oh_mon_bras.wav',
  npc_menace_ollala_fuiez: 'sounds/npc_menace_ollala_fuiez.wav',
  npc_menace_ouuuu: 'sounds/npc_menace_ouuuu.wav',
  npc_menace_pitie_je_ne_veux_pas_mourir: 'sounds/npc_menace_pitie_je_ne_veux_pas_mourir.wav',
  npc_menace_pitie_laissez_moi_partir_je: 'sounds/npc_menace_pitie_laissez_moi_partir_je.wav',
  npc_menace_pitie_laissez_moi_partir_je_2: 'sounds/npc_menace_pitie_laissez_moi_partir_je_2.wav',
  npc_menace_pitie: 'sounds/npc_menace_pitie.wav',
  npc_menace_pittier: 'sounds/npc_menace_pittier.wav',
  npc_menace_quelcun_m_enttand_aidez_moi: 'sounds/npc_menace_quelcun_m_enttand_aidez_moi.wav',
  npc_menace_quesque_vous_voullez: 'sounds/npc_menace_quesque_vous_voullez.wav',
  npc_menace_recule: 'sounds/npc_menace_recule.wav',
  npc_menace_sauvez_moi: 'sounds/npc_menace_sauvez_moi.wav',
  npc_menace_sil_vous_plais_nonnn: 'sounds/npc_menace_sil_vous_plais_nonnn.wav',
  npc_menace_ca_fait_mal: 'sounds/npc_menace_ca_fait_mal.wav',
  npc_menace_ca_seigne: 'sounds/npc_menace_ca_seigne.wav',
  npc_menace_ca_souffi: 'sounds/npc_menace_ca_souffi.wav',
};

// Bruits de pas réels, groupés par surface : un tirage aléatoire à chaque pas
// pour que la marche du personnage sonne naturelle, pas répétitive.
const FOOTSTEP_GROUPS = {
  asphalt: ['pas_asphalt_01', 'pas_asphalt_02', 'pas_asphalt_03', 'pas_asphalt_04', 'pas_asphalt_05', 'pas_asphalt_06'],
  concrete: ['pas_concrete_01', 'pas_concrete_02', 'pas_concrete_03', 'pas_concrete_04', 'pas_concrete_05', 'pas_concrete_06', 'pas_concrete_07', 'pas_concrete_08', 'pas_concrete_09', 'pas_concrete_10', 'pas_concrete_11'],
  grass: ['pas_grass_01', 'pas_grass_02', 'pas_grass_03', 'pas_grass_04', 'pas_grass_05', 'pas_grass_06'],
  dirt: ['pas_dirt_01', 'pas_dirt_02', 'pas_dirt_03', 'pas_dirt_04', 'pas_dirt_05', 'pas_dirt_06', 'pas_dirt_07', 'pas_dirt_08'],
  interieur: ['pas_interieur_01', 'pas_interieur_02', 'pas_interieur_03', 'pas_interieur_04', 'pas_interieur_05', 'pas_interieur_06', 'pas_interieur_07', 'pas_interieur_08', 'pas_interieur_09', 'pas_interieur_10', 'pas_interieur_11'],
  water: ['eau_pas_1', 'eau_pas_2', 'eau_pas_3', 'eau_pas_4'],
};

/* ============================================================
   GROUPES DE VOIX PNJ — réactions des passants selon la situation.
   "panique" = premier groupe (témoins de violence : tirs, explosion,
   PNJ tué à proximité). D'autres groupes viendront s'ajouter ici
   plus tard (ex : "curiosite", "hostile", "policier"...).
============================================================ */
const NPCVoiceGroups = {
  panique: [
    { key: 'npcv_au_secours', gender: 'femme' },
    { key: 'npcv_pourquoi_ca', gender: 'femme' },
    { key: 'npcv_attention_1', gender: 'femme' },
    { key: 'npcv_attention_2', gender: 'femme' },
    { key: 'npcv_pourquoi_court', gender: 'femme' },
    { key: 'npcv_pas_de_mal_2', gender: 'femme' },
    { key: 'npcv_malade_type', gender: 'femme' },
    { key: 'npcv_maman', gender: 'femme' },
    { key: 'npcv_aide_police', gender: 'femme' },
    { key: 'npcv_encore_problemes', gender: 'femme' },
    { key: 'npcv_impact_choc', gender: 'homme' },
    { key: 'npcv_detresse_1', gender: 'homme' },
    { key: 'npcv_detresse_2', gender: 'homme' },
    { key: 'npcv_detresse_3', gender: 'homme' },
    { key: 'npcv_je_me_casse', gender: 'homme' },
    { key: 'npcv_mon_dieu', gender: 'homme' },
    { key: 'npcv_impact_detresse', gender: 'homme' },
  ],
  // "énervé" = deuxième groupe (PNJ hostiles/territoriaux : membres de gang
  // ou PNJ provoqués/menacés qui répondent avec agressivité).
  enerve: [
    { key: 'npcv_enerve_recule', gender: 'homme' },
    { key: 'npcv_enerve_barre_toi', gender: 'homme' },
    { key: 'npcv_enerve_casser_2', gender: 'homme' },
    { key: 'npcv_enerve_venez_faire_quoi', gender: 'homme' },
    { key: 'npcv_enerve_approche_plus', gender: 'homme' },
    { key: 'npcv_enerve_mon_territoire', gender: 'homme' },
    { key: 'npcv_enerve_pas_repeter', gender: 'homme' },
    { key: 'npcv_enerve_plus_malin', gender: 'homme' },
    { key: 'npcv_enerve_cherche_problemes', gender: 'homme' },
    { key: 'npcv_enerve_probleme_nouveau', gender: 'homme' },
  ],
  // "impatient" = troisième groupe (automobilistes bloqués par le joueur :
  // véhicule à l'arrêt en pleine route, collision, conduite dangereuse).
  impatient: [
    { key: 'npcv_impatient_bouge_caisse', gender: 'homme' },
    { key: 'npcv_impatient_incompetents', gender: 'homme' },
    { key: 'npcv_impatient_degage_route', gender: 'homme' },
    { key: 'npcv_impatient_touriste', gender: 'homme' },
    { key: 'npcv_impatient_clients_attendent', gender: 'homme' },
    { key: 'npcv_impatient_bouge_vehicule', gender: 'homme' },
    { key: 'npcv_impatient_constat', gender: 'homme' },
    { key: 'npcv_impatient_quil_fiche', gender: 'homme' },
    { key: 'npcv_impatient_aveugle', gender: 'homme' },
    { key: 'npcv_impatient_fatigue_nuls', gender: 'homme' },
    { key: 'npcv_impatient_bloque_quartier', gender: 'homme' },
    { key: 'npcv_impatient_abimer_caisse', gender: 'homme' },
    { key: 'npcv_impatient_idiot', gender: 'homme' },
    { key: 'npcv_impatient_apprendre_rouler', gender: 'homme' },
    { key: 'npcv_impatient_ca_klaxonne', gender: 'homme' },
  ],
  // "menace_directe" = réaction PERSONNELLE d'un PNJ directement visé par une
  // arme (menacé, mains en l'air/fuite) ou touché par un tir mais encore en
  // vie — distinct du groupe "panique" (témoins qui réagissent à une violence
  // qu'ils voient de loin). Voix homme UNIQUEMENT (contenu fourni ainsi) : ne
  // pas utiliser pour un PNJ femme, voir npcVoiceReaction / le choix du groupe
  // selon le genre dans game.js. Le cri immédiat au moment de l'impact d'une
  // balle (playNpcHitCry, cri_png_*) reste inchangé, cette liste ne s'y substitue pas.
  menace_directe: [
    { key: 'npc_menace_a_l_aide_on_m_attaque', gender: 'homme' },
    { key: 'npc_menace_a_l_aide', gender: 'homme' },
    { key: 'npc_menace_a_l_assacin', gender: 'homme' },
    { key: 'npc_menace_aah_non_arrette', gender: 'homme' },
    { key: 'npc_menace_aahhh_ai_ahh_c_est_torible', gender: 'homme' },
    { key: 'npc_menace_aahhhhh_c_est_affreu', gender: 'homme' },
    { key: 'npc_menace_aaii', gender: 'homme' },
    { key: 'npc_menace_ah_eh_oh_la_police', gender: 'homme' },
    { key: 'npc_menace_aidez_moi_il_veux_me_tue', gender: 'homme' },
    { key: 'npc_menace_aidez_moi_par_pitie', gender: 'homme' },
    { key: 'npc_menace_aidez_moi_sil_vous_plais', gender: 'homme' },
    { key: 'npc_menace_aii', gender: 'homme' },
    { key: 'npc_menace_au_voleur', gender: 'homme' },
    { key: 'npc_menace_ai_ai_ai_ai_hum_hu_m', gender: 'homme' },
    { key: 'npc_menace_ai_ai', gender: 'homme' },
    { key: 'npc_menace_ai_aii', gender: 'homme' },
    { key: 'npc_menace_ai_c_est_trop_ca_fait_ma_l', gender: 'homme' },
    { key: 'npc_menace_ai_ai_ai_c_est_pas_vrai_s', gender: 'homme' },
    { key: 'npc_menace_ai_ca_brule', gender: 'homme' },
    { key: 'npc_menace_ai', gender: 'homme' },
    { key: 'npc_menace_ai_2', gender: 'homme' },
    { key: 'npc_menace_c_est_fini', gender: 'homme' },
    { key: 'npc_menace_c_est_torible', gender: 'homme' },
    { key: 'npc_menace_c_est_trop', gender: 'homme' },
    { key: 'npc_menace_c_est_un_cochemare', gender: 'homme' },
    { key: 'npc_menace_ehh_ooh', gender: 'homme' },
    { key: 'npc_menace_haaah_c_est_la_fi_n', gender: 'homme' },
    { key: 'npc_menace_hau_mon_dieu', gender: 'homme' },
    { key: 'npc_menace_ho_non_au_secoure', gender: 'homme' },
    { key: 'npc_menace_ho_non_c_est_un_cochemar', gender: 'homme' },
    { key: 'npc_menace_ho_non_non_non_c_est_la_fin', gender: 'homme' },
    { key: 'npc_menace_j_ai_mal', gender: 'homme' },
    { key: 'npc_menace_je_n_est_rien_prenez_tous', gender: 'homme' },
    { key: 'npc_menace_je_n_est_rien_fait', gender: 'homme' },
    { key: 'npc_menace_je_ne_sans_plus_ma_jamb_e', gender: 'homme' },
    { key: 'npc_menace_je_vais_mourir', gender: 'homme' },
    { key: 'npc_menace_je_voux_en_supli', gender: 'homme' },
    { key: 'npc_menace_laissez_moi_la_vie_sauve', gender: 'homme' },
    { key: 'npc_menace_laissez_moi_tranquile', gender: 'homme' },
    { key: 'npc_menace_laisse_moi_partir_je_vous_en', gender: 'homme' },
    { key: 'npc_menace_laisse_moi_partir', gender: 'homme' },
    { key: 'npc_menace_laisse_moi_tranquile_je_n_es', gender: 'homme' },
    { key: 'npc_menace_ma_jambe_ca_seigne', gender: 'homme' },
    { key: 'npc_menace_ma_jambe', gender: 'homme' },
    { key: 'npc_menace_ne_me_faites_pas_de_mal_lais', gender: 'homme' },
    { key: 'npc_menace_ne_me_tue_pas', gender: 'homme' },
    { key: 'npc_menace_ne_me_tue_pas_je_vous_s_en_s', gender: 'homme' },
    { key: 'npc_menace_non_non_ne_faites_pas_ca', gender: 'homme' },
    { key: 'npc_menace_non_hummmmmmm', gender: 'homme' },
    { key: 'npc_menace_oh_mon_bras', gender: 'homme' },
    { key: 'npc_menace_ollala_fuiez', gender: 'homme' },
    { key: 'npc_menace_ouuuu', gender: 'homme' },
    { key: 'npc_menace_pitie_je_ne_veux_pas_mourir', gender: 'homme' },
    { key: 'npc_menace_pitie_laissez_moi_partir_je', gender: 'homme' },
    { key: 'npc_menace_pitie_laissez_moi_partir_je_2', gender: 'homme' },
    { key: 'npc_menace_pitie', gender: 'homme' },
    { key: 'npc_menace_pittier', gender: 'homme' },
    { key: 'npc_menace_quelcun_m_enttand_aidez_moi', gender: 'homme' },
    { key: 'npc_menace_quesque_vous_voullez', gender: 'homme' },
    { key: 'npc_menace_recule', gender: 'homme' },
    { key: 'npc_menace_sauvez_moi', gender: 'homme' },
    { key: 'npc_menace_sil_vous_plais_nonnn', gender: 'homme' },
    { key: 'npc_menace_ca_fait_mal', gender: 'homme' },
    { key: 'npc_menace_ca_seigne', gender: 'homme' },
    { key: 'npc_menace_ca_souffi', gender: 'homme' },
  ],
};
window.NPCVoiceGroups = NPCVoiceGroups;
// ============================================================
// VRAI MOTEUR ENREGISTRÉ (RealEngine) — pour les véhicules thermiques
// "sport" qui font vraiment du bruit. Deux boucles de régime (cruise à
// bas régime, vitesse stable à haut régime) jouent en même temps, avec
// un fondu enchaîné entre les deux selon la vitesse, et un pitch continu
// (playbackRate) qui simule la montée en régime. Des sons ponctuels
// d'accélération/décélération/freinage se déclenchent par-dessus, choisis
// selon l'ampleur et la vitesse réelles du changement — pas au hasard.
// Électriques et véhicules volants restent sur le moteur synthétique
// (Audio.playEngine) pour l'instant, en attendant leurs propres sons.
const RealEngine = {
  active: false, vehicleId: null,
  lowKey: 'veh1_cruise', highKey: 'veh1_vitesse_stable',
  lastSpeedRatio: 0, lastEventTime: 0, startedAt: 0,
  start(vehicleId) {
    if (this.active && this.vehicleId === vehicleId) return;
    if (this.active) this.stop();
    this.vehicleId = vehicleId;
    this.active = true;
    this.startedAt = Date.now();
    this.lastSpeedRatio = 0;
    AudioLib.playOnce('veh1_demarrage', { volume: 0.6 });
  },
  stop() {
    if (!this.active) return;
    this.active = false; this.vehicleId = null;
    AudioLib.stopLoop(this.lowKey);
    AudioLib.stopLoop(this.highKey);
  },
  // Appelé à chaque déplacement en véhicule thermique (voir driveVehicle).
  update(v, cls, speedRatio) {
    if (!this.active || this.vehicleId !== v.id) this.start(v.id);
    // Les deux boucles de régime ne démarrent qu'une fois le démarrage fini,
    // pour ne pas se superposer au son du contact.
    if (Date.now() - this.startedAt < 850) return;
    if (!AudioLib.isLoopPlaying(this.lowKey)) AudioLib.playLoop(this.lowKey, 0.3);
    if (!AudioLib.isLoopPlaying(this.highKey)) AudioLib.playLoop(this.highKey, 0);
    const low = AudioLib.loopElements[this.lowKey], high = AudioLib.loopElements[this.highKey];
    const mix = Math.min(1, speedRatio * 1.3);
    // Un seul jeu d'enregistrements (veh1_*) sert à la fois pour le Sport GT,
    // l'hypercar et les grosses motos sportives (tous cls.sport) : sans rien
    // de plus, les quatre sonnaient de façon rigoureusement identique. On
    // module le régime de base selon cls.baseFreq du catalogue (déjà pensé
    // pour distinguer les véhicules, mais jusqu'ici ignoré par ce moteur
    // échantillonné) pour qu'une moto sonne clairement plus aiguë/nerveuse
    // qu'une GT, et l'hypercar légèrement au-dessus de la GT.
    const pitch = 0.85 + UTIL.clamp(((cls.baseFreq || 60) - 55) / 45, 0, 1) * 0.4;
    if (low) { low.volume = 0.32 * (1 - mix) + 0.05; low.playbackRate = (0.8 + speedRatio * 0.55) * pitch; }
    if (high) { high.volume = 0.4 * mix; high.playbackRate = (0.85 + speedRatio * 0.5) * pitch; }
    // Détection des évènements (accélération franche, décélération, freinage)
    // à partir de la vraie variation de vitesse — pas un minuteur aveugle.
    // Le seuil de décélération (0.18) était sensiblement plus strict que celui
    // d'accélération (0.14) : un ralentissement progressif (relâcher sans
    // freiner franchement) ne l'atteignait quasiment jamais, d'où le son de
    // ralentissement quasi absent signalé. Rapproché du seuil d'accélération.
    const now = Date.now();
    const delta = speedRatio - this.lastSpeedRatio;
    this.lastSpeedRatio = speedRatio;
    if (now - this.lastEventTime < 650) return;
    if (delta > 0.14 && speedRatio > 0.15) { // il faut rouler un minimum : pas de son d'accélération à l'arrêt (tapotage)
      this.lastEventTime = now;
      const key = delta > 0.3 ? 'veh1_accel_forte' : UTIL.pick(['veh1_accel_courte1', 'veh1_accel_courte2', 'veh1_accel_progressive2']);
      AudioLib.playOnce(key, { volume: 0.4, exclusive: 'realengine_event' });
      if (speedRatio > 0.75 && delta > 0.25) AudioLib.playOnce(UTIL.pick(['veh1_turbo_1', 'veh1_turbo_2']), { volume: 0.3, exclusive: 'realengine_event' });
    } else if (delta < -0.12) {
      this.lastEventTime = now;
      const key = speedRatio > 0.55 ? 'veh1_decel_haute_vitesse' : UTIL.pick(['veh1_decel_1', 'veh1_petit_decel_1', 'veh1_petit_decel_2']);
      AudioLib.playOnce(key, { volume: 0.35, exclusive: 'realengine_event' });
    }
  },
  // Freinage volontaire (espace) : plus fort qu'une simple décélération.
  // Diffusé aux joueurs proches (passager compris) : avant, seul le
  // conducteur entendait son propre freinage.
  brake(speedRatio) {
    const key = speedRatio > 0.5 ? 'veh1_frenage_brusque_haute_vitesse' : UTIL.pick(['veh1_frenage_1', 'veh1_frenage_2', 'veh1_frenage_3', 'veh1_frenage_4', 'veh1_frenage_5']);
    AudioLib.playOnce(key, { volume: 0.45, exclusive: 'realengine_brake' });
    if (window.Net && Net.connected) Net.emitSound(key, { vol: 0.45 });
  },
};

// ============================================================
// VRAI MOTEUR AÉRIEN ENREGISTRÉ (avions et hélicoptères) — même principe que
// RealEngine pour les véhicules au sol, en plus simple : une seule boucle de
// régime (le son diffère déjà bien entre avion et hélicoptère), avec pitch
// continu selon la vitesse, démarrage/arrêt réels, et un "crachotement"
// occasionnel si l'appareil est endommagé.
const RealAirEngine = {
  active: false, vehicleId: null, type: null, startedAt: 0,
  start(vehicleId, isPlane) {
    if (this.active && this.vehicleId === vehicleId) return;
    if (this.active) this.stop();
    this.vehicleId = vehicleId; this.type = isPlane ? 'avion' : 'helico'; this.active = true;
    this.startedAt = Date.now();
    AudioLib.playOnce(isPlane ? 'avion_demarrage' : 'helico_demarrage', { volume: 0.6 });
  },
  stop() {
    if (!this.active) return;
    AudioLib.stopLoop('avion_stable');
    AudioLib.stopLoop('helico_stable');
    if (this.type) AudioLib.playOnce(this.type === 'avion' ? 'avion_arret' : 'helico_arret', { volume: 0.5 });
    this.active = false; this.vehicleId = null; this.type = null;
  },
  update(v, cls, speedRatio) {
    const isPlane = v.type === 'avion';
    if (!this.active || this.vehicleId !== v.id) this.start(v.id, isPlane);
    if (Date.now() - this.startedAt < 900) return; // laisse finir le démarrage
    const loopKey = isPlane ? 'avion_stable' : 'helico_stable';
    if (!AudioLib.isLoopPlaying(loopKey)) AudioLib.playLoop(loopKey, 0.4);
    const el = AudioLib.loopElements[loopKey];
    if (el) { el.volume = 0.25 + speedRatio * 0.25; el.playbackRate = 0.85 + speedRatio * 0.4; }
    // Appareil endommagé : le moteur crachote de temps en temps.
    if (v.hp < 30 && Math.random() < 0.01) AudioLib.playOnce('avion_helico_crache', { volume: 0.4, exclusive: true });
  },
};

// ============================================================
// FABRIQUE DE MOTEUR ÉCHANTILLONNÉ INTELLIGENT — factorise ce que RealEngine
// faisait pour le moteur sport, en plus riche : TROIS boucles de régime
// (basse/moyenne/haute) qui se fondent en continu selon la vitesse réelle
// (pas juste deux), avec un son de transition quand on change vraiment de
// palier, et des évènements ponctuels (accélération/décélération) choisis
// selon l'ampleur et la vitesse réelles du changement. Utilisée pour créer
// le moteur "véhicule2" (BMW et autres véhicules non-sport) et le moteur
// électrique, qui partagent la même logique mais des sons différents.
function createSampleEngine(keys) {
  return {
    active: false, vehicleId: null, startedAt: 0, lastSpeedRatio: 0, lastEventTime: 0, lastTier: null,
    start(vehicleId) {
      if (this.active && this.vehicleId === vehicleId) return;
      if (this.active) this.stop();
      this.vehicleId = vehicleId; this.active = true; this.startedAt = Date.now();
      this.lastSpeedRatio = 0; this.lastTier = null;
      if (keys.declic) AudioLib.playOnce(keys.declic, { volume: 0.4 });
      setTimeout(() => AudioLib.playOnce(keys.demarrage, { volume: 0.6 }), keys.declic ? 300 : 0);
    },
    stop() {
      if (!this.active) return;
      this.active = false; this.vehicleId = null;
      [keys.basse, keys.moyenne, keys.haute].forEach(k => AudioLib.stopLoop(k));
      AudioLib.playOnce(keys.arret, { volume: 0.5 });
    },
    update(v, speedRatio) {
      if (!this.active || this.vehicleId !== v.id) this.start(v.id);
      if (Date.now() - this.startedAt < 750) return; // laisse finir le démarrage
      [keys.basse, keys.moyenne, keys.haute].forEach(k => { if (!AudioLib.isLoopPlaying(k)) AudioLib.playLoop(k, 0); });
      // Fondu enchaîné continu entre les trois paliers de régime.
      const wBasse = Math.max(0, 1 - speedRatio * 2.2);
      const wHaute = Math.max(0, (speedRatio - 0.5) * 2.2);
      const wMoyenne = Math.max(0, 1 - wBasse - wHaute);
      const elB = AudioLib.loopElements[keys.basse], elM = AudioLib.loopElements[keys.moyenne], elH = AudioLib.loopElements[keys.haute];
      if (elB) { elB.volume = wBasse * 0.35; elB.playbackRate = 0.85 + speedRatio * 0.25; }
      if (elM) { elM.volume = wMoyenne * 0.35; elM.playbackRate = 0.9 + speedRatio * 0.3; }
      if (elH) { elH.volume = wHaute * 0.4; elH.playbackRate = 0.9 + speedRatio * 0.35; }
      // Son de transition uniquement quand on change vraiment de palier de
      // régime (pas à chaque frame) — c'est ce qui rend l'ensemble cohérent.
      const tier = speedRatio < 0.3 ? 'basse' : speedRatio < 0.7 ? 'moyenne' : 'haute';
      if (this.lastTier && tier !== this.lastTier && keys.transition) AudioLib.playOnce(keys.transition, { volume: 0.25, exclusive: keys.demarrage + '_event' });
      this.lastTier = tier;
      // Évènements ponctuels (accélération/décélération) selon la vraie
      // variation de vitesse — pas un minuteur aveugle.
      const now = Date.now();
      const delta = speedRatio - this.lastSpeedRatio;
      this.lastSpeedRatio = speedRatio;
      if (now - this.lastEventTime < 700) return;
      if (delta > 0.14 && speedRatio > 0.15) { // pas de son d'accélération à l'arrêt (tapotage)
        this.lastEventTime = now;
        AudioLib.playOnce(delta > 0.3 ? keys.accelForte : UTIL.pick(keys.accels), { volume: 0.4, exclusive: keys.demarrage + '_event' });
      } else if (delta < -0.12) { // rapproché du seuil d'accélération : un ralentissement progressif n'atteignait presque jamais -0.18
        this.lastEventTime = now;
        AudioLib.playOnce(speedRatio > 0.55 ? keys.decelLongue : UTIL.pick(keys.decels), { volume: 0.35, exclusive: keys.demarrage + '_event' });
      }
    },
    // Freinage volontaire (espace) : avant, seul le kit sport (RealEngine)
    // avait un vrai son de freinage — la majorité des véhicules (normaux et
    // électriques) rejouait un simple son de décélération générique (pas un
    // vrai bruit de frein), ou gardait le silence à faible vitesse. keys.frein
    // (fichier fourni, jusque-là jamais utilisé) donne maintenant un vrai son
    // de freinage dédié. Diffusé aux joueurs proches (passager compris),
    // comme RealEngine.brake().
    brake(speedRatio) {
      const key = keys.frein || (speedRatio > 0.5 ? keys.decelLongue : UTIL.pick(keys.decels));
      AudioLib.playOnce(key, { volume: 0.5, exclusive: keys.demarrage + '_event' });
      if (window.Net && Net.connected) Net.emitSound(key, { vol: 0.5 });
    },
  };
}
// Moteur "véhicule2" : BMW et autres véhicules qui ne sont ni des engins de
// sport bruyants, ni électriques — la majorité du parc (berlines, SUV, taxis,
// motos faibles, camions...).
const RealEngine2 = createSampleEngine({
  demarrage: 'veh2_demarrage', arret: 'veh2_arret', declic: 'veh2_declic_avant_demarrage',
  basse: 'veh2_vitesse_basse', moyenne: 'veh2_vitesse_moyenne', haute: 'veh2_vitesse_haute',
  transition: 'veh2_transition',
  accels: ['veh2_accel_1', 'veh2_accel_2', 'veh2_accel_3', 'veh2_accel_pendant_vitesse', 'veh2_petit_accel'],
  accelForte: 'veh2_accel_forte',
  decels: ['veh2_decel_1', 'veh2_decel_douce', 'veh2_relachement_1', 'veh2_relachement_2'],
  decelLongue: 'veh2_decel_longue',
  frein: 'veh_frein_main', // vrai son de frein (jusque-là fourni mais jamais utilisé)
});
// Moteur électrique : silence relatif, montée en régime linéaire, pas de
// rugissement — utilisé pour les véhicules marqués `electric: true`.
const RealElectricEngine = createSampleEngine({
  demarrage: 'veh_elec_demarrage', arret: 'veh_elec_arret',
  basse: 'veh_elec_vitesse_basse', moyenne: 'veh_elec_vitesse_moyenne', haute: 'veh_elec_vitesse_haute',
  transition: 'veh_elec_transition',
  accels: ['veh_elec_accel_1', 'veh_elec_accel_2', 'veh_elec_accel_3', 'veh_elec_accel_pendant_vitesse', 'veh_elec_petit_accel'],
  accelForte: 'veh_elec_accel_forte',
  decels: ['veh_elec_decel_1', 'veh_elec_decel_douce', 'veh_elec_relachement_1', 'veh_elec_relachement_2'],
  decelLongue: 'veh_elec_decel_longue',
  frein: 'veh_frein_main', // même son de frein réel que les véhicules normaux
});

const AudioLib = {
  loopElements: {},
  loopShouldPlay: {}, // clés des boucles censées jouer actuellement (pour les relancer si le navigateur les coupe)
  loopVolumes: {},
  activeOneShots: new Set(), // garde une référence vive tant qu'un son ponctuel joue (voir playOnce)
  unlocked: false,
  RINGTONES: ['sonnerie_1', 'sonnerie_2', 'sonnerie_3', 'sonnerie_4'],
  // Débloque la lecture des fichiers <audio> au premier geste utilisateur.
  // Sans ça, après une pause ou un changement d'onglet, le navigateur refuse
  // souvent de relancer play() — d'où des ambiances qui marchent une fois puis
  // plus. On force ici chaque élément de boucle à être "réveillé".
  // Boucles jouées via Web Audio (AudioBufferSourceNode.loop) : le bouclage est
  // alors sample-exact, SANS le micro-silence audible que laisse HTMLAudio.loop
  // à chaque tour. Les fichiers fournis, coupés au plus juste, bouclent donc de
  // façon parfaitement continue. loopElements[key] reste un objet exposant
  // .volume / .playbackRate / .paused pour rester compatible avec les moteurs.
  _loopBuffers: {},
  _loopLoading: {},
  _ensureLoopBuffer(key) {
    if (this._loopBuffers[key]) return Promise.resolve(this._loopBuffers[key]);
    if (this._loopLoading[key]) return this._loopLoading[key];
    const src = SOUND_FILES[key];
    if (!src || !Audio.ensure) { return Promise.resolve(null); }
    // En local (file://), fetch est bloqué par la politique CORS : on bascule
    // directement sur le repli HTMLAudio (voir playLoop). En production (https),
    // le décodage Web Audio se fait normalement, pour un bouclage sans coupure.
    if (typeof location !== 'undefined' && location.protocol === 'file:') return Promise.resolve(null);
    const ctx = Audio.ensure();
    const p = fetch(src).then(r => r.arrayBuffer()).then(ab => ctx.decodeAudioData(ab))
      .then(buf => { this._loopBuffers[key] = buf; delete this._loopLoading[key]; return buf; })
      .catch(() => { delete this._loopLoading[key]; return null; });
    this._loopLoading[key] = p;
    return p;
  },
  _startLoop(key) {
    if (!this.loopShouldPlay[key] || this.isLoopPlaying(key)) return;
    const buf = this._loopBuffers[key];
    if (!buf || !Audio.ensure) return;
    const ctx = Audio.ensure();
    const source = ctx.createBufferSource();
    source.buffer = buf; source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = this.loopVolumes[key] != null ? this.loopVolumes[key] : 1;
    source.connect(gain).connect(Audio.master || ctx.destination);
    try { source.start(); } catch (e) {}
    this.loopElements[key] = {
      _source: source, _gain: gain, playing: true,
      get volume() { return this._gain.gain.value; },
      set volume(v) { try { this._gain.gain.value = v; } catch (e) {} },
      get playbackRate() { return this._source.playbackRate.value; },
      set playbackRate(r) { try { this._source.playbackRate.value = r; } catch (e) {} },
      get paused() { return !this.playing; },
    };
  },
  unlock() {
    this.unlocked = true;
    Object.keys(this.loopShouldPlay).forEach(k => {
      if (this.loopShouldPlay[k] && !this.isLoopPlaying(k)) this.playLoop(k, this.loopVolumes[k] != null ? this.loopVolumes[k] : 1);
    });
  },
  // Relance toute boucle qui devrait jouer mais ne joue pas (onglet inactif,
  // décodage tardif, coupure système...). Recrée le nœud si nécessaire.
  tickLoops() {
    if (!this.unlocked) return;
    Object.keys(this.loopShouldPlay).forEach(k => {
      if (this.loopShouldPlay[k] && !this.isLoopPlaying(k)) this.playLoop(k, this.loopVolumes[k] != null ? this.loopVolumes[k] : 1);
    });
  },
  getLoopElement(key) { return this.loopElements[key] || null; },
  // Repli HTMLAudio (bouclage avec un léger gap) quand Web Audio n'est pas
  // disponible : garantit que la boucle joue quand même.
  _startLoopFallback(key) {
    if (!this.loopShouldPlay[key] || this.isLoopPlaying(key)) return;
    const src = SOUND_FILES[key]; if (!src) return;
    const a = new (window.Audio)(src); a.preload = 'auto'; a.loop = true;
    a.volume = this.loopVolumes[key] != null ? this.loopVolumes[key] : 1;
    a.addEventListener('pause', () => { if (this.loopShouldPlay[key] && this.unlocked) setTimeout(() => { if (a.paused && this.loopShouldPlay[key]) a.play().catch(() => {}); }, 200); });
    this.loopElements[key] = {
      _a: a, playing: true,
      get volume() { return this._a.volume; },
      set volume(v) { try { this._a.volume = Math.max(0, Math.min(1, v)); } catch (e) {} },
      get playbackRate() { return this._a.playbackRate; },
      set playbackRate(r) { try { this._a.playbackRate = r; } catch (e) {} },
      get paused() { return this._a.paused; },
    };
    a.play().catch(() => {});
  },
  playLoop(key, volume = 1) {
    this.loopVolumes[key] = volume;
    this.loopShouldPlay[key] = true;
    const node = this.loopElements[key];
    if (node && node.playing) { node.volume = volume; return; }
    if (this._loopBuffers[key]) { this._startLoop(key); return; }
    this._ensureLoopBuffer(key).then(buf => { if (buf) this._startLoop(key); else this._startLoopFallback(key); });
  },
  stopLoop(key) {
    this.loopShouldPlay[key] = false;
    const node = this.loopElements[key];
    if (node) {
      if (node._source) { try { node._source.stop(); } catch (e) {} }
      if (node._a) { try { node._a.pause(); node._a.currentTime = 0; } catch (e) {} }
      node.playing = false; this.loopElements[key] = null;
    }
  },
  isLoopPlaying(key) { const n = this.loopElements[key]; return !!(n && n.playing && !n.paused); },
  // Boucles PANNÉES à INSTANCES MULTIPLES : contrairement à playLoop/loopElements
  // (une seule instance globale par clé de son, pour le moteur de SON PROPRE
  // véhicule), ceci permet de faire jouer le MÊME fichier plusieurs fois en même
  // temps, chacun avec son propre panoramique/volume — nécessaire pour entendre
  // à la fois plusieurs véhicules d'autres joueurs autour de soi, chacun localisé
  // à sa position. instanceId = identifiant unique (ex. 'ambveh_' + idJoueur).
  instanceLoops: {},
  playLoopInstance(instanceId, key, volume = 0.3, pan = 0) {
    const existing = this.instanceLoops[instanceId];
    if (existing && existing.key === key) {
      // Lissage natif (Web Audio AudioParam) au lieu d'un saut instantané :
      // ceci n'est rappelé qu'une fois par tick (~400ms, voir
      // Game.tickAmbientVehicles), donc sans ça, un véhicule qui passe se
      // déplaçait par à-coups au lieu de glisser en continu d'une position à
      // l'autre. setTargetAtTime approche la nouvelle valeur en douceur,
      // sans avoir besoin d'une boucle d'interpolation JS séparée.
      const ctx = Audio.ensure();
      const now = ctx.currentTime;
      existing.gain.gain.setTargetAtTime(volume, now, 0.15);
      if (existing.panner) existing.panner.pan.setTargetAtTime(pan, now, 0.15);
      return;
    }
    if (existing) this.stopLoopInstance(instanceId);
    if (!Audio.ensure) return;
    const ctx = Audio.ensure();
    const buf = this._loopBuffers[key];
    if (!buf) { this._ensureLoopBuffer(key); return; } // pas encore décodé : réessayé au prochain tick
    const source = ctx.createBufferSource();
    source.buffer = buf; source.loop = true;
    const gain = ctx.createGain(); gain.gain.value = volume;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; source.connect(gain).connect(panner).connect(Audio.master || ctx.destination); }
    else source.connect(gain).connect(Audio.master || ctx.destination);
    try { source.start(); } catch (e) {}
    this.instanceLoops[instanceId] = { key, source, gain, panner };
  },
  stopLoopInstance(instanceId) {
    const inst = this.instanceLoops[instanceId];
    if (!inst) return;
    try { inst.source.stop(); } catch (e) {}
    delete this.instanceLoops[instanceId];
  },
  // clé -> instance en cours pour les sons "exclusifs" (voir opts.exclusive) :
  // les sons de véhicule (moteur, accélération...) se redemandent très
  // souvent en peu de temps ; sans ça, chaque nouvel appel s'empilait sur les
  // précédents encore en cours de lecture, ce qui finissait par faire un bruit
  // de fond confus et désagréable au lieu d'un vrai son de moteur.
  _exclusiveByKey: {},
  playOnce(key, opts = {}) {
    const src = SOUND_FILES[key];
    if (!src) return null;
    // opts.exclusive: true -> exclusif par SA PROPRE clé ; une chaîne -> un
    // "canal" partagé explicite (ex. plusieurs sons ponctuels du moteur d'un
    // même véhicule, choisis au hasard parmi plusieurs fichiers, qui doivent
    // quand même se couper les uns les autres au lieu de s'empiler).
    const exclKey = opts.exclusive === true ? key : opts.exclusive;
    if (exclKey) {
      const prev = this._exclusiveByKey[exclKey];
      if (prev) { try { prev.pause(); } catch (e) {} this.activeOneShots.delete(prev); }
    }
    // Un nouvel élément à chaque appel : deux tirs rapprochés ne se coupent pas la parole.
    const a = new (window.Audio)(src);
    a.preload = 'auto';
    a.loop = false; a.volume = opts.volume !== undefined ? opts.volume : 1;
    if (opts.rate) a.playbackRate = opts.rate; // ex. pas plus lourds/graves sous un gilet blindé
    // On garde une référence vive tant que ça joue : un élément Audio créé puis
    // jamais gardé nulle part ailleurs (cas de la plupart des appels "tir et
    // oublie" dans ce jeu) peut sinon être coupé en plein milieu par le
    // ramasse-miettes du navigateur, qui ne sait pas qu'il doit attendre la fin.
    this.activeOneShots.add(a);
    if (exclKey) this._exclusiveByKey[exclKey] = a;
    const cleanup = () => { this.activeOneShots.delete(a); if (exclKey && this._exclusiveByKey[exclKey] === a) delete this._exclusiveByKey[exclKey]; };
    a.addEventListener('ended', cleanup, { once: true });
    a.addEventListener('error', cleanup, { once: true });
    if (opts.onEnded) a.addEventListener('ended', opts.onEnded, { once: true });
    a.play().catch(cleanup);
    return a;
  },
  // Voix (cris, réactions parlées) : une seule à la fois. On coupe la voix
  // précédente avant d'en jouer une nouvelle, pour qu'elles ne se compilent
  // jamais quand elles s'enchaînent rapidement.
  _currentVoice: null,
  playVoice(key, opts = {}) {
    if (this._currentVoice) { try { this._currentVoice.pause(); } catch (e) {} this.activeOneShots.delete(this._currentVoice); }
    const a = this.playOnce(key, opts);
    this._currentVoice = a;
    if (a) a.addEventListener('ended', () => { if (this._currentVoice === a) this._currentVoice = null; }, { once: true });
    return a;
  },
  randomRingtone() { return UTIL.pick(this.RINGTONES); },
  // Joue un son `times` fois de suite (chaînées via l'évènement 'ended', pas
  // un simple .loop) puis appelle onDone. Permet de garantir un nombre exact
  // de répétitions (ex : compte à rebours d'une grenade) plutôt qu'une durée.
  // Renvoie un objet { cancel() } pour interrompre la séquence en cours.
  playRepeated(key, times, onDone, opts = {}) {
    let count = 0, cancelled = false, current = null;
    const step = () => {
      if (cancelled) return;
      count++;
      if (count > times) { if (onDone) onDone(); return; }
      current = this.playOnce(key, { volume: opts.volume, onEnded: step });
    };
    step();
    return { cancel() { cancelled = true; if (current) { current.pause(); try { current.currentTime = 0; } catch (e) {} } } };
  },
  // Joue le son de notification choisi par l'utilisateur dans Réglages
  // (sonnerie par défaut ou l'une des 4 sonneries alternatives fournies).
  playNotification(opts) { return this.playOnce(CONFIG.NOTIFICATION_SOUND || 'sfx_notification', opts); },
  // Lecture avec panoramique gauche/droite (utilisée pour les voix des PNJ,
  // afin que le joueur perçoive d'où vient la réaction). Repli automatique
  // sur une lecture simple si l'API Web Audio n'est pas disponible.
  playPositional(key, pan = 0, volume = 1) {
    const src = SOUND_FILES[key];
    if (!src) return null;
    try {
      const ctx = Audio.ensure();
      const a = new (window.Audio)(src);
      a.preload = 'auto';
      a.volume = 1;
      const node = ctx.createMediaElementSource(a);
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const gain = ctx.createGain(); gain.gain.value = volume;
      if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(panner).connect(gain).connect(Audio.master); }
      else { node.connect(gain).connect(Audio.master); }
      this.activeOneShots.add(a);
      const cleanup = () => { this.activeOneShots.delete(a); };
      a.addEventListener('ended', cleanup, { once: true });
      a.addEventListener('error', cleanup, { once: true });
      a.play().catch(cleanup);
      return a;
    } catch (e) {
      return this.playOnce(key, { volume });
    }
  },
  stopAllAmbient() {
    ['amb_matin', 'amb_oiseaux', 'amb_aeroport', 'amb_foret', 'amb_pluie', 'amb_feu', 'sfx_grillade', 'sfx_alarme_antivol'].forEach(k => this.stopLoop(k));
  },
  stopAllRingtones() { this.RINGTONES.forEach(k => this.stopLoop(k)); this.stopLoop('sfx_attente_appel'); },
};
window.AudioLib = AudioLib;

/* ============================================================
   MÉTÉO ET AMBIANCES DE ZONE
   Pilotent automatiquement les sons d'ambiance en boucle selon
   la météo, l'heure réelle de l'appareil et l'endroit où se
   trouve le joueur dans la ville.
============================================================ */
const Weather = {
  state: 'clair', // 'clair' | 'pluie'
  // En multijoueur, la météo vient DU SERVEUR (voir Net.handleMessage,
  // 'weather_change') : tout le monde sur le même serveur voit la même pluie
  // au même moment, au lieu que chaque client la tire indépendamment au
  // hasard (avant, deux joueurs côte à côte pouvaient avoir un temps différent).
  applyState(newState, sayIt) {
    if (newState === this.state) return;
    this.state = newState;
    if (sayIt) announce(newState === 'pluie' ? 'Le ciel se couvre, il commence à pleuvoir.' : 'La pluie s\'arrête, le ciel se dégage.', 'polite');
    if (this.state === 'pluie') AudioLib.playLoop('amb_pluie', 0.18); else AudioLib.stopLoop('amb_pluie');
  },
  // Repli SOLO uniquement (pas connecté à un serveur) : tirage local, comme
  // avant. Dès qu'un serveur est connecté, c'est lui qui décide (voir
  // Net.handleMessage) et ce tirage local ne s'exécute plus.
  tick() {
    if (Net.connected) return;
    // Probabilités ASYMÉTRIQUES : il se met rarement à pleuvoir, et la pluie
    // s'arrête vite. Avant, un simple basculement à 12 % faisait pleuvoir
    // environ la moitié du temps — beaucoup trop. Repassé de 8 % à 1,5 % par
    // tick (~90 s) : la pluie reste possible mais devient un évènement rare
    // au lieu de revenir toutes les 15-20 minutes en moyenne.
    if (this.state === 'clair') { if (UTIL.chance(0.015)) this.applyState('pluie', true); }
    else { if (UTIL.chance(0.6)) this.applyState('clair', true); }
  },
};
// Cycle jour/nuit : même principe que Weather (voir ci-dessus) — en
// multijoueur, l'heure vient DU SERVEUR (Net.handleMessage, 'daynight_change'
// + welcome), partagée par tout le monde ; en solo, calculée localement
// depuis l'heure de lancement de la partie. Une journée complète dure
// DAY_LENGTH_MS de temps réel (1h réelle = 24h en jeu).
const DayNight = {
  phase: 'jour', // 'aube' | 'jour' | 'crepuscule' | 'nuit'
  hour: 12,
  DAY_LENGTH_MS: 60 * 60 * 1000,
  _localStart: Date.now(),
  PHASE_LABELS: {
    aube: 'Le jour se lève sur la ville.',
    jour: 'Il fait grand jour.',
    crepuscule: 'Le crépuscule tombe, la nuit approche.',
    nuit: 'La nuit est tombée sur la ville.',
  },
  computePhase(hour) {
    if (hour >= 5 && hour < 7) return 'aube';
    if (hour >= 7 && hour < 18) return 'jour';
    if (hour >= 18 && hour < 20) return 'crepuscule';
    return 'nuit';
  },
  applyState(newPhase, hour, sayIt) {
    if (typeof hour === 'number') this.hour = hour;
    if (newPhase === this.phase) return;
    this.phase = newPhase;
    if (sayIt) announce(this.PHASE_LABELS[newPhase] || '', 'polite');
    if (typeof AmbientZones !== 'undefined') AmbientZones.current = null; // force une réévaluation de l'ambiance sonore au prochain tick
  },
  // Repli SOLO uniquement (pas connecté à un serveur) : calcul local, comme
  // pour la météo. Dès qu'un serveur est connecté, c'est lui qui décide (voir
  // Net.handleMessage) et ce calcul local ne s'exécute plus.
  tick() {
    if (Net.connected) return;
    const elapsed = (Date.now() - this._localStart) % this.DAY_LENGTH_MS;
    const hour = (elapsed / this.DAY_LENGTH_MS) * 24;
    this.applyState(this.computePhase(hour), hour, true);
  },
};
const AmbientZones = {
  current: null,
  ZONE_KEYS: ['amb_aeroport', 'amb_foret', 'amb_oiseaux', 'sfx_grillade', 'amb_feu', 'amb_matin', 'amb_ville', 'amb_centre_ville_route', 'amb_interieur_couloir'],
  check() {
    if (!Game || Game.inVehicle) { this.switchTo(null); return; } // pas d'ambiance extérieure en conduisant
    const d = City.districts.find(d => Game.x >= d.x1 && Game.x <= d.x2 && Game.y >= d.y1 && Game.y <= d.y2);
    const nearRestaurant = City.pois.some(p => p.type === 'restaurant' && UTIL.dist(p, Game) < 8);
    const nearMine = City.miningSites.some(m => UTIL.dist(m, Game) < 10);
    const nearHouse = City.houses.some(h => UTIL.dist(h, Game) < 5);
    const onRoad = City.isRoad(Game.x, Game.y);
    // Phase du cycle jour/nuit PARTAGÉ (voir DayNight), pas l'heure brute de
    // l'appareil : avant, "le matin" dépendait de l'horloge du téléphone —
    // pas la même pour deux joueurs dans des fuseaux différents, et sans
    // aucun lien avec le cycle jour/nuit désormais partagé par tout le monde.
    const phase = (typeof DayNight !== 'undefined') ? DayNight.phase : 'jour';

    let zone = null;
    if (d && d.type === 'aeroport') zone = 'aeroport';
    else if (d && d.type === 'parc') zone = 'foret';
    else if (nearRestaurant) zone = 'grillade';
    else if (nearMine) zone = 'feu';
    else if (nearHouse) zone = 'interieur';
    else if (d && (d.type === 'centre' || d.type === 'commercial') && onRoad) zone = 'centre_route';
    else if (phase === 'aube') zone = 'matin';
    else if (phase === 'nuit') zone = 'nuit';
    else zone = 'ville'; // ambiance de fond par défaut, partout ailleurs en extérieur

    if (zone !== this.current) this.switchTo(zone);
  },
  switchTo(zone) {
    this.ZONE_KEYS.forEach(k => AudioLib.stopLoop(k));
    this.current = zone;
    if (zone === 'aeroport') AudioLib.playLoop('amb_aeroport', 0.55);
    else if (zone === 'foret') { AudioLib.playLoop('amb_foret', 0.6); AudioLib.playLoop('amb_oiseaux', 0.5); }
    else if (zone === 'grillade') AudioLib.playLoop('sfx_grillade', 0.5);
    else if (zone === 'feu') AudioLib.playLoop('amb_feu', 0.5);
    else if (zone === 'matin') { AudioLib.playLoop('amb_matin', 0.5); AudioLib.playLoop('amb_oiseaux', 0.35); }
    else if (zone === 'interieur') AudioLib.playLoop('amb_interieur_couloir', 0.5);
    else if (zone === 'centre_route') AudioLib.playLoop('amb_centre_ville_route', 0.3);
    // Nuit : la même ambiance de ville, mais bien plus étouffée — une ville
    // qui dort. Pas de fichier dédié à la nuit pour l'instant, donc on rejoue
    // amb_ville à faible volume plutôt que d'ajouter un silence complet.
    else if (zone === 'nuit') AudioLib.playLoop('amb_ville', 0.12);
    else if (zone === 'ville') AudioLib.playLoop('amb_ville', 0.26);
  },
};
window.Weather = Weather; window.AmbientZones = AmbientZones; window.DayNight = DayNight;

/* ============================================================
   LECTEUR DE MUSIQUE PERSONNELLE (fichier local du joueur)
   Un seul lecteur partagé, accessible depuis plusieurs "appareils" (téléphone,
   enceinte/télé chez soi, autoradio, radio portable) : ce ne sont que des
   points d'accès différents aux mêmes contrôles, pas des lecteurs séparés.
   Contrainte du navigateur : JS ne peut pas lire un fichier au hasard sur le
   disque sans que le joueur le choisisse lui-même (sécurité). Avec la File
   System Access API (Chrome/Edge), on peut retenir l'accès au VRAI fichier
   d'une session à l'autre via un "handle" stocké dans IndexedDB (localStorage
   ne peut pas contenir ce genre d'objet). Sans cette API (Firefox/Safari), on
   retombe sur un simple <input type=file> : le nom est retenu, mais il faut
   resélectionner le fichier à chaque session.
============================================================ */
const MusicPlayer = {
  audioEl: null, gainNode: null, sourceNode: null,
  fileName: null, fileHandle: null, playing: false, volume: 0.8,
  supported: typeof window.showOpenFilePicker === 'function',
  // Position de la source si c'est une ENCEINTE FIXE posée dans une maison
  // ({house, ix, iy}) : le son doit alors baisser avec la distance, comme
  // dans un vrai GTA — avant, le volume restait plein même en sortant de la
  // maison et en s'éloignant complètement. `null` = source MOBILE qui suit
  // le joueur (radio portable, autoradio) : toujours à plein volume, aucune
  // atténuation par distance n'a de sens pour elle.
  sourceRef: null,
  setSourceRef(ref) { this.sourceRef = ref; this.updateSpatialGain(); },
  // Rappelé toutes les 500 ms tant que la musique joue (voir l'intervalle plus
  // bas) : recalcule l'atténuation selon la position ACTUELLE du joueur.
  updateSpatialGain() {
    if (!this.gainNode) return;
    if (!this.sourceRef || !this.playing) { this.gainNode.gain.value = this.volume; return; }
    const g = window.Game, ref = this.sourceRef;
    let dist;
    if (g && g.interior && g.interior.ref === ref.house) {
      // Le joueur est DANS la même maison : distance sur la grille intérieure
      // (petite échelle, quelques cases par pièce).
      dist = Math.abs((g.interior.ix || 0) - ref.ix) + Math.abs((g.interior.iy || 0) - ref.iy);
      const RADIUS = 10;
      this.gainNode.gain.value = this.volume * Math.max(0, 1 - dist / RADIUS);
    } else if (g) {
      // Dehors (ou dans un autre lieu) : distance réelle jusqu'à la maison,
      // même rayon d'atténuation que la voix de proximité pour rester cohérent.
      dist = UTIL.dist(g, ref.house);
      const RADIUS = 25;
      this.gainNode.gain.value = this.volume * Math.max(0, 1 - dist / RADIUS);
    } else {
      this.gainNode.gain.value = this.volume;
    }
  },

  _ensureNodes() {
    if (this.audioEl) return;
    this.audioEl = new (window.Audio)();
    this.audioEl.loop = true; // musique perso en boucle continue, comme une vraie radio
    const ctx = Audio.ensure();
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this.volume;
    this.sourceNode = ctx.createMediaElementSource(this.audioEl);
    this.sourceNode.connect(this.gainNode).connect(Audio.master);
    this.audioEl.addEventListener('ended', () => { this.playing = false; });
  },

  // Mini IndexedDB clé/valeur, juste pour stocker le FileSystemFileHandle
  // (impossible dans localStorage, qui n'accepte que du texte).
  _dbPromise: null,
  _openDb() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('blind_city_music', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  },
  async _dbGet(key) {
    try {
      const db = await this._openDb();
      return await new Promise((resolve) => {
        const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  },
  async _dbSet(key, val) {
    try {
      const db = await this._openDb();
      return await new Promise((resolve) => {
        const r = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
        r.onsuccess = () => resolve(true);
        r.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  },

  // Doit être appelé directement depuis un clic/Entrée (geste utilisateur
  // requis par le navigateur pour choisir un fichier).
  async pickFile() {
    this._ensureNodes();
    if (this.supported) {
      let handles;
      try {
        handles = await window.showOpenFilePicker({ types: [{ description: 'Fichiers audio', accept: { 'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'] } }] });
      } catch (e) { return false; } // fenêtre annulée par le joueur
      await this._loadHandle(handles[0]);
      await this._dbSet('lastFile', handles[0]);
      return true;
    }
    // Repli sans mémorisation réelle (navigateur sans File System Access API).
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'audio/*';
      input.onchange = () => { if (input.files[0]) { this._loadPlainFile(input.files[0]); resolve(true); } else resolve(false); };
      input.click();
    });
  },
  async _loadHandle(handle) {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') { announce('Autorisation refusée pour ce fichier.', 'assertive'); return false; }
    const file = await handle.getFile();
    this.fileHandle = handle;
    this._loadPlainFile(file);
    return true;
  },
  _loadPlainFile(file) {
    this._ensureNodes();
    if (this.audioEl.src) URL.revokeObjectURL(this.audioEl.src);
    this.audioEl.src = URL.createObjectURL(file);
    this.fileName = file.name;
    localStorage.setItem('blind_city_music_name', file.name);
  },
  // Nom du dernier fichier connu, même avant tout chargement dans cette
  // session (pour l'annoncer/proposer une reprise dès l'ouverture du menu).
  lastKnownName() { return this.fileName || localStorage.getItem('blind_city_music_name'); },
  // Tente de retrouver le VRAI dernier fichier (File System Access uniquement) ;
  // resterPermission() ci-après gère la reprise avec un nouveau geste utilisateur.
  async getLastHandle() { return this.supported ? this._dbGet('lastFile') : null; },
  async resumeLastFile() {
    const handle = await this.getLastHandle();
    if (!handle) return false;
    return this._loadHandle(handle);
  },

  play() {
    this._ensureNodes();
    if (!this.audioEl.src) { announce('Choisissez d\'abord un fichier audio.', 'assertive'); return false; }
    this.audioEl.play().catch(() => {});
    this.playing = true;
    return true;
  },
  pause() { if (this.audioEl) { this.audioEl.pause(); this.playing = false; } },
  stop() { if (this.audioEl) { this.audioEl.pause(); this.audioEl.currentTime = 0; this.playing = false; } },
  toggle() { if (this.playing) { this.pause(); return false; } return this.play(); },
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.updateSpatialGain(); },
};
window.MusicPlayer = MusicPlayer;
// Réévalue l'atténuation par distance en continu tant qu'une musique joue
// depuis une enceinte fixe (voir sourceRef ci-dessus) — même cadence que la
// réévaluation de la voix de proximité, largement suffisante pour un volume
// qui n'a pas besoin d'être aussi réactif qu'une position en temps réel.
setInterval(() => { if (MusicPlayer.playing) MusicPlayer.updateSpatialGain(); }, 500);

/* ============================================================
   CONFIGURATION ET UTILITAIRES
============================================================ */
