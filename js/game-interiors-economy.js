/* ============================================================
   GAME-INTERIORS-ECONOMY.JS — suite de l'objet Game (voir js/game.js
   pour l'explication du découpage en plusieurs fichiers).
   Contenu : intérieurs parcourables, mode vendeur.
============================================================ */
Object.assign(Game, {
  /* ==========================================================
     INTÉRIEURS À PARCOURIR — on marche vraiment dans le plan (pièces
     contiguës), tout à l'oreille. Étape 1 : maison vide (les meubles
     s'achètent plus tard). E décrit/utilise la pièce ; Ctrl+Alt+E sort.
     ========================================================== */
  interior: null,
  enterHouseInterior(house) {
    const key = (house.floors >= 2) ? 'maison_luxe' : 'maison';
    this._enterInterior(house, house.name || 'votre maison', key);
  },
  _enterInterior(ref, name, key) {
    const tpl = (typeof INTERIOR_TYPES !== 'undefined' && INTERIOR_TYPES[key]) || INTERIOR_TYPES.maison;
    const ent = tpl.entrance || { x: 0, y: 0 };
    this.interior = { ref, name, kind: 'house', rooms: tpl.rooms, ix: ent.x, iy: ent.y, room: null, returnX: this.x, returnY: this.y };
    this.indoors = { name, ref, kind: 'interior' }; // ambiance de ville atténuée
    this.doorCue();
    const room = this._roomAt(ent.x, ent.y);
    this.interior.room = room ? room.name : null;
    announce(`Vous entrez dans ${name}. Pièce : ${room ? room.name : 'entrée'}. Déplacez-vous pour explorer les pièces. E pour interagir, Touche Q ou Ctrl+Alt+E pour sortir.`, 'assertive');
    updateHud();
  },
  _roomAt(ix, iy) {
    if (!this.interior) return null;
    return this.interior.rooms.find(r => ix >= r.x && ix < r.x + r.w && iy >= r.y && iy < r.y + r.h) || null;
  },
  _moveInterior(dx, dy) {
    const it = this.interior;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    if (sx === 0 && sy === 0) return;
    const nx = it.ix + sx, ny = it.iy + sy;
    const room = this._roomAt(nx, ny);
    if (!room) { // mur / bord du plan
      if (window.Audio && Audio.impact) Audio.impact(UTIL.clamp(sx, -1, 1) * 0.5);
      announce('Mur.', 'assertive');
      return;
    }
    it.ix = nx; it.iy = ny;
    if (window.Audio && Audio.tone) Audio.tone({ freq: 210, type: 'sine', duration: 0.05, gain: 0.045, pan: 0 });
    if (room.name !== it.room) {
      it.room = room.name; announce(`Pièce : ${room.name}.`, 'polite');
      // La piscine d'une maison de standing : on peut s'y baigner (touche E,
      // même mécanique que plonger dans l'eau en extérieur).
      const wasInWater = this.inWater;
      this.inWater = (room.name === 'piscine');
      if (wasInWater && !this.inWater) this.underwater = false;
    }
    const obj = this._objectAt(nx, ny);
    if (obj) announce(`Objet : ${obj.name}. E pour l'utiliser.`, 'polite');
    if (it.service && it.service.x === nx && it.service.y === ny) announce(`${it.service.label}. Appuyez sur E pour être servi.`, 'polite');
  },
  // Meuble/objet posé exactement sur une case (pour l'annonce en marchant).
  _objectAt(ix, iy) {
    const it = this.interior; if (!it || !it.ref || !it.ref.furniture) return null;
    return it.ref.furniture.find(f => f.ix === ix && f.iy === iy) || null;
  },
  // Meuble sur la case OU juste à côté (pour interagir sans alignement pixel
  // parfait : « impossible d'interagir avec certains objets » venait de là).
  _objectNear(ix, iy) {
    const it = this.interior; if (!it || !it.ref || !it.ref.furniture) return null;
    return it.ref.furniture
      .map(f => ({ f, d: Math.max(Math.abs(f.ix - ix), Math.abs(f.iy - iy)) }))
      .filter(o => o.d <= 1)
      .sort((a, b) => a.d - b.d)[0]?.f || null;
  },
  // Première case libre de la pièce (celle où l'on se tient en priorité).
  _freeFurnitureSpot(roomName, prefX, prefY) {
    const it = this.interior; const room = (it.rooms || []).find(r => r.name === roomName); if (!room) return null;
    const taken = (x, y) => (it.ref.furniture || []).some(f => f.ix === x && f.iy === y);
    if (prefX >= room.x && prefX < room.x + room.w && prefY >= room.y && prefY < room.y + room.h && !taken(prefX, prefY)) return { x: prefX, y: prefY };
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (!taken(x, y)) return { x, y };
    return null;
  },
  // Acheter un meuble et le placer dans la pièce courante de sa maison.
  buyFurniture(furnId) {
    const it = this.interior; if (!it) return announce('Entrez dans votre maison pour la meubler.', 'assertive');
    const f = (typeof FURNITURE_CATALOG !== 'undefined') && FURNITURE_CATALOG[furnId]; if (!f) return;
    if (this.money < f.price) return announce(`${f.name} coûte ${UTIL.formatMoney(f.price)}. Fonds insuffisants.`, 'assertive');
    const spot = this._freeFurnitureSpot(it.room, it.ix, it.iy);
    if (!spot) return announce('Plus de place dans cette pièce. Essayez une autre pièce.', 'assertive');
    this.money -= f.price;
    it.ref.furniture = it.ref.furniture || [];
    it.ref.furniture.push({ id: 'furn_' + Date.now(), type: f.type, name: f.name, room: it.room, ix: spot.x, iy: spot.y, capacity: f.capacity || 0, storage: [] });
    if (window.Audio && Audio.cash) Audio.cash();
    announce(`${f.name} acheté et placé dans ${it.room} pour ${UTIL.formatMoney(f.price)}. Placez-vous dessus et appuyez sur E pour l'utiliser.`, 'assertive');
    updateHud();
  },
  // Interagir avec un meuble selon son type.
  interactFurniture(obj) {
    switch (obj.type) {
      case 'storage':
        obj.storage = obj.storage || [];
        return this.openStorage(obj.storage, obj.capacity || 20, obj.name);
      case 'ordi':
        return (typeof Computer !== 'undefined') ? Computer.boot() : announce('Ordinateur indisponible.', 'assertive');
      case 'lit':
        this.energy = Math.min(100, (this.energy || 0) + 40);
        if (window.AudioLib) AudioLib.playOnce('sfx_notification', { volume: 0.3 });
        return announce('Vous vous reposez un moment. Énergie restaurée.', 'assertive');
      case 'audio':
        announce(`${obj.name}. Ouverture du lecteur de musique.`, 'polite');
        // Enceinte FIXE posée dans la maison : le son doit baisser avec la
        // distance (y compris en sortant de la maison), pas rester à plein
        // volume partout comme avant.
        MusicPlayer.setSourceRef({ house: this.interior.ref, ix: obj.ix, iy: obj.iy });
        return this.openMusicMenu(`${obj.name} (${obj.room})`);
      default:
        return announce(`${obj.name}. Un bel élément de votre intérieur.`, 'polite');
    }
  },
  exitInterior() {
    if (!this.interior) return;
    const name = this.interior.name;
    this.x = this.interior.returnX; this.y = this.interior.returnY;
    this.interior = null; this.indoors = null;
    this.inWater = City.getTile(this.x, this.y) === 'eau'; this.underwater = false; AudioLib.stopLoop('eau_nage_sous');
    this.doorCue();
    announce(`Vous sortez de ${name}. Vous êtes de nouveau dehors.`, 'assertive');
    updateHud();
  },
  // E à l'intérieur : décrit la pièce et donne accès au rangement de la maison
  // (les meubles/objets interactifs par pièce viendront avec la personnalisation).
  _interactInterior() {
    const it = this.interior;
    // Lieu public : au comptoir/guichet/accueil (case de service ou juste à
    // côté), E ouvre le service du lieu (boutique, banque, soins, police…).
    if (it.kind === 'poi') {
      if (it.service && Math.abs(it.ix - it.service.x) <= 1 && Math.abs(it.iy - it.service.y) <= 1) return this.enterPOI(it.poi);
      return announce(`Pièce : ${it.room || 'entrée'}. Allez au ${it.service ? it.service.label : 'comptoir'} pour être servi.`, 'assertive');
    }
    // Piscine (maison de standing) : E pour se baigner directement.
    if (it.room === 'piscine') return this.diveInWater();
    // Un meuble sous les pieds OU juste à côté : on l'utilise directement.
    const obj = this._objectNear(it.ix, it.iy);
    if (obj) return this.interactFurniture(obj);
    // Sinon : menu de la pièce (acheter/placer un meuble, rangement de la maison).
    if (typeof openHouseRoomMenu === 'function') return openHouseRoomMenu();
    const house = it.ref;
    if (house && typeof house.capacity === 'number') { house.storage = house.storage || []; return this.openStorage(house.storage, house.capacity, it.name || 'Maison'); }
    announce(`Pièce : ${it.room || 'entrée'}.`, 'polite');
  },

  // Interactions
  interact() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.freeFalling) return announce('Vous êtes en chute libre, impossible d\'agir.', 'polite');
    if (this.interior) return this._interactInterior(); // dedans : on interagit avec la pièce
    // On considère qu'on est ressorti si l'on s'est éloigné du lieu où l'on
    // était entré (Ctrl+Alt+E). E n'est PLUS détourné pour rouvrir toujours le
    // même lieu : il propose normalement TOUT ce qu'il y a autour (le lieu
    // lui-même quand on est dedans, mais aussi un véhicule, une personne…), pour
    // ne plus rester bloqué (ex. l'auto-école après le test).
    if (this.indoors && this.indoors.ref && UTIL.dist(this.indoors.ref, this) > 4) this.indoors = null;
    // Un vrai joueur inconscient à proximité : assistance immédiate, ou
    // portage physique réel (pour l'emmener où on veut — otage, escorte...).
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
      // On porte déjà quelqu'un : relâcher (dépose sur place, ou réveil si
      // un hôpital est à proximité).
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
    // Client de la mission "Course VIP soignée" : prioritaire, même en
    // véhicule (on l'invite à monter sans en descendre).
    if (this.activeMission && (this.activeMission.type === 'taxi_soigne' || this.activeMission.type === 'taxi') && !this.taxiState) {
      const client = City.npcs.find(n => n.id === this.activeMission.clientId && !n.dead);
      const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
      if (client && UTIL.dist(client, myPos) < 3) return this.openTaxiBoardMenu(client, this.activeMission);
    }
    if (this.activeMission && this.activeMission.type === 'escorte' && !this.escorteState && this.isMissionAuthorized(this.activeMission)) {
      const client = City.npcs.find(n => n.id === this.activeMission.clientId && !n.dead);
      const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
      if (client && UTIL.dist(client, myPos) < 3) return this.openEscorteBoardMenu(client, this.activeMission);
    }
    // Station-service ou parking à proximité, en véhicule : on propose le
    // choix plutôt que de forcer la descente automatiquement. Avant, E en
    // véhicule appelait TOUJOURS interactVehicle() (qui fait descendre), donc
    // faire le plein était en fait impossible — refuelVehicle() exige d'être
    // dans le véhicule, mais on en était déjà sorti avant de pouvoir l'appeler.
    if (this.inVehicle && this.vehicle) {
      const servicePoi = City.pois.find(p => (p.type === 'station_essence' || p.type === 'garage' || p.type === 'atelier') && UTIL.dist(p, this.vehicle) < 4);
      if (servicePoi) {
        const label = servicePoi.type === 'station_essence' ? '⛽ Faire le plein / recharger' : servicePoi.type === 'atelier' ? '🔧 Faire réparer' : '🅿️ Se garer ici';
        if (typeof ensureMenuOpen === 'function') ensureMenuOpen(); else el('menuOverlay').style.display = 'flex';
        el('menuTitle').textContent = servicePoi.name;
        const items = [
          { id: 'service', title: label, desc: 'Rester au volant.' },
          { id: 'exit', title: '🚪 Descendre du véhicule', desc: '' },
        ];
        renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'service') this.enterPOI(servicePoi); else this.interactVehicle(); });
        announce(`${servicePoi.name} à proximité. Restez au volant pour utiliser le service, ou descendez.`, 'assertive');
        return;
      }
    }
    // Le passager (ridingWith) doit aussi tomber ici pour descendre directement
    // : sinon E le faisait passer par la recherche de cibles ci-dessous, qui ne
    // le faisait descendre QUE si le véhicule était la seule cible à portée
    // (menu de choix sinon, voire une tout autre interaction) — d'où le statut
    // "passager" qui semblait ne jamais se nettoyer une fois qu'on avait fait
    // autre chose entre-temps.
    if (this.inVehicle || this.ridingWith) return this.interactVehicle();
    // On rassemble TOUT ce avec quoi on peut interagir à portée (joueurs, PNJ,
    // bâtiments, maisons, véhicules, mine, gang, objets au sol). S'il n'y a
    // qu'une seule chose, on interagit directement ; s'il y en a plusieurs, on
    // demande au joueur avec laquelle il veut interagir (menu de choix).
    const targets = [];
    Array.from(Net.remotePlayers.values()).forEach(p => {
      const d = UTIL.dist(p, this);
      if (d >= 3) return;
      const np = { id: p.id, name: `${p.firstName} ${p.lastName}`, gender: p.gender, outfit: p.outfit, isPlayer: true, x: p.x, y: p.y, role: p.role, policeRank: p.policeRank, accountUsername: p.accountUsername || null };
      // Piégé dans un véhicule volé à un PNJ (voir stuckInVehicle) : on peut
      // l'aider à sortir depuis l'extérieur, plutôt que la salutation habituelle.
      if (p.stuckInVehicle) targets.push({ d, label: `🔓 Aider ${np.name} à sortir du véhicule (piégé(e) à l'intérieur)`, act: () => helpFreeTrappedPlayer(np.id, np.name) });
      else targets.push({ d, label: `🧍 ${np.name} (joueur)`, act: () => { this.describePerson(np); this.greetPlayer(np); } });
    });
    City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < 3).forEach(n => {
      targets.push({ d: UTIL.dist(n, this), label: `🧍 ${n.name}`, act: () => { this.describePerson(n); this.talkTo(n); } });
    });
    // Bâtiments : E N'ENTRE PLUS (l'entrée est réservée à Ctrl+Alt+E). Les lieux
    // « sans porte » (station-service, aéroport…) restent des services qu'on
    // utilise directement ; un lieu où l'on est DÉJÀ entré : E rouvre son contenu.
    const noDoorEnter = ['station_essence', 'mine', 'aeroport', 'heliport', 'port', 'atelier'];
    City.pois.filter(p => UTIL.dist(p, this) < 4).forEach(p => {
      const inside = this.indoors && this.indoors.ref === p;
      if (noDoorEnter.includes(p.type) || inside) {
        targets.push({ d: UTIL.dist(p, this), label: `🏢 ${p.name}${inside ? ' (intérieur)' : ''}`, act: () => this.enterPOI(p) });
      } else {
        targets.push({ d: UTIL.dist(p, this), label: `🚪 ${p.name} — touche Q pour entrer`, act: () => announce(`Vous êtes devant ${p.name}. Appuyez sur la touche Q, ou Ctrl+Alt+E, pour entrer.`, 'assertive') });
      }
    });
    City.houses.filter(h => UTIL.dist(h, this) < 4).forEach(h => {
      const inside = this.indoors && this.indoors.ref === h;
      if (inside) {
        targets.push({ d: UTIL.dist(h, this), label: `🏠 ${h.name || 'une maison'} (intérieur)`, act: () => this.enterHouse(h) });
      } else {
        targets.push({ d: UTIL.dist(h, this), label: `🏠 ${h.name || 'une maison'} — touche Q pour entrer`, act: () => announce(`Vous êtes devant ${h.name || 'cette maison'}. Appuyez sur la touche Q, ou Ctrl+Alt+E, pour entrer.`, 'assertive') });
      }
    });
    City.vehicles.filter(v => !this.inVehicle && UTIL.dist(v, this) < 3).forEach(v => {
      // Distance précise et mention « à vous » : indispensable pour distinguer
      // deux véhicules du même modèle garés côte à côte, sans quoi le menu
      // affichait deux entrées au texte IDENTIQUE, impossibles à différencier.
      const meters = Math.round(UTIL.dist(v, this) * CONFIG.METERS_PER_TILE);
      // v.owner === 'player' est un indicateur générique ("appartient à UN
      // joueur, peu importe lequel", stocké sur l'objet partagé et donc vrai
      // pour le véhicule d'un AUTRE joueur aussi) — pas "m'appartient à MOI" :
      // c'est ownedVehicles (propre à chaque client) qu'il faut vérifier.
      // Avant, la voiture d'un autre joueur garée à côté de la vôtre pouvait
      // s'afficher « à vous » à tort.
      const mine = (this.ownedVehicles || []).includes(v.id) ? ' — à vous' : '';
      targets.push({ d: UTIL.dist(v, this), label: `🚗 ${v.name} (véhicule, ${meters} m${mine})`, act: () => this.interactVehicle(v) });
    });
    City.miningSites.filter(m => UTIL.dist(m, this) < 4).forEach(m => {
      targets.push({ d: UTIL.dist(m, this), label: '⛏️ Site minier', act: () => this.mine(m) });
    });
    City.gangs.filter(g => UTIL.dist(g, this) < 4).forEach(g => {
      targets.push({ d: UTIL.dist(g, this), label: '💀 Repaire de gang', act: () => this.beginGangRaid(g) });
    });
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
    // Rien juste à portée : plutôt que de rester muet, on repère le lieu utile
    // le plus proche (bâtiment, maison ou véhicule) dans un rayon élargi et on
    // indique dans quelle direction avancer pour pouvoir interagir.
    const near = [];
    City.pois.forEach(p => near.push({ name: p.name, x: p.x, y: p.y, d: UTIL.dist(p, this) }));
    City.houses.forEach(h => near.push({ name: h.name || 'une maison', x: h.x, y: h.y, d: UTIL.dist(h, this) }));
    City.vehicles.forEach(v => { if (!this.inVehicle) near.push({ name: v.name, x: v.x, y: v.y, d: UTIL.dist(v, this) }); });
    const closest = near.filter(o => o.d < 10).sort((a, b) => a.d - b.d)[0];
    if (closest) {
      const m = Math.round(closest.d * CONFIG.METERS_PER_TILE);
      const dir = UTIL.bearing(closest.x - this.x, closest.y - this.y);
      Audio.tone({ freq: 500, type: 'sine', duration: 0.12, gain: 0.08, pan: this.panForPoint(closest.x, closest.y) });
      return announce(`${closest.name} est à ${m} mètres, vers le ${dir}. Approchez-vous encore un peu, puis appuyez de nouveau pour interagir.`, 'assertive');
    }
    announce('Rien à proximité. Faites un scan avec F.', 'polite');
  },
  // Enregistrer un contact sous un nom personnalisé : c'est CE nom qui sera
  // annoncé à chaque fois qu'on croise cette personne par la suite — jamais
  // son vrai nom de personnage. Lié au compte (identité stable) si connu, et
  // au numéro précis si on a composé un numéro pour l'appeler (permet à la
  // même personne d'être enregistrée sous plusieurs noms différents si elle a
  // donné plusieurs numéros à des moments différents).
  saveContact(targetId, defaultName, number) {
    const remote = targetId ? Net.remotePlayers.get(targetId) : null;
    const username = remote?.accountUsername || null;
    if (!username && !number) return announce('Impossible d\'enregistrer ce contact : identité inconnue.', 'assertive');
    AccessibleTextPrompt.open('Enregistrer ce contact', 'Sous quel nom voulez-vous reconnaître cette personne à chaque fois que vous la croiserez ?', defaultName || '', (label) => {
      if (!label) return;
      const idx = number ? this.myContacts.findIndex(c => c.number === number) : this.myContacts.findIndex(c => c.username && c.username === username && !c.number);
      const entry = { number: number || null, username, label };
      if (idx !== -1) this.myContacts[idx] = entry; else this.myContacts.push(entry);
      announce(`Contact enregistré : vous reconnaîtrez cette personne comme "${label}" désormais.`, 'assertive');
    });
  },
  // Résout comment appeler une personne rencontrée, d'après les contacts
  // enregistrés par l'OBSERVATEUR (pas le vrai nom du personnage). Si
  // plusieurs numéros de la même personne ont été enregistrés sous des noms
  // différents (elle a donné plusieurs identités), l'ambiguïté est annoncée
  // honnêtement plutôt que d'en choisir une au hasard.
  resolveContactName(npc) {
    if (!npc.isPlayer || !npc.accountUsername) return null;
    const matches = this.myContacts.filter(c => c.username === npc.accountUsername);
    if (!matches.length) return null;
    const labels = [...new Set(matches.map(m => m.label))];
    if (labels.length === 1) return { label: labels[0], ambiguous: false };
    return { label: labels.join(' ou '), ambiguous: true };
  },
  describePerson(npc) {
    // Un PNJ sans apparence encore générée en reçoit une, une fois pour
    // toutes. Un vrai joueur, lui, ne doit JAMAIS se voir attribuer une
    // apparence inventée localement : ce serait faux, et jamais partagé avec
    // les autres. On décrit honnêtement ce qu'il a réellement choisi.
    if (!npc.isPlayer && (!npc.outfit || !Object.keys(npc.outfit).length)) npc.outfit = generateNPCAppearance(npc.job);
    const o = npc.outfit || {};
    const estFemme = npc.gender === 'femme';
    const sujet = estFemme ? 'Une femme' : 'Un homme';
    const pronom = estFemme ? 'Elle porte' : 'Il porte';
    // Un masque cache tout ce qui permettrait d'identifier la personne : son
    // nom ET son métier, même si c'est en réalité un policier ou quelqu'un
    // de connu. La tenue visible (hors visage/coiffure), elle, continue
    // toujours d'être décrite en entier — un masque ne cache pas les habits.
    if (o.masque) {
      // "se trouve" plutôt que "est arrêté(e)" : ce dernier se comprend à
      // l'oreille comme une arrestation policière, alors qu'il ne s'agissait
      // que de dire que la personne est immobile, juste devant vous — ambigu
      // en particulier si elle est assise dans un véhicule.
      let desc = `${sujet} masqué${estFemme ? 'e' : ''} se trouve droit devant vous. Impossible d'identifier qui c'est. `;
      const parts = [];
      if (o.haut) parts.push(`un ${o.haut}${o.couleurHaut ? ' de couleur ' + o.couleurHaut : ''}`);
      if (o.bas) parts.push(`un ${o.bas}${o.couleurBas ? ' ' + o.couleurBas : ''}`);
      if (o.chaussures) parts.push(`des ${o.chaussures}${o.couleurChaussures ? ' ' + o.couleurChaussures : ''}`);
      if (parts.length) desc += `${pronom} ${parts.join(', ')}. `;
      announce(desc, 'polite');
      return;
    }
    // L'identification comme policier ne dépend JAMAIS du métier caché de la
    // personne, seulement de ce qu'elle porte VRAIMENT en ce moment : sans
    // uniforme (civil, déguisement...), rien ne permet de la reconnaître
    // comme policier, même si elle l'est réellement.
    const qualif = npc.isPlayer
      ? (o.isPolice ? (POLICE_RANKS[npc.policeRank || 'agent']?.name || 'policier') : 'joueur réel')
      : (o.isPolice ? npc.job : (npc.job === 'policier' ? 'civil (hors service ou en civil)' : npc.job));
    // Le nom annoncé est celui que VOUS avez enregistré pour cette personne
    // dans vos contacts, pas son vrai nom de personnage — comme reconnaître
    // quelqu'un à son visage plutôt qu'à une pièce d'identité qu'on ne voit pas.
    const contactMatch = this.resolveContactName(npc);
    const displayName = contactMatch ? contactMatch.label : npc.name;
    let desc = `${sujet} se trouve droit devant vous : ${displayName}, ${qualif}. `;
    if (contactMatch?.ambiguous) desc += `Attention : cette personne correspond à plusieurs de vos contacts enregistrés sous des noms différents — impossible de savoir lequel c'est vraiment sans lui parler. `;
    if (o.isPolice) {
      desc += `${pronom} l'uniforme de la police. `;
    } else if (o.haut || o.bas || o.chaussures) {
      const parts = [];
      if (o.haut) parts.push(`un ${o.haut}${o.couleurHaut ? ' de couleur ' + o.couleurHaut : ''}`);
      if (o.bas) parts.push(`un ${o.bas}${o.couleurBas ? ' ' + o.couleurBas : ''}`);
      if (o.chaussures) parts.push(`des ${o.chaussures}${o.couleurChaussures ? ' ' + o.couleurChaussures : ''}`);
      desc += `${pronom} ${parts.join(', ')}. `;
    } else {
      desc += npc.isPlayer ? 'Il/elle n\'a pas encore personnalisé sa tenue. ' : '';
    }
    desc += o.coiffure ? `Coiffure : ${o.coiffure}. ` : '';
    if (o.lunettes && o.lunettes !== 'aucune') desc += `${pronom} des ${o.lunettes}.`;
    else if (o.lunettes === 'aucune') desc += 'Pas de lunettes.';
    announce(desc, 'polite');
  },
  greetPlayer(p) {
    if (p.outfit?.masque) {
      announce('Impossible d\'identifier cette personne masquée. Ctrl+Y pour lui parler en RP quand même, verrouillez-la comme cible (scan puis un chiffre) pour lui donner un objet ou votre talkie-walkie.', 'polite');
      return;
    }
    const contactMatch = this.resolveContactName(p);
    const displayName = contactMatch ? contactMatch.label : p.name;
    announce(`Vous êtes en face de ${displayName}, un vrai joueur. Ctrl+Y pour lui parler en RP, verrouillez-le comme cible (scan puis un chiffre) pour lui donner un objet ou votre talkie-walkie.`, 'polite');
  },
  rpTalk() {
    if (!Net.connected) return announce('Vous n\'êtes pas connecté à un serveur multijoueur.', 'assertive');
    AccessibleTextPrompt.open('Parler en RP', 'Que dites-vous, audible par les joueurs proches ?', '', (text) => {
      if (!text) return;
      Net.chat(text);
      announce(`Vous dites : ${text}`, 'polite');
      log(`💬 Vous : ${text}`, 'chat');
    });
  },
  // RP libre ("/me") : décrit une ACTION ou une attitude de son personnage,
  // pas une réplique parlée (voir rpTalk ci-dessus). Sert à jouer tout ce
  // qu'aucune touche ou mécanique du jeu ne couvre (lever les mains d'un air
  // nerveux, sortir un objet, hocher la tête...) — audible par les mêmes
  // joueurs réels proches, avec la même portée que la parole RP.
  rpAction() {
    if (!Net.connected) return announce('Vous n\'êtes pas connecté à un serveur multijoueur.', 'assertive');
    AccessibleTextPrompt.open('Action RP libre', 'Que fait votre personnage, visible par les joueurs proches ? (ex. « lève lentement les mains »)', '', (text) => {
      if (!text) return;
      Net.rpAction(text);
      announce(`Vous ${text}`, 'polite');
      log(`🎭 Vous ${text}`, 'chat');
    });
  },
  talkTo(npc) {
    Audio.voiceHint(0);
    const line = UTIL.pick(npc.dialogue);
    announce(`${npc.name}, ${npc.job} : « ${line} »`, 'polite');
    if (npc.job === 'ganger' || npc.job === 'garde') {
      // Réplique audio du groupe "énervé" pour renforcer l'hostilité — déjà
      // utilisée pour les membres de gang, étendue aux gardes/vigiles armés
      // (sabotage, convoi blindé, dépôt d'armes, planque gardée), qui n'en
      // profitaient pas du tout jusque-là.
      const pool = NPCVoiceGroups.enerve.filter(l => l.gender === npc.gender);
      const voice = UTIL.pick(pool.length ? pool : NPCVoiceGroups.enerve);
      const pan = Math.max(-1, Math.min(1, (npc.x - this.x) / 15));
      AudioLib.playPositional(voice.key, pan, 0.9);
    }
    if (npc.job === 'commercant' || npc.job === 'vendeur') this.openShop(npc);
    if (npc.job === 'mecanicien') this.repairVehicle();
    if (npc.job === 'medecin') {
      if (this.money < 5000) return announce('Soins médicaux : 5 000 FCFA. Fonds insuffisants.', 'assertive');
      this.heal(30); this.money -= 5000; announce('Soins médicaux : 5 000 FCFA.', 'polite');
    }
  },
  describeOutfit() {
    const o = this.outfit;
    if (o.isPolice) {
      let msg = 'Vous portez l\'uniforme de la police.';
      if (o.bas) msg += ` Bas : ${o.bas}.`;
      if (o.chaussures) msg += ` Chaussures : ${o.chaussures}.`;
      return announce(msg, 'polite');
    }
    if (!o.haut && !o.bas && !o.chaussures && !o.accessoires.length) return announce('Vous ne portez pas de vêtements particuliers pour le moment. Achetez une tenue dans une boutique de vêtements, ou personnalisez coiffure/lunettes depuis "Ma tenue" dans le menu.', 'polite');
    let msg = 'Votre tenue actuelle : ';
    const parts = [];
    if (o.haut) parts.push(o.couleurHaut ? `${o.haut} ${o.couleurHaut}` : o.haut);
    if (o.bas) parts.push(o.couleurBas ? `${o.bas} ${o.couleurBas}` : o.bas);
    if (o.chaussures) parts.push(o.couleurChaussures ? `${o.chaussures} ${o.couleurChaussures}` : o.chaussures);
    msg += parts.join(', ') || 'rien de particulier';
    if (o.coiffure) msg += `. Coiffure : ${o.coiffure}`;
    if (o.lunettes && o.lunettes !== 'aucune') msg += `. ${o.lunettes}`;
    if (o.accessoires.length) msg += `. Accessoires : ${o.accessoires.join(', ')}`;
    announce(msg + '.', 'polite');
  },
  // Personnaliser son apparence (couleurs, coiffure, lunettes) : sans ça, un
  // vrai joueur croisé par un autre n'a ni couleur de vêtement, ni coiffure,
  // ni lunettes à décrire — utile par exemple pour qu'un groupe s'accorde sur
  // une tenue reconnaissable (costume blanc) et repère un intrus (en rouge).
  customizeAppearance() {
    el('menuTitle').textContent = 'Ma tenue';
    const o = this.outfit;
    const items = [
      { id: 'describe', title: '🗣️ Décrire ma tenue actuelle', desc: '' },
      { id: 'coiffure', title: '💇 Changer la coiffure', desc: o.coiffure || 'Non choisie.' },
      { id: 'lunettes', title: '👓 Changer les lunettes', desc: o.lunettes || 'Aucune.' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      if (sel.id === 'describe') { closeMenu(); this.describeOutfit(); }
      else if (sel.id === 'coiffure') this.pickAppearanceValue('coiffure', APPEARANCE.coiffures);
      else if (sel.id === 'lunettes') this.pickAppearanceValue('lunettes', APPEARANCE.lunettes);
    });
    announce('Le haut, le bas et les chaussures s\'achètent en boutique de vêtements, puis se portent depuis l\'inventaire — ce menu ne gère que la coiffure et les lunettes, qui ne s\'achètent nulle part.', 'polite');
  },
  pickAppearanceValue(field, options) {
    el('menuTitle').textContent = field === 'coiffure' ? 'Choisir une coiffure' : 'Choisir des lunettes';
    const items = options.map(o => ({ id: o, title: o, desc: '' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      this.outfit[field] = sel.id;
      announce(`${field === 'coiffure' ? 'Coiffure' : 'Lunettes'} : ${sel.id}.`, 'assertive');
      updateHud();
    });
  },
  enterPOI(poi) {
    if (poi.type === 'magasin' || poi.type === 'restaurant' || poi.type === 'pharmacie' || poi.type === 'vetements' || poi.type === 'quincaillerie' || poi.type === 'electronique') { this.openShop(poi); }
    else if (poi.type === 'armurerie') { this.openShop(poi); }
    else if (poi.type === 'marche_noir') { this.openShop(poi); }
    else if (poi.type === 'marche_noir_lointain') {
      // Le marché noir international (ville voisine, très loin — en pratique
      // seulement atteignable en avion ou en hélicoptère) a un stock plus
      // fourni ET l'offre rare et clandestine du char d'assaut, exclusive à
      // ce lieu : le vrai motif du voyage.
      if (!this.ownedVehicles.some(id => City.vehicles.find(v => v.id === id)?.type === 'char') && UTIL.chance(0.15)) {
        const price = Math.round(VEHICLE_CATALOG.char.price * 1.4);
        AccessibleConfirm.open('Offre clandestine', `Un contact local vous propose un char d'assaut volé, à ${UTIL.formatMoney(price)}. Très risqué, très rare. Acheter ?`, (confirmed) => {
          if (confirmed) {
            if (this.money < price) { announce('Fonds insuffisants pour cette offre.', 'assertive'); this.openShop(poi); return; }
            this.money -= price;
            const cls = VEHICLE_CATALOG.char;
            const vid = 'char_bm_' + Date.now();
            City.vehicles.push({ id: vid, type: 'char', name: cls.name, x: poi.x + 2, y: poi.y + 2, fuel: 1, hp: 100, locked: false, owner: 'player', inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: cls.price, trunk: cls.trunk, passengers: [], openDoors: new Set() });
            this.ownedVehicles.push(vid);
            this.wanted = Math.min(100, this.wanted + 25);
            announce('Char d\'assaut livré discrètement. Attention : très visible, très recherché — et vous êtes encore loin de chez vous.', 'assertive');
            updateHud();
          }
          this.openShop(poi);
        });
        return;
      }
      this.openShop(poi);
    }
    else if (poi.type === 'concessionnaire') { this.openVehicleShop(poi); }
    else if (poi.type === 'police') { this.openPoliceStation(poi); }
    else if (poi.type === 'hopital') { this.heal(100); announce('Vous êtes soigné à l\'hôpital.', 'assertive'); }
    else if (poi.type === 'banque') { if (this.activeMission && this.activeMission.type === 'heist' && !this.heistState) this.beginBankHeist(); else this.useBankCounter(); }
    else if (poi.type === 'station_essence') { this.refuelVehicle(poi); }
    else if (poi.type === 'atelier') { this.enterWorkshop(poi); }
    else if (poi.type === 'prison') { this.openPrison(poi); }
    else if (poi.type === 'aeroport' || poi.type === 'heliport') { this.aircraftMenu(poi); }
    else if (poi.type === 'mine') { const mine = City.miningSites.find(m => m.x === poi.x && m.y === poi.y); if (mine) { if (!this.miningMachine) announce(`Site minier. Ressource : ${mine.resource}. Achetez une machine d'extraction (750 000 FCFA, touche Ctrl+M) pour un bien meilleur rendement.`, 'polite'); this.mine(mine); } }
    else if (poi.type === 'entrepot') { this.openWarehouse(poi); }
    else if (poi.type === 'garage') { this.openPublicParking(poi); }
    else if (poi.type === 'terrain_agricole') { this.tendFarm(poi); }
    else if (poi.type === 'animalerie') { if (typeof GuideDog !== 'undefined') GuideDog.openPetShopMenu(); }
    else if (poi.type === 'veterinaire') { if (typeof GuideDog !== 'undefined') GuideDog.openVetMenu(); }
    else if (poi.type === 'qg_extreme') {
      // Façon RP GTA : la police est jouée par de vrais joueurs humains, donc
      // il n'y a pas de pénalité automatique garantie. Le seul vrai risque,
      // c'est de vous faire remarquer et signaler — si personne ne joue
      // policier au même moment, il ne se passe simplement rien.
      if (UTIL.chance(0.12)) {
        this.reportCrimeToPolice('intrusion', 'Passage suspect signalé près d\'un repaire connu');
        announce('Quelqu\'un vous a repéré en train de traîner par ici... ça pourrait remonter à la police.', 'polite');
      }
      this.openExtremeMissions();
    }
    else if (poi.type === 'auto_ecole') { this.openDrivingSchool(); }
    else if (poi.type === 'ecole_pilotage') { this.openFlightSchool(); }
    else if (poi.type === 'tribunal') { this.openCourtHouse(); }
    else if (poi.type === 'monument') { this.openMusicMonument(); }
    else if (poi.type === 'gouvernorat') { this.openGovernorate(); }
    else if (poi.type === 'morgue') { this.openMorgue(); }
    else if (poi.type === 'cimetiere') { this.openCemetery(); }
    else { announce(`Vous entrez dans ${poi.name}. ${poi.floors > 1 ? 'Bâtiment de ' + poi.floors + ' étages.' : ''}`, 'polite'); }
  },
  // --- Cour Pénale : régulariser sa situation judiciaire ---
  // Payer une caution ramène le niveau de recherche à zéro ; plaider soi-même
  // est gratuit mais aléatoire ; on peut aussi juste assister à un procès.
  openCourtHouse() {
    el('menuTitle').textContent = '⚖️ Cour Pénale';
    const wanted = Math.round(this.wanted || 0);
    const bail = Math.max(50000, wanted * 40000);
    const items = [];
    if (wanted > 0) {
      items.push({ id: 'bail', title: `⚖️ Payer une caution (${UTIL.formatMoney(bail)})`, desc: `Recherche actuelle ${wanted} sur 100 : ramenée à zéro.` });
      items.push({ id: 'plead', title: '🗣️ Plaider soi-même (gratuit)', desc: 'Risqué : réduit peut-être votre niveau de recherche, ou pas du tout.' });
    } else {
      items.push({ id: 'clean', title: '✅ Votre casier est vierge', desc: 'Rien à régulariser pour l\'instant.' });
    }
    items.push({ id: 'watch', title: '👂 Assister à un procès en cours', desc: 'Écouter les débats de la Cour.' });
    items.push({ id: 'exit', title: '↩️ Sortir', desc: '' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'bail') {
        if (this.money < bail) return announce(`Caution de ${UTIL.formatMoney(bail)} : fonds insuffisants.`, 'assertive');
        this.money -= bail; this.wanted = 0; Audio.cash();
        announce('Caution payée. Votre situation est régularisée : vous n\'êtes plus recherché.', 'assertive'); updateHud();
      } else if (sel.id === 'plead') {
        if (UTIL.chance(0.5)) { this.wanted = Math.max(0, Math.round((this.wanted || 0) / 2)); announce('Votre plaidoirie a convaincu la Cour : votre niveau de recherche a baissé.', 'assertive'); }
        else announce('La Cour n\'a pas été convaincue. Votre situation reste inchangée.', 'assertive');
        updateHud();
      } else if (sel.id === 'watch') {
        announce('Un procès est en cours : l\'avocat plaide, le juge écoute, le public retient son souffle. La justice de la cité suit son cours.', 'polite');
      }
    });
  },
  // --- Monument de la Musique : panorama sonore + concert ---
  openMusicMonument() {
    el('menuTitle').textContent = '🎵 Monument de la Musique';
    const items = [
      { id: 'top', title: '🔭 Monter au sommet (panorama sonore)', desc: 'Entendre la direction et la distance des grands lieux de la cité.' },
      { id: 'concert', title: '🎶 Écouter un concert', desc: 'Profiter de la musique du monument.' },
      { id: 'exit', title: '↩️ Redescendre', desc: '' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'top') this.announceCityPanorama();
      else if (sel.id === 'concert') {
        try { AudioLib.playOnce('son_intro_jeu', { volume: 0.6 }); } catch (e) { /* ignore */ }
        announce('Un concert résonne depuis le Monument de la Musique : les artistes de la cité se produisent ici.', 'polite');
      }
    });
  },
  // Décrit, depuis le sommet, les grands lieux repérables : direction cardinale
  // et distance, pour aider à s'orienter dans toute la ville.
  announceCityPanorama() {
    const notable = ['police', 'hopital', 'banque', 'concessionnaire', 'aeroport', 'prison', 'tribunal', 'palais', 'marche_noir'];
    const chosen = [];
    for (const type of notable) {
      const list = City.pois.filter(p => p.type === type);
      if (!list.length) continue;
      const p = list.slice().sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
      chosen.push({ name: p.name, bearing: UTIL.bearing(p.x - this.x, p.y - this.y), dist: Math.round(UTIL.dist(p, this) * CONFIG.METERS_PER_TILE) });
    }
    chosen.sort((a, b) => a.dist - b.dist);
    const top = chosen.slice(0, 6);
    if (!top.length) return announce('Du sommet, la ville s\'étend autour de vous, mais aucun grand lieu n\'est identifiable d\'ici.', 'polite');
    announce(`Du sommet du Monument de la Musique, vous repérez : ${top.map(p => `${p.name}, ${p.bearing}, à ${p.dist} mètres`).join(' ; ')}.`, 'polite');
  },
  // --- Gouvernorat : là où travaillent le gouverneur et les membres du
  // gouvernement. Rencontre officielle, dépôt d'une doléance, don pour la cité.
  openGovernorate() {
    el('menuTitle').textContent = '🏛️ Gouvernorat';
    const items = [
      { id: 'gouverneur', title: '🏛️ Rencontrer le gouverneur', desc: 'Une allocution officielle du gouvernement de la cité.' },
      { id: 'doleance', title: '📝 Déposer une doléance', desc: 'Adresser une requête au gouvernement.' },
      { id: 'don', title: '🎁 Faire un don pour la cité', desc: 'Soutenir les projets du gouvernement.' },
      { id: 'exit', title: '↩️ Sortir', desc: '' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'gouverneur') {
        const paroles = [
          'Le gouverneur déclare : la cité avance quand chaque habitant respecte la loi et son prochain.',
          'Le gouvernement rappelle : sécurité, travail et solidarité sont les priorités de la cité.',
          'Le gouverneur vous souhaite la bienvenue au Gouvernorat, siège du pouvoir de la cité.',
          'Le gouvernement annonce de nouveaux projets pour les quartiers : routes, écoles et santé.',
          'Le gouverneur remercie les citoyens qui font vivre l\'économie et la paix de la cité.',
        ];
        announce(UTIL.pick(paroles), 'polite');
      } else if (sel.id === 'doleance') {
        if (typeof AccessibleTextPrompt === 'undefined') return announce('Dépôt de doléance indisponible pour l\'instant.', 'assertive');
        AccessibleTextPrompt.open('Doléance au gouvernement', 'Écrivez votre requête ou plainte adressée au gouvernement.', '', (texte) => {
          if (!texte || !texte.trim()) return;
          announce('Votre doléance a été enregistrée par le Gouvernorat. Le gouvernement l\'examinera.', 'assertive');
          if (typeof RPJournal !== 'undefined' && RPJournal.log) RPJournal.log('Gouvernorat', `Doléance déposée : ${texte.trim().slice(0, 120)}`, 'info');
        });
      } else if (sel.id === 'don') {
        this.openCityDonation();
      }
    });
  },
  openCityDonation() {
    el('menuTitle').textContent = '🎁 Don pour la cité';
    const montants = [50000, 250000, 1000000];
    const items = montants.map(m => ({ id: String(m), title: UTIL.formatMoney(m), desc: '' }));
    items.push({ id: 'exit', title: '↩️ Annuler', desc: '' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'exit') return;
      const m = parseInt(sel.id, 10);
      if (this.money < m) return announce('Fonds insuffisants pour ce don.', 'assertive');
      this.money -= m; Audio.cash();
      announce(`Le gouvernement vous remercie pour votre don de ${UTIL.formatMoney(m)} en faveur de la cité. Votre générosité est reconnue.`, 'assertive');
      updateHud();
    });
  },
  // --- Décès & enterrement (morgue → cimetière) ---
  // Au décès officiel, le corps est déposé à la morgue. En multijoueur, la liste
  // est partagée par le serveur (le joueur mort a quitté le jeu) ; en solo, elle
  // reste locale. Depuis le cimetière, un joueur décide quand enterrer un défunt.
  recordDeath(name, cause) {
    if (Net.connected) { Net.send({ type: 'death_notice', name, cause: cause || '' }); }
    else { City.morgue = City.morgue || []; City.morgue.push({ name, cause: cause || '', time: Date.now() }); }
  },
  buryDeceased(name) {
    if (Net.connected) { Net.send({ type: 'bury', name }); }
    else {
      City.morgue = City.morgue || []; City.graves = City.graves || [];
      const idx = City.morgue.findIndex(m => m.name === name);
      if (idx >= 0) { const e = City.morgue.splice(idx, 1)[0]; e.buriedTime = Date.now(); City.graves.push(e); }
    }
  },
  // Morgue : consulter les défunts en attente d'enterrement.
  openMorgue() {
    const morgue = City.morgue || [];
    el('menuTitle').textContent = '🏥 Morgue';
    const items = [];
    if (!morgue.length) items.push({ id: 'empty', title: 'Aucun défunt à la morgue', desc: 'Personne n\'attend d\'enterrement pour l\'instant.' });
    else morgue.forEach((m, i) => items.push({ id: 'm' + i, title: `⚰️ ${m.name}`, desc: `En attente d'enterrement.${m.cause ? ' Cause : ' + m.cause + '.' : ''} Allez au cimetière pour l'enterrer.` }));
    items.push({ id: 'exit', title: '↩️ Sortir', desc: '' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, () => { closeMenu(); });
  },
  // Cimetière : organiser l'enterrement d'un défunt de la morgue, se recueillir,
  // ou consulter le registre des personnes déjà enterrées.
  openCemetery() {
    el('menuTitle').textContent = '⚰️ Cimetière';
    const morgue = City.morgue || [];
    const graves = City.graves || [];
    const items = [
      { id: 'bury', title: `⚰️ Organiser un enterrement (${morgue.length} en attente)`, desc: 'Enterrer un défunt actuellement à la morgue.' },
      { id: 'respect', title: '🕯️ Se recueillir', desc: 'Un moment de recueillement.' },
      { id: 'registre', title: `📜 Registre des défunts (${graves.length})`, desc: 'Les personnes enterrées ici.' },
      { id: 'exit', title: '↩️ Sortir', desc: '' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'bury') this.openBurialMenu();
      else if (sel.id === 'respect') announce('Vous vous recueillez un instant. Le silence règne au cimetière, seul le vent murmure entre les stèles.', 'polite');
      else if (sel.id === 'registre') {
        if (!graves.length) return announce('Le registre des défunts est vide pour le moment.', 'polite');
        announce(`Reposent au cimetière : ${graves.slice(-10).map(g => g.name).join(', ')}.`, 'polite');
      }
    });
  },
  openBurialMenu() {
    const morgue = City.morgue || [];
    if (!morgue.length) return announce('Aucun défunt à la morgue : personne à enterrer pour le moment.', 'polite');
    el('menuTitle').textContent = '⚰️ Choisir un défunt à enterrer';
    const items = morgue.map((m, i) => ({ id: 'm' + i, title: m.name, desc: m.cause ? `Cause : ${m.cause}.` : '' }));
    items.push({ id: 'exit', title: '↩️ Retour', desc: '' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'exit') return;
      const m = (City.morgue || [])[parseInt(sel.id.replace('m', ''), 10)];
      if (!m) return;
      this.buryDeceased(m.name);
      try { AudioLib.playOnce('sfx_notification', { volume: 0.5 }); } catch (e) { /* ignore */ }
      announce(`Vous organisez l'enterrement de ${m.name}. Une cérémonie a lieu au cimetière : que son âme repose en paix. La cité lui rend hommage.`, 'assertive');
    });
  },
  enterHouse(house) {
    const authorized = this.ownedHouses.includes(house.id) || (house.authorizedUsers || []).includes(Net.accountUsername);
    if (!authorized && house.owner) return announce('Cette maison est privée. Demandez les clés au propriétaire ou à un agent immobilier.', 'assertive');
    if (!authorized) {
      AccessibleConfirm.open(house.name, `À vendre : ${UTIL.formatMoney(house.price)}, ${house.floors} étage(s), capacité de stockage ${house.capacity}. Acheter ?`, (confirmed) => {
        if (!confirmed) return;
        if (this.money < house.price) return announce(`Prix : ${UTIL.formatMoney(house.price)}. Trop cher.`, 'assertive');
        this.money -= house.price; this.ownedHouses.push(house.id); house.owner = 'player';
        this.registerOwnedProperty('maison', house);
        sendWorldEdit('house_owner', { id: house.id, owner: 'player' });
        announce(`Vous achetez ${house.name} pour ${UTIL.formatMoney(house.price)}.`, 'assertive'); Audio.cash();
        announce(`Vous êtes chez vous, ${house.name}. Capacité de stockage : ${house.capacity}.`, 'polite');
        this.openStorage(house.storage, house.capacity, 'Maison');
      });
      return;
    }
    announce(`Vous êtes chez vous, ${house.name}. Capacité de stockage : ${house.capacity}.`, 'polite');
    this.openStorage(house.storage, house.capacity, 'Maison');
  },
  mine(mine) {
    const hasMachine = this.miningMachine || Roles.hasPerm('machine_extraction');
    if (mine.guards > 0 && !UTIL.chance(hasMachine ? 0.7 : 0.4)) {
      this.takeDamage(UTIL.randInt(5, 15)); alertUser('Des gardes vous repèrent ! Fuite ou combat.');
      return;
    }
    const qty = Math.min(mine.yield, hasMachine ? UTIL.randInt(15, 40) : UTIL.randInt(1, 8));
    const item = { id: 'minerai_' + mine.resource, name: `Minerai de ${mine.resource}`, category: 'minerai', price: UTIL.randInt(3000, 25000), size: 1.5, q: qty };
    if (this.addItem(item)) {
      mine.yield -= qty; Audio.footstep('dirt');
      const outil = hasMachine ? 'La machine d\'extraction' : 'Vous';
      announce(`${outil} extrai${hasMachine ? 't' : 'e'}z ${qty} unités de ${mine.resource}. Gisement restant : ${Math.max(0, Math.round(mine.yield))}.`, 'assertive');
    }
  },
  buyMiningMachine() {
    const price = 750000;
    if (this.miningMachine) return announce('Vous possédez déjà une machine d\'extraction industrielle.', 'polite');
    const mine = City.miningSites.find(m => UTIL.dist(m, this) < 6);
    if (!mine) return announce('Rendez-vous sur un site minier pour acheter une machine d\'extraction.', 'assertive');
    if (this.money < price) return announce(`Machine d'extraction industrielle : ${UTIL.formatMoney(price)}.`, 'assertive');
    this.money -= price; this.miningMachine = true; Audio.cash();
    announce('Machine d\'extraction achetée. Le rendement d\'extraction du minerai (or, diamant, fer...) est désormais bien supérieur, et le risque d\'être repéré par les gardes est réduit.', 'assertive');
    updateHud();
  },
  repairVehicle() {
    if (!this.vehicle) return announce('Pas de véhicule à réparer.', 'assertive');
    const cost = Math.floor((100 - this.vehicle.hp) * 500);
    if (this.money >= cost) { this.money -= cost; this.vehicle.hp = 100; this.vehicle.fuel = 1; announce(`Réparé pour ${UTIL.formatMoney(cost)}.`, 'assertive'); Audio.cash(); }
    else announce(`Réparation : ${UTIL.formatMoney(cost)}. Fonds insuffisants.`, 'assertive');
  },
  // Atelier de réparation : lieu de travail des garagistes, et service de
  // réparation fiable pour tout le monde même sans mécanicien réel connecté
  // (contrairement au dépannage à domicile, qui dépend d'un vrai joueur).
  enterWorkshop(poi) {
    if (Roles.current === 'mecanicien') return this.openMechanicMenu();
    if (!this.inVehicle || !this.vehicle) return announce(`${poi.name}. Montez dans un véhicule pour le faire réparer ici.`, 'assertive');
    const v = this.vehicle;
    if (v.hp >= 100) return announce(`${poi.name}. ${v.name} est déjà en parfait état.`, 'polite');
    const cost = Math.floor((100 - v.hp) * 300);
    if (this.money < cost) return announce(`${poi.name} : réparation complète pour ${UTIL.formatMoney(cost)}. Fonds insuffisants.`, 'assertive');
    this.money -= cost; v.hp = 100;
    Audio.cash();
    announce(`${poi.name} : ${v.name} réparé, état 100%, pour ${UTIL.formatMoney(cost)}.`, 'assertive');
    updateHud();
  },
  useBankCounter() {
    this.openBankMenu();
  },
  // Menu bancaire accessible (comptoir ou téléphone) : cartes + saisie du
  // montant via AccessibleTextPrompt, plutôt que des champs à l'intérieur de
  // l'écran du téléphone (moins fiable au doigt/lecteur d'écran).
  openBankMenu() {
    el('menuTitle').textContent = 'Banque';
    const items = [
      { id: 'solde', title: `💰 Solde bancaire : ${UTIL.formatMoney(this.bank)}`, desc: `Liquide en poche : ${UTIL.formatMoney(this.money)}${this.dirtyMoney ? `, argent sale : ${UTIL.formatMoney(this.dirtyMoney)}` : ''}.` },
      { id: 'deposit', title: '⬇️ Déposer', desc: 'Déposer du liquide sur le compte bancaire.' },
      { id: 'withdraw', title: '⬆️ Retirer', desc: 'Retirer de l\'argent du compte vers le liquide.' },
    ];
    if (this.dirtyMoney > 0) items.push({ id: 'launder', title: '🧺 Blanchir de l\'argent sale', desc: `${UTIL.formatMoney(this.dirtyMoney)} d'argent sale à nettoyer (avec des frais).` });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'deposit') {
        AccessibleTextPrompt.open('Déposer', `Montant à déposer (liquide disponible : ${UTIL.formatMoney(this.money)}).`, '', (v) => { if (v) this.bankDeposit(v); });
      } else if (sel.id === 'withdraw') {
        AccessibleTextPrompt.open('Retirer', `Montant à retirer (solde : ${UTIL.formatMoney(this.bank)}).`, '', (v) => { if (v) this.bankWithdraw(v); });
      } else if (sel.id === 'launder') {
        AccessibleTextPrompt.open('Blanchir', `Montant à blanchir (argent sale : ${UTIL.formatMoney(this.dirtyMoney)}).`, '', (v) => { if (v) this.launderMoney(v); });
      }
    });
  },
  // Parking public (lieu « garage » sur la carte) : vos véhicules restent
  // toujours exactement où vous les laissez. Seuls les 3 parkings PRINCIPAUX
  // (voir Game.mainGarages) offrent un service de livraison par chauffeur
  // PNJ via le téléphone (touche O) — un simple parking public n'est qu'un
  // stationnement sûr, sans ce service.
  openPublicParking(poi) {
    const principal = !!poi.principal;
    if (this.inVehicle && this.vehicle) {
      announce(`${poi.name} : ${this.vehicle.name} peut rester garé ici en toute sécurité — descendez pour l'y laisser.${principal ? ' Comme c\'est un parking principal, vous pourrez ensuite le faire livrer n\'importe où via Parking sur votre téléphone (touche O).' : ' Ce n\'est pas un parking principal : pas de livraison possible depuis ici, il faudra venir le rechercher sur place.'}`, 'assertive');
    } else if (this.ownedVehicles.length) {
      announce(`${poi.name}. Vos véhicules restent où vous les laissez.${principal ? ' Utilisez Parking sur votre téléphone (touche O) pour en faire livrer un depuis ici.' : ' Ce n\'est pas un parking principal : aucun service de livraison depuis ici.'}`, 'polite');
    } else {
      announce(`${poi.name}. Vous n'avez pas encore de véhicule à y garer.`, 'polite');
    }
  },
  // Terrain agricole : culture de drogue sur plusieurs jours RÉELS, y compris
  // hors ligne (basé sur une vraie date de plantation, pas sur un minuteur de
  // jeu) — pas à la maison, il faut se déplacer jusqu'à un terrain rural.
  MAX_FARM_PLOTS: 3,
  FARM_GROW_MS: 3 * 24 * 60 * 60 * 1000, // 3 jours réels avant récolte
  tendFarm(poi) {
    this.plantations = this.plantations || [];
    const now = Date.now();
    const ready = this.plantations.filter(p => now - p.plantedAt >= p.durationMs);
    if (ready.length) {
      let totalQty = 0; const names = new Set();
      ready.forEach(p => {
        const drug = DRUG_CATALOG.find(d => d.id === p.drugId);
        const qty = UTIL.randInt(4, 10);
        this.addItem({ ...drug, q: qty });
        totalQty += qty; names.add(drug?.name || 'plants');
      });
      this.plantations = this.plantations.filter(p => !ready.includes(p));
      announce(`Récolte à ${poi.name} : ${totalQty} ${Array.from(names).join(', ')} ! C'est illégal, évitez de vous faire remarquer.`, 'assertive');
      updateHud();
      if (UTIL.chance(0.15)) this.reportCrimeToPolice('culture_drogue', poi.name);
      return;
    }
    const seed = this.inventory.find(i => i.id === 'graines_herbe');
    const hasCapacity = this.plantations.length < this.MAX_FARM_PLOTS;
    if (hasCapacity && seed) {
      this.removeItem('graines_herbe', 1);
      this.plantations.push({ id: 'plot_' + now, drugId: 'herbe', plantedAt: now, durationMs: this.FARM_GROW_MS });
      announce(`Vous préparez une parcelle à ${poi.name} et semez des graines de chanvre. Revenez dans environ 3 jours pour la récolte — la pousse continue même hors ligne.`, 'assertive');
      updateHud();
      return;
    }
    if (this.plantations.length) {
      const next = this.plantations.slice().sort((a, b) => (a.plantedAt + a.durationMs) - (b.plantedAt + b.durationMs))[0];
      const remainMs = next.durationMs - (now - next.plantedAt);
      const days = Math.max(1, Math.ceil(remainMs / 86400000));
      const full = !hasCapacity ? ` Vous avez déjà ${this.MAX_FARM_PLOTS} parcelles (maximum).` : '';
      announce(`${this.plantations.length} parcelle(s) en cours de pousse.${full} La prochaine récolte sera prête dans environ ${days} jour(s).`, 'polite');
      return;
    }
    announce('Vous n\'avez pas de graines à planter. Achetez-en au marché noir.', 'assertive');
  },
  aircraftMenu(poi) {
    const types = poi.type === 'heliport' ? ['helico'] : ['avion'];
    const list = City.vehicles.filter(v => types.includes(v.type) && !v.owner);
    if (!list.length) return announce('Aucun appareil disponible.', 'assertive');
    const v = list[0]; v.x = poi.x; v.y = poi.y + 2; v.locked = false;
    v.fuel = 1; // Prêt à voler : sinon un appareil ambiant à court d'essence donnait l'impression que les commandes ne répondaient pas.
    announce(`${v.name} prêt sur le tarmac, plein d'essence fait.`, 'assertive');
  },
  openWarehouse(poi) {
    if (!this.ownedWarehouses.includes(poi.id)) {
      const price = 500000;
      if (this.money >= price) { this.money -= price; this.ownedWarehouses.push(poi.id); poi.owner = 'player'; this.registerOwnedProperty('entrepôt', poi); Audio.cash(); announce(`Entrepôt acheté pour ${UTIL.formatMoney(price)}.`, 'assertive'); }
      else return announce(`Prix entrepôt : ${UTIL.formatMoney(price)}.`, 'assertive');
    }
    poi.storage = poi.storage || [];
    this.openStorage(poi.storage, CONFIG.WAREHOUSE_CAPACITY, 'Entrepôt');
  },
  openStorage(store, cap, label) {
    const used = store.reduce((a, i) => a + (i.size || 1) * (i.q || 1), 0);
    announce(`${label} : ${used.toFixed(1)} sur ${cap}. ${store.length ? store.map(i => (i.q || 1) + ' ' + i.name).join(', ') : 'vide'}.`, 'polite');
    // In a full UI, we'd show a menu; here we voice-list items.
  },

  // Shops
  openShop(poi) {
    const stock = poi.stock || [];
    if (!stock.length) return announce('Le magasin est vide.', 'polite');
    this.shopContext = { poi, stock };
    openShopCategoryMenu(poi);
  },
  buyItem(indexOrName) {
    const ctx = this.shopContext; if (!ctx) return announce('Ouvrez d\'abord un magasin.', 'assertive');
    let it = null;
    if (typeof indexOrName === 'number') it = ctx.stock[indexOrName - 1];
    else it = ctx.stock.find(s => s.name.toLowerCase().includes(indexOrName.toLowerCase()));
    if (!it) return announce('Article non trouvé.', 'assertive');
    if (this.money < it.price) return announce('Pas assez d\'argent.', 'assertive');
    if (it.q <= 0) return announce('Rupture de stock.', 'assertive');
    // Vérifier la place AVANT de débiter : sinon l'argent partait et le stock
    // diminuait même quand les poches pleines empêchaient l'ajout, faisant
    // perdre l'argent sans jamais recevoir l'objet.
    if (!this.canAdd(it)) return announce('Vos poches sont pleines : impossible de recevoir cet achat.', 'assertive');
    this.money -= it.price; it.q--;
    const bought = { ...it, q: 1 };
    this.addItem(bought);
    Audio.cash();
    announce(`Vous achetez ${it.name} pour ${UTIL.formatMoney(it.price)}.`, 'assertive');
    updateHud();
  },
  buyItemQty(index, qty) {
    const ctx = this.shopContext; if (!ctx) return announce('Ouvrez d\'abord un magasin.', 'assertive');
    const it = ctx.stock[index - 1];
    if (!it) return announce('Article non trouvé.', 'assertive');
    // Casque/gilet : pas un objet d'inventaire classique, un état porté (booléen).
    if (it.special === 'helmet') return this.buyHelmet();
    if (it.special === 'vest') return this.buyVest();
    qty = Math.min(Math.max(1, Math.floor(qty) || 1), it.q);
    // Un commerce dans un quartier où ça braque souvent se couvre en
    // augmentant ses prix (jusqu'à +25% si le quartier est très "chaud").
    const districtName = ctx.poi ? City.getDistrictAt(ctx.poi.x, ctx.poi.y).name : null;
    const heatSurcharge = districtName ? Math.min(0.25, City.getDistrictEconomy(districtName).heat / 200) : 0;
    // Un gang qui tient le marché de cette catégorie (armes, drogue,
    // protection — voir City.MARKET_TYPES, attribué par le staff) prélève sa
    // propre majoration, où que l'article soit acheté.
    const gangSurcharge = City.getGangMarketSurcharge(it.category);
    const gangHolder = gangSurcharge ? Object.entries(City.MARKET_TYPES).find(([, def]) => def.categories.includes(it.category))?.[0] : null;
    const surcharge = heatSurcharge + gangSurcharge;
    const unitPrice = Math.round(it.price * (1 + surcharge));
    const total = unitPrice * qty;
    if (this.money < total) return announce(`Pas assez d'argent pour ${qty} ${it.name} (${UTIL.formatMoney(total)}).`, 'assertive');
    // Même vérification que buyItem() : la place doit être garantie AVANT de
    // débiter, sinon l'argent partait sans que l'objet ne soit jamais reçu.
    if (!this.canAdd({ ...it, q: qty })) return announce('Vos poches sont pleines : impossible de recevoir cet achat.', 'assertive');
    this.money -= total; it.q -= qty;
    this.addItem({ ...it, q: qty });
    Audio.cash();
    const gangNote = gangHolder ? ` (majoration : ce marché est tenu par ${City.getMarketHolder(gangHolder).leaderName || 'quelqu\'un'}, président des ${City.getMarketHolder(gangHolder).name})` : '';
    announce(`Vous achetez ${qty > 1 ? qty + ' ' : ''}${it.name} pour ${UTIL.formatMoney(total)}${heatSurcharge > 0.02 ? ' (majoration locale liée à l\'insécurité)' : ''}${gangNote}.`, 'assertive');
    updateHud();
  },
  sellItem() {
    if (!this.inventory.length) return announce('Rien à vendre.', 'assertive');
    const it = this.inventory[0];
    const price = Math.floor((it.price || 1000) * 0.6);
    this.money += price; this.removeItem(it.id, 1);
    Audio.cash(); announce(`Vous vendez ${it.name} pour ${UTIL.formatMoney(price)}.`, 'polite'); updateHud();
  },

  // Demande de revente aux passants selon le quartier : plus un quartier est
  // commerçant et animé, plus les passants achètent cher et ont du budget.
  // Gounghin (forte) > Cissin (moyenne) > Koulouba (faible) > Aéroport (très
  // faible). Renvoie un multiplicateur de prix et une fourchette de budget.
  npcDemandFactor(districtName) {
    // Marge de REVENTE : les passants paient PLUS que le prix magasin (mult > 1) —
    // c'est de la revente informelle, on la fait pour le bénéfice, jamais à perte.
    // Plus le quartier est commerçant/animé, plus la marge et le budget sont élevés.
    const name = districtName || '';
    let base;
    if (/Gounghin/i.test(name)) base = { mult: 1.6, budgetMin: 25000, budgetMax: 70000, label: 'forte' };
    else if (/Cissin/i.test(name)) base = { mult: 1.4, budgetMin: 15000, budgetMax: 42000, label: 'moyenne' };
    else if (/Koulouba/i.test(name)) base = { mult: 1.25, budgetMin: 10000, budgetMax: 26000, label: 'faible' };
    else if (/A[ée]roport/i.test(name)) base = { mult: 1.15, budgetMin: 8000, budgetMax: 18000, label: 'très faible' };
    else base = { mult: 1.35, budgetMin: 10000, budgetMax: 34000, label: 'ordinaire' };
    // Ajustement dynamique : marché saturé (trop de ventes récentes ici) ou
    // méfiant (délits récents dans ce quartier) fait baisser prix et budget —
    // ça bouge vraiment selon ce que le joueur y a fait récemment.
    const econ = City.getDistrictEconomy(name);
    const penalty = (econ.heat + econ.saturation) / 100;
    if (penalty > 0.02) {
      const factor = Math.max(0.5, 1 - penalty);
      return {
        mult: +(base.mult * factor).toFixed(2),
        budgetMin: Math.round(base.budgetMin * factor),
        budgetMax: Math.round(base.budgetMax * factor),
        label: penalty > 0.25 ? `${base.label}, marché méfiant/saturé` : base.label,
      };
    }
    return base;
  },
  // Vendre un objet de l'inventaire à un passant. On cherche un civil proche,
  // non hostile ; s'il a le budget (selon le quartier), il se dirige vers le
  // vendeur et la vente se conclut à son arrivée (voir npcTick).
  // Passant susceptible d'acheter : civil non hostile, vivant, disponible, proche.
  _findBuyerNear(radius = 14) {
    return (City.npcs || [])
      .filter(n => !n.dead && !n.hostile && !n.menotte && !n.knockedOut && !n.wantsToBuyItem
        && (n.job === 'civil' || n.job === 'commercant' || n.job === 'vendeur' || n.job === 'etudiant' || n.job === 'employe' || n.job === 'retraite')
        && UTIL.dist(n, this) < radius)
      .sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
  },
  sellToNPC(itemId, qty = 1) {
    const it = this.inventory.find(i => i.id === itemId) || this.inventory[0];
    if (!it) return announce('Rien à vendre.', 'assertive');
    qty = Math.min(Math.max(1, Math.floor(qty) || 1), it.q || 1);
    // Acheteur : un passant civil, non hostile, vivant, non déjà occupé, proche.
    const buyer = this._findBuyerNear(14);
    if (!buyer) return announce('Aucun passant intéressé à proximité. Rapprochez-vous d\'une zone animée.', 'assertive');
    const demand = this.npcDemandFactor(City.getDistrictAt(this.x, this.y).name);
    const price = Math.max(1, Math.floor((it.price || 1000) * demand.mult * qty));
    // Budget du passant dans ce quartier.
    const budget = UTIL.randInt(demand.budgetMin, demand.budgetMax);
    if (budget < price) {
      return announce(`${buyer.name} n'a pas les moyens : ${UTIL.formatMoney(budget)} en poche, vous demandez ${UTIL.formatMoney(price)}. La demande est ${demand.label} ici.`, 'assertive');
    }
    buyer.money = budget;
    buyer.wantsToBuyItem = { itemId: it.id, qty, price, name: it.name, expires: Date.now() + 30000 };
    // Repère sonore de l'acheteur qui approche.
    if (window.Audio && Audio.tone) Audio.tone({ freq: 620, type: 'sine', duration: 0.12, gain: 0.1, pan: this.panForPoint(buyer.x, buyer.y) });
    announce(`${buyer.name} est intéressé par ${it.name} pour ${UTIL.formatMoney(price)} et se dirige vers vous. Demande ${demand.label} dans ce quartier. Restez sur place.`, 'assertive');
  },
  // Conclut la vente quand l'acheteur arrive à portée du vendeur.
  completeNPCSale(n) {
    const deal = n.wantsToBuyItem;
    if (!deal) return;
    n.wantsToBuyItem = null;
    const it = this.inventory.find(i => i.id === deal.itemId);
    if (!it || (it.q || 1) < deal.qty) {
      return announce(`${n.name} est venu acheter ${deal.name}, mais vous ne l'avez plus.`, 'polite');
    }
    const profit = deal.price - Math.floor((it.price || 1000) * deal.qty);
    this.money += deal.price;
    n.money = Math.max(0, (n.money || 0) - deal.price);
    this.removeItem(deal.itemId, deal.qty);
    City.recordSaleInDistrict(City.getDistrictAt(this.x, this.y).name);
    Audio.cash();
    announce(`Vente conclue : ${deal.qty} ${deal.name} à ${n.name} pour ${UTIL.formatMoney(deal.price)}${profit > 0 ? `, bénéfice de ${UTIL.formatMoney(profit)}` : ''}.`, 'assertive');
    if (this.vendorMode && this.vendorMode.itemId === deal.itemId) { this.vendorMode.sales++; this.vendorMode.revenue += deal.price; }
    updateHud();
  },
  /* ==========================================================
     MODE VENDEUR ACTIVABLE — on « installe son étal » : une fois activé,
     les passants du quartier viennent acheter l'article proposé au fil du
     temps, tout seuls (selon la demande locale), sans avoir à relancer la
     vente à chaque passant. Réutilise la demande par quartier et la
     conclusion de vente existantes. Se coupe en le réactivant, ou tout
     seul quand le stock est épuisé.
     ========================================================== */
  vendorMode: null,
  toggleVendorMode(itemId) {
    if (this.vendorMode) {
      const vm = this.vendorMode; this.vendorMode = null;
      announce(`Vente automatique arrêtée.${vm.sales ? ` Bilan : ${vm.sales} vente${vm.sales > 1 ? 's' : ''} pour ${UTIL.formatMoney(vm.revenue)}.` : ''}`, 'assertive');
      return;
    }
    const it = itemId ? this.inventory.find(i => i.id === itemId) : this.inventory[0];
    if (!it) return announce('Vous n\'avez rien à vendre.', 'assertive');
    this.vendorMode = { itemId: it.id, lastAttempt: 0, sales: 0, revenue: 0 };
    const demand = this.npcDemandFactor(City.getDistrictAt(this.x, this.y).name);
    announce(`Vente automatique activée : vous proposez ${it.name}. Demande ${demand.label} dans ce quartier. Restez sur place, les passants viendront. Réactivez pour arrêter.`, 'assertive');
  },
  // Attire un acheteur pour un article donné, sans bavardage en cas d'échec
  // (utilisé par le mode vendeur automatique).
  _attractBuyer(it, qty = 1) {
    const buyer = this._findBuyerNear(16);
    if (!buyer) return false;
    const demand = this.npcDemandFactor(City.getDistrictAt(this.x, this.y).name);
    const price = Math.max(1, Math.floor((it.price || 1000) * demand.mult * qty));
    const budget = UTIL.randInt(demand.budgetMin, demand.budgetMax);
    if (budget < price) return false;
    buyer.money = budget;
    buyer.wantsToBuyItem = { itemId: it.id, qty, price, name: it.name, expires: Date.now() + 30000 };
    if (window.Audio && Audio.tone) Audio.tone({ freq: 620, type: 'sine', duration: 0.12, gain: 0.1, pan: this.panForPoint(buyer.x, buyer.y) });
    announce(`${buyer.name} s'intéresse à ${it.name} pour ${UTIL.formatMoney(price)} et vient vous voir.`, 'polite');
    return true;
  },
  // Boucle du mode vendeur : périodiquement, une chance d'attirer un passant.
  vendorTick() {
    const vm = this.vendorMode; if (!vm) return;
    if (this.unconscious || this.inVehicle) return; // pas d'étal en voiture ni inconscient
    const now = Date.now();
    if (now - vm.lastAttempt < 4000) return; // cadence des tentatives
    vm.lastAttempt = now;
    const it = this.inventory.find(i => i.id === vm.itemId);
    if (!it) { this.vendorMode = null; announce(`Vente automatique terminée : plus de stock.${vm.sales ? ` Bilan : ${vm.sales} vente${vm.sales > 1 ? 's' : ''} pour ${UTIL.formatMoney(vm.revenue)}.` : ''}`, 'assertive'); return; }
    const demand = this.npcDemandFactor(City.getDistrictAt(this.x, this.y).name);
    if (!UTIL.chance(Math.min(0.6, 0.3 * demand.mult))) return; // parfois personne ne mord
    this._attractBuyer(it, 1);
  },
  openVehicleShop(poi) {
    const available = Object.entries(VEHICLE_CATALOG).map(([k, v]) => ({ id: k, ...v }));
    this.vehicleShopContext = available;
    openVehicleCategoryMenu(poi, available);
  },
  // Verrouiller/déverrouiller son propre véhicule : possible dedans, ou juste à
  // côté d'un véhicule qu'on possède. Diffusé aux autres joueurs (vehicle_lock).
  toggleVehicleLock() {
    if (this.inVehicle) return this.applyVehicleLockToggle(this.vehicle);
    const nearby = City.vehicles.filter(veh => (this.ownedVehicles || []).includes(veh.id) && UTIL.dist(veh, this) < 3);
    if (!nearby.length) return announce('Aucun véhicule à vous à portée.', 'assertive');
    if (nearby.length === 1) return this.applyVehicleLockToggle(nearby[0]);
    // Plusieurs véhicules à vous à portée : on demande lequel plutôt que de
    // deviner (verrouillait/déverrouillait le mauvais véhicule au hasard).
    el('menuTitle').textContent = 'Quel véhicule ?';
    const items = nearby.map(v => {
      const dist = Math.round(UTIL.dist(v, this) * CONFIG.METERS_PER_TILE);
      const bearing = UTIL.bearing(v.x - this.x, v.y - this.y);
      return { id: v.id, title: `${v.name} — ${v.locked ? 'verrouillé' : 'déverrouillé'}`, desc: `${dist} m, vers le ${bearing}.` };
    });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      const v = nearby.find(vv => vv.id === sel.id);
      if (v) this.applyVehicleLockToggle(v);
    });
  },
  applyVehicleLockToggle(v) {
    if (!v) return announce('Aucun véhicule à vous à portée.', 'assertive');
    if (!(this.ownedVehicles || []).includes(v.id)) return announce('Ce véhicule ne vous appartient pas.', 'assertive');
    v.locked = !v.locked;
    sendWorldEdit('vehicle_lock', { id: v.id, locked: v.locked });
    AudioLib.playOnce('veh1_verrouillage', { volume: 0.5 });
    announce(v.locked ? `${v.name} verrouillé.` : `${v.name} déverrouillé.`, 'assertive');
  },
  // Retrouver un véhicule : s'il n'y en a qu'un, guidage direct ; s'il y en a
  // plusieurs (garés à des endroits différents), un vrai choix s'affiche,
  // avec la distance et la direction de chacun. Inclut aussi le dernier
  // véhicule emprunté (non possédé), s'il est différent.
  // Fait sonner le klaxon d'UN de ses véhicules à distance (sans y monter),
  // pour le repérer à l'oreille — utile en plus du guidage GPS (Maj+F),
  // surtout quand deux véhicules identiques sont garés côte à côte : le son
  // spatialisé permet de savoir lequel est le sien sans se fier au nom.
  // Contrairement à findMyCar(), rejouable à volonté, sans lancer de guidage.
  honkMyVehicle() {
    if (this.inVehicle) return announce('Vous êtes déjà dans un véhicule.', 'polite');
    const owned = (this.ownedVehicles || []).map(id => City.vehicles.find(v => v.id === id)).filter(Boolean);
    if (!owned.length) return announce('Vous ne possédez aucun véhicule.', 'assertive');
    const honkVehicle = (v) => {
      // Signal dédié de repérage (pas un klaxon) — le même que celui utilisé
      // par findMyCar() : distinct du bruit de klaxon des autres véhicules
      // (NPC, collisions), pour qu'on le reconnaisse sans ambiguïté comme
      // « c'est le mien qui répond », qu'on soit à pied ou dans un autre véhicule.
      const dist = UTIL.dist(v, this);
      const m = Math.round(dist * CONFIG.METERS_PER_TILE);
      announce(`${v.name} émet son signal de repérage à ${m} mètres, vers le ${UTIL.bearing(v.x - this.x, v.y - this.y)}.`, 'polite');
      // Signal RÉPÉTÉ pendant quelques secondes, avec panoramique et volume
      // mis à jour EN DIRECT selon votre position — avant, c'était un son
      // ponctuel figé au moment du lancement : en vous approchant, vous
      // éloignant, ou en tournant, le son restait exactement identique,
      // inutile pour se guider à l'oreille comme dans la vraie vie.
      const instanceId = 'findcar_' + v.id;
      let ticks = 0;
      const tick = () => {
        const live = City.vehicles.find(vv => vv.id === v.id);
        if (!live || this.inVehicle || ticks++ > 14) { AudioLib.stopLoopInstance(instanceId); return; }
        const d = UTIL.dist(live, this);
        AudioLib.playLoopInstance(instanceId, 'veh_alarme_position', UTIL.clamp(0.9 - d / 40, 0.1, 0.9), this.panForPoint(live.x, live.y));
        setTimeout(tick, 500);
      };
      tick();
    };
    if (owned.length === 1) return honkVehicle(owned[0]);
    el('menuTitle').textContent = 'Faire sonner quel véhicule ?';
    const items = owned.map(v => {
      const dist = Math.round(UTIL.dist(v, this) * CONFIG.METERS_PER_TILE);
      return { id: v.id, title: v.name, desc: `${dist} m.` };
    });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      const v = owned.find(vv => vv.id === sel.id);
      if (v) honkVehicle(v);
    });
  },
  findMyCar() {
    if (this.inVehicle) return announce('Vous êtes déjà dans un véhicule.', 'polite');
    const owned = (this.ownedVehicles || []).map(id => City.vehicles.find(v => v.id === id)).filter(Boolean);
    const borrowed = (this.lastParkedVehicle && !owned.some(v => v.id === this.lastParkedVehicle.id))
      ? City.vehicles.find(v => v.id === this.lastParkedVehicle.id) : null;
    const all = borrowed ? [...owned, borrowed] : owned;
    if (!all.length) return announce('Vous ne possédez aucun véhicule, et aucun n\'a été utilisé récemment.', 'assertive');
    if (all.length === 1) {
      const v = all[0];
      if ((this.ownedVehicles || []).includes(v.id)) AudioLib.playPositional('veh_alarme_position', UTIL.clamp((v.x - this.x) / 20, -1, 1), 0.5);
      return this.setGuidance({ name: v.name, x: v.x, y: v.y });
    }
    el('menuTitle').textContent = 'Retrouver un véhicule';
    const items = all.map(v => {
      const dist = Math.round(UTIL.dist(v, this) * CONFIG.METERS_PER_TILE);
      const bearing = UTIL.bearing(v.x - this.x, v.y - this.y);
      return { id: v.id, title: `${v.name}${v === borrowed ? ' (emprunté)' : ''}`, desc: `${dist} m, vers le ${bearing}.` };
    });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      const v = all.find(vv => vv.id === sel.id);
      if (v) {
        if ((this.ownedVehicles || []).includes(v.id)) AudioLib.playPositional('veh_alarme_position', UTIL.clamp((v.x - this.x) / 20, -1, 1), 0.5);
        this.setGuidance({ name: v.name, x: v.x, y: v.y });
      }
    });
  },
  // Système d'eau : plonger fait basculer entre nager en surface (pas dans
  // l'eau) et nager sous l'eau (immersion). Boire ne fonctionne que dans
  // l'eau, et réduit vraiment la soif.
  diveInWater() {
    if (this.inVehicle) return announce('Descendez d\'abord du véhicule.', 'assertive');
    if (!this.inWater) return announce('Il n\'y a pas d\'eau ici pour plonger.', 'assertive');
    this.underwater = !this.underwater;
    if (this.underwater) {
      AudioLib.playOnce('eau_plongeon', { volume: 0.7 });
      AudioLib.stopLoop('eau_mer_amb');
      AudioLib.playLoop('eau_nage_sous', 0.5);
      announce('Vous plongez sous l\'eau.', 'assertive');
    } else {
      AudioLib.stopLoop('eau_nage_sous');
      AudioLib.playLoop('eau_mer_amb', 0.3);
      announce('Vous remontez à la surface.', 'assertive');
    }
  },
  toggleWindow() {
    if (!this.inVehicle || !this.vehicle) return announce('Vous n\'êtes pas dans un véhicule.', 'assertive');
    this.vehicle.windowDown = !this.vehicle.windowDown;
    AudioLib.playOnce('veh_vitre_monte_descend', { volume: 0.6 });
    announce(this.vehicle.windowDown ? 'Vitre baissée.' : 'Vitre remontée.', 'polite');
  },
  // Tir au canon du char : très puissant, mais rechargement lent, et repéré
  // par la police à chaque tir (comme une explosion).
  fireTankCannon() {
    if (!this.inVehicle || !this.vehicle || this.vehicle.type !== 'char') return announce('Réservé au char d\'assaut.', 'assertive');
    const now = Date.now();
    if (now - (this._lastCannonShot || 0) < 8000) return announce('Le canon recharge encore.', 'polite');
    this._lastCannonShot = now;
    AudioLib.playOnce('son_char_tir', { volume: 0.8 });
    const target = this.getLiveTarget();
    if (target && UTIL.dist(target, this.vehicle) < 40) {
      if (target.isPlayer) {
        if (Net.connected) Net.send({ type: 'player_hit', targetId: target.id, damage: 120, headshot: false });
      } else {
        const npc = City.npcs.find(n => n.id === target.id);
        if (npc) { npc.health -= 120; this.playNpcHitCry(npc); if (npc.health <= 0) this.killNPC(npc); }
      }
      announce(`Tir de canon sur ${this.lockedTarget?.name || target.name} ! Dégâts massifs.`, 'assertive');
    } else {
      announce('Tir de canon dans le vide.', 'polite');
    }
    Game.reportCrimeToPolice('explosion', 'Tir de canon entendu');
  },
  buyVehicle(index) {
    const v = this.vehicleShopContext?.[index - 1]; if (!v) return;
    if (v.restricted) {
      if (Roles.current !== 'police') return announce(`${v.name} est réservé aux policiers en service. Demandez le rôle "police" pour y avoir accès.`, 'assertive');
      if (v.id === 'char') return this.requisitionTank();
      return announce('Ce véhicule réservé n\'a pas encore de parcours d\'achat dédié.', 'assertive');
    }
    if (this.money < v.price) return announce('Fonds insuffisants.', 'assertive');
    this.money -= v.price; Audio.cash();
    const nv = { id: 'owned_' + Date.now(), type: v.id, name: v.name, x: this.x + 1, y: this.y + 1, fuel: 1, hp: 100, locked: false, owner: 'player', ownerName: `${this.player.firstName} ${this.player.lastName}`, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: v.price, trunk: v.trunk };
    City.vehicles.push(nv); this.ownedVehicles.push(nv.id);
    sendWorldEdit('vehicle_create', nv);
    announce(`Vous achetez un ${v.name}.`, 'assertive'); updateHud();
  },
  // Réservé au mode staff : fait apparaître gratuitement un véhicule à côté de soi, pour tester.
  spawnStaffVehicle(typeId) {
    const cls = VEHICLE_CATALOG[typeId];
    if (!cls) return announce(`Type de véhicule inconnu. Types possibles : ${Object.keys(VEHICLE_CATALOG).join(', ')}.`, 'assertive');
    const nv = { id: 'staff_' + Date.now(), type: typeId, name: cls.name, x: this.x + 1, y: this.y + 1, fuel: 1, hp: 100, locked: false, owner: 'player', inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: cls.trunk };
    City.vehicles.push(nv); this.ownedVehicles.push(nv.id);
    sendWorldEdit('vehicle_create', nv);
    announce(`${cls.name} apparu juste à côté de vous.`, 'assertive'); updateHud();
  },

  // Missions
  openMissions() {
    const active = City.missions.filter(m => (m.active || !m.completed) && !m.extreme).slice(0, 12);
    if (typeof Phone !== 'undefined' && Phone.open) Phone.closePhone();
    el('menuOverlay').style.display = 'flex';
    el('menuTitle').textContent = 'Missions';
    if (!active.length && !this.activeMission) { renderMenu([{ id: 'empty', title: 'Aucune mission disponible', desc: '' }], () => {}); return; }
    const items = active.map((m, i) => ({ id: String(i), title: `${m.title} — ${UTIL.formatMoney(m.reward)}`, desc: `${m.desc} Danger : ${m.danger}/100.` }));
    this.missionContext = active;
    if (this.activeMission) items.unshift({ id: 'cancel', title: `❌ Annuler la mission en cours : ${this.activeMission.title}`, desc: 'Arrête la mission active. Aucune pénalité.' });
    renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'cancel') this.abandonMission(); else this.activateMission(parseInt(sel.id, 10) + 1); });
  },
  openExtremeMissions() {
    const active = City.missions.filter(m => (m.active || !m.completed) && m.extreme).slice(0, 12);
    if (typeof Phone !== 'undefined' && Phone.open) Phone.closePhone();
    el('menuOverlay').style.display = 'flex';
    el('menuTitle').textContent = 'Missions extrêmes';
    if (!active.length && !this.activeMission) { renderMenu([{ id: 'empty', title: 'Aucune mission extrême disponible pour l\'instant', desc: '' }], () => {}); return; }
    const items = active.map((m, i) => ({ id: String(i), title: `💀 ${m.title} — ${UTIL.formatMoney(m.reward)}`, desc: `${m.desc} Danger : ${m.danger}/100.` }));
    this.missionContext = active;
    if (this.activeMission) items.unshift({ id: 'cancel', title: `❌ Annuler la mission en cours : ${this.activeMission.title}`, desc: 'Arrête la mission active. Aucune pénalité.' });
    renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'cancel') this.abandonMission(); else this.activateMission(parseInt(sel.id, 10) + 1); });
  },
  activateMission(index) {
    const m = this.missionContext?.[index - 1]; if (!m) return;
    this.activeMission = m; m.active = true;
    // Missions à IDs façon GTA : au lancement (sauf missions débutant), il
    // faut saisir les identifiants de toute l'équipe qui va la jouer. Seuls
    // ces identifiants pourront l'accomplir. Ça change à chaque reconnexion.
    // Boîte de saisie accessible (narrée par le jeu) : pas de prompt() natif,
    // qui ne peut pas être lu sans lecteur d'écran externe.
    if (MULTIPLAYER_REQUIRED_MISSION_TYPES.includes(m.type) && !m.authorizedIds) {
      const myId = Net.connected ? Net.id.replace(/^p/, '') : 'solo';
      AccessibleTextPrompt.open(
        'Mission à identifiants',
        `Saisissez les IDs de toute l'équipe qui joue cette mission, séparés par des virgules. Votre ID actuel : ${myId}.`,
        myId,
        (input) => {
          const ids = (input || myId).split(',').map(s => s.trim()).filter(Boolean);
          if (!ids.includes(myId)) ids.push(myId);
          m.authorizedIds = ids;
          announce(`Mission réservée aux identifiants : ${ids.join(', ')}.`, 'polite');
          this.finishActivateMission(m);
        }
      );
      return;
    }
    // Missions extrêmes JOUABLES SEUL (pas dans MULTIPLAYER_REQUIRED_MISSION_
    // TYPES ci-dessus, qui l'exigent) : avant, rien ne permettait d'y jouer à
    // plusieurs. L'invitation par identifiant reste ENTIÈREMENT FACULTATIVE —
    // refuser ou ignorer démarre la mission normalement en solo.
    if (m.extreme && Net.connected && !m._invitePrompted) {
      m._invitePrompted = true;
      AccessibleConfirm.open(
        'Inviter des coéquipiers ?',
        `Mission extrême « ${m.title} » : voulez-vous inviter d'autres joueurs par leur identifiant pour la jouer à plusieurs ? Facultatif : la mission reste jouable seul si vous refusez.`,
        (acc) => {
          if (acc) this.inviteToMission(m);
          this.finishActivateMission(m);
        }
      );
      return;
    }
    this.finishActivateMission(m);
  },
  // Invite d'autres joueurs (par identifiant) à rejoindre une mission
  // extrême JOUABLE SEUL : chacun reçoit une notification avec le lieu de
  // rendez-vous et peut l'accepter ou la refuser (voir le gestionnaire
  // 'mission_invite' dans network.js) — un simple toggle, sans rien imposer.
  inviteToMission(m) {
    AccessibleTextPrompt.open(
      'Inviter par identifiant',
      'Saisissez les identifiants des joueurs à inviter, séparés par des virgules.',
      '',
      (input) => {
        const ids = (input || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length) return;
        ids.forEach(id => Net.send({ type: 'mission_invite', targetId: 'p' + id.replace(/^p/, ''), missionTitle: m.title, missionType: m.type, x: m.x, y: m.y }));
        announce(`Invitation envoyée à : ${ids.join(', ')}.`, 'polite');
      }
    );
  },
  finishActivateMission(m) {
    // Guidage adapté à chaque mission : celles qui ont déjà leur propre
    // repérage sonore (objet perdu, urgence médicale) le gardent tel quel ;
    // toutes les autres sont guidées automatiquement (GPS piéton) vers le
    // point de départ, la complexité/distance variant d'une mission à l'autre.
    const selfGuidedTypes = ['objet_perdu', 'urgence_medicale'];
    if (!selfGuidedTypes.includes(m.type)) {
      announce(`Mission activée : ${m.title}. ${m.desc}`, 'assertive');
      this.setGuidance({ name: m.title, x: m.x, y: m.y });
    } else {
      announce(`Mission activée : ${m.title}. ${m.desc}. Un repérage sonore vous guidera une fois à proximité.`, 'assertive');
    }
    updateHud();
  },
  // Abandonner la mission en cours à tout moment, sans pénalité (on ne touche
  // pas la récompense puisqu'elle n'est versée qu'à la réussite).
  abandonMission() {
    if (!this.activeMission) return announce('Aucune mission en cours à annuler.', 'assertive');
    const m = this.activeMission;
    // Véhicule créé spécifiquement pour cette mission (convoyage, recel...) :
    // sans ça, il restait pour toujours dans City.vehicles à l'abandon (alors
    // qu'il est bien retiré à la complétion), polluant radar/scan à vie.
    // On ne le retire pas si le joueur est dedans (il reste utilisable normalement).
    if (m.vehicleId && !(this.inVehicle && this.vehicle?.id === m.vehicleId)) {
      City.vehicles = City.vehicles.filter(v => v.id !== m.vehicleId);
    }
    m.active = false; m.completed = false;
    this.activeMission = null;
    // Réinitialise tous les états d'étape éventuels pour repartir proprement.
    this.deliveryState = null; this.taxiState = null; this.escorteState = null;
    this.heistState = null; this.combatState = null; this.pursuitState = null;
    if (this.guidanceTarget) this.stopGuidance();
    announce(`Mission « ${m.title} » annulée. Vous pouvez en relancer une autre quand vous voulez.`, 'assertive');
    updateHud();
  },
  checkMission() {
    if (!this.activeMission) return;
    const m = this.activeMission;
    if (!this.isMissionAuthorized(m)) {
      if (Math.random() < 0.04) announce(`Cette mission a été lancée avec d'autres identifiants (${m.authorizedIds.join(', ')}) : votre ID actuel ne peut pas l'accomplir.`, 'polite');
      return;
    }
    // Le braquage de banque et le raid de gang ont leur propre déroulé (voir
    // beginBankHeist / beginGangRaid) : pas de validation automatique en
    // marchant dessus comme les autres missions.
    if (m.type === 'heist') {
      if (this.heistState) {
        // Le braquage est en cours : s'éloigner trop de la banque l'annule.
        const bank = City.pois.find(p => p.type === 'banque' && UTIL.dist(p, this) < 6);
        if (!bank) this.abortBankHeist();
      }
      return;
    }
    if (m.type === 'combat' || m.type === 'hunt') return;
    if (m.type === 'convoyage') return;
    if (m.type === 'colis_fragile') return this.tickFragileDelivery(m);
    if (m.type === 'taxi_soigne' || m.type === 'taxi') return this.tickTaxiSoigne(m);
    if (m.type === 'objet_perdu') return this.tickObjetPerdu(m);
    if (m.type === 'filature') return this.tickFilature(m);
    if (m.type === 'escorte') return this.tickEscorte(m);
    if (m.type === 'contrebande') return this.tickContrebande(m);
    if (m.type === 'urgence_medicale' || m.type === 'medical') return this.tickUrgenceMedicale(m);
    if (m.type === 'course_clandestine' || m.type === 'race') return this.tickCourseClandestine(m);
    if (m.type === 'sabotage') return this.tickSabotage(m);
    if (m.type === 'chasse_primes') return this.tickChassePrimes(m);
    if (m.type === 'defense_territoire') return this.tickDefenseTerritoire(m);
    if (m.type === 'casse_extreme') return this.tickCasseExtreme(m);
    if (m.type === 'convoi_blinde') return this.tickConvoiBlinde(m);
    if (m.type === 'depot_armes_gang') return this.tickDepotArmesGang(m);
    if (m.type === 'extraction_vip') return this.tickExtractionVip(m);
    if (m.type === 'braquage_superette') return this.tickBraquageSuperette(m);
    if (m.type === 'gofast') return this.tickGofast(m);
    if (m.type === 'planque_gardee') return this.tickPlanqueGardee(m);
    if (m.type === 'recel_vehicule') return this.tickRecelVehicule(m);
    const d = UTIL.dist({ x: this.x, y: this.y }, m);
    if (d < 5) {
      // Ces types (police, mine, trade, medical, air, hunt, taxi, fishing...)
      // n'ont pas de mini-jeu dédié : avant, arriver au point suffisait à
      // empocher la récompense instantanément, sans le moindre risque — trop
      // simple. On exige maintenant de rester sur place le temps de "mener la
      // mission à bien" (proportionnel au danger annoncé), en s'exposant à une
      // alerte police pendant ce temps pour les missions illégales ; s'éloigner
      // annule la progression.
      if (!this.genericMissionState || this.genericMissionState.missionId !== m.id) {
        const dwellMs = Math.max(6000, Math.min(30000, (m.danger || 20) * 250));
        this.genericMissionState = { missionId: m.id, startedAt: Date.now(), dwellMs, alarmed: false };
        announce(`Vous êtes sur place pour « ${m.title} ». Restez ${Math.round(dwellMs / 1000)} secondes sans partir pour mener la mission à bien.`, 'assertive');
        return;
      }
      const gs = this.genericMissionState;
      const illegalTypes = ['trade', 'hunt', 'contrebande', 'gofast', 'recel_vehicule', 'braquage_superette', 'depot_armes_gang', 'planque_gardee'];
      const illegal = illegalTypes.includes(m.type);
      if (illegal && !gs.alarmed && UTIL.chance(0.02)) {
        gs.alarmed = true;
        Game.reportCrimeToPolice(m.type, m.title);
      }
      if (Date.now() - gs.startedAt < gs.dwellMs) return;
      this.genericMissionState = null;
      if (illegal) this.dirtyMoney += m.reward; else this.money += m.reward;
      Audio.cash(); m.completed = true; m.active = false; this.activeMission = null; this.completedMissions.push(m.id);
      // Le guidage GPS pointait vers ce point : on le coupe pour ne pas continuer
      // à guider vers une mission déjà terminée.
      this.guidanceTarget = null; this.guidanceAxis = null;
      RPJournal.log('Mission', `Mission accomplie : ${m.title}, ${UTIL.formatMoney(m.reward)}.`, illegal ? 'alert' : 'info');
      announce(`Mission accomplie ! Vous gagnez ${UTIL.formatMoney(m.reward)}${illegal ? ' d\'argent sale' : ''}.`, 'assertive');
      updateHud();
    } else {
      if (this.genericMissionState && this.genericMissionState.missionId === m.id) {
        this.genericMissionState = null;
        announce('Vous vous êtes trop éloigné : reprenez depuis le point de mission.', 'polite');
      }
      // Rappel de distance limité à une fois toutes les 4 secondes : la boucle de
      // jeu appelle checkMission à chaque image, on ne veut pas dépendre du
      // hasard « la voix est occupée » pour ne pas répéter en continu.
      const now = Date.now();
      if (now - (this._lastMissionPing || 0) > 4000) {
        this._lastMissionPing = now;
        const bearing = UTIL.bearing(m.x - this.x, m.y - this.y);
        announce(`Mission : ${Math.round(d)} m, cap ${bearing}.`, 'polite');
      }
    }
  },

});
