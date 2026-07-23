/* ============================================================
   CHIEN GUIDE (non-combattant)
   ------------------------------------------------------------
   Un labrador qui mène le joueur par la laisse jusqu'à une
   destination choisie. Le joueur prend la laisse (Maj+Alt+0),
   choisit une destination, et le chien le guide : le chien
   avance le long d'un chemin calculé (A*), et le joueur occupe
   à chaque pas la case que le chien vient de libérer — il suit
   donc exactement le chemin, sans jamais heurter un mur, sans
   toucher aux flèches. Repères sonores spatialisés (halètement,
   aboiement) pour localiser le chien à l'oreille.

   Le chien ne se bat pas : il alerte, se cache sous les tirs,
   gémit s'il est blessé, halète s'il a soif ou est fatigué.

   Commandes : Maj+Alt+chiffre (voir GuideDog.handleDigit) et
   Maj+Alt+F7 (repos). Boutique animalière et vétérinaire comme
   points d'intérêt de la ville.
   ============================================================ */

const DOG_NAMES = ['Rex', 'Bella', 'Simba', 'Nala', 'Bobby', 'Volt', 'Djuma', 'Farka'];
const DOG_STEP_MS = 420;       // un pas de guidage toutes les ~420 ms
const DOG_REST_MS = 120000;    // repos = 2 minutes
const DOG_PRICE = 255000;      // prix d'un chien (remplacement) à l'animalerie
const DOG_FOOD_ID = 'croquettes_chien';
const DOG_WATER_ID = 'eau_chien';

