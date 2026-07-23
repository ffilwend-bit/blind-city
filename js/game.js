const Game = {
  x: 120, y: 120, altitude: 0, floor: 0, heading: 0, health: 100, maxHealth: 100,
  money: 100000, bank: 0, dirtyMoney: 0, handsUp: false, hunger: 50, thirst: 50, energy: 100,
  inVehicle: false, vehicle: null, ownedVehicles: [],
  inventory: [], backpack: false, belt: false, holster: null,
  weapons: [], weapon: null, weaponOut: false, ammo: {}, ammoReserve: {},
  lockedTarget: null, scannedTargets: [], aimPart: 'torse',
  activeMission: null, completedMissions: [],
  ownedHouses: [], ownedWarehouses: [], savedPlaces: [], ownsTablet: false,
  phones: [], activePhoneIndex: 0,
  wanted: 0, policeAwareness: 0,
  keys: new Set(), lastMoved: 0,
  lastAnnounce: 0,
  skills: { repair: 0, heal: 0, driving: 0, hacking: 0 },
  carriedPlayer: null, will: null, tickets: [], invoices: [],
  player: { firstName: 'Joueur', lastName: 'Anonyme', gender: 'homme', registered: false },
  outfit: { haut: null, bas: null, chaussures: null, couleurHaut: null, couleurBas: null, couleurChaussures: null, coiffure: null, lunettes: null, isPolice: false, masque: false, accessoires: [] },
  miningMachine: false,
  talkie: { owned: false, battery: 1, on: false, frequency: 151.5 },
  voiceOpen: false, // micro de proximité (parler en direct aux gens autour de vous, sans passer par un appel)

  getDistrictName() { return City.getDistrictAt(this.x, this.y).name; },
  getTileSurface() {
    const t = City.getTile(this.x, this.y);
    if (City.houses.some(h => UTIL.dist(h, this) < 5)) return 'interieur';
    if (t === 'eau') return 'water';
    if (t === 'route' || t === 'rue' || t === 'autoroute') return 'asphalt';
    if (t === 'parc' || t === 'gazon') return 'grass';
    if (t === 'mine' || t === 'industriel' || t === 'dirt') return 'dirt';
    return 'concrete';
  },

  // Movement
  // Navigation façon "vraie vie" : gauche/droite tournent le personnage sur
  // lui-même (orientation), haut/bas avancent ou reculent dans la direction
  // où l'on regarde. Une pression = un pas ; touche maintenue = déplacement
  // continu (le navigateur répète l'évènement tant qu'on appuie).
  HEADING_NAMES: { 0: 'nord', 1: 'nord-est', 2: 'est', 3: 'sud-est', 4: 'sud', 5: 'sud-ouest', 6: 'ouest', 7: 'nord-ouest' },
  turn(delta) {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.ridingWith) return announce('Vous êtes passager. Appuyez sur Interagir pour descendre.', 'polite');
    if (this.inVehicle && this.vehicle) {
      // Au volant, on tourne par quarts (90°) : la conduite ne se fait que sur
      // les 4 axes de la grille, quel que soit le pas demandé par la touche.
      const vdelta = delta >= 0 ? 2 : -2;
      this.vehicle.heading = ((this.vehicle.heading + vdelta) % 8 + 8) % 8; this.heading = this.vehicle.heading;
      const cls = VEHICLE_CATALOG[this.vehicle.type];
      if (cls && !cls.flies) AudioLib.playOnce('clignotant_voiture', { volume: 0.35 });
    }
    // À pied, on tourne finement par huitièmes (45°) : flèche gauche/droite fait
    // pivoter un peu à la fois sur soi-même, pour viser un cap précis parmi les
    // 8 directions ; les touches de cap direct (! ; , :) restent là pour se
    // placer d'un coup au nord/est/sud/ouest.
    else this.heading = ((this.heading + delta) % 8 + 8) % 8;
    // Si un guidage est actif, on redonne TOUT DE SUITE la consigne mise à jour
    // après le virage : retour immédiat ("Tout droit" une fois aligné), pour que
    // la personne ne sur-corrige pas faute de confirmation (c'était la cause de
    // l'oscillation gauche/droite). Sinon, on annonce simplement le nouveau cap.
    if (this.guidanceTarget) this.updateGuidance(true);
    else {
      // Après un virage : on annonce le nouveau cap ET, s'il y a un mur droit
      // devant, on prévient tout de suite (avant de foncer dedans).
      let msg = `Vous vous tournez vers le ${this.HEADING_NAMES[this.heading]}.`;
      const dd = this.headingToDelta(this.heading);
      if ((dd.dx || dd.dy) && City.isSolid(Math.round(this.x + dd.dx), Math.round(this.y + dd.dy))) msg += ' Attention, obstacle juste devant.';
      announce(msg, 'polite');
    }
    updateHud();
  },
  // Signale un obstacle DROIT DEVANT avant qu'on ne le heurte (essentiel pour
  // naviguer sans voir). Throttlé pour ne pas répéter en boucle.
  warnObstacleAhead() {
    if (this.inVehicle || this.unconscious || this.guidanceTarget) return;
    const { dx, dy } = this.headingToDelta(this.heading);
    if (dx === 0 && dy === 0) return;
    if (City.isSolid(Math.round(this.x + dx), Math.round(this.y + dy))) {
      const now = Date.now();
      if (now - (this._lastObstacleWarn || 0) > 1500) {
        this._lastObstacleWarn = now;
        announce('Attention, obstacle juste devant.', 'assertive');
      }
    }
  },
  // Se tourner DIRECTEMENT vers un cap cardinal précis en un seul appui
  // (touches ! ; , :), plutôt que de tourner pas à pas avec les flèches.
  setHeadingDirect(h) {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.isCuffed) return announce('Vous êtes menotté(e), impossible d\'agir.', 'polite');
    if (this.inVehicle && this.vehicle) { this.vehicle.heading = h; this.heading = h; }
    else this.heading = h;
    announce(`Cap : ${this.HEADING_NAMES[this.heading]}.`, 'polite');
    updateHud();
  },
  headingToDelta(h) {
    // 8 directions : 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SO, 6=O, 7=NO.
    const d = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]][((h % 8) + 8) % 8] || [0, 0];
    return { dx: d[0], dy: d[1] };
  },
  moveForward() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.inVehicle && this.vehicle) { const { dx, dy } = this.headingToDelta(this.vehicle.heading); this.driveVehicle(dx, dy); return; }
    const { dx, dy } = this.headingToDelta(this.heading);
    this.move(dx, dy, { keepHeading: true });
  },
  moveBackward() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.inVehicle && this.vehicle) { this.driveVehicle(0, 0); return; } // le frein/marche arrière véhicule reste sur Espace
    const { dx, dy } = this.headingToDelta(this.heading);
    this.move(-dx, -dy, { keepHeading: true, reverse: true });
  },
  move(dx, dy, opts = {}) {
    if (this.ridingWith) return announce('Vous êtes passager. Appuyez sur Interagir pour descendre avant de marcher.', 'polite');
    if (this.inVehicle && this.vehicle) {
      this.driveVehicle(dx, dy);
      return;
    }
    const surface = this.getTileSurface();
    // Terrain lent (herbe, terre, eau) : on n'avance pas d'une fraction de
    // case — Math.round(x + 0.4) retomberait sur la MÊME case et bloquait le
    // joueur définitivement. À la place, un accumulateur : chaque pas ajoute
    // sa "vitesse", et dès que le cumul atteint une case entière, on la
    // franchit. Lent sur l'herbe/dans l'eau, mais jamais bloqué.
    const speed = surface === 'grass' ? 0.4 : surface === 'dirt' ? 0.6 : surface === 'water' ? 0.5 : 1.0;
    this._moveAccum = (this._moveAccum || 0) + speed;
    if (this._moveAccum < 1) {
      // Pas glissant : bruit de pas, mais la case n'est pas encore franchie.
      Audio.footstep(surface);
      return;
    }
    this._moveAccum -= 1;
    const nx = Math.round(this.x + dx), ny = Math.round(this.y + dy);
    // En diagonale, on ne se faufile pas à travers le coin de deux murs : si les
    // deux cases orthogonales sont solides, le passage est bloqué.
    if (dx !== 0 && dy !== 0 && City.isSolid(Math.round(this.x + dx), Math.round(this.y)) && City.isSolid(Math.round(this.x), Math.round(this.y + dy))) {
      Audio.impact(UTIL.clamp(dx, -1, 1) * 0.5);
      announce('Passage bloqué entre deux murs. Tournez un peu pour les contourner.', 'assertive');
      return;
    }
    if (City.isSolid(nx, ny)) {
      Audio.impact(UTIL.clamp(dx, -1, 1) * 0.5);
      if (Net.connected) Net.emitSound('synth:impact', { vol: 0.5 });
      announce('Obstacle, vous n\'avancez pas. ' + City.getTile(nx, ny), 'assertive');
      return;
    }
    this.x = UTIL.clamp(nx, 0, City.W - 1); this.y = UTIL.clamp(ny, 0, City.H - 1);
    if (!opts.keepHeading) this.heading = (dx > 0 ? 2 : dx < 0 ? 6 : dy > 0 ? 4 : dy < 0 ? 0 : this.heading);
    // Passage vrai eau <-> terre : annonce et bascule l'ambiance sonore.
    const wasInWater = this.inWater;
    this.inWater = City.getTile(this.x, this.y) === 'eau';
    if (this.inWater && !wasInWater) {
      announce('Vous entrez dans l\'eau.', 'polite');
      AudioLib.playLoop('eau_mer_amb', 0.3);
    } else if (!this.inWater && wasInWater) {
      announce('Vous sortez de l\'eau.', 'polite');
      AudioLib.stopLoop('eau_mer_amb');
      if (this.underwater) { this.underwater = false; AudioLib.stopLoop('eau_nage_sous'); }
    }
    this._syncFloorOnMove();
    if (!(surface === 'water' && this.underwater)) {
      const stepKey = Audio.footstep(surface);
      // Pas audibles par les joueurs proches (spatialisés chez eux).
      if (Net.connected && stepKey) Net.emitSound(stepKey, { vol: 0.35 });
    }
    // En déplacement continu (touche maintenue), annoncer "vous avancez" à chaque
    // pas ferait annuler la synthèse vocale avant qu'elle n'ait eu le temps de
    // sortir un seul mot (nouvelle annonce = coupe la précédente). On espace donc
    // ces annonces routinières dans le temps ; les infos importantes (obstacle,
    // rencontre...) restent, elles, toujours annoncées immédiatement.
    const now = Date.now();
    if (now - (this._lastMoveAnnounce || 0) > 900) {
      announce(opts.reverse ? 'Vous reculez.' : 'Vous avancez.', 'polite');
      this._lastMoveAnnounce = now;
    }
    this.hunger = Math.min(100, this.hunger + 0.02); this.thirst = Math.min(100, this.thirst + 0.03); this.energy = Math.max(0, this.energy - 0.01);
    if (Math.random() < 0.08) this.randomEncounters();
    this.checkEdge();
    if (this.guidanceTarget) this.updateGuidance();
    else this.warnObstacleAhead();
    updateHud();
  },

  // ==================== STATE DE ZONE (INTÉRIEUR / EXTÉRIEUR) ====================
  // État « à l'intérieur d'un lieu » : tant qu'il est actif, l'ambiance de la
  // ville reste assourdie et l'on reste dedans jusqu'à ressortir volontairement (Ctrl+Alt+E).
  // NOUVEAU : stocke aussi une référence au lieu (POI ou maison) pour filtrer
  // les objets interactifs selon le contexte.
  indoors: null,

  // Franchissement d'une porte : son de porte + marquer qu'on est à l'intérieur du lieu
  announceEnterBuilding(name, zone, locationRef) {
    if (window.AudioLib) AudioLib.playOnce('sfx_porte_vehicule', { volume: 0.5 });
    if (window.Audio && Audio.tone) Audio.tone({ freq: 170, type: 'sine', duration: 0.4, gain: 0.06, pan: 0 });
    const lieu = zone === 'cour' ? `la cour de ${name}` : name;
    this.indoors = { name: lieu, locationRef };  // ✅ NOUVEAU : stocker la référence au lieu
    announce(`Vous entrez dans ${lieu}. Touche E pour interagir avec ce qui s'y trouve, Ctrl+Alt+E pour ressortir.`, 'assertive');
  },

  // Entrer dans un bâtiment via sa porte (annonce + son), puis ouvrir le lieu.
  enterBuilding(poi) {
    const noDoor = ['station_essence', 'mine', 'aeroport', 'heliport', 'port'];
    if (!noDoor.includes(poi.type)) this.announceEnterBuilding(poi.name, 'porte', poi);  // ✅ Passer poi comme locationRef
    this.enterPOI(poi);
  },

  // Ctrl+Alt+E : entrer dans le lieu le plus proche, ou en ressortir si on y est déjà.
  // Une fois dedans, on peut interagir librement avec E sans ressortir.
  toggleIndoor() {
    if (this.inVehicle) return announce('Descendez du véhicule pour entrer dans un lieu.', 'assertive');
    if (this.indoors) {
      const name = this.indoors.name;
      this.indoors = null;
      if (window.AudioLib) AudioLib.playOnce('sfx_porte_vehicule', { volume: 0.5 });
      announce(`Vous sortez de ${name}. Vous êtes de nouveau dehors.`, 'assertive');
      return;
    }
    // Chercher un lieu (bâtiment ou maison) à portée pour y entrer.
    const poi = City.pois.map(p => ({ p, d: UTIL.dist(p, this) })).filter(o => o.d < 4).sort((a, b) => a.d - b.d)[0];
    const house = City.houses.map(h => ({ h, d: UTIL.dist(h, this) })).filter(o => o.d < 4).sort((a, b) => a.d - b.d)[0];
    if (poi && (!house || poi.d <= house.d)) { this.announceEnterBuilding(poi.p.name, 'porte', poi.p); this.enterPOI(poi.p); }
    else if (house) { this.announceEnterBuilding(house.h.name || 'la maison', 'cour', house.h); this.enterHouse(house.h); }  // ✅ Passer house.h comme locationRef
    else announce('Aucun lieu où entrer ici. Approchez-vous d\'une porte, puis refaites Ctrl+Alt+E.', 'assertive');
  },

  // ==================== SYSTÈME D'INTERACTION (TOUCHE E) ====================
  // CORRIGÉ : filtrer les objets selon le contexte (intérieur/extérieur)
  interact() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    
    // Un vrai joueur inconscient à proximité : assistance immédiate, ou portage physique réel
    if (Net.connected) {
      const downedPlayer = Array.from(Net.remotePlayers.values()).find(p => p.unconscious && UTIL.dist(p, this) < 3 && p.id !== this.carriedByRemote?.id);
      if (downedPlayer) {
        const name = `${downedPlayer.firstName} ${downedPlayer.lastName}`;
        el('menuTitle').textContent = name;
        const items = [
          { id: 'assist', title: '🚑 Assister (réveil immédiat à l\'hôpital)', desc: 'Il/elle se réveille tout de suite à l\'hôpital le plus proche.' },
          { id: 'carry', title: '🫳 Porter physiquement', desc: 'Vous l\'emmenez où vous voulez tant qu\'il/elle reste inconscient(e) — utile pour une escorte, une arrestation, ou pire.' },
          { id: 'cancel', title: '↩️ Rien faire', desc: '' },
        ];
        renderMenu(items, (sel) => {
          closeMenu();
          if (sel.id === 'assist') this.assistUnconsciousPlayer(downedPlayer.id, name);
          else if (sel.id === 'carry') this.carryRemotePlayer(downedPlayer.id, name);
        });
        return;
      }
      if (this.carryingPlayer) {
        el('menuTitle').textContent = `${this.carryingPlayer.name} (porté)`;
        const hopital = City.pois.find(p => p.type === 'hopital' && UTIL.dist(p, this) < 4);
        const items = [
          { id: 'release', title: hopital ? '🏥 Déposer à l\'hôpital (réveil)' : '⬇️ Relâcher ici', desc: hopital ? 'Réveil immédiat.' : 'Reste inconscient(e), à la merci de la situation.' },
        ];
        renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'release') this.releaseCarriedPlayer(!!hopital); });
        return;
      }
    }
    
    // Client de la mission "Course VIP soignée" : prioritaire
    if (this.activeMission && this.activeMission.type === 'taxi_soigne' && !this.taxiState) {
      const client = City.npcs.find(n => n.id === this.activeMission.clientId && !n.dead);
      const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
      if (client && UTIL.dist(client, myPos) < 3) return this.openTaxiBoardMenu(client, this.activeMission);
    }
    if (this.activeMission && this.activeMission.type === 'escorte' && !this.escorteState && this.isMissionAuthorized(this.activeMission)) {
      const client = City.npcs.find(n => n.id === this.activeMission.clientId && !n.dead);
      const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
      if (client && UTIL.dist(client, myPos) < 3) return this.openEscorteBoardMenu(client, this.activeMission);
    }
    if (this.inVehicle) return this.interactVehicle();

    // ✅ CORRECTION MAJEURE : filtrer les cibles selon le contexte (intérieur/extérieur)
    const targets = [];
    
    // Si on est à l'intérieur : ne montrer que les objets du lieu actuel
    // Si on est dehors : montrer tous les objets à proximité
    const isIndoors = !!this.indoors;

    // Joueurs réels proches (toujours affichés, partout)
    Array.from(Net.remotePlayers.values()).forEach(p => {
      const d = UTIL.dist(p, this);
      if (d >= 3) return;
      const np = { id: p.id, name: `${p.firstName} ${p.lastName}`, gender: p.gender, outfit: p.outfit, isPlayer: true, x: p.x, y: p.y, role: p.role, policeRank: p.policeRank, accountUsername: p.accountUsername };
      targets.push({ d, label: `🧍 ${np.name} (joueur)`, act: () => { this.describePerson(np); this.greetPlayer(np); } });
    });

    // PNJ proches (toujours affichés, partout)
    City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < 3).forEach(n => {
      targets.push({ d: UTIL.dist(n, this), label: `🧍 ${n.name}`, act: () => { this.describePerson(n); this.talkTo(n); } });
    });

    // Bâtiments : FILTRER selon le contexte
    // ✅ Si on est dedans : ne pas afficher les POIs extérieurs
    if (!isIndoors) {
      City.pois.filter(p => UTIL.dist(p, this) < 4).forEach(p => {
        targets.push({ d: UTIL.dist(p, this), label: `🏢 ${p.name}`, act: () => this.enterBuilding(p) });
      });
    }

    // Maisons : FILTRER selon le contexte
    // ✅ Si on est dedans : ne pas afficher les maisons extérieures
    if (!isIndoors) {
      City.houses.filter(h => UTIL.dist(h, this) < 4).forEach(h => {
        targets.push({ d: UTIL.dist(h, this), label: `🏠 ${h.name || 'une maison'}`, act: () => { this.announceEnterBuilding(h.name || 'la maison', 'cour', h); this.enterHouse(h); } });
      });
    }

    // Véhicules : FILTRER selon le contexte
    // ✅ Si on est dedans : ne pas afficher les véhicules extérieurs
    if (!isIndoors) {
      City.vehicles.filter(v => !this.inVehicle && UTIL.dist(v, this) < 3).forEach(v => {
        targets.push({ d: UTIL.dist(v, this), label: `🚗 ${v.name} (véhicule)`, act: () => this.interactVehicle() });
      });
    }

    // Sites miniers : FILTRER selon le contexte
    // ✅ Si on est dedans : ne pas afficher les sites miniers extérieurs
    if (!isIndoors) {
      City.miningSites.filter(m => UTIL.dist(m, this) < 4).forEach(m => {
        targets.push({ d: UTIL.dist(m, this), label: '⛏️ Site minier', act: () => this.mine(m) });
      });
    }

    // Repaires de gang : FILTRER selon le contexte
    // ✅ Si on est dedans : ne pas afficher les repaires extérieurs
    if (!isIndoors) {
      City.gangs.filter(g => UTIL.dist(g, this) < 4).forEach(g => {
        targets.push({ d: UTIL.dist(g, this), label: '💀 Repaire de gang', act: () => this.beginGangRaid(g) });
      });
    }

    // Objets au sol : affichés partout (on peut toujours ramasser des objets)
    if ((City.groundItems || []).some(it => UTIL.dist(it, this) < 2)) {
      targets.push({ d: 0, label: '📦 Objets au sol', act: () => this.pickUpItems() });
    }

    if (targets.length === 1) return targets[0].act();
    if (targets.length >= 2) {
      targets.sort((a, b) => a.d - b.d);
      if (typeof ensureMenuOpen === 'function') ensureMenuOpen();
      el('menuTitle').textContent = 'Avec quoi interagir ?';
      const items = targets.map((t, i) => ({ id: String(i), title: t.label, desc: `À ${Math.round(t.d * CONFIG.METERS_PER_TILE)} mètres.` }));
      renderMenu(items, (sel) => { closeMenu(); const t = targets[parseInt(sel.id, 10)]; if (t) t.act(); });
      el('menuOverlay').style.display = 'flex';
      announce('Plusieurs choses à proximité. Choisissez avec quoi interagir.', 'assertive');
      return;
    }

    // Rien à portée : trouver le lieu le plus proche dans un rayon élargi
    const near = [];
    if (!isIndoors) {  // ✅ Ne suggérer des lieux que si on est dehors
      City.pois.forEach(p => near.push({ name: p.name, x: p.x, y: p.y, d: UTIL.dist(p, this) }));
      City.houses.forEach(h => near.push({ name: h.name || 'une maison', x: h.x, y: h.y, d: UTIL.dist(h, this) }));
      City.vehicles.forEach(v => { if (!this.inVehicle) near.push({ name: v.name, x: v.x, y: v.y, d: UTIL.dist(v, this) }); });
    }
    const closest = near.filter(o => o.d < 10).sort((a, b) => a.d - b.d)[0];
    if (closest) {
      const m = Math.round(closest.d * CONFIG.METERS_PER_TILE);
      const dir = UTIL.bearing(closest.x - this.x, closest.y - this.y);
      Audio.tone({ freq: 500, type: 'sine', duration: 0.12, gain: 0.08, pan: this.panForPoint(closest.x, closest.y) });
      return announce(`${closest.name} est à ${m} mètres, vers le ${dir}. Approchez-vous encore un peu, puis appuyez de nouveau pour interagir.`, 'assertive');
    }
    announce(isIndoors ? 'Rien à proximité à l\'intérieur. Appuyez sur Ctrl+Alt+E pour ressortir.' : 'Rien à proximité. Faites un scan avec F.', 'polite');
  },

  // ... (reste du fichier inchangé)
};