const GuideDog = {
  data: null, // null = le joueur n'a pas (ou plus) de chien

  has() { return !!this.data && this.data.alive; },

  // Acquisition d'un chien (achat / remplacement).
  acquire(name) {
    this.data = {
      name: name || UTIL.pick(DOG_NAMES),
      x: Math.round(Game.x), y: Math.round(Game.y),
      alive: true, active: true,
      leashed: false, staying: false, resting: false, restUntil: 0,
      atVehicle: false, recalling: false,
      health: 100, hunger: 0, thirst: 0, fatigue: 0,
      target: null, path: null, pathIdx: 1,
      hasVest: false, hasCollar: false, hasLeash: true,
      _lastStep: 0, _lastPant: 0, _lastBark: 0, _lastNeed: 0,
    };
    Game.guideDog = this.data;
  },

  /* ---------- Achats : animalerie & vétérinaire ---------- */
  openPetShopMenu() {
    ensureMenuOpen();
    el('menuTitle').textContent = '🏪 Animalerie';
    const d = this.data;
    const items = [];
    if (!this.has()) items.push({ id: 'dog', title: `🦮 Acheter un chien guide — ${UTIL.formatMoney(DOG_PRICE)}`, desc: 'Un labrador dressé pour vous guider par la laisse.' });
    else items.push({ id: 'dog', title: `🦮 Remplacer le chien — ${UTIL.formatMoney(DOG_PRICE)}`, desc: `Vous avez déjà ${d.name}. Le remplacer par un nouveau chien.` });
    items.push({ id: 'food', title: '🍖 Nourriture pour chien — 500 FCFA', desc: 'Un paquet. Se met dans vos poches, à donner avec Maj+Alt+3.' });
    items.push({ id: 'water', title: '💧 Eau pour chien — 300 FCFA', desc: 'Une bouteille. À donner avec Maj+Alt+4.' });
    items.push({ id: 'vest', title: '🦺 Gilet pare-balles pour chien — 40 000 FCFA', desc: 'Protège le chien des tirs.' });
    items.push({ id: 'collar', title: '🔦 Collier lumineux — 8 000 FCFA', desc: 'Renforce le bip de localisation du chien.' });
    items.push({ id: 'leash', title: '🪢 Laisse — 2 000 FCFA', desc: 'Une laisse de rechange si vous l\'avez perdue.' });
    renderMenu(items, (it) => this._buy(it.id));
    el('menuOverlay').style.display = 'flex';
    announce('Animalerie. Choisissez un article.', 'polite');
  },
  _buy(id) {
    if (id === 'dog') {
      if (Game.money < DOG_PRICE) return announce(`Un chien coûte ${UTIL.formatMoney(DOG_PRICE)}. Fonds insuffisants.`, 'assertive');
      Game.money -= DOG_PRICE;
      AccessibleTextPrompt.open('Nom du chien', 'Donnez un nom à votre chien guide (facultatif).', '', (name) => {
        this.acquire((name || '').trim().slice(0, 20));
        Audio.cash(); this.bark(2);
        announce(`Vous adoptez ${this.data.name}, votre chien guide. Prenez la laisse avec Maj+Alt+0 et choisissez une destination.`, 'assertive');
        updateHud();
      });
      return;
    }
    const catalog = {
      food: { price: 500, item: { id: DOG_FOOD_ID, name: 'Nourriture pour chien', price: 500, consumable: true, category: 'animal', size: 0.5 } },
      water: { price: 300, item: { id: DOG_WATER_ID, name: 'Eau pour chien', price: 300, consumable: true, category: 'animal', size: 0.5 } },
    };
    if (catalog[id]) {
      const c = catalog[id];
      if (Game.money < c.price) return announce('Fonds insuffisants.', 'assertive');
      Game.money -= c.price; Game.addItem({ ...c.item }); Audio.cash();
      announce(`${c.item.name} achetée.`, 'assertive'); updateHud(); return;
    }
    if (id === 'vest' || id === 'collar' || id === 'leash') {
      if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
      const price = id === 'vest' ? 40000 : id === 'collar' ? 8000 : 2000;
      if (Game.money < price) return announce('Fonds insuffisants.', 'assertive');
      Game.money -= price; Audio.cash();
      if (id === 'vest') { this.data.hasVest = true; announce('Gilet pare-balles posé sur le chien.', 'assertive'); }
      else if (id === 'collar') { this.data.hasCollar = true; announce('Collier lumineux posé. Le bip de localisation est renforcé.', 'assertive'); }
      else { this.data.hasLeash = true; announce('Nouvelle laisse achetée.', 'assertive'); }
      updateHud(); return;
    }
  },
  openVetMenu() {
    if (!this.has()) return announce('Vous n\'avez pas de chien à soigner.', 'assertive');
    const cost = 10000;
    AccessibleConfirm.open('Vétérinaire', `Soigner ${this.data.name} (santé ${Math.round(this.data.health)} pour cent) pour ${UTIL.formatMoney(cost)} ?`, (ok) => {
      if (!ok) return;
      if (Game.money < cost) return announce('Fonds insuffisants.', 'assertive');
      Game.money -= cost; this.data.health = 100; this.data.hunger = Math.max(0, this.data.hunger - 40); this.data.thirst = Math.max(0, this.data.thirst - 40);
      Audio.cash(); this.bark(1); announce(`${this.data.name} est soigné. En pleine forme.`, 'assertive'); updateHud();
    });
  },

  /* ---------- Sons du chien ---------- */
  // Aboiement (n fois) spatialisé sur la position du chien.
  bark(times) {
    if (!this.has()) return;
    const key = times >= 5 ? 'chien_aboie_5' : times >= 3 ? 'chien_aboie_3' : times >= 2 ? 'chien_aboie_2' : 'chien_aboie_1';
    const pan = Game.panForPoint(this.data.x, this.data.y);
    const vol = this.data.hasCollar ? 0.85 : 0.7;
    if (window.AudioLib && AudioLib.playPositional) AudioLib.playPositional(key, pan, vol);
    else if (window.AudioLib) AudioLib.playOnce(key, { volume: vol });
    if (Net.connected) Net.emitSound(key, { vol: 0.6 });
  },
  // Halètement (soif / fatigue) : petit souffle synthétisé.
  pant() {
    if (!this.has() || !window.Audio) return;
    const pan = Game.panForPoint(this.data.x, this.data.y);
    Audio.tone({ freq: 300, type: 'triangle', duration: 0.12, gain: 0.05, pan });
    setTimeout(() => Audio.tone({ freq: 260, type: 'triangle', duration: 0.1, gain: 0.04, pan }), 130);
  },
  // Gémissement (blessé).
  whine() {
    if (!window.Audio) return;
    const pan = this.has() ? Game.panForPoint(this.data.x, this.data.y) : 0;
    Audio.tone({ freq: 700, type: 'sine', duration: 0.25, gain: 0.08, pan });
    setTimeout(() => Audio.tone({ freq: 520, type: 'sine', duration: 0.3, gain: 0.07, pan }), 150);
  },
  // Repère de position discret (bip doux + halètement) vers le chien.
  positionPing() {
    if (!this.has()) return;
    const pan = Game.panForPoint(this.data.x, this.data.y);
    const vol = this.data.hasCollar ? 0.5 : 0.35;
    if (window.AudioLib && AudioLib.playPositional) AudioLib.playPositional('chien_aboie_court', pan, vol);
  },

  /* ---------- Destination & guidage ---------- */
  // Fixe la destination et calcule le chemin depuis la position du chien.
  setTarget(poi) {
    if (!this.has()) return announce('Vous n\'avez pas de chien guide.', 'assertive');
    if (!poi) return announce('Aucune destination.', 'assertive');
    this.data.active = true; this.data.staying = false; this.data.resting = false; this.data.atVehicle = false;
    this.data.target = { name: poi.name || 'destination', x: Math.round(poi.x), y: Math.round(poi.y) };
    // Le chien part de sa position actuelle vers la cible.
    this.data.path = Game.computePath(this.data.x, this.data.y, this.data.target.x, this.data.target.y);
    this.data.pathIdx = 1;
    if (!this.data.path || this.data.path.length < 2) {
      // Pas de chemin (ou déjà sur place).
      if (UTIL.dist(this.data.target, Game) < 3) return announce(`Vous êtes déjà à ${this.data.target.name}.`, 'assertive');
      this.data.target = null;
      return announce('Le chien ne trouve pas de chemin vers cette destination.', 'assertive');
    }
    if (!this.data.leashed) {
      this.data.leashed = true;
      announce(`Vous prenez la laisse. ${this.data.name} vous guide vers ${this.data.target.name}. Laissez-vous mener, ne touchez pas aux flèches.`, 'assertive');
    } else {
      announce(`${this.data.name} vous guide vers ${this.data.target.name}.`, 'assertive');
    }
    this.bark(1);
  },

  // Maj+Alt+2 : guider vers la « cible » courante (destination déjà fixée, sinon
  // cible verrouillée, sinon on invite à choisir dans le menu).
  guideToCurrentTarget() {
    if (!this.has()) return announce('Vous n\'avez pas de chien guide. Achetez-en un à l\'animalerie.', 'assertive');
    if (Game.guidanceTarget) return this.setTarget(Game.guidanceTarget);
    const live = Game.getLiveTarget && Game.getLiveTarget();
    if (live) return this.setTarget({ name: live.name || 'la cible', x: live.x, y: live.y });
    this.openDestinationMenu();
  },

  openDestinationMenu() {
    if (!this.has()) return announce('Vous n\'avez pas de chien guide.', 'assertive');
    ensureMenuOpen();
    el('menuTitle').textContent = '📍 Guider vers';
    const items = [];
    // Lieux enregistrés (Mes lieux).
    (Game.savedPlaces || []).forEach((p, i) => {
      const dist = Math.round(UTIL.dist(p, Game) * CONFIG.METERS_PER_TILE);
      items.push({ id: 'saved_' + i, poi: p, title: `📌 ${p.name}`, desc: `Lieu enregistré, ${dist} m.` });
    });
    // Véhicule possédé le plus proche.
    const veh = (Game.ownedVehicles || []).map(id => City.vehicles.find(v => v.id === id)).filter(Boolean)
      .sort((a, b) => UTIL.dist(a, Game) - UTIL.dist(b, Game))[0];
    if (veh) items.push({ id: 'veh', poi: { name: veh.name, x: veh.x, y: veh.y }, title: `🚗 ${veh.name}`, desc: `Votre véhicule, ${Math.round(UTIL.dist(veh, Game) * CONFIG.METERS_PER_TILE)} m.` });
    // Cible verrouillée (joueur / PNJ).
    const live = Game.getLiveTarget && Game.getLiveTarget();
    if (live) items.push({ id: 'lock', poi: { name: live.name || 'la cible', x: live.x, y: live.y }, title: `🎯 ${live.name || 'Cible verrouillée'}`, desc: 'La cible actuellement verrouillée.' });
    // Lieux (POI) proches.
    City.pois.map(p => ({ p, d: UTIL.dist(p, Game) })).filter(o => o.d < 120).sort((a, b) => a.d - b.d).slice(0, 10)
      .forEach(o => items.push({ id: 'poi_' + (o.p.id || o.p.name), poi: o.p, title: `🏢 ${o.p.name}`, desc: `${Math.round(o.d * CONFIG.METERS_PER_TILE)} m, vers le ${UTIL.bearing(o.p.x - Game.x, o.p.y - Game.y)}.` }));
    if (!items.length) items.push({ id: 'none', title: 'Aucune destination trouvée', desc: 'Enregistrez un lieu ou approchez-vous d\'un bâtiment.' });
    renderMenu(items, (it) => { if (it.poi) { this.setTarget(it.poi); closeMenu(); } });
    el('menuOverlay').style.display = 'flex';
    announce('Choisissez une destination pour le chien.', 'polite');
  },

  /* ---------- Actions clavier ---------- */
  toggleLeash() {
    if (!this.has()) return announce('Vous n\'avez pas de chien guide. Achetez-en un à l\'animalerie.', 'assertive');
    if (!this.data.hasLeash) return announce('Vous n\'avez plus de laisse. Achetez-en une à l\'animalerie.', 'assertive');
    this.data.leashed = !this.data.leashed;
    if (this.data.leashed) {
      if (!this.data.target) { announce('Vous prenez la laisse. Choisissez une destination.', 'assertive'); this.openDestinationMenu(); }
      else announce(`Vous prenez la laisse. ${this.data.name} vous guide vers ${this.data.target.name}.`, 'assertive');
    } else {
      announce('Vous lâchez la laisse. Le chien s\'arrête de guider.', 'assertive');
    }
  },
  feed() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    const it = Game.inventory.find(i => i.id === DOG_FOOD_ID);
    if (!it) return announce('Vous n\'avez pas de nourriture pour chien. Achetez-en à l\'animalerie.', 'assertive');
    it.q = (it.q || 1) - 1; if (it.q <= 0) Game.removeItem(DOG_FOOD_ID, 1);
    this.data.hunger = Math.max(0, this.data.hunger - 60);
    this.bark(1); announce(`${this.data.name} mange. Faim apaisée.`, 'assertive');
  },
  water() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    const it = Game.inventory.find(i => i.id === DOG_WATER_ID);
    if (!it) return announce('Vous n\'avez pas d\'eau pour chien. Achetez-en à l\'animalerie.', 'assertive');
    it.q = (it.q || 1) - 1; if (it.q <= 0) Game.removeItem(DOG_WATER_ID, 1);
    this.data.thirst = Math.max(0, this.data.thirst - 60);
    announce(`${this.data.name} boit. Soif étanchée.`, 'assertive');
  },
  announceState() {
    if (!this.has()) return announce('Vous n\'avez pas de chien guide.', 'assertive');
    const d = this.data;
    const dist = Math.round(UTIL.dist(d, Game) * CONFIG.METERS_PER_TILE);
    const etat = [];
    etat.push(`santé ${Math.round(d.health)} pour cent`);
    etat.push(`faim ${Math.round(d.hunger)}`);
    etat.push(`soif ${Math.round(d.thirst)}`);
    etat.push(`fatigue ${Math.round(d.fatigue)}`);
    let statut = d.resting ? 'au repos' : d.staying ? 'reste sur place' : !d.active ? 'désactivé' : d.atVehicle ? 'près du véhicule' : d.leashed && d.target ? `vous guide vers ${d.target.name}` : 'vous suit';
    announce(`${d.name} : ${etat.join(', ')}. Il ${statut}, à ${dist} mètres, vers le ${UTIL.bearing(d.x - Game.x, d.y - Game.y)}.`, 'polite');
    this.positionPing();
  },
  recall() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    if (!this.data.active) return announce('Le chien est désactivé. Réactivez-le d\'abord avec Maj+Alt+9.', 'assertive');
    this.data.resting = false; this.data.staying = false; this.data.atVehicle = false; this.data.recalling = true;
    const dist = Math.round(UTIL.dist(this.data, Game) * CONFIG.METERS_PER_TILE);
    this.bark(2);
    announce(`Vous rappelez ${this.data.name}. Il arrive, il est à ${dist} mètres.`, 'assertive');
  },
  stay() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    this.data.staying = !this.data.staying;
    if (this.data.staying) { this.data.recalling = false; announce(`${this.data.name} reste sur place.`, 'assertive'); }
    else announce(`${this.data.name} vous suit de nouveau.`, 'assertive');
  },
  sendToVehicle() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    const veh = (Game.ownedVehicles || []).map(id => City.vehicles.find(v => v.id === id)).filter(Boolean)
      .sort((a, b) => UTIL.dist(a, Game) - UTIL.dist(b, Game))[0] || (Game.inVehicle ? Game.vehicle : null);
    if (!veh) return announce('Vous n\'avez pas de véhicule où envoyer le chien.', 'assertive');
    this.data.staying = false; this.data.resting = false; this.data.recalling = false;
    this.data.atVehicle = true; this.data.target = { name: veh.name, x: Math.round(veh.x), y: Math.round(veh.y) };
    this.data.path = Game.computePath(this.data.x, this.data.y, this.data.target.x, this.data.target.y); this.data.pathIdx = 1;
    announce(`${this.data.name} se dirige vers ${veh.name}.`, 'assertive');
  },
  toggleActive() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    this.data.active = !this.data.active;
    if (!this.data.active) { this.data.leashed = false; announce(`${this.data.name} est désactivé sur place. Il ne bouge plus. Maj+Alt+9 pour le réactiver.`, 'assertive'); }
    else announce(`${this.data.name} est réactivé, là où il était.`, 'assertive');
  },
  rest() {
    if (!this.has()) return announce('Vous n\'avez pas de chien.', 'assertive');
    this.data.resting = true; this.data.leashed = false; this.data.staying = false; this.data.recalling = false;
    this.data.restUntil = Date.now() + DOG_REST_MS;
    announce(`${this.data.name} se repose ici pendant deux minutes et récupère. Rappelez-le avec Maj+Alt+6 pour écourter.`, 'assertive');
  },

  // Dispatch des touches Maj+Alt+chiffre.
  handleDigit(n) {
    switch (n) {
      case 0: return this.toggleLeash();
      case 1: return this.openMenu();
      case 2: return this.guideToCurrentTarget();
      case 3: return this.feed();
      case 4: return this.water();
      case 5: return this.announceState();
      case 6: return this.recall();
      case 7: return this.stay();
      case 8: return this.sendToVehicle();
      case 9: return this.toggleActive();
    }
  },

  openMenu() {
    if (!this.has()) {
      return AccessibleConfirm.open('Chien guide', 'Vous n\'avez pas de chien guide. Ouvrir l\'animalerie pour en acheter un ?', (ok) => { if (ok) this.openPetShopMenu(); });
    }
    ensureMenuOpen();
    el('menuTitle').textContent = `🐕 ${this.data.name}`;
    const d = this.data;
    const items = [
      { id: 'state', title: '🐕 État', desc: `Santé ${Math.round(d.health)} %, faim ${Math.round(d.hunger)}, soif ${Math.round(d.thirst)}, fatigue ${Math.round(d.fatigue)}.` },
      { id: 'guide', title: '📍 Guider vers…', desc: 'Lieu, lieu enregistré, joueur, véhicule, maison.' },
      { id: 'leash', title: d.leashed ? '🦮 Lâcher la laisse' : '🦮 Prendre la laisse', desc: 'Basculer le guidage à la laisse.' },
      { id: 'feed', title: '🍖 Nourrir', desc: 'Donner un paquet de nourriture (depuis vos poches).' },
      { id: 'water', title: '💧 Abreuver', desc: 'Donner une bouteille d\'eau (depuis vos poches).' },
      { id: 'recall', title: '📞 Rappeler', desc: 'Le faire revenir, même s\'il est loin.' },
      { id: 'stay', title: d.staying ? '🐾 Reprendre (il vous suit)' : '🛑 Rester sur place', desc: 'Lui demander de rester, ou de vous suivre.' },
      { id: 'vehicle', title: '🚗 Envoyer au véhicule', desc: 'L\'envoyer attendre près de votre véhicule.' },
      { id: 'rest', title: '💤 Repos (2 min)', desc: 'L\'envoyer se reposer et récupérer sa fatigue.' },
      { id: 'active', title: d.active ? '🔕 Désactiver sur place' : '🔔 Réactiver', desc: 'Le figer complètement, ou le réactiver.' },
      { id: 'vet', title: '🩺 Vétérinaire (soigner)', desc: 'Soigner le chien (10 000 FCFA).' },
      { id: 'shop', title: '🏪 Animalerie', desc: 'Acheter nourriture, eau, gilet, collier, laisse, ou un nouveau chien.' },
    ];
    renderMenu(items, (it) => {
      if (it.id === 'state') this.announceState();
      else if (it.id === 'guide') this.openDestinationMenu();
      else if (it.id === 'leash') this.toggleLeash();
      else if (it.id === 'feed') this.feed();
      else if (it.id === 'water') this.water();
      else if (it.id === 'recall') { this.recall(); closeMenu(); }
      else if (it.id === 'stay') { this.stay(); this.openMenu(); }
      else if (it.id === 'vehicle') { this.sendToVehicle(); closeMenu(); }
      else if (it.id === 'rest') { this.rest(); closeMenu(); }
      else if (it.id === 'active') { this.toggleActive(); this.openMenu(); }
      else if (it.id === 'vet') this.openVetMenu();
      else if (it.id === 'shop') this.openPetShopMenu();
    });
    el('menuOverlay').style.display = 'flex';
    announce(`Menu de ${this.data.name}.`, 'polite');
  },

  /* ---------- Boucle : suivi, guidage, besoins ---------- */
  tick() {
    if (!this.has()) { if (window.AudioLib) AudioLib.stopLoop('chien_laisse'); return; }
    const d = this.data, now = Date.now();
    // Bruit de la laisse tendue : en boucle tant qu'on tient la laisse (et que
    // le chien est actif) ; s'arrête dès qu'on la relâche.
    if (window.AudioLib) {
      if (d.leashed && d.active) AudioLib.playLoop('chien_laisse', 0.4);
      else AudioLib.stopLoop('chien_laisse');
    }

    // Fin de repos.
    if (d.resting) {
      d.fatigue = Math.max(0, d.fatigue - 0.5);
      if (now >= d.restUntil) { d.resting = false; d.fatigue = 0; announce(`${d.name} est reposé et vous rejoint.`, 'polite'); }
    }
    // Besoins qui montent doucement.
    if (now - d._lastNeed > 4000) {
      d._lastNeed = now;
      d.hunger = Math.min(100, d.hunger + 0.6);
      d.thirst = Math.min(100, d.thirst + 0.9);
      if (d.leashed && d.target) d.fatigue = Math.min(100, d.fatigue + 0.8);
      // Halètement si soif ou fatigue élevées.
      if ((d.thirst > 70 || d.fatigue > 70) && now - d._lastPant > 6000) { d._lastPant = now; this.pant(); }
      // Trop faim/soif : santé qui baisse, gémissement.
      if (d.hunger >= 100 || d.thirst >= 100) { d.health = Math.max(0, d.health - 1); if (Math.random() < 0.3) this.whine(); }
      if (d.health <= 0) return this.die('épuisement');
    }

    if (!d.active) return; // désactivé sur place : ne bouge pas

    // Guidage actif : le chien mène, le joueur suit exactement son chemin.
    if (d.leashed && d.target && !d.staying && !d.resting && !Game.inVehicle) {
      if (now - d._lastStep >= DOG_STEP_MS) { d._lastStep = now; this._stepGuiding(); }
      // Repère de position (halètement/petit aboiement) de temps en temps.
      if (now - d._lastBark > 5000) { d._lastBark = now; this.positionPing(); }
      return;
    }

    // Sinon : suivi normal du joueur (ou rappel), sauf s'il reste/repose/au véhicule.
    if (!d.staying && !d.resting && !d.atVehicle) {
      if (now - d._lastStep >= DOG_STEP_MS) { d._lastStep = now; this._stepFollow(); }
    } else if (d.atVehicle && d.target) {
      // Rejoint le véhicule puis attend.
      if (now - d._lastStep >= DOG_STEP_MS) { d._lastStep = now; this._stepAlongPath(); }
    }
  },

  // Un pas de guidage : le chien avance le long du chemin, le joueur prend la
  // case libérée. Arrivée = destination atteinte.
  _stepGuiding() {
    const d = this.data;
    if (!d.path || d.pathIdx >= d.path.length) return this._arrive();
    const next = d.path[d.pathIdx];
    // Chemin devenu invalide (obstacle mobile) : recalcul.
    if (City.isSolid(next.x, next.y)) {
      d.path = Game.computePath(d.x, d.y, d.target.x, d.target.y); d.pathIdx = 1;
      if (!d.path || d.path.length < 2) return this._arrive();
      return;
    }
    const px = d.x, py = d.y;
    d.x = next.x; d.y = next.y; d.pathIdx++;
    // Le joueur suit : il occupe la case que le chien vient de quitter.
    Game.x = px; Game.y = py;
    const hx = d.x - px, hy = d.y - py;
    Game.heading = hx > 0 ? 2 : hx < 0 ? 6 : hy > 0 ? 4 : hy < 0 ? 0 : Game.heading;
    Audio.footstep(Game.getTileSurface ? Game.getTileSurface() : 'asphalt');
    if (UTIL.dist(d.target, Game) < 2 || d.pathIdx >= d.path.length) this._arrive();
  },
  _arrive() {
    const d = this.data;
    const name = d.target ? d.target.name : 'destination';
    d.target = null; d.path = null; d.leashed = false;
    this.bark(2);
    announce(`Vous êtes arrivé à ${name}. ${d.name} s'arrête. Vous pouvez lâcher la laisse.`, 'assertive');
  },
  // Suivi : le chien se rapproche du joueur pour rester à ses côtés (1-2 cases).
  _stepFollow() {
    const d = this.data;
    const dist = UTIL.dist(d, Game);
    const wantClose = d.recalling ? 1.2 : 2.5;
    if (dist <= wantClose) { if (d.recalling && dist <= 1.5) { d.recalling = false; announce(`${d.name} est à côté de vous.`, 'polite'); } return; }
    const dx = Math.sign(Game.x - d.x), dy = Math.sign(Game.y - d.y);
    // Priorité à l'axe le plus éloigné, avec repli.
    const tryMoves = Math.abs(Game.x - d.x) >= Math.abs(Game.y - d.y)
      ? [[dx, 0], [0, dy], [dx, dy]] : [[0, dy], [dx, 0], [dx, dy]];
    for (const [mx, my] of tryMoves) {
      const nx = d.x + mx, ny = d.y + my;
      if ((mx || my) && nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { d.x = nx; d.y = ny; return; }
    }
  },
  // Suit un chemin pré-calculé (envoi au véhicule).
  _stepAlongPath() {
    const d = this.data;
    if (!d.path || d.pathIdx >= d.path.length) { if (d.target && UTIL.dist(d, d.target) < 2) { /* arrivé au véhicule */ } return; }
    const next = d.path[d.pathIdx];
    if (!City.isSolid(next.x, next.y)) { d.x = next.x; d.y = next.y; }
    d.pathIdx++;
  },

  // Réaction à un danger (tir) proche : le chien aboie une fois pour alerter,
  // puis se « cache » (reste sur place). Appelé par le système de tir.
  onDangerNear(sx, sy) {
    if (!this.has()) return;
    const d = this.data;
    if (UTIL.dist({ x: sx, y: sy }, d) > 14) return;
    if (Date.now() - (d._lastDanger || 0) < 3000) return;
    d._lastDanger = Date.now();
    this.bark(5); // aboiement d'alerte
    // Sans gilet, le chien peut être touché s'il est très près de la ligne de feu.
    if (!d.hasVest && UTIL.dist({ x: sx, y: sy }, d) < 4 && Math.random() < 0.5) {
      d.health = Math.max(0, d.health - UTIL.randInt(20, 45));
      this.whine();
      if (d.health <= 0) return this.die('blessures');
      announce(`${d.name} est touché ! Santé ${Math.round(d.health)} pour cent. Emmenez-le chez le vétérinaire.`, 'assertive');
    }
  },
  die(cause) {
    if (!this.data) return;
    const name = this.data.name;
    if (window.AudioLib) AudioLib.stopLoop('chien_laisse');
    this.whine();
    this.data.alive = false;
    Game.guideDog = null;
    const d = this.data; this.data = null;
    announce(`${name} n'a pas survécu (${cause}). Vous devez acheter un nouveau chien à l'animalerie.`, 'assertive');
  },
};
window.GuideDog = GuideDog;
