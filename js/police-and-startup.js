function setupExtraInput() {
  // P key = phone
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return; // ne pas capter les touches pendant une saisie de texte
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey, alt = e.altKey, shift = e.shiftKey;
    // Panneau d'administration. On teste aussi e.code (KeyP) car sur un clavier
    // AZERTY, Ctrl+Alt agit comme AltGr et change e.key : "p" n'était alors
    // jamais reconnu.
    if (ctrl && alt && shift && (key === 'p' || e.code === 'KeyP')) { e.preventDefault(); openAdminMenu(); return; }
    // IMPORTANT : les raccourcis "touche seule" excluent aussi Maj, sinon
    // Maj+P / Maj+B étaient capturés ici (téléphone / inventaire) au lieu
    // d'atteindre plus bas Maj+P (appareils de poche) et Maj+B (balises).
    if (key === 'p' && !ctrl && !alt && !shift) { e.preventDefault(); Phone.openPhone(); }
    else if (key === 'q' && !ctrl && !alt && !shift) { e.preventDefault(); Game.toggleIndoor(); } // entrer / sortir d'un lieu — touche SIMPLE fiable partout (Ctrl+Alt+E est capté par l'OS sur beaucoup de portables)
    else if (key === 'k' && !ctrl && !alt && !shift) { e.preventDefault(); Computer.boot(); }
    else if (key === 'b' && !ctrl && !alt && !shift) { e.preventDefault(); Game.announceInventory(); }
    else if (key === 'l' && !ctrl && !alt) { e.preventDefault(); Game.announceLocation(); }
    else if (ctrl && key === 'l') { e.preventDefault(); Game.toggleVehicleLock(); }
    else if (ctrl && key === 'i') { e.preventDefault(); Game.announceMyId(); }
    else if (key === 'a' && !ctrl && !alt && !shift) { e.preventDefault(); Game.toggleWeapon(); } // sortir/ranger la dernière arme
    else if (shift && key === 'a') { e.preventDefault(); openWeaponsMenu(); } // menu de sélection d'arme
    else if (key === 'x' && !ctrl && !alt) { e.preventDefault(); Game.punch(); }
    else if (key === 'y' && !ctrl && !alt) { e.preventDefault(); Game.carryPlayer(); }
    else if (shift && key === 'z') { e.preventDefault(); Game.putInVehicle(); }
    else if (shift && key === 't') { e.preventDefault(); Game.declareWillAtStation(); }
    else if (ctrl && key === 'j') { e.preventDefault(); Game.openVehicleMenu(); }
    else if (ctrl && key === 'f') { e.preventDefault(); Game.searchTarget(); }
    else if (ctrl && key === 'u') { e.preventDefault(); Game.openPoliceMenu(); }
    else if (ctrl && key === 's') { e.preventDefault(); Game.toggleSiren(); }
    else if (ctrl && key === 'h') { e.preventDefault(); Game.honk(); }
    else if (ctrl && key === 'r') {
      e.preventDefault();
      if (!Game.portableRadio.owned) announce('Vous n\'avez pas de radio portable. Achetez-en une dans l\'appli Musique du téléphone.', 'assertive');
      else {
        // Radio PORTABLE : suit le joueur partout, jamais de baisse de volume
        // par distance (contrairement à une enceinte fixe posée en maison).
        MusicPlayer.setSourceRef(null);
        if (!MusicPlayer.fileName) Game.openMusicMenu('radio portable'); // rien à lire : ouvre le choix de fichier
        else announce(MusicPlayer.toggle() ? 'Lecture.' : 'Pause.', 'polite');
      }
    }
    else if (ctrl && key === 'd') { e.preventDefault(); Game.toggleDriveAssist(); } // assistant de conduite (alerte obstacles)
    else if (ctrl && key === 'k') { e.preventDefault(); openConvoyMenu(); } // gérer le convoi (créer / rejoindre / quitter)
    else if (ctrl && key === 'x') { e.preventDefault(); Game.callTaxi(); }
    else if (ctrl && key === 'p') { e.preventDefault(); Game.payTickets(); }
    else if (ctrl && key === 'm') { e.preventDefault(); Game.buyMiningMachine(); }
    else if (ctrl && key === 'o') { e.preventDefault(); Game.describeOutfit(); }
    else if (ctrl && key === 'a') {
      e.preventDefault();
      const isOwner = (typeof OwnerAccess !== 'undefined') && OwnerAccess.isOwner((typeof Net !== 'undefined' && Net.accountUsername) || null, Game.player && Game.player.firstName, Game.player && Game.player.lastName);
      if (StaffMode.active) { StaffMode.toggle(); }             // ouvre/ferme le panneau (désactive)
      else if (isOwner) { StaffMode.reactivateOwner(); }        // propriétaire : réactivation SANS code
      else { AccessibleTextPrompt.open('Code administrateur', 'Saisissez le code du mode staff.', '', (code) => { if (code) StaffMode.toggle(code); }); }
    }
    else if (ctrl && alt && key === 't') { e.preventDefault(); Game.requisitionTank(); }
    else if (ctrl && key === 't') { e.preventDefault(); openTalkieMenu(); }
    else if (ctrl && key === 'y') { e.preventDefault(); Game.rpTalk(); }
    else if (ctrl && alt && (key === 'e' || e.code === 'KeyE')) { e.preventDefault(); Game.toggleIndoor(); } // entrer / sortir d'un lieu (e.code : sur AZERTY, AltGr+E donne « € », pas « e »)
    else if (ctrl && key === 'e') { e.preventDefault(); Game.throwGrenade(); }
    else if (shift && key === 'e') { e.preventDefault(); Game.changeFloor(1); }   // monter d'un étage
    else if (alt && key === 'e') { e.preventDefault(); Game.changeFloor(-1); }     // descendre d'un étage
    // Chien guide : Maj+Alt+chiffre (0-9) et Maj+Alt+F7 (repos). On lit e.code
    // (Digit0..Digit9) pour rester fiable sur clavier AZERTY.
    else if (shift && alt && ((e.code && /^(Digit|Numpad)[0-9]$/.test(e.code)) || /^[0-9]$/.test(e.key))) {
      // Chien guide : Maj+Alt+chiffre. On accepte à la fois les chiffres de la
      // rangée du haut ET le pavé numérique (Verr Num activé), via e.code
      // (Digit/Numpad) OU e.key (le chiffre lui-même) — le premier qui donne un
      // chiffre gagne. Ça marche quel que soit Verr Maj / Verr Num.
      e.preventDefault();
      const digit = (e.code && /^(Digit|Numpad)[0-9]$/.test(e.code)) ? parseInt(e.code.replace(/\D/g, ''), 10) : parseInt(e.key, 10);
      if (typeof GuideDog !== 'undefined' && !isNaN(digit)) GuideDog.handleDigit(digit);
    }
    else if (shift && alt && (key === 'f7' || e.code === 'F7')) { e.preventDefault(); if (typeof GuideDog !== 'undefined') GuideDog.rest(); }
    else if (ctrl && (['1','2','3','4','5','6','7','8','9'].includes(key))) { e.preventDefault(); Game.target(parseInt(key, 10)); }
    else if (alt && key === 'f') { e.preventDefault(); Game.searchSelf(); }
    else if (alt && key === 'c') { e.preventDefault(); Game.toggleClimb(); }
    else if (alt && key === 'v') { e.preventDefault(); Game.openVehicleInfo(Game.vehicle || City.vehicles.find(v => UTIL.dist(v, Game) < 4)); }
    else if (alt && key === 'k') { e.preventDefault(); Convoy.locate(); } // repérage audio rapide du convoi
    else if (alt && key === 'm') { e.preventDefault(); AccessibleTextPrompt.open('Enregistrer un lieu', 'Nom du lieu à enregistrer ici.', '', (n) => { if (n) Game.savePlaceHere(n); }); }
    else if (alt && key === 'h') { e.preventDefault(); Game.toggleHide(); }
    else if (shift && key === 's') { e.preventDefault(); Game.announceLocation(); }
    else if (shift && key === 'f') { e.preventDefault(); Game.findMyCar(); }
    else if (shift && key === 'v') { e.preventDefault(); Game.honkMyVehicle(); }
    else if (shift && key === 'p') { e.preventDefault(); Game.openPocketDevices(); }
    else if (shift && key === 'h') { e.preventDefault(); toggleHandsUp(); }
    else if (shift && key === 'b') { e.preventDefault(); Game.toggleBeacons(); }
    else if (shift && key === 'g') { e.preventDefault(); Game.stopGuidance(); }
    else if (shift && key === 'n') { e.preventDefault(); Game.toggleGpsBeeps(); }
    else if (shift && key === 'c') { e.preventDefault(); Game.cityTour(); }
    else if (shift && key === 'u') {
      e.preventDefault();
      const live = Game.getLiveTarget();
      if (!live) { announce('Aucune cible verrouillée ou hors de portée.', 'assertive'); }
      else if (live.isPlayer) { announce('Un vrai joueur menotté ne peut pas être traîné ainsi — portez-le physiquement (touche Y) s\'il est aussi inconscient.', 'assertive'); }
      else if (!live.menotte) { announce('Aucune cible menottée verrouillée.', 'assertive'); }
      else { live.follow = !live.follow; announce(live.follow ? `${live.name} vous suit.` : `${live.name} ne vous suit plus.`, 'assertive'); }
    }
    else if (key === 'f6') { e.preventDefault(); Game.announceStatus(); } // bilan vocal : santé, faim, soif, énergie, argent, essence
    else if (key === 'f7') { e.preventDefault(); Game.announceServerInfo(); } // détail séparé du F6 : joueurs connectés
    else if (key === 'f8') { e.preventDefault(); Game.announceActiveMissionId(); } // rappel de la mission active et de son identifiant
    else if (key === 'f9') { e.preventDefault(); Game.searchSelf(); }
    else if (key === 'f10') { e.preventDefault(); Game.openVehicleMenu(); }
    else if (key === 'f11') { e.preventDefault(); Game.toggleSiren(); }
    else if (key === 'f12') { e.preventDefault(); Game.declareWillAtStation(); }
  });
  // Phone app icons
  document.querySelectorAll('.app-icon').forEach(icon => {
    icon.addEventListener('click', () => Phone.renderApp(icon.dataset.app));
    icon.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') Phone.renderApp(icon.dataset.app); });
  });
  el('closePhone').addEventListener('click', () => Phone.closePhone());
  el('phoneAirplaneBtn').addEventListener('click', () => Phone.toggleAirplane());
  el('phoneVoiceBtn').addEventListener('click', () => Phone.toggleMic());
  // Computer
  el('closeComputer').addEventListener('click', () => Computer.close());
  document.querySelectorAll('.computer-sidebar button').forEach(b => b.addEventListener('click', () => Computer.renderMenu(b.dataset.cmd)));
  el('computerRun').addEventListener('click', () => { Computer.runCommand(el('computerInput').value); el('computerInput').value = ''; });
  el('computerInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { Computer.runCommand(el('computerInput').value); el('computerInput').value = ''; } });
  // Shop dialog
  el('closeShop').addEventListener('click', () => Game.closeShopDialog());
}

/* ============================================================
   V10 NEW SYSTEMS — police dispatch, economy, physical interactions,
   skills, black market, RP journal, passengers, wills
============================================================ */

const Police = {
  alerts: [],
  wills: [], // testaments déclarés au commissariat
  dispatch(type, x, y, target) {
    if (type === 'tir') {
      const d = City.getDistrictAt(x, y).name;
      const msg = `Alerte police : tirs signalés dans ${d}, position ${x},${y}.`;
      this.alerts.unshift({ type, x, y, time: Date.now(), target: target?.name });
      log('📢 ' + msg, 'talkie');
      announce('La police a été alertée par les tirs.', 'assertive');
      Game.wanted = Math.min(100, Game.wanted + 10);
    }
  },
  tick() {
    // Pas de PNJ policier qui patrouille en continu, mais si le niveau de
    // recherche reste trop élevé trop longtemps, une équipe d'intervention
    // finit par vous localiser — pour que "être recherché" ait un vrai effet
    // même sans joueur humain policier connecté.
    if (Game.wanted < 50) { Game._wantedHighSince = null; return; }
    if (Game.wantedResponseState) return;
    // La police, ce sont de VRAIS joueurs : s'il y en a de connectés à proximité,
    // on ne déclenche PAS d'intervention PNJ automatique — ils gèrent eux-mêmes.
    if (Game._nearbyRealPolice && Game._nearbyRealPolice(60).length) { Game._wantedHighSince = null; return; }
    const now = Date.now();
    if (!Game._wantedHighSince) { Game._wantedHighSince = now; return; }
    const delay = Math.max(20000, 90000 - Game.wanted * 700);
    if (now - Game._wantedHighSince > delay) {
      Game._wantedHighSince = null;
      Game.triggerPoliceResponse();
    }
  },
  registerWill(player, beneficiary) {
    this.wills = this.wills.filter(w => w.player !== player);
    this.wills.push({ player, beneficiary, time: Date.now() });
    RPJournal.log('Police', `Testament enregistré pour ${player} : bénéficiaire ${beneficiary}.`, 'info');
    announce('Testament enregistré au commissariat.', 'polite');
  },
  executeWill(player, heir) {
    const w = this.wills.find(x => x.player === player);
    if (w) { heir = w.beneficiary; }
    return heir;
  },
  issueTicket(target, amount, reason) {
    if (!Roles.hasPerm('cni')) return;
    if (!target) return announce('Aucune cible pour ce PV.', 'assertive');
    if (target.isPlayer) {
      if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
      Net.send({ type: 'issue_ticket', targetId: target.id, amount, reason });
      announce(`PV émis à ${target.name} pour ${reason}. Montant : ${UTIL.formatMoney(amount)}.`, 'assertive');
    } else {
      const ticket = { id: 'pv_' + Date.now(), target: target.name, amount, reason, time: Date.now() };
      Game.tickets.push(ticket);
      announce(`PV émis pour ${reason}. Montant : ${UTIL.formatMoney(amount)}.`, 'polite');
    }
    RPJournal.log('Police', `PV émis : ${reason}, ${UTIL.formatMoney(amount)}.`, 'alert');
  },
};

const RPJournal = {
  entries: [],
  log(category, text, type = 'info') {
    this.entries.unshift({ time: new Date().toLocaleTimeString(), category, text, type });
    if (this.entries.length > 50) this.entries.pop();
    log(`📰 ${category} : ${text}`, type === 'alert' ? 'damage' : 'system');
  },
  render() {
    const lines = this.entries.slice(0, 8).map(e => `[${e.time}] ${e.category} : ${e.text}`).join('\n');
    return lines || 'Aucune actualité.';
  },
};

const BlackMarket = {
  baseMultiplier: 1.0,
  update() {
    const policePressure = (Game.wanted + Game.policeAwareness) / 200;
    const supply = City.pois.filter(p => p.type === 'marche_noir').reduce((a, p) => a + (p.stock?.length || 0), 0);
    const scarcity = Math.max(0.5, 1 - supply / 100);
    this.baseMultiplier = 0.6 + policePressure * 0.8 + scarcity * 0.6;
    this.baseMultiplier = Math.max(0.4, Math.min(2.5, this.baseMultiplier));
  },
  priceFor(item) {
    const base = item.price || 1000;
    const isBlackMarket = Game.shopContext?.poi?.type === 'marche_noir';
    if (!isBlackMarket) return base;
    const legalPenalty = item.legal !== false ? 0.7 : 1.0;
    return Math.floor(base * this.baseMultiplier * legalPenalty);
  },
};

Game.giveItem = function(itemId, targetName, qty) {
  const it = this.inventory.find(i => i.id === itemId);
  if (!it) return announce('Objet non trouvé.', 'assertive');
  const target = targetName ? City.npcs.find(n => n.name.toLowerCase().includes(targetName.toLowerCase())) : this.lockedTarget;
  if (!target) return announce('Aucun destinataire. Verrouillez une cible (changer de cible) avant de donner un objet.', 'assertive');
  if (UTIL.dist(target, this) > 3) return announce(`Trop loin de ${target.name} pour lui donner un objet. Approchez-vous.`, 'assertive');
  const available = it.q || 1;
  if (qty === undefined && available > 1) {
    QtyPicker.open(`Donner ${it.name} à ${target.name}`, available, (n) => this.giveItem(itemId, targetName, n));
    return;
  }
  qty = Math.min(Math.max(1, Math.floor(qty) || 1), available);
  if (target.isPlayer) {
    Net.giveItemTo(target.id, { ...it, q: qty });
    this.removeItem(itemId, qty);
    announce(`Vous proposez ${qty > 1 ? qty + ' ' : ''}${it.name} à ${target.name} (joueur réel). En attente de sa réponse.`, 'assertive');
    return;
  }
  this.removeItem(itemId, qty);
  target.inventory = target.inventory || [];
  const existing = target.inventory.find(i => i.id === it.id);
  if (existing) existing.q = (existing.q || 1) + qty; else target.inventory.push({ ...it, q: qty });
  announce(`Vous donnez ${qty > 1 ? qty + ' ' : ''}${it.name} à ${target.name}.`, 'polite');
  RPJournal.log('Échange', `${this.role} donne ${qty} ${it.name} à ${target.name}.`, 'info');
};

Game.dropItem = function(itemId, qty) {
  const it = this.inventory.find(i => i.id === itemId);
  if (!it) return announce('Objet non trouvé.', 'assertive');
  const available = it.q || 1;
  if (qty === undefined && available > 1) {
    QtyPicker.open(`Déposer ${it.name} au sol`, available, (n) => this.dropItem(itemId, n));
    return;
  }
  qty = Math.min(Math.max(1, Math.floor(qty) || 1), available);
  this.removeItem(itemId, qty);
  City.groundItems = City.groundItems || [];
  City.groundItems.push({ ...it, q: qty, x: this.x, y: this.y });
  announce(`Vous déposez ${qty > 1 ? qty + ' ' : ''}${it.name} au sol.`, 'polite');
  RPJournal.log('Objet', `${this.role} dépose ${qty} ${it.name} au sol.`, 'info');
};

// Munitions : contrairement aux autres objets, elles ne restent pas dans
// l'inventaire une fois ramassées (converties directement en compteur de
// chargeur) — donc ni donner ni déposer ne fonctionnait avec les fonctions
// ci-dessus. Système dédié, sur le même principe.
Game.giveAmmo = function(ammoType, qty, target) {
  const available = this.ammoReserve[ammoType] || 0;
  const name = AMMO_CATALOG[ammoType]?.name || `Munitions ${ammoType}`;
  if (available <= 0) return announce(`Vous n'avez pas de ${name.toLowerCase()} en réserve.`, 'assertive');
  target = target || this.getLiveTarget();
  if (!target) return announce('Aucun destinataire. Verrouillez une cible ou choisissez un joueur réel proche.', 'assertive');
  if (UTIL.dist(target, this) > 3) return announce(`Trop loin de ${target.name} pour lui donner des munitions. Approchez-vous.`, 'assertive');
  qty = Math.min(Math.max(1, Math.floor(qty) || 1), available);
  this.ammoReserve[ammoType] -= qty;
  if (target.isPlayer) {
    if (!Net.connected) { this.ammoReserve[ammoType] += qty; return announce('Nécessite une connexion au serveur.', 'assertive'); }
    Net.send({ type: 'give_ammo', targetId: target.id, ammoType, qty });
    announce(`Vous donnez ${qty} ${name.toLowerCase()} à ${target.name}. C'est à lui/elle de décider de les charger.`, 'assertive');
  } else {
    target.ammoReserve = target.ammoReserve || {};
    target.ammoReserve[ammoType] = (target.ammoReserve[ammoType] || 0) + qty;
    announce(`Vous donnez ${qty} ${name.toLowerCase()} à ${target.name}.`, 'polite');
  }
  updateHud();
};
Game.dropAmmo = function(ammoType, qty) {
  const available = this.ammoReserve[ammoType] || 0;
  const name = AMMO_CATALOG[ammoType]?.name || `Munitions ${ammoType}`;
  if (available <= 0) return announce(`Vous n'avez pas de ${name.toLowerCase()} en réserve.`, 'assertive');
  qty = Math.min(Math.max(1, Math.floor(qty) || 1), available);
  this.ammoReserve[ammoType] -= qty;
  City.groundItems = City.groundItems || [];
  City.groundItems.push({ id: 'ammo_drop_' + Date.now(), name: `${name} ×${qty}`, isAmmo: true, ammoType, q: qty, x: this.x, y: this.y });
  announce(`Vous déposez ${qty} ${name.toLowerCase()} au sol.`, 'polite');
  updateHud();
};
Game.openAmmoTransferMenu = function() {
  const types = Object.keys(this.ammoReserve).filter(t => this.ammoReserve[t] > 0);
  if (!types.length) return announce('Vous n\'avez aucune munition en réserve à transférer (le chargeur en cours ne se transfère pas).', 'assertive');
  el('menuTitle').textContent = 'Munitions en réserve à transférer';
  const items = types.map(t => ({ id: t, title: `${AMMO_CATALOG[t]?.name || t} (${this.ammoReserve[t]} en réserve)`, desc: '' }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    const ammoType = sel.id;
    el('menuTitle').textContent = 'Donner ou déposer ?';
    const actionItems = [
      { id: 'give', title: '🤝 Donner directement', desc: 'À votre cible verrouillée, ou un joueur réel proche.' },
      { id: 'drop', title: '📦 Déposer au sol', desc: 'L\'autre personne vient le ramasser elle-même.' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(actionItems, (sel2) => {
      closeMenu();
      AccessibleTextPrompt.open('Quantité', `Combien de ${AMMO_CATALOG[ammoType]?.name || ammoType} (${this.ammoReserve[ammoType]} en réserve) ?`, '', (qtyStr) => {
        const qty = parseInt(qtyStr, 10);
        if (!qty) return announce('Quantité invalide.', 'assertive');
        if (sel2.id === 'drop') this.dropAmmo(ammoType, qty);
        else this.giveAmmo(ammoType, qty);
      });
    });
  });
};

// Ramasser un ou plusieurs objets au sol à proximité (munitions, armes,
// objets déposés par un autre joueur...). Un seul objet proche = ramassage
// direct ; plusieurs = un menu pour choisir lequel.
Game.pickUpItems = function() {
  City.groundItems = City.groundItems || [];
  const nearby = City.groundItems.filter(it => UTIL.dist(it, this) < 2);
  if (!nearby.length) return announce('Rien à ramasser ici.', 'polite');
  if (nearby.length === 1) return this.pickUpOneItem(nearby[0]);
  el('menuTitle').textContent = 'Ramasser au sol';
  const items = nearby.map((it, i) => ({ id: String(i), title: `${it.name}${it.q > 1 ? ' ×' + it.q : ''}`, desc: 'Ramasser cet objet.' }));
  renderMenu(items, (sel) => { closeMenu(); this.pickUpOneItem(nearby[parseInt(sel.id, 10)]); });
};
Game.pickUpOneItem = function(groundItem) {
  const idx = City.groundItems.indexOf(groundItem);
  if (idx === -1) return;
  if (groundItem.isCash) {
    this.money += groundItem.amount;
    City.groundItems.splice(idx, 1);
    announce(`Vous ramassez ${UTIL.formatMoney(groundItem.amount)} en liquide.`, 'assertive');
    updateHud();
    return;
  }
  if (groundItem.isAmmo) {
    this.ammoReserve[groundItem.ammoType] = (this.ammoReserve[groundItem.ammoType] || 0) + groundItem.q;
    City.groundItems.splice(idx, 1);
    announce(`Vous ramassez ${groundItem.q} ${(AMMO_CATALOG[groundItem.ammoType]?.name || groundItem.ammoType).toLowerCase()} en réserve.`, 'assertive');
    updateHud();
    return;
  }
  this.addItem({ ...groundItem });
  City.groundItems.splice(idx, 1);
  announce(`Vous ramassez ${groundItem.q > 1 ? groundItem.q + ' ' : ''}${groundItem.name}.`, 'assertive');
  RPJournal.log('Objet', `${this.role} ramasse ${groundItem.q || 1} ${groundItem.name} au sol.`, 'info');
  updateHud();
};

// Coffre du véhicule : déposer un objet de son inventaire dedans, ou en
// récupérer un. Le champ vehicle.inventory existait déjà sur chaque
// véhicule mais n'était jusqu'ici jamais utilisé nulle part.
// Le coffre visé est soit le véhicule où l'on est, soit un véhicule proche
// (le sien, ou celui de quelqu'un d'autre s'il est déverrouillé) passé en
// paramètre — voir Game.openVehicleMenu, branche "à côté d'un véhicule".
Game.storeInTrunk = function(itemId, qty, targetVehicle) {
  const v = targetVehicle || this.vehicle;
  if (!v) return announce('Montez d\'abord dans un véhicule, ou approchez-vous d\'un véhicule déverrouillé.', 'assertive');
  const it = this.inventory.find(i => i.id === itemId);
  if (!it) return announce('Objet non trouvé.', 'assertive');
  const available = it.q || 1;
  if (qty === undefined && available > 1) {
    QtyPicker.open(`Déposer ${it.name} dans le coffre`, available, (n) => this.storeInTrunk(itemId, n, v));
    return;
  }
  qty = Math.min(Math.max(1, Math.floor(qty) || 1), available);
  v.inventory = v.inventory || [];
  this.removeItem(itemId, qty);
  const existing = v.inventory.find(i => i.id === it.id);
  if (existing) existing.q = (existing.q || 1) + qty; else v.inventory.push({ ...it, q: qty });
  announce(`Vous rangez ${qty > 1 ? qty + ' ' : ''}${it.name} dans le coffre${v !== this.vehicle ? ' de ' + v.name : ''}.`, 'polite');
  updateHud();
};
Game.retrieveFromTrunk = function(itemId, qty, targetVehicle) {
  const v = targetVehicle || this.vehicle;
  if (!v) return announce('Montez d\'abord dans un véhicule, ou approchez-vous d\'un véhicule déverrouillé.', 'assertive');
  const it = (v.inventory || []).find(i => i.id === itemId);
  if (!it) return announce('Objet introuvable dans le coffre.', 'assertive');
  const available = it.q || 1;
  if (qty === undefined && available > 1) {
    QtyPicker.open(`Récupérer ${it.name} du coffre`, available, (n) => this.retrieveFromTrunk(itemId, n, v));
    return;
  }
  qty = Math.min(Math.max(1, Math.floor(qty) || 1), available);
  // Même principe que pour un achat : vérifier la place AVANT de retirer du
  // coffre, sinon l'objet disparaissait du coffre sans jamais être reçu.
  if (!this.canAdd({ ...it, q: qty })) return announce('Vos poches sont pleines : impossible de récupérer cet objet.', 'assertive');
  it.q -= qty; if (it.q <= 0) v.inventory = v.inventory.filter(i => i !== it);
  this.addItem({ ...it, q: qty });
  announce(`Vous récupérez ${qty > 1 ? qty + ' ' : ''}${it.name} du coffre${v !== this.vehicle ? ' de ' + v.name : ''}.`, 'assertive');
  updateHud();
};
Game.openTrunkMenu = function(targetVehicle) {
  const v = targetVehicle || this.vehicle;
  if (!v) return announce('Montez d\'abord dans un véhicule, ou approchez-vous d\'un véhicule déverrouillé, pour accéder au coffre.', 'assertive');
  el('menuTitle').textContent = `Coffre${v !== this.vehicle ? ' de ' + v.name : ' du véhicule'}`;
  const items = [
    { id: 'store', title: '📦 Déposer des objets', desc: 'Cocher un ou plusieurs objets de votre inventaire à ranger dans le coffre.' },
    { id: 'retrieve', title: '🎒 Récupérer des objets', desc: `Cocher un ou plusieurs objets à reprendre (${(v.inventory || []).length} objet(s) dedans).` },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'store') this.openTrunkStoreMenu(v);
    else this.openTrunkRetrieveMenu(v);
  });
};
// Menu à cases à cocher : on peut sélectionner plusieurs objets avant de
// confirmer, plutôt que de devoir répéter l'opération un par un.
Game.openTrunkStoreMenu = function(targetVehicle) {
  const v = targetVehicle || this.vehicle;
  if (!this.inventory.length) return announce('Votre inventaire est vide.', 'assertive');
  const selected = new Set();
  const build = () => {
    el('menuTitle').textContent = 'Déposer dans le coffre';
    const items = this.inventory.map(it => ({
      id: it.id,
      title: `${selected.has(it.id) ? '☑' : '☐'} ${it.name}${it.q > 1 ? ' ×' + it.q : ''}`,
      desc: selected.has(it.id) ? 'Sélectionné — appuyez pour retirer de la sélection.' : 'Appuyez pour cocher.',
    }));
    items.push({ id: '__confirm', title: `✅ Déposer ${selected.size ? `(${selected.size})` : ''}`.trim(), desc: selected.size ? 'Confirmer le dépôt des objets cochés.' : 'Cochez au moins un objet avant de valider.' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      if (sel.id === '__confirm') {
        closeMenu();
        if (!selected.size) return announce('Aucun objet coché.', 'assertive');
        const ids = Array.from(selected);
        ids.forEach(id => { const it = this.inventory.find(i => i.id === id); if (it) this.storeInTrunk(id, it.q || 1, v); });
        return;
      }
      if (selected.has(sel.id)) selected.delete(sel.id); else selected.add(sel.id);
      build();
    });
  };
  build();
};
Game.openTrunkRetrieveMenu = function(targetVehicle) {
  const v = targetVehicle || this.vehicle;
  const inv = (v && v.inventory) || [];
  if (!inv.length) return announce('Le coffre est vide.', 'assertive');
  const selected = new Set();
  const build = () => {
    el('menuTitle').textContent = 'Récupérer du coffre';
    const items = inv.map(it => ({
      id: it.id,
      title: `${selected.has(it.id) ? '☑' : '☐'} ${it.name}${it.q > 1 ? ' ×' + it.q : ''}`,
      desc: selected.has(it.id) ? 'Sélectionné — appuyez pour retirer de la sélection.' : 'Appuyez pour cocher.',
    }));
    items.push({ id: '__confirm', title: `✅ Récupérer ${selected.size ? `(${selected.size})` : ''}`.trim(), desc: selected.size ? 'Confirmer la récupération des objets cochés.' : 'Cochez au moins un objet avant de valider.' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      if (sel.id === '__confirm') {
        closeMenu();
        if (!selected.size) return announce('Aucun objet coché.', 'assertive');
        const ids = Array.from(selected);
        ids.forEach(id => { const it = inv.find(i => i.id === id); if (it) this.retrieveFromTrunk(id, it.q || 1, v); });
        return;
      }
      if (selected.has(sel.id)) selected.delete(sel.id); else selected.add(sel.id);
      build();
    });
  };
  build();
};

// Payer en liquide, main à la main : marche pour un PNJ (transfert local,
// comme avant) et pour un vrai joueur (relayé par le réseau — avant, ça ne
// faisait rien du tout côté destinataire réel).
Game.giveMoney = function(amount, target) {
  amount = parseInt(amount) || 0;
  if (amount <= 0 || this.money < amount) return announce('Montant invalide ou fonds insuffisants.', 'assertive');
  target = target || this.lockedTarget;
  if (!target) return announce('Aucun destinataire. Verrouillez une cible ou choisissez un joueur réel proche.', 'assertive');
  this.money -= amount;
  if (target.isPlayer) {
    if (!Net.connected) { this.money += amount; return announce('Nécessite une connexion au serveur.', 'assertive'); }
    Net.send({ type: 'give_money', targetId: target.id, amount });
    announce(`Vous donnez ${UTIL.formatMoney(amount)} en liquide à ${target.name}, main à la main.`, 'assertive');
  } else {
    target.money = (target.money || 0) + amount;
    announce(`Vous donnez ${UTIL.formatMoney(amount)} à ${target.name}.`, 'polite');
  }
  updateHud();
};
// Autre façon de payer en liquide : déposer l'argent au sol, l'autre
// personne (n'importe qui, pas seulement une cible précise) vient le
// ramasser elle-même — utile pour rester discret ou sans verrouiller personne.
Game.dropMoney = function(amount) {
  amount = parseInt(amount) || 0;
  if (amount <= 0 || this.money < amount) return announce('Montant invalide ou fonds insuffisants.', 'assertive');
  this.money -= amount;
  City.groundItems = City.groundItems || [];
  City.groundItems.push({ id: 'cash_' + Date.now(), name: `Argent liquide (${UTIL.formatMoney(amount)})`, isCash: true, amount, x: this.x, y: this.y });
  announce(`Vous déposez ${UTIL.formatMoney(amount)} en liquide au sol.`, 'polite');
  updateHud();
};
// Ouvre le choix : donner directement (à une cible/un joueur proche) ou
// déposer au sol à récupérer.
Game.openPayCashMenu = function() {
  el('menuTitle').textContent = 'Payer en liquide';
  const items = [
    { id: 'direct', title: '🤝 Donner directement', desc: 'À votre cible verrouillée, ou un joueur réel proche.' },
    { id: 'drop', title: '💵 Déposer au sol', desc: 'L\'autre personne vient le ramasser elle-même.' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'drop') {
      AccessibleTextPrompt.open('Déposer de l\'argent', 'Montant en FCFA à déposer au sol.', '', (amt) => this.dropMoney(parseInt(amt, 10)));
      return;
    }
    const nearby = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < 4);
    const candidates = [...(this.lockedTarget ? [this.lockedTarget] : []), ...nearby.map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, isPlayer: true }))];
    if (!candidates.length) return announce('Aucune cible verrouillée ni joueur réel proche.', 'assertive');
    const pick = (target) => AccessibleTextPrompt.open('Montant à donner', 'Montant en FCFA.', '', (amt) => this.giveMoney(parseInt(amt, 10), target));
    if (candidates.length === 1) return pick(candidates[0]);
    el('menuTitle').textContent = 'À qui donner ?';
    const targetItems = candidates.map((c, i) => ({ id: String(i), title: c.name, desc: '' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(targetItems, (sel2) => { closeMenu(); pick(candidates[parseInt(sel2.id, 10)]); });
  });
};

Game.punch = function(targetName) {
  if (this.isCuffed) return announce('Vous êtes menotté(e), impossible de frapper.', 'polite');
  const target = targetName ? City.npcs.find(n => n.name.toLowerCase().includes(targetName.toLowerCase())) : this.getLiveTarget();
  if (!target) return announce('Aucune cible.', 'assertive');
  const distance = UTIL.dist(target, this);
  if (distance > 1.5) return announce(`Trop loin pour frapper (${Math.round(distance * CONFIG.METERS_PER_TILE)} m). Approchez-vous.`, 'assertive');
  const dmg = UTIL.randInt(5, 12);
  AudioLib.playOnce('son_coup_poing_pied', { volume: 0.6 });
  if (target.isPlayer) {
    if (!Net.connected) return;
    Net.send({ type: 'player_punch', targetId: target.id, damage: dmg });
    announce(`Coup de poing sur ${this.lockedTarget?.name || target.name}. ${dmg} dégâts.`, 'assertive');
    return;
  }
  target.health -= dmg;
  this.playNpcHitCry(target);
  announce(`Coup de poing sur ${target.name}. ${dmg} dégâts.`, 'assertive');
  // Un coup de poing n'alerte jamais la police (contrairement aux coups de feu et
  // explosifs) : ce n'est pas une arme à feu. Si la cible tombe, elle est
  // assommée et reste au sol, fouillable — rien n'est pillé automatiquement.
  if (target.health <= 0) this.knockOut(target);
};
// Assomme une cible (coup de poing, etc.) : elle reste au sol, inconsciente et
// fouillable, mais rien n'est pris automatiquement — voir Game.searchTarget.
// Différent de killNPC (mort par arme), qui lui alerte la police et retire le corps.
Game.knockOut = function(target) {
  target.health = 0; target.knockedOut = true; target.subdued = true;
  AudioLib.playOnce('bruit_chute', { volume: 0.6 });
  announce(`${target.name} est assommé et tombe au sol. Vous pouvez le fouiller (Ctrl+F) à proximité.`, 'assertive');
  this.npcPanicReaction(target.x, target.y, { count: 1 });
};

Game.carryPlayer = function(targetName) {
  const target = targetName ? City.npcs.find(n => n.name.toLowerCase().includes(targetName.toLowerCase())) : this.getLiveTarget();
  if (!target || target.health > 0) return announce('Cible invalide.', 'assertive');
  this.carriedPlayer = target;
  announce(`Vous portez ${target.name}. Montez dans un véhicule pour l'installer.`, 'polite');
};

Game.putInVehicle = function() {
  if (!this.carriedPlayer) return announce('Personne à transporter.', 'assertive');
  if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule d\'abord.', 'assertive');
  const cls = VEHICLE_CATALOG[this.vehicle.type];
  const currentPassengers = this.vehicle.passengers?.length || 0;
  if (currentPassengers >= cls.seats - 1) return announce('Véhicule plein.', 'assertive');
  this.vehicle.passengers = this.vehicle.passengers || [];
  this.vehicle.passengers.push({ id: this.carriedPlayer.id, name: this.carriedPlayer.name, health: this.carriedPlayer.health });
  announce(`${this.carriedPlayer.name} installé dans le véhicule.`, 'assertive');
  this.carriedPlayer = null;
};

Game.openDoor = function(door) {
  if (!this.inVehicle || !this.vehicle) return announce('Vous n\'êtes pas dans un véhicule.', 'assertive');
  const doors = ['porte_conducteur', 'porte_passager_avant_droit', 'porte_passager_avant_gauche', 'porte_passager_arriere_droit', 'porte_passager_arriere_gauche', 'coffre'];
  if (!doors.includes(door)) return announce('Porte inconnue.', 'assertive');
  this.vehicle.openDoors = this.vehicle.openDoors || new Set();
  if (this.vehicle.openDoors.has(door)) { this.vehicle.openDoors.delete(door); announce(`Porte ${door} fermée.`, 'polite'); }
  else { this.vehicle.openDoors.add(door); announce(`Porte ${door} ouverte.`, 'polite'); }
};

Game.bankDeposit = function(amount) {
  amount = parseInt(amount) || 0;
  if (amount <= 0 || this.money < amount) return announce('Montant invalide.', 'assertive');
  if (this.bank + amount > CONFIG.BANK_CAPACITY) return announce('Limite bancaire atteinte.', 'assertive');
  this.money -= amount; this.bank += amount;
  announce(`Dépôt de ${UTIL.formatMoney(amount)} en banque.`, 'polite'); updateHud();
};

Game.bankWithdraw = function(amount) {
  amount = parseInt(amount) || 0;
  if (amount <= 0 || this.bank < amount) return announce('Montant invalide.', 'assertive');
  this.bank -= amount; this.money += amount;
  announce(`Retrait de ${UTIL.formatMoney(amount)}.`, 'polite'); updateHud();
};

Game.launderMoney = function(amount) {
  amount = parseInt(amount) || 0;
  if (amount <= 0 || this.dirtyMoney < amount) return announce('Montant invalide.', 'assertive');
  const tax = Math.floor(amount * CONFIG.DIRTY_LAUNDER_TAX);
  const clean = amount - tax;
  this.dirtyMoney -= amount; this.bank += clean;
  announce(`Blanchiment : ${UTIL.formatMoney(amount)} nettoyés, moins ${UTIL.formatMoney(tax)} de frais.`, 'polite');
  RPJournal.log('Économie', 'Blanchiment d\'argent sale détecté.', 'alert'); updateHud();
};

Game.inherit = function(deceased, heir) {
  if (!deceased || !heir) return;
  if (deceased.bank > 0) { heir.bank += deceased.bank; deceased.bank = 0; }
  if (deceased.money > 0) { heir.money += deceased.money; deceased.money = 0; }
  if (deceased.dirtyMoney > 0) { heir.dirtyMoney += deceased.dirtyMoney; deceased.dirtyMoney = 0; }
  for (const vid of deceased.ownedVehicles || []) {
    if (!heir.ownedVehicles.includes(vid)) heir.ownedVehicles.push(vid);
  }
  for (const hid of deceased.ownedHouses || []) {
    if (!heir.ownedHouses.includes(hid)) heir.ownedHouses.push(hid);
  }
  announce(`Héritage reçu de ${deceased.name || 'un proche'}.`, 'assertive');
};

// Perte de connaissance temporaire (pas la mort) : le joueur reste inconscient
// jusqu'à 5 minutes, se réveille automatiquement à l'hôpital si personne ne
// l'aide avant, ou peut être réveillé plus vite par un autre joueur réel qui
// vient l'assister sur place.
Game.die = function() {
  // Déjà inconscient : ne PAS redéclencher. Sinon, tant que la santé reste à 0
  // (faim/soif au maximum), die() serait rappelé en boucle — il ré-annoncerait
  // « Vous perdez connaissance » sans fin ET remettrait le compteur de réveil à
  // zéro à chaque fois, empêchant tout réveil. C'était la voix en boucle.
  if (this.unconscious) return;
  this.unconscious = true; this.unconsciousSince = Date.now();
  AudioLib.playOnce('bruit_chute', { volume: 0.6 });
  if (Net.connected) Net.send({ type: 'state', unconscious: true });
  alertUser('Vous perdez connaissance ! Vous vous réveillerez à l\'hôpital dans 5 minutes si personne ne vient vous aider avant.');
  RPJournal.log('Santé', `${this.player.firstName} ${this.player.lastName} perd connaissance.`, 'alert');
};
Game.wakeAtHospital = function(assistedBy) {
  if (!this.unconscious) return;
  this.unconscious = false;
  this.health = 30; this.money = Math.max(0, this.money - 5000);
  const hopital = City.pois.find(p => p.type === 'hopital');
  if (hopital) { this.x = hopital.x; this.y = hopital.y; this.altitude = 0; }
  if (Net.connected) Net.send({ type: 'state', unconscious: false });
  AudioLib.playOnce('sfx_decompte');
  announce(assistedBy ? `${assistedBy} vous a emmené à l'hôpital. Vous reprenez connaissance.` : 'Vous reprenez connaissance à l\'hôpital.', 'assertive');
  updateHud();
};
// Vérifie régulièrement si les 5 minutes se sont écoulées (voir gameLoop).
Game.UNCONSCIOUS_MS = 5 * 60 * 1000;
Game.tickUnconscious = function() {
  if (!this.unconscious) return;
  // Filet de sécurité : si l'horodatage est absent, invalide (NaN) ou situé
  // dans le futur — cas d'une ancienne sauvegarde, d'un rechargement, ou d'une
  // reconnexion — on ne reste JAMAIS coincé inconscient. On le répare pour
  // provoquer un réveil au prochain contrôle plutôt que d'attendre à l'infini.
  if (typeof this.unconsciousSince !== 'number' || !isFinite(this.unconsciousSince) || this.unconsciousSince > Date.now()) {
    this.unconsciousSince = Date.now() - this.UNCONSCIOUS_MS;
  }
  if (Date.now() - this.unconsciousSince >= this.UNCONSCIOUS_MS) this.wakeAtHospital();
};
// Mort définitive : tir à la tête sans casque, explosion fatale, ou
// hémorragie massive après beaucoup trop d'impacts. Le compte est supprimé et
// ne pourra plus jamais être utilisé.
Game.permanentDeath = function(cause) {
  const label = cause.headshot ? 'un tir mortel à la tête' : cause.explosion ? 'une explosion' : 'une hémorragie massive après trop de blessures';
  this.unconscious = false;
  this._permanentlyDead = true; // bloque toute sauvegarde locale future (voir Game.save) — sinon l'autosave 'beforeunload' juste avant le reload ressuscitait le personnage mort dans le localStorage
  announce(`Vous succombez à ${label}. Votre personnage est mort. C'est définitif : votre compte va être supprimé.`, 'assertive');
  const beneficiary = Police.executeWill('player', this.will?.beneficiary);
  if (beneficiary) {
    const heir = City.npcs.find(n => n.name === beneficiary) || { name: beneficiary, money: 0, bank: 0, dirtyMoney: 0, ownedVehicles: [], ownedHouses: [] };
    this.inherit(this, heir);
    RPJournal.log('Décès', `${beneficiary} hérite des biens de ${this.player.firstName} ${this.player.lastName}, mort(e) définitivement (${label}).`, 'alert');
  }
  // Le corps est transporté à la morgue, en attente d'enterrement. En
  // multijoueur, c'est partagé sur le serveur : d'autres joueurs pourront
  // organiser les funérailles au cimetière quand ils le décideront.
  this.recordDeath(`${this.player.firstName} ${this.player.lastName}`, label);
  announce(`${this.player.firstName} ${this.player.lastName} est transporté(e) à la morgue de la cité, en attente d'enterrement. Que son âme repose en paix.`, 'polite');
  localStorage.removeItem('blind_city_v18'); localStorage.removeItem('blind_city_v17'); localStorage.removeItem('city_blind_v16');
  if (Net.connected && Net.accountUsername) Net.send({ type: 'delete_own_account', username: Net.accountUsername });
  setTimeout(() => { try { location.reload(); } catch (e) {} }, 7000);
};
// Un autre joueur réel, à proximité d'un joueur inconscient, peut l'assister
// pour accélérer son réveil à l'hôpital (au lieu d'attendre les 5 minutes).
Game.assistUnconsciousPlayer = function(targetId, targetName) {
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  Net.send({ type: 'assist_wake', targetId });
  announce(`Vous portez assistance à ${targetName} pour l'emmener à l'hôpital.`, 'assertive');
};
// Portage physique réel d'un autre joueur inconscient : sa position suit la
// nôtre (ou notre véhicule) tant qu'on ne l'a pas relâché — voir Net.sendState
// côté joueur porté, qui mire notre position en continu.
Game.carryingPlayer = null;
Game.carriedByRemote = null;
Game.inWater = false;
Game.isCuffed = false; // vrai pour SOI-MÊME si un autre joueur réel vous menotte — on peut toujours se déplacer et parler, mais plus tirer, frapper, ni utiliser le téléphone/la tablette (mains attachées)
// Menotter/démenotter la cible verrouillée : pour un PNJ, modifie le vrai
// objet (résolu en direct, plus une copie figée) ; pour un joueur réel,
// synchronisé par le réseau — la personne menottée voit vraiment ses
// actions bloquées, pas juste une annonce locale sans effet.
Game.toggleCuffs = function() {
  const live = this.getLiveTarget();
  if (!live) return announce('Cible introuvable ou hors de portée.', 'assertive');
  const name = this.lockedTarget?.name || live.name || 'la cible';
  if (live.isPlayer) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    const newState = !this._targetCuffedGuess;
    this._targetCuffedGuess = newState;
    Net.send({ type: 'toggle_cuffs', targetId: live.id, cuffed: newState });
    announce(newState ? `Vous menottez ${name}.` : `Vous démenottez ${name}.`, 'assertive');
  } else {
    live.menotte = !live.menotte;
    announce(live.menotte ? `${name} menotté(e).` : `${name} démenotté(e).`, 'assertive');
  }
};
Game.jailed = false; // vrai pour SOI-MÊME si un policier vous a enfermé(e) en cellule : plus aucun déplacement ni sortie de lieu tant qu'on n'est pas libéré.
// Mettre en cellule / libérer la cible verrouillée. Réservé à la police, et
// seulement dans les cellules du commissariat — sur une cible déjà maîtrisée
// (menottée ou neutralisée). Pour un joueur réel, synchronisé par le réseau :
// la personne enfermée voit vraiment ses déplacements bloqués, jusqu'à ce
// qu'un policier revienne ouvrir la cellule.
Game.toggleJail = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  const inCellBlock = this.interior && this.interior.poi && (this.interior.poi.type === 'police' || this.interior.poi.type === 'prison') && this.interior.room === 'cellules';
  if (!inCellBlock) return announce('Vous devez être dans les cellules du commissariat pour cette action.', 'assertive');
  const live = this.getLiveTarget();
  if (!live) return announce('Cible introuvable ou hors de portée.', 'assertive');
  const name = this.lockedTarget?.name || live.name || 'la cible';
  const alreadyJailed = live.isPlayer ? this._targetJailedGuess : !!live.jailed;
  if (!alreadyJailed && !(live.menotte || live.isCuffed || live.knockedOut)) {
    return announce(`${name} doit être menotté(e) ou neutralisé(e) avant d'être mis(e) en cellule.`, 'assertive');
  }
  if (live.isPlayer) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    const newState = !alreadyJailed;
    this._targetJailedGuess = newState;
    Net.send({ type: 'toggle_jail', targetId: live.id, jailed: newState, byName: `${this.player.firstName} ${this.player.lastName}` });
    announce(newState ? `Vous enfermez ${name} en cellule.` : `Vous libérez ${name} de sa cellule.`, 'assertive');
  } else {
    live.jailed = !alreadyJailed;
    announce(live.jailed ? `${name} enfermé(e) en cellule.` : `${name} libéré(e) de sa cellule.`, 'assertive');
  }
};
Game.policeRank = null; // null tant que le joueur n'a jamais été policier ; sinon 'agent'/'brigadier'/'capitaine'/'chef'
Game.myContacts = []; // [{ number, username, label }] — reconnaissance d'une personne par nom personnalisé
Game.newsArticles = []; // [{ title, content, author, time }] — publiées par les journalistes, visibles par tous
Game.pendingNegotiations = []; // [{ lawyerId, lawyerName, clientId, clientName }] — en attente de décision policière, après discussion vocale réelle
Game.carryRemotePlayer = function(targetId, targetName) {
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  Net.send({ type: 'carry_request', targetId });
  this.carryingPlayer = { id: targetId, name: targetName };
  announce(`Vous portez ${targetName}. Il/elle vous suit tant que vous ne le/la relâchez pas. Interagissez de nouveau pour le/la déposer.`, 'assertive');
};
Game.releaseCarriedPlayer = function(atHospital) {
  if (!this.carryingPlayer) return;
  Net.send({ type: 'carry_release', targetId: this.carryingPlayer.id, atHospital });
  announce(atHospital ? `${this.carryingPlayer.name} est réveillé(e) à l'hôpital.` : `Vous relâchez ${this.carryingPlayer.name} ici, toujours inconscient(e).`, 'assertive');
  this.carryingPlayer = null;
};

Game.gainSkill = function(skill, amount) {
  this.skills[skill] = Math.min(100, (this.skills[skill] || 0) + amount);
};

Game.repairVehicle = function() {
  if (!this.vehicle) return announce('Pas de véhicule.', 'assertive');
  const bonus = (this.skills.repair || 0) * 0.3;
  const cost = Math.max(0, Math.floor((100 - this.vehicle.hp) * 300 - bonus * 100));
  if (this.money < cost) return announce(`Réparation : ${UTIL.formatMoney(cost)}.`, 'assertive');
  this.money -= cost;
  this.vehicle.hp = Math.min(100, this.vehicle.hp + 30 + bonus);
  this.vehicle.fuel = Math.min(1, this.vehicle.fuel + 0.2);
  this.gainSkill('repair', 2);
  announce(`Réparation effectuée. État : ${Math.round(this.vehicle.hp)}%.`, 'assertive'); updateHud();
};

Game.heal = function(amount) {
  const bonus = (this.skills.heal || 0) * 0.5;
  this.health = Math.min(this.maxHealth, this.health + amount + bonus);
  if (Roles.current === 'medecin') this.gainSkill('heal', 1);
  updateHud();
};

Game.doctorHeal = function(npc) {
  if (npc.job !== 'medecin') return;
  if (this.money >= 12000) { this.money -= 12000; this.heal(60); this.hunger = Math.max(0, this.hunger - 10); this.thirst = Math.max(0, this.thirst - 10); this.gainSkill('heal', 3); announce(`${npc.name} vous soigne avec des outils médicaux. Santé +60%.`, 'polite'); }
  else announce('Soins spécialisés : 12 000 FCFA.', 'assertive');
};

// Métiers habilités à facturer un client : chacun pour ses propres services.
const BILLABLE_ROLES = ['police', 'medecin', 'mecanicien', 'agent_immo', 'avocat', 'concessionnaire'];
// Facturer quelqu'un : si c'est un vrai joueur, la facture lui est vraiment
// envoyée par le réseau (avant, ça ne faisait rien du tout côté destinataire —
// cette fonction n'était même jamais déclenchable). Pour un PNJ, ça reste une
// simple trace locale, comme avant.
Game.sendInvoice = function(target, amount, reason) {
  if (!BILLABLE_ROLES.includes(Roles.current)) return announce('Votre métier actuel ne permet pas de facturer.', 'assertive');
  amount = parseInt(amount) || 0;
  if (amount <= 0) return announce('Montant invalide.', 'assertive');
  if (target?.isPlayer) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    Net.send({ type: 'send_invoice', targetId: target.id, amount, reason });
    this.invoices.push({ target: target.name, amount, reason, time: Date.now() });
    announce(`Facture de ${UTIL.formatMoney(amount)} envoyée à ${target.name} pour ${reason}.`, 'assertive');
  } else if (target) {
    this.invoices.push({ target: target.name, amount, reason, time: Date.now() });
    announce(`Facture de ${UTIL.formatMoney(amount)} enregistrée pour ${target.name}, ${reason}.`, 'polite');
  } else {
    announce('Aucun destinataire. Verrouillez une cible ou choisissez un joueur réel proche.', 'assertive');
  }
};
// Ouvre le choix du destinataire à facturer (joueur réel proche, ou cible
// verrouillée), puis le montant et le motif.
Game.openInvoiceMenu = function() {
  if (!BILLABLE_ROLES.includes(Roles.current)) return announce('Votre métier actuel ne permet pas de facturer.', 'assertive');
  const nearby = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < 8);
  const candidates = [...nearby.map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, isPlayer: true })), ...(this.lockedTarget ? [this.lockedTarget] : [])];
  if (!candidates.length) return announce('Aucun client proche ni cible verrouillée à facturer.', 'assertive');
  el('menuTitle').textContent = 'Facturer un client';
  const items = candidates.map((c, i) => ({ id: String(i), title: c.name, desc: c.isPlayer ? 'Joueur réel proche.' : 'Cible verrouillée.' }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    const target = candidates[parseInt(sel.id, 10)];
    closeMenu();
    // Le motif se dit de vive voix entre les deux, pas tapé ici — le menu ne
    // sert qu'à acter le montant sur lequel vous vous êtes mis d'accord.
    AccessibleTextPrompt.open('Montant de la facture', 'Montant en FCFA, dont vous vous êtes mis d\'accord de vive voix.', '', (amountStr) => {
      const amount = parseInt(amountStr, 10);
      if (!amount) return announce('Montant invalide.', 'assertive');
      this.sendInvoice(target, amount, `services rendus par ${Roles.list[Roles.current].name.toLowerCase()}`);
    });
  });
};
// Factures reçues, à payer — le vrai trou que le système d'avant laissait :
// une facture pouvait être "envoyée" sans que le destinataire ne la voie ni
// ne puisse la régler.
// Historique complet des PV et factures (payés ET en attente), en menu à
// cartes accessible — l'appui direct sur une entrée en attente la paie.
Game.openFinesHistoryMenu = function() {
  const history = this.finesHistory || [];
  el('menuTitle').textContent = 'PV et factures';
  if (!history.length) {
    el('menuOverlay').style.display = 'flex';
    renderMenu([{ id: 'empty', title: 'Rien pour l\'instant', desc: 'Aucun PV ni facture reçu.' }], () => closeMenu());
    return;
  }
  const items = history.map(f => {
    const d = new Date(f.time); const time = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    const label = f.type === 'pv' ? 'PV' : 'Facture';
    const statut = f.paid ? '✅ payé' : '⏳ en attente — appuyez pour payer';
    return { id: f.id, title: `${label} — ${UTIL.formatMoney(f.amount)} (${f.reason})`, desc: `De ${f.from}, ${time} — ${statut}`, entry: f };
  });
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.entry.paid) return;
    if (sel.entry.type === 'pv') this.payTickets();
    else { const idx = this.pendingBills.findIndex(b => b.id === sel.entry.id); if (idx !== -1) this.payBill(idx); }
  });
};
Game.pendingBills = [];
Game.openMyBills = function() {
  if (!this.pendingBills.length) return announce('Aucune facture en attente.', 'polite');
  el('menuTitle').textContent = 'Mes factures';
  const items = this.pendingBills.map((b, i) => ({ id: String(i), title: `${UTIL.formatMoney(b.amount)} — ${b.from}`, desc: b.reason }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => { closeMenu(); this.payBill(parseInt(sel.id, 10)); });
};
Game.payBill = function(index) {
  const bill = this.pendingBills[index];
  if (!bill) return;
  // Une facture se paie par virement bancaire, jamais en liquide de la
  // poche — refusé net si le compte n'a pas les fonds, même avec du
  // liquide disponible par ailleurs.
  if (this.bank < bill.amount) return announce(`Facture de ${UTIL.formatMoney(bill.amount)} : solde bancaire insuffisant (${UTIL.formatMoney(this.bank)} disponible). Déposez d'abord de l'argent à la banque.`, 'assertive');
  this.bank -= bill.amount;
  this.pendingBills.splice(index, 1);
  const histEntry = this.finesHistory.find(f => f.type === 'facture' && f.id === bill.id);
  if (histEntry) { histEntry.paid = true; histEntry.paidAt = Date.now(); }
  Audio.cash();
  announce(`Facture de ${UTIL.formatMoney(bill.amount)} payée à ${bill.from} par virement bancaire.`, 'assertive');
  if (Net.connected && bill.fromId) Net.send({ type: 'invoice_paid', targetId: bill.fromId, amount: bill.amount });
  updateHud();
};

Game.mechanicRepair = function(npc) {
  if (npc.job !== 'mecanicien') return;
  if (!this.vehicle) return;
  const cost = Roles.hasPerm('full_repair') ? 0 : 8000;
  if (this.money < cost) return announce(`Réparation garagiste : ${UTIL.formatMoney(cost)}.`, 'assertive');
  this.money -= cost; this.vehicle.hp = 100; this.vehicle.fuel = 1; this.gainSkill('repair', 4); announce('Garagiste : réparation complète.', 'assertive');
};

// Trouve le joueur réel le plus proche (pour diagnostiquer, soigner,
// réparer son véhicule...). Rayon large : 6 cases, un peu plus qu'une
// simple interaction, pour rester pratique en RP.
Game.findNearbyRealPlayer = function(radius = 6) {
  const p = Array.from(Net.remotePlayers.values())
    .filter(p => UTIL.dist(p, this) < radius)
    .sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
  return p ? { ...p, name: `${p.firstName} ${p.lastName}`, isPlayer: true } : null;
};

// Aiguillage général : ouvre le menu du métier qu'on exerce actuellement.
Game.openMyJobMenu = function() {
  const role = Roles.current;
  if (role === 'police') return this.openPoliceMenu();
  if (role === 'medecin') return this.openDoctorMenu();
  if (role === 'mecanicien') return this.openMechanicMenu();
  if (role === 'mineur_pro') return this.openMinerMenu();
  if (role === 'agent_immo') return this.openRealEstateMenu();
  if (role === 'avocat') return this.openLawyerMenu();
  if (role === 'journaliste_pro') return this.openJournalistMenu();
  if (role === 'concessionnaire') return this.openDealershipMenu();
  if (role === 'chauffeur_pro') return this.openTaxiDriverMenu();
  announce('Votre métier actuel n\'a pas de menu dédié pour l\'instant.', 'assertive');
};

/* ============================================================
   MENU CHAUFFEUR — recevoir les demandes de course des passagers
   réels, et s'y rendre en conduite automatique.
============================================================ */
Game.pendingRides = []; // [{ passengerId, passengerName, x, y }]
Game.openTaxiDriverMenu = function() {
  if (Roles.current !== 'chauffeur_pro') return announce('Réservé aux chauffeurs professionnels.', 'assertive');
  if (!this.pendingRides.length) return announce('Aucune demande de course en attente.', 'polite');
  el('menuTitle').textContent = 'Courses en attente';
  const items = this.pendingRides.map((r, i) => ({ id: String(i), title: r.passengerName, desc: `${Math.round(UTIL.dist(r, this) * CONFIG.METERS_PER_TILE)} m.` }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    const ride = this.pendingRides[parseInt(sel.id, 10)];
    if (!this.inVehicle) return announce('Montez d\'abord dans votre véhicule pour vous y rendre.', 'assertive');
    this.vehicle.auto = true; this.vehicle.autoDest = { x: ride.x, y: ride.y, name: `${ride.passengerName} (client)` };
    if (Net.connected) Net.send({ type: 'taxi_accept', targetId: ride.passengerId });
    announce(`En route vers ${ride.passengerName}.`, 'assertive');
  });
};

/* ============================================================
   MENU CONCESSIONNAIRE — estimer un véhicule du catalogue, et en
   proposer un à un client précis (comme l'agent immobilier pour
   les maisons). L'achat en libre-service reste possible pour tout
   le monde ; ceci ajoute le vrai rôle du vendeur par-dessus.
============================================================ */
Game.openDealershipMenu = function() {
  if (Roles.current !== 'concessionnaire') return announce('Réservé aux concessionnaires.', 'assertive');
  el('menuTitle').textContent = 'Menu concessionnaire';
  const items = [
    { id: 'estimate', title: '📋 Estimer un véhicule du catalogue', desc: 'Prix, vitesse, places, coffre.' },
    { id: 'sell', title: '🚗 Vendre un véhicule à un client', desc: 'À un joueur réel proche, avec son accord.' },
    { id: 'invoice', title: '🧾 Facturer un client', desc: 'Frais annexes, entretien...' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'estimate') this.estimateVehicleFromCatalog();
    else if (sel.id === 'sell') this.sellVehicleToBuyer();
    else this.openInvoiceMenu();
  });
};
Game.estimateVehicleFromCatalog = function() {
  const entries = Object.entries(VEHICLE_CATALOG).filter(([, v]) => !v.restricted);
  el('menuTitle').textContent = 'Estimer un véhicule';
  const items = entries.map(([id, v]) => ({ id, title: v.name, desc: '' }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    const v = VEHICLE_CATALOG[sel.id];
    announce(`${v.name} : ${UTIL.formatMoney(v.price)}, ${v.seats} place(s), coffre ${v.trunk}, ${v.human ? 'à pédales' : v.electric ? 'électrique' : v.flies ? 'volant' : 'thermique'}.`, 'assertive');
  });
};
Game.sellVehicleToBuyer = function() {
  const entries = Object.entries(VEHICLE_CATALOG).filter(([, v]) => !v.restricted);
  const buyer = this.findNearbyRealPlayer();
  if (!buyer) return announce('Aucun client réel à proximité.', 'assertive');
  el('menuTitle').textContent = `Vendre à ${buyer.name}`;
  const items = entries.map(([id, v]) => ({ id, title: `${v.name} — ${UTIL.formatMoney(v.price)}`, desc: '' }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    const v = VEHICLE_CATALOG[sel.id];
    AccessibleConfirm.open(`Vendre ${v.name}`, `Proposer ${v.name} à ${buyer.name} pour ${UTIL.formatMoney(v.price)} ?`, (confirmed) => {
      if (!confirmed) return;
      if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
      Net.send({ type: 'vehicle_sale_offer', targetId: buyer.id, vehicleType: sel.id, vehicleName: v.name, price: v.price });
      announce(`Offre de vente envoyée à ${buyer.name}. En attente de sa réponse.`, 'assertive');
    });
  });
};



/* ============================================================
   MENU AVOCAT — la réduction d'un PV n'est JAMAIS automatique : ça
   se joue en RP, l'avocat plaide sa cause auprès d'un policier réel,
   qui seul décide d'accepter ou de refuser.
============================================================ */
Game.openLawyerMenu = function() {
  if (Roles.current !== 'avocat') return announce('Réservé aux avocats.', 'assertive');
  el('menuTitle').textContent = 'Menu avocat';
  const items = [
    { id: 'negotiate', title: '⚖️ Plaider pour un client auprès de la police', desc: 'Nécessite un client réel ET un policier réel, tous deux à proximité.' },
    { id: 'invoice', title: '🧾 Facturer un client (honoraires)', desc: '' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'negotiate') this.negotiateWithPolice();
    else this.openInvoiceMenu();
  });
};
// Ouvre une demande de négociation : la vraie discussion se fait à la voix
// (micro de proximité, touche V — déjà utilisable par les deux), pas par un
// texte tapé. Ceci ne sert qu'à prévenir le policier qu'une négociation est
// en cours pour ce client précis, et à activer son micro s'il ne l'est pas
// déjà. La décision reste entièrement la sienne, prise plus tard, une fois
// la vraie conversation terminée.
Game.negotiateWithPolice = function() {
  const nearby = Array.from(Net.remotePlayers.values());
  const client = nearby.filter(p => UTIL.dist(p, this) < 6).map(p => ({ ...p, name: `${p.firstName} ${p.lastName}` }))[0];
  const officer = nearby.filter(p => p.role === 'police' && UTIL.dist(p, this) < 6).map(p => ({ ...p, name: `${p.firstName} ${p.lastName}` }))[0];
  if (!client) return announce('Aucun client réel à proximité pour le représenter.', 'assertive');
  if (!officer) return announce('Aucun policier réel à proximité pour plaider votre cause.', 'assertive');
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  if (!Game.voiceOpen) toggleProxVoice(); // active le micro de l'avocat automatiquement, s'il ne l'était pas déjà
  Net.send({ type: 'legal_negotiation', officerId: officer.id, clientId: client.id, clientName: client.name });
  announce(`Demande de négociation envoyée à ${officer.name} pour ${client.name}. Parlez-lui directement avec votre micro (V) — c'est lui qui décidera ensuite, depuis son menu police.`, 'assertive');
};

/* ============================================================
   MENU JOURNALISTE — écrire et diffuser une info, que tous les
   joueurs peuvent lire dans l'application Actualités du téléphone.
============================================================ */
Game.openJournalistMenu = function() {
  if (Roles.current !== 'journaliste_pro') return announce('Réservé aux journalistes.', 'assertive');
  el('menuTitle').textContent = 'Menu journaliste';
  const items = [
    { id: 'publish', title: '📰 Publier une info', desc: 'Visible par tous les joueurs connectés, dans l\'application Actualités. Écrivez ce que vous avez appris en parlant aux gens.' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    this.publishNews();
  });
};
Game.publishNews = function() {
  AccessibleTextPrompt.open('Titre de l\'info', 'Un titre court et clair.', '', (title) => {
    if (!title) return;
    AccessibleTextPrompt.open('Contenu', 'Le corps de l\'article.', '', (content) => {
      if (!content) return;
      if (!Net.connected) return announce('Nécessite une connexion au serveur pour publier.', 'assertive');
      Net.send({ type: 'publish_news', title, content, author: `${this.player.firstName} ${this.player.lastName}` });
      announce('Info envoyée à la rédaction. Elle apparaîtra dans les Actualités de tous les joueurs connectés.', 'assertive');
    });
  });
};

/* ============================================================
   MENU AGENT IMMOBILIER — estimer, vendre à un acheteur précis,
   donner les clés (autorisation d'accès sans être propriétaire).
============================================================ */
Game.openRealEstateMenu = function() {
  if (Roles.current !== 'agent_immo') return announce('Réservé aux agents immobiliers.', 'assertive');
  el('menuTitle').textContent = 'Menu agent immobilier';
  const items = [
    { id: 'estimate', title: '📋 Estimer la maison proche', desc: 'Prix, étages, capacité de stockage, propriétaire actuel.' },
    { id: 'sell', title: '🏠 Vendre la maison proche à un client', desc: 'À un joueur réel proche, avec son accord.' },
    { id: 'keys', title: '🔑 Donner les clés de la maison proche', desc: 'Autoriser un joueur réel à y entrer sans en être propriétaire.' },
    { id: 'invoice', title: '🧾 Facturer un client', desc: 'Envoyer une facture (honoraires, commission...).' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'estimate') this.estimateHouse();
    else if (sel.id === 'sell') this.sellHouseToBuyer();
    else if (sel.id === 'keys') this.giveHouseKeys();
    else if (sel.id === 'invoice') this.openInvoiceMenu();
  });
};
Game.findNearbyHouse = function() {
  return City.houses.filter(h => UTIL.dist(h, this) < 6).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0] || null;
};
Game.estimateHouse = function() {
  const house = this.findNearbyHouse();
  if (!house) return announce('Aucune maison à proximité à estimer.', 'assertive');
  const ownerLabel = house.owner ? (this.ownedHouses.includes(house.id) ? 'vous-même' : 'déjà vendue à quelqu\'un d\'autre') : 'à vendre, aucun propriétaire';
  announce(`Estimation de ${house.name} : ${UTIL.formatMoney(house.price)}, ${house.floors} étage(s), capacité de stockage ${house.capacity}. Propriétaire : ${ownerLabel}.`, 'assertive');
};
// Annuaire des adresses : lit City.houses en direct, donc toute maison
// ajoutée plus tard (croissance de la ville, admin) apparaît automatiquement
// sans rien à mettre à jour ici.
Game.houseAddress = function(h) {
  const d = City.getDistrictAt(h.x, h.y);
  return `${h.name}, quartier ${d.name}`;
};
Game.openHouseDirectory = function() {
  const houses = City.houses.slice().sort((a, b) => Game.houseAddress(a).localeCompare(Game.houseAddress(b)));
  el('menuTitle').textContent = 'Adresses des maisons';
  const items = houses.map(h => {
    const ownerLabel = h.owner ? (this.ownedHouses.includes(h.id) ? 'à vous' : 'occupée') : 'libre, à vendre';
    const dist = Math.round(UTIL.dist(h, this) * CONFIG.METERS_PER_TILE);
    const bearing = UTIL.bearing(h.x - this.x, h.y - this.y);
    return { id: h.id, title: `${this.houseAddress(h)} — ${ownerLabel}`, desc: `${UTIL.formatMoney(h.price)}, ${dist} m, vers le ${bearing}.` };
  });
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    const h = houses.find(hh => hh.id === sel.id);
    if (h) this.setGuidance({ name: this.houseAddress(h), x: h.x, y: h.y });
  });
};
Game.sellHouseToBuyer = function() {
  const house = this.findNearbyHouse();
  if (!house) return announce('Aucune maison à proximité à vendre.', 'assertive');
  if (house.owner && !this.ownedHouses.includes(house.id)) return announce('Cette maison appartient déjà à quelqu\'un d\'autre — seul son propriétaire peut la remettre en vente.', 'assertive');
  const buyer = this.findNearbyRealPlayer();
  if (!buyer) return announce('Aucun client réel à proximité.', 'assertive');
  AccessibleConfirm.open(`Vendre ${house.name}`, `Proposer ${house.name} à ${buyer.name} pour ${UTIL.formatMoney(house.price)} ?`, (confirmed) => {
    if (!confirmed) return;
    if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    Net.send({ type: 'house_sale_offer', targetId: buyer.id, houseId: house.id, houseName: house.name, price: house.price });
    announce(`Offre de vente envoyée à ${buyer.name}. En attente de sa réponse.`, 'assertive');
  });
};
Game.giveHouseKeys = function() {
  const house = this.findNearbyHouse();
  if (!house) return announce('Aucune maison à proximité.', 'assertive');
  if (!this.ownedHouses.includes(house.id) && Roles.current !== 'agent_immo') return announce('Seul le propriétaire ou un agent immobilier peut donner les clés.', 'assertive');
  const target = this.findNearbyRealPlayer();
  if (!target || !target.accountUsername) return announce('Aucun joueur réel connecté à un compte, à proximité.', 'assertive');
  house.authorizedUsers = house.authorizedUsers || [];
  if (house.authorizedUsers.includes(target.accountUsername)) return announce(`${target.name} a déjà les clés de ${house.name}.`, 'polite');
  house.authorizedUsers.push(target.accountUsername);
  sendWorldEdit('house_keys', { id: house.id, authorizedUsers: house.authorizedUsers });
  announce(`Clés de ${house.name} données à ${target.name}. Il/elle peut désormais y entrer librement.`, 'assertive');
};

/* ============================================================
   MENU MÉDECIN — vrai diagnostic avant de soigner, pas juste un
   bouton "soigner" aveugle.
============================================================ */
Game.openDoctorMenu = function() {
  if (Roles.current !== 'medecin') return announce('Réservé aux médecins.', 'assertive');
  el('menuTitle').textContent = 'Menu médecin';
  const items = [
    { id: 'diagnose', title: '🩺 Diagnostiquer un patient proche', desc: 'Inspecter son état réel (santé, faim, soif, conscience) avant de le soigner.' },
    { id: 'treat', title: '💉 Soigner le dernier patient diagnostiqué', desc: this._diagnosedPatientId ? `Patient : ${this._diagnosedPatientName}.` : 'Diagnostiquez d\'abord quelqu\'un.' },
    { id: 'invoice', title: '🧾 Facturer un client', desc: 'Envoyer une facture de soins à un joueur réel proche.' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'diagnose') this.diagnosePatient();
    else if (sel.id === 'treat') this.treatPatient();
    else this.openInvoiceMenu();
  });
};
Game.diagnosePatient = function() {
  const patient = this.findNearbyRealPlayer();
  if (!patient) return announce('Aucun patient réel à proximité pour l\'établir.', 'assertive');
  this._diagnosedPatientId = patient.id; this._diagnosedPatientName = patient.name;
  const problems = [];
  if (patient.unconscious) problems.push('inconscient(e) — urgence, réanimation nécessaire avant tout');
  else if (patient.health < 30) problems.push(`blessure grave (santé à ${Math.round(patient.health)}%)`);
  else if (patient.health < 70) problems.push(`blessure légère (santé à ${Math.round(patient.health)}%)`);
  if (typeof patient.hunger === 'number' && patient.hunger > 70) problems.push(`dénutrition avancée (faim à ${Math.round(patient.hunger)}%)`);
  if (typeof patient.thirst === 'number' && patient.thirst > 70) problems.push(`déshydratation avancée (soif à ${Math.round(patient.thirst)}%)`);
  if (!problems.length) problems.push('aucun problème de santé apparent, patient en bonne forme');
  announce(`Diagnostic de ${patient.name} : ${problems.join(', ')}.`, 'assertive');
};
Game.treatPatient = function() {
  if (!this._diagnosedPatientId) return announce('Diagnostiquez d\'abord un patient proche.', 'assertive');
  // Re-résolu EN DIRECT depuis Net.remotePlayers : le diagnostic peut dater
  // de quelques secondes, la personne a pu bouger, se soigner elle-même, etc.
  const patient = Net.remotePlayers.get(this._diagnosedPatientId);
  const name = this._diagnosedPatientName;
  if (!patient) return announce(`${name} n'est plus connecté(e) ou hors de portée.`, 'assertive');
  if (UTIL.dist(patient, this) > 6) return announce(`${name} n'est plus à proximité.`, 'assertive');
  if (patient.unconscious) {
    if (!Roles.hasPerm('revive')) return announce('La réanimation nécessite la compétence "revive".', 'assertive');
    this.assistUnconsciousPlayer(patient.id, name);
    this.gainSkill('heal', 5);
    return;
  }
  const cost = Roles.hasPerm('advanced_heal') ? 0 : 12000;
  if (this.money < cost) return announce(`Traitement : ${UTIL.formatMoney(cost)}. Fonds insuffisants.`, 'assertive');
  this.money -= cost;
  if (Net.connected) Net.send({ type: 'player_treated', targetId: patient.id, healthGain: 60 });
  this.gainSkill('heal', 4);
  announce(`Vous traitez ${name} : soins appliqués à distance, la personne recevra +60% de santé.`, 'assertive');
};

/* ============================================================
   MENU GARAGISTE — réparer le véhicule d'un autre vrai joueur.
============================================================ */
Game.openMechanicMenu = function() {
  if (Roles.current !== 'mecanicien') return announce('Réservé aux garagistes.', 'assertive');
  el('menuTitle').textContent = 'Menu garagiste';
  const items = [
    { id: 'repair', title: '🔧 Réparer le véhicule proche', desc: 'Répare le véhicule le plus proche, occupé ou non.' },
    { id: 'callouts', title: `🚨 Dépannages en attente${this.pendingCallouts.length ? ' (' + this.pendingCallouts.length + ')' : ''}`, desc: 'Clients en panne demandant un garagiste sur place.' },
    { id: 'invoice', title: '🧾 Facturer un client', desc: 'Envoyer une facture de réparation à un joueur réel proche.' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'repair') this.mechanicRepairNearbyVehicle();
    else if (sel.id === 'callouts') this.openCalloutsMenu();
    else this.openInvoiceMenu();
  });
};
Game.pendingCallouts = []; // [{ clientId, clientName, x, y }]
Game.openCalloutsMenu = function() {
  if (!this.pendingCallouts.length) return announce('Aucun dépannage en attente.', 'polite');
  el('menuTitle').textContent = 'Dépannages en attente';
  const items = this.pendingCallouts.map((c, i) => ({ id: String(i), title: c.clientName, desc: `${Math.round(UTIL.dist(c, this) * CONFIG.METERS_PER_TILE)} m.` }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    const callout = this.pendingCallouts[parseInt(sel.id, 10)];
    if (!this.inVehicle) return announce('Montez d\'abord dans votre véhicule pour vous y rendre.', 'assertive');
    this.vehicle.auto = true; this.vehicle.autoDest = { x: callout.x, y: callout.y, name: `${callout.clientName} (dépannage)` };
    if (Net.connected) Net.send({ type: 'mechanic_accept', targetId: callout.clientId });
    announce(`En route vers ${callout.clientName}.`, 'assertive');
  });
};
// Appeler un garagiste réel pour qu'il vienne réparer sur place, plutôt que
// d'avoir à se rendre soi-même chez lui.
Game.callMechanic = function() {
  if (!this.inVehicle) return announce('Montez d\'abord dans le véhicule à réparer.', 'assertive');
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  Net.send({ type: 'mechanic_request', x: this.x, y: this.y, vehicleName: this.vehicle.name });
  announce('Demande de dépannage envoyée aux garagistes réels connectés. Quelqu\'un vous contactera s\'il accepte.', 'assertive');
};
Game.mechanicRepairNearbyVehicle = function() {
  const v = City.vehicles.filter(v => UTIL.dist(v, this) < 6).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
  if (!v) return announce('Aucun véhicule à proximité.', 'assertive');
  const cost = Roles.hasPerm('full_repair') ? 0 : 8000;
  if (this.money < cost) return announce(`Réparation : ${UTIL.formatMoney(cost)}. Fonds insuffisants.`, 'assertive');
  this.money -= cost; v.hp = 100; v.fuel = 1; this.gainSkill('repair', 4);
  sendWorldEdit('vehicle_position', { id: v.id, x: v.x, y: v.y, locked: v.locked });
  announce(`${v.name} entièrement réparé.`, 'assertive');
};

/* ============================================================
   MENU MINEUR — regroupe l'achat de la machine et l'extraction.
============================================================ */
Game.openMinerMenu = function() {
  if (Roles.current !== 'mineur_pro') return announce('Réservé aux mineurs professionnels.', 'assertive');
  el('menuTitle').textContent = 'Menu mineur professionnel';
  const items = [
    { id: 'machine', title: this.miningMachine ? '✅ Machine déjà achetée' : '⛏️ Acheter une machine d\'extraction', desc: 'Nécessaire pour extraire du minerai en zone minière.' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'machine' && !this.miningMachine) this.buyMiningMachine();
  });
};


Game.openVehicleMenu = function() {
  if (!this.inVehicle || !this.vehicle) {
    const v = City.vehicles.filter(v => UTIL.dist(v, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    if (!v) return announce('Aucun véhicule à proximité.', 'assertive');
    // À côté d'un véhicule (le vôtre ou celui de quelqu'un d'autre) sans y être
    // monté : on peut consulter ses infos, et accéder à son coffre s'il est
    // déverrouillé ou si c'est le vôtre.
    el('menuTitle').textContent = `Véhicule : ${v.name}`;
    const accessible = !v.locked || v.owner === 'player';
    const items = [
      { id: 'info', title: 'ℹ️ Infos du véhicule', desc: 'Puissance, essence, état, portes, passagers.' },
      { id: 'trunk', title: '📦 Coffre', desc: accessible ? 'Déposer ou récupérer des objets.' : 'Véhicule verrouillé : coffre inaccessible.' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'info') this.openVehicleInfo(v);
      else if (sel.id === 'trunk') {
        if (!accessible) return announce('Ce véhicule est verrouillé, impossible d\'accéder au coffre.', 'assertive');
        this.openTrunkMenu(v);
      }
    });
    return;
  }
  // Au volant : proposer aussi le mode de conduite (auto/manuel guidé/libre),
  // à la demande seulement — il ne s'ouvre plus tout seul en montant.
  if (typeof ensureMenuOpen === 'function') ensureMenuOpen();
  el('menuTitle').textContent = `Véhicule : ${this.vehicle.name}`;
  const items = [
    { id: 'info', title: 'ℹ️ Infos du véhicule', desc: 'Puissance, essence, état, portes, passagers.' },
    { id: 'drivemode', title: '🧭 Mode de conduite', desc: 'Choisir conduite automatique, manuelle guidée, ou revenir à la conduite libre.' },
    { id: 'radio', title: '🎵 Autoradio', desc: MusicPlayer.fileName ? `En cours : ${MusicPlayer.fileName}.` : 'Jouer votre propre musique (fichier local).' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'info') this.openVehicleInfo(this.vehicle);
    else if (sel.id === 'drivemode') this.openDriveModeMenu(this.vehicle);
    else if (sel.id === 'radio') { MusicPlayer.setSourceRef(null); this.openMusicMenu('autoradio'); } // suit le véhicule, jamais spatialisé par distance
  });
};
Game.openVehicleInfo = function(v) {
  const cls = VEHICLE_CATALOG[v.type];
  const doors = Array.from(v.openDoors || new Set());
  const passengers = v.passengers?.map(p => p.name).join(', ') || 'aucun';
  const power = Math.round(cls.maxSpeed * 120);
  const fuelPct = Math.round(v.fuel * 100);
  const fuelLabel = cls.electric ? 'batterie' : 'essence';
  const hpPct = Math.round(v.hp);
  const locked = v.locked ? 'verrouillé' : 'déverrouillé';
  announce(`Véhicule : ${v.name}. Puissance ~${power} ch, ${fuelLabel} ${fuelPct}%, état ${hpPct}%, ${locked}. Portes ouvertes : ${doors.length ? doors.join(', ') : 'aucune'}. Passagers : ${passengers}. Sièges : ${cls.seats}. Coffre : ${cls.trunk} L.`, 'polite');
};

Game.openPoliceStation = function(poi) {
  if (!this.player.registered) {
    this.registerAtStation();
    return;
  }
  if (Roles.current === 'police') {
    announce(`Commissariat ${poi.name}. Menu : C pour caméras, F pour fourrière, V pour PV, T pour testament, S pour sirène.`, 'polite');
    if (!this.outfit.isPolice) {
      AccessibleConfirm.open('Uniforme de police', 'Prendre votre uniforme officiel ? Gratuit pour les policiers en service. Reconnaissable par tous, décrit comme tel.', (confirmed) => {
        if (!confirmed) return;
        this.outfit.haut = 'uniforme de police'; this.outfit.isPolice = true;
        announce('Uniforme de police pris et enfilé, gratuitement.', 'assertive');
        updateHud();
      });
    }
  } else {
    const will = Police.wills.find(w => w.player === 'player');
    const willInfo = will ? `Testament enregistré : bénéficiaire ${will.beneficiary}.` : 'Aucun testament enregistré.';
    announce(`Commissariat ${poi.name}. ${willInfo} Appuyez sur T pour déclarer un testament. Vous pouvez payer vos PV ici. Ouvrez le menu Rôle pour demander un métier.`, 'polite');
  }
};
Game.registerAtStation = function() {
  const p = this.player;
  p.registered = true;
  const genre = p.gender === 'femme' ? 'Enregistrement de Madame' : 'Enregistrement de Monsieur';
  announce(`${genre} ${p.firstName} ${p.lastName} au commissariat : identité vérifiée, empreintes et photo prises, dossier ouvert. Vous pouvez maintenant demander un métier dans le menu Rôle.`, 'assertive');
  updateHud();
};
Game.declareWillAtStation = function(beneficiary) {
  if (!beneficiary) {
    const near = City.pois.find(p => UTIL.dist(p, this) < 3 && p.type === 'police');
    if (!near) return announce('Rendez-vous au commissariat pour déclarer un testament.', 'assertive');
    AccessibleTextPrompt.open('Testament', 'Nom du bénéficiaire ?', '', (b) => {
      if (!b) return;
      Police.registerWill('player', b);
      this.will = { beneficiary: b, time: Date.now() };
    });
    return;
  }
  Police.registerWill('player', beneficiary);
  this.will = { beneficiary, time: Date.now() };
};
Game.payTickets = function() {
  if (!Game.tickets.length) return announce('Aucun PV à payer.', 'polite');
  const total = Game.tickets.reduce((a, t) => a + t.amount, 0);
  if (this.money < total) return announce(`PV total : ${UTIL.formatMoney(total)}. Fonds insuffisants.`, 'assertive');
  this.money -= total;
  const paidIds = new Set(this.tickets.map(t => t.id));
  const now = Date.now();
  this.finesHistory.forEach(f => { if (f.type === 'pv' && paidIds.has(f.id)) { f.paid = true; f.paidAt = now; } });
  this.tickets = [];
  announce(`PV payés : ${UTIL.formatMoney(total)}.`, 'assertive');
};
Game.refuelVehicle = function(poi) {
  if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule pour faire le plein ou recharger.', 'assertive');
  const cls = VEHICLE_CATALOG[this.vehicle.type];
  if (cls.human) return announce('Un vélo n\'a pas de moteur : pas besoin d\'essence.', 'polite');
  if (cls.electric) {
    const missing = 1 - this.vehicle.fuel;
    if (missing <= 0.01) return announce('Batterie déjà chargée à 100%.', 'polite');
    const cost = Math.floor(missing * 22000);
    if (this.money < cost) return announce(`Recharge électrique à la borne : ${UTIL.formatMoney(cost)} pour une charge complète.`, 'assertive');
    this.money -= cost; this.vehicle.fuel = 1;
    announce(`Recharge électrique terminée à la borne de ${poi.name} pour ${UTIL.formatMoney(cost)}. Batterie à 100%.`, 'assertive'); Audio.cash();
    return;
  }
  const cost = Math.floor((1 - this.vehicle.fuel) * 50000);
  if (this.money < cost) return announce(`Plein : ${UTIL.formatMoney(cost)}.`, 'assertive');
  this.money -= cost; this.vehicle.fuel = 1;
  announce(`Plein effectué à ${poi.name} pour ${UTIL.formatMoney(cost)}.`, 'assertive'); Audio.cash();
};
Game.openPrison = function(poi) {
  const vehicles = City.vehicles.filter(v => v.type === 'police' && UTIL.dist(v, poi) < 20).map(v => v.name).join(', ');
  announce(`Prison ${poi.name}. Véhicules de police à proximité : ${vehicles || 'aucun'}. Menu : G pour garer, E pour embarquer un détenu.`, 'polite');
};
const SIREN_SOUNDS = { police: 'sirene_vehicule_police', moto_police: 'sirene_moto_police', ambulance: 'sirene_vehicule_hopital' };
Game.toggleSiren = function() {
  if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule.', 'assertive');
  const sirenKey = SIREN_SOUNDS[this.vehicle.type];
  if (!sirenKey) return announce('Sirène réservée aux véhicules de police et de l\'hôpital.', 'assertive');
  this.vehicle.siren = !this.vehicle.siren;
  announce(this.vehicle.siren ? 'Sirène activée. Priorité de passage.' : 'Sirène désactivée.', 'assertive');
  if (this.vehicle.siren) AudioLib.playLoop(sirenKey, 0.7);
  else AudioLib.stopLoop(sirenKey);
};
Game.callTaxi = function() {
  if (this.pendingTaxi) return announce('Un taxi est déjà en route.', 'assertive');
  if (this.inVehicle) return announce('Descendez d\'abord de votre véhicule.', 'assertive');
  const fare = 2000;
  if (this.money < fare) return announce(`Un taxi coûte ${UTIL.formatMoney(fare)} pour la course. Fonds insuffisants.`, 'assertive');
  this.money -= fare;
  this.pendingTaxi = true;
  announce(`Taxi appelé. ${UTIL.formatMoney(fare)} débités. Il arrive dans quelques instants.`, 'assertive');
  setTimeout(() => {
    this.pendingTaxi = false;
    const nv = { id: 'taxi_' + Date.now(), type: 'taxi', name: 'Taxi', x: this.x + (UTIL.chance(0.5) ? 1 : -1), y: this.y + (UTIL.chance(0.5) ? 1 : -1), fuel: 1, hp: 100, locked: false, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG.taxi.trunk };
    City.vehicles.push(nv);
    announce('Votre taxi est arrivé et vous attend juste à côté. Montez et dites un lieu pour la conduite automatique.', 'assertive');
    AudioLib.playNotification();
  }, UTIL.randInt(10000, 18000));
};
// Appeler un VRAI chauffeur (joueur réel avec le métier chauffeur professionnel),
// plutôt que le taxi PNJ automatique ci-dessus.
Game.callRealTaxiDriver = function() {
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  Net.send({ type: 'taxi_request', x: this.x, y: this.y });
  announce('Demande de taxi envoyée aux chauffeurs réels connectés. Quelqu\'un vous contactera s\'il accepte la course.', 'assertive');
};
Game.honk = function() {
  if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule pour klaxonner.', 'assertive');
  const cls = VEHICLE_CATALOG[this.vehicle.type];
  let key = 'klaxon_voiture';
  if (cls && cls.human) key = 'velo_clochette'; // vélo : sonnette d'avertissement
  else if (cls && cls.type === '2 roues') key = 'klaxon_moto';
  else if (cls && cls.type === 'poids lourd') key = 'klaxon_camion';
  else if (cls && cls.type === 'air') return announce('Pas de klaxon en vol.', 'polite');
  else if (cls && cls.price >= 8000000) key = 'klaxon_luxe'; // véhicule haut de gamme : klaxon distinctif
  AudioLib.playOnce(key);
  if (Net.connected) Net.emitSound(key, { vol: 0.8 }); // klaxon / sonnette audible par les joueurs proches
};
Game.searchSelf = function() {
  if (!this.inventory.length) return announce('Vos poches sont vides.', 'polite');
  const items = this.inventory.map(i => `${i.q || 1} ${i.name}`).join(', ');
  const vol = this.inventoryVolume(), cap = this.inventoryCapacity();
  announce(`Vos poches : ${items}. Volume ${vol.toFixed(1)} / ${cap}.`, 'polite');
};

// Identifier le propriétaire d'un véhicule (le sien, ou le plus proche à
// portée) : utile pour contrôler un stationnement suspect ou un véhicule
// impliqué dans un délit.
Game.lookupVehicleOwner = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  const v = (this.inVehicle && this.vehicle) || City.vehicles.filter(vv => UTIL.dist(vv, this) < 6).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
  if (!v) return announce('Aucun véhicule à proximité à identifier.', 'assertive');
  if (!v.owner) return announce(`${v.name} : aucun propriétaire enregistré (véhicule public, PNJ, ou volé).`, 'assertive');
  const label = v.ownerName || (this.ownedVehicles.includes(v.id) ? `${this.player.firstName} ${this.player.lastName}` : 'identité non communiquée');
  announce(`${v.name} appartient à : ${label}.`, 'assertive');
};
Game.openPoliceMenu = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  el('menuTitle').textContent = 'Menu police';
  const items = [
    { id: 'hierarchy', title: '🎖️ Hiérarchie policière', desc: 'Voir votre grade, ou promouvoir un policier proche si vous êtes chef.' },
    { id: 'ticket', title: '📝 Donner un PV', desc: 'À votre cible verrouillée, ou un joueur réel proche.' },
    { id: 'negotiations', title: `⚖️ Négociations en attente${this.pendingNegotiations.length ? ' (' + this.pendingNegotiations.length + ')' : ''}`, desc: 'Décider, après en avoir vraiment discuté à la voix avec l\'avocat.' },
    { id: 'cameras', title: '📹 Caméras de surveillance', desc: 'Lister les caméras les plus proches et leur distance.' },
    { id: 'goto_alert', title: '🚨 Se rendre à la dernière alerte', desc: this.lastCrimeAlert ? `${this.lastCrimeAlert.name}, guidage GPS.` : 'Aucune alerte reçue pour l\'instant.' },
    { id: 'impound', title: '🚛 Mettre en fourrière', desc: 'Un véhicule non-possédé à proximité (8 cases).' },
    { id: 'vehicle_owner', title: '🔎 Propriétaire d\'un véhicule', desc: 'Identifier le propriétaire du véhicule où vous êtes, ou le plus proche.' },
    { id: 'vehicle_search', title: '🚓 Fouiller un véhicule', desc: 'Le véhicule déverrouillé le plus proche : voir et saisir le contenu du coffre.' },
    { id: 'criminal_record', title: '📁 Consulter un casier judiciaire', desc: 'Demande au joueur réel le plus proche (5 cases) : délits, récidive, peines purgées.' },
    { id: 'tank', title: '🪖 Réquisitionner un char d\'assaut', desc: 'Très cher, un seul à la fois.' },
    { id: 'invoice', title: '🧾 Facturer un client', desc: 'Envoyer une facture (frais divers) à un joueur réel proche.' },
    { id: 'cell', title: '🔒 Mettre en cellule / Libérer', desc: 'Cible verrouillée, menottée ou neutralisée — uniquement dans les cellules du commissariat.' },
    { id: 'reminder', title: 'ℹ️ Rappel des raccourcis', desc: 'Ctrl+F fouiller, Ctrl+S sirène, Maj+T testament, Ctrl+Alt+T char.' },
  ];
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    if (sel.id === 'hierarchy') Game.openPoliceHierarchyMenu();
    else if (sel.id === 'ticket') Game.openIssueTicketMenu();
    else if (sel.id === 'negotiations') Game.openPendingNegotiationsMenu();
    else if (sel.id === 'cameras') { closeMenu(); Game.cameraControl(); }
    else if (sel.id === 'goto_alert') { closeMenu(); Game.goToLastCrimeAlert(); }
    else if (sel.id === 'impound') { closeMenu(); Game.impoundVehicle(); }
    else if (sel.id === 'vehicle_owner') { closeMenu(); Game.lookupVehicleOwner(); }
    else if (sel.id === 'vehicle_search') { closeMenu(); Game.searchVehicle(); }
    else if (sel.id === 'criminal_record') { closeMenu(); Game.lookupPlayerCriminalRecord(); }
    else if (sel.id === 'tank') { closeMenu(); Game.requisitionTank(); }
    else if (sel.id === 'invoice') Game.openInvoiceMenu();
    else if (sel.id === 'cell') { closeMenu(); Game.toggleJail(); }
    else if (sel.id === 'reminder') { closeMenu(); announce('Ctrl+F pour fouiller une cible, Ctrl+S pour la sirène, Maj+T ou F12 pour le testament, Ctrl+Alt+T pour réquisitionner un char.', 'polite'); }
  });
};
// Le policier choisit ici, une fois qu'il a VRAIMENT discuté à la voix avec
// l'avocat, s'il accorde ou non la négociation pour ce client précis.
Game.openPendingNegotiationsMenu = function() {
  if (!this.pendingNegotiations.length) return announce('Aucune négociation en attente.', 'polite');
  el('menuTitle').textContent = 'Négociations en attente';
  const items = this.pendingNegotiations.map((n, i) => ({ id: String(i), title: `${n.clientName} (plaidé par ${n.lawyerName})`, desc: '' }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    const idx = parseInt(sel.id, 10);
    const nego = this.pendingNegotiations[idx];
    el('menuTitle').textContent = `Décision pour ${nego.clientName}`;
    const decisionItems = [
      { id: 'accept', title: '✅ Accorder la négociation', desc: `Annule le PV le plus récent de ${nego.clientName}.` },
      { id: 'reject', title: '❌ Refuser', desc: '' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(decisionItems, (sub) => {
      closeMenu();
      const accepted = sub.id === 'accept';
      Net.send({ type: 'legal_negotiation_result', targetId: nego.lawyerId, accepted, isClient: false });
      Net.send({ type: 'legal_negotiation_result', targetId: nego.clientId, accepted, isClient: true });
      announce(accepted ? `Vous accordez la négociation pour ${nego.clientName}.` : `Vous refusez la négociation pour ${nego.clientName}.`, 'assertive');
      this.pendingNegotiations.splice(idx, 1);
    });
  });
};
Game.openIssueTicketMenu = function() {
  const target = this.getLiveTarget() || this.findNearbyRealPlayer();
  if (!target) return announce('Aucune cible verrouillée ni joueur réel proche.', 'assertive');
  closeMenu();
  AccessibleTextPrompt.open('Montant du PV', 'Montant en FCFA.', '', (amountStr) => {
    const amount = parseInt(amountStr, 10);
    if (!amount) return announce('Montant invalide.', 'assertive');
    AccessibleTextPrompt.open('Motif', 'Raison du PV (excès de vitesse, stationnement gênant...).', '', (reason) => {
      Police.issueTicket({ ...target, name: this.lockedTarget?.name || target.name }, amount, reason || 'infraction');
    });
  });
};
// Hiérarchie policière : chaque policier a un grade (agent par défaut à
// l'embauche). Seul un chef de la police (ou le staff) peut promouvoir un
// autre policier réel à proximité — jamais soi-même.
Game.openPoliceHierarchyMenu = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  const myRank = POLICE_RANKS[this.policeRank || 'agent'];
  el('menuTitle').textContent = 'Hiérarchie policière';
  const items = [{ id: 'mine', title: `🎖️ Mon grade : ${myRank.name}`, desc: '' }];
  const canPromote = (this.policeRank === 'chef') || (typeof StaffMode !== 'undefined' && StaffMode.active);
  if (canPromote) items.push({ id: 'promote', title: '⬆️ Promouvoir un policier proche', desc: 'Choisir un policier réel à proximité et lui donner un nouveau grade.' });
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    if (sel.id === 'mine') { closeMenu(); announce(`Votre grade : ${myRank.name}.`, 'polite'); }
    else if (sel.id === 'promote') Game.pickOfficerToPromote();
  });
};
Game.pickOfficerToPromote = function() {
  const officers = Array.from(Net.remotePlayers.values()).filter(p => p.role === 'police' && p.id !== Net.id);
  if (!officers.length) return announce('Aucun autre policier réel à proximité ou connu.', 'assertive');
  el('menuTitle').textContent = 'Promouvoir un policier';
  const items = officers.map(p => ({ id: p.id, title: `${p.firstName} ${p.lastName}`, desc: `Grade actuel : ${POLICE_RANKS[p.policeRank || 'agent'].name}.` }));
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    const officer = officers.find(o => o.id === sel.id);
    el('menuTitle').textContent = `Nouveau grade pour ${officer.firstName} ${officer.lastName}`;
    const rankItems = POLICE_RANK_ORDER.map(r => ({ id: r, title: POLICE_RANKS[r].name, desc: '' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(rankItems, (rankSel) => {
      closeMenu();
      if (!Net.connected) return;
      Net.send({ type: 'promote_police', targetId: officer.id, rank: rankSel.id });
      announce(`${officer.firstName} ${officer.lastName} nommé(e) ${POLICE_RANKS[rankSel.id].name}.`, 'assertive');
    });
  });
};
// Réquisition d'un char d'assaut par la police : très cher (budget), et
// seulement un exemplaire à la fois par joueur policier. Apparaît au poste
// de police le plus proche.
Game.requisitionTank = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  if (this.ownedVehicles.some(id => City.vehicles.find(v => v.id === id)?.type === 'char')) {
    return announce('Vous avez déjà un char d\'assaut réquisitionné.', 'assertive');
  }
  const price = VEHICLE_CATALOG.char.price;
  AccessibleConfirm.open('Réquisitionner un char d\'assaut', `Coût budgétaire : ${UTIL.formatMoney(price)}. Confirmer la réquisition ?`, (confirmed) => {
    if (!confirmed) return;
    if (this.money < price) return announce('Fonds insuffisants pour cette réquisition.', 'assertive');
    const station = City.pois.find(p => p.type === 'police' && UTIL.dist(p, this) < 60) || City.pois.find(p => p.type === 'police');
    if (!station) return announce('Aucun poste de police trouvé.', 'assertive');
    this.money -= price;
    const vid = 'char_' + Date.now();
    const cls = VEHICLE_CATALOG.char;
    City.vehicles.push({ id: vid, type: 'char', name: cls.name, x: station.x + 2, y: station.y + 2, fuel: 1, hp: 100, locked: false, owner: 'player', inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: cls.price, trunk: cls.trunk, passengers: [], openDoors: new Set() });
    this.ownedVehicles.push(vid);
    announce(`Char d'assaut réquisitionné, livré au poste de police le plus proche.`, 'assertive');
    updateHud();
  });
};

// Menu de contrôle du lecteur de musique personnelle, partagé par tous les
// points d'accès (téléphone, enceinte/télé chez soi, autoradio, radio
// portable) — seul le "label" affiché change, les contrôles sont les mêmes.
Game.openMusicMenu = function(label) {
  const lastName = MusicPlayer.lastKnownName();
  el('menuTitle').textContent = `Musique${label ? ' — ' + label : ''}`;
  const items = [{ id: 'pick', title: '📂 Choisir un fichier audio', desc: 'Ouvre le sélecteur de fichiers de votre ordinateur.' }];
  if (!MusicPlayer.fileName && lastName) {
    items.push({ id: 'resume', title: `🔄 Reprendre « ${lastName} »`, desc: MusicPlayer.supported ? 'Redonne accès au même fichier (une autorisation peut être redemandée).' : 'Non mémorisé sur ce navigateur : il faudra le rechercher à nouveau.' });
  }
  if (MusicPlayer.fileName) {
    items.push({ id: 'toggle', title: MusicPlayer.playing ? '⏸️ Mettre en pause' : '▶️ Lire', desc: `Fichier actuel : ${MusicPlayer.fileName}.` });
    items.push({ id: 'stop', title: '⏹️ Arrêter', desc: 'Revient au début du morceau.' });
    items.push({ id: 'volup', title: '🔊 Volume plus fort', desc: `Actuellement ${Math.round(MusicPlayer.volume * 100)}%.` });
    items.push({ id: 'voldown', title: '🔉 Volume plus faible', desc: `Actuellement ${Math.round(MusicPlayer.volume * 100)}%.` });
  }
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    if (sel.id === 'pick') {
      closeMenu();
      MusicPlayer.pickFile().then((ok) => { if (ok) { MusicPlayer.play(); announce(`${MusicPlayer.fileName} chargé${label ? ' sur ' + label : ''}.`, 'assertive'); } });
    } else if (sel.id === 'resume') {
      closeMenu();
      MusicPlayer.resumeLastFile().then((ok) => {
        if (ok) { MusicPlayer.play(); announce(`${MusicPlayer.fileName} repris${label ? ' sur ' + label : ''}.`, 'assertive'); }
        else announce('Impossible de reprendre ce fichier. Choisissez-le à nouveau.', 'assertive');
      });
    } else if (sel.id === 'toggle') {
      closeMenu();
      announce(MusicPlayer.toggle() ? 'Lecture.' : 'Pause.', 'polite');
    } else if (sel.id === 'stop') {
      closeMenu(); MusicPlayer.stop(); announce('Musique arrêtée.', 'polite');
    } else if (sel.id === 'volup') {
      MusicPlayer.setVolume(MusicPlayer.volume + 0.1); Game.openMusicMenu(label);
    } else if (sel.id === 'voldown') {
      MusicPlayer.setVolume(MusicPlayer.volume - 0.1); Game.openMusicMenu(label);
    }
  });
};
// Fouille policière d'un véhicule : réservée à la police, et seulement si le
// véhicule est déverrouillé (sinon il faut d'abord le faire ouvrir par son
// propriétaire, ou le forcer comme n'importe qui — voir enterAsDriver).
Game.searchVehicle = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  const v = City.vehicles.filter(vv => UTIL.dist(vv, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
  if (!v) return announce('Aucun véhicule à proximité à fouiller.', 'assertive');
  if (v.locked) return announce(`${v.name} est verrouillé : impossible de le fouiller sans l'ouvrir d'abord (consentement du propriétaire, ou forcer la portière).`, 'assertive');
  openVehicleSearchMenu(v);
};
function openVehicleSearchMenu(v) {
  const ownerLabel = v.ownerName || (v.owner ? 'propriétaire non identifié' : 'aucun propriétaire enregistré');
  el('menuTitle').textContent = `Fouille de ${v.name}`;
  const inv = v.inventory || [];
  const items = inv.map((it, i) => ({ id: 'item_' + i, title: `${it.legal === false ? '☣️ ' : ''}${it.name} (${it.q || 1})`, desc: it.legal === false ? 'Objet illégal — choisir la quantité à saisir.' : 'Choisir la quantité à saisir.' }));
  if (!items.length) items.push({ id: 'empty', title: 'Rien trouvé', desc: `Coffre vide. Propriétaire : ${ownerLabel}.` });
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, (sel) => {
    if (sel.id === 'empty') { closeMenu(); return; }
    const idx = parseInt(sel.id.replace('item_', ''), 10);
    const it = inv[idx];
    closeMenu();
    QtyPicker.open(`${it.name} à saisir`, it.q || 1, (n) => {
      it.q -= n; if (it.q <= 0) v.inventory = v.inventory.filter(i => i !== it);
      Game.addItem({ ...it, q: n });
      const illegal = it.legal === false;
      announce(`Vous saisissez ${n} ${it.name}${illegal ? ', objet illégal' : ''} dans ${v.name}.`, 'assertive');
      if (illegal) RPJournal.log('Police', `Saisie lors de la fouille de ${v.name} (${ownerLabel}) : ${n} ${it.name}.`, 'alert');
      updateHud();
    });
  });
}
// Résumé du casier judiciaire (délits par type + récidive + temps purgé),
// envoyé à un policier qui consulte à distance, ou affiché à soi-même.
Game.summarizeCriminalRecord = function() {
  const record = this.criminalRecord || [];
  const crimes = record.filter(r => r.kind !== 'incarceration');
  const counts = {};
  crimes.forEach(r => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
  const incarcerations = record.filter(r => r.kind === 'incarceration');
  return {
    playerName: `${this.player.firstName} ${this.player.lastName}`,
    totalCrimes: crimes.length,
    byType: Object.entries(counts).map(([kind, count]) => ({ kind, label: CRIME_LABELS[kind] || kind, count })),
    incarcerationsCount: incarcerations.length,
    totalJailMs: incarcerations.reduce((s, r) => s + (r.durationMs || 0), 0),
    wanted: Math.round(this.wanted || 0),
  };
};
Game._pendingRecordLookup = null;
Game.showCriminalRecord = function(fromId, data) {
  const pending = this._pendingRecordLookup;
  const name = (pending && fromId && pending.targetId === fromId) ? pending.targetName : data.playerName;
  this._pendingRecordLookup = null;
  el('menuTitle').textContent = `Casier judiciaire — ${name}`;
  const items = [
    { id: 'total', title: `📋 ${data.totalCrimes} délit(s) signalé(s)`, desc: data.totalCrimes ? 'Détail par type ci-dessous.' : 'Aucun délit enregistré.' },
  ];
  data.byType.forEach(t => items.push({ id: 'type_' + t.kind, title: `${t.label} : ${t.count}×`, desc: t.count > 1 ? 'Récidive.' : 'Premier signalement.' }));
  items.push({ id: 'jail', title: `🔒 ${data.incarcerationsCount} incarcération(s)`, desc: data.totalJailMs ? `Temps total purgé : ${Math.round(data.totalJailMs / 60000)} minute(s).` : 'Jamais incarcéré(e).' });
  items.push({ id: 'wanted', title: `🚨 Niveau de recherche actuel : ${data.wanted}%`, desc: '' });
  el('menuOverlay').style.display = 'flex';
  renderMenu(items, () => closeMenu());
};
// Consultation de son propre casier (téléphone).
Game.openCriminalRecord = function() {
  const data = this.summarizeCriminalRecord();
  data.playerName = 'vous-même';
  this.showCriminalRecord(null, data);
};
// Contrôle policier : demande le casier d'un joueur réel proche.
Game.lookupPlayerCriminalRecord = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  if (!Net.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
  const nearby = Array.from(Net.remotePlayers.entries()).map(([pid, p]) => ({ id: pid, p, d: UTIL.dist(p, this) })).filter(x => x.d < 5).sort((a, b) => a.d - b.d)[0];
  if (!nearby) return announce('Aucun joueur réel à proximité à contrôler.', 'assertive');
  this._pendingRecordLookup = { targetId: nearby.id, targetName: `${nearby.p.firstName} ${nearby.p.lastName}` };
  Net.send({ type: 'criminal_record_request', targetId: nearby.id });
  announce(`Demande de consultation du casier envoyée à ${nearby.p.firstName} ${nearby.p.lastName}...`, 'polite');
};
Game.searchTarget = function() {
  const lockedLive = this.lockedTarget && !this.lockedTarget.isPlayer ? this.getLiveTarget() : null;
  const npcTarget = lockedLive || City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < 3).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0]
    || City.npcs.filter(n => (n.dead || n.knockedOut) && UTIL.dist(n, this) < 3).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
  const nearbyHandsUpPlayer = Net.connected && Array.from(Net.remotePlayers.values()).some(p => p.handsUp && UTIL.dist(p, this) < 3);
  if (!npcTarget && nearbyHandsUpPlayer) return searchNearbyPlayer();
  if (!npcTarget) return announce('Aucune cible à proximité.', 'assertive');
  if (UTIL.dist(npcTarget, this) > 3) return announce('Trop loin pour fouiller. Approchez-vous.', 'assertive');
  const eligible = npcTarget.dead || npcTarget.knockedOut || npcTarget.menotte || Roles.hasPerm('cni');
  if (!eligible) return announce('La cible doit être inconsciente, menottée, ou vous devez être policier.', 'assertive');
  openSearchMenu(npcTarget);
};
function openSearchMenu(target) {
  el('menuTitle').textContent = `Fouille de ${target.name}`;
  const items = [];
  const money = target.money || 0;
  if (money > 0) items.push({ id: 'money', title: `💰 Argent : ${UTIL.formatMoney(money)}`, desc: 'Choisir le montant à prendre.' });
  (target.inventory || []).forEach((it, i) => {
    items.push({ id: 'item_' + i, title: `${it.name} (${it.q || 1})`, desc: 'Choisir la quantité à prendre.' });
  });
  if (!items.length) items.push({ id: 'empty', title: 'Rien à prendre', desc: `${target.name} n'a ni argent ni objet sur lui.` });
  renderMenu(items, (sel) => {
    if (sel.id === 'empty') { closeMenu(); return; }
    if (sel.id === 'money') {
      closeMenu();
      QtyPicker.open('Argent à prendre', money, (n) => {
        if (target.remotePlayerId) Net.send({ type: 'loot_take', targetId: target.remotePlayerId, data: { kind: 'money', amount: n } });
        else target.money -= n;
        Game.money += n;
        announce(`Vous prenez ${UTIL.formatMoney(n)} sur ${target.name}.`, 'assertive');
      });
    } else {
      const idx = parseInt(sel.id.replace('item_', ''), 10);
      const it = target.inventory[idx];
      closeMenu();
      QtyPicker.open(`${it.name} à prendre`, it.q || 1, (n) => {
        if (target.remotePlayerId) Net.send({ type: 'loot_take', targetId: target.remotePlayerId, data: { kind: 'item', itemId: it.id, amount: n } });
        else { it.q -= n; if (it.q <= 0) target.inventory.splice(idx, 1); }
        Game.addItem({ ...it, q: n });
        announce(`Vous prenez ${n} ${it.name}.`, 'assertive');
      });
    }
  });
}

// Patch startGame to include new setup and intervals
const originalStartGame = startGame;
startGame = function(seed) {
  try { originalStartGame(seed); } catch (e) { console.error('startGame() a échoué :', e); }
  try { setupExtraInput(); } catch (e) { console.error('setupExtraInput() a échoué :', e); }
  setInterval(npcTick, 2000);
  setInterval(() => Phone.updateClock(), 30000);
  // Accès propriétaire : priorités totales du staff sans code, dès que
  // l'identité (compte ou nom de personnage) est connue.
  try { if (typeof OwnerAccess !== 'undefined') OwnerAccess.watch(); } catch (e) { console.error('OwnerAccess a échoué :', e); }
};

// Expose Phone and Computer for debugging
window.Phone = Phone; window.Computer = Computer; window.Roles = Roles;

// Expose Game and City for console debugging
window.Game = Game; window.City = City;

/* ============================================================
   DÉMARRAGE FIABLE (fix bug bouton "Entrer dans la cité" sur mobile)
   L'ancien code attachait le clic du bouton à l'intérieur de setupInput(),
   qui n'était lui-même appelé QUE depuis startGame() : le bouton ne
   déclenchait donc jamais le tout premier lancement (surtout visible sur
   smartphone où il n'y a pas d'autre moyen d'entrer dans la ville).
   On attache maintenant le clic dès que la page est chargée, en récupérant
   au passage le prénom, le nom et le sexe du personnage créé.
============================================================ */
let gameHasStarted = false;
function onStartButtonPressed() {
  if (gameHasStarted) return; // évite un double démarrage (double-tap tactile)
  gameHasStarted = true;
  SpeechFix.unlock(); // débloque explicitement le son et la voix dès ce geste utilisateur
  const firstNameField = el('charFirstName');
  const lastNameField = el('charLastName');
  const genderField = document.querySelector('input[name="charGender"]:checked');
  Game.player.firstName = (firstNameField && firstNameField.value.trim()) || 'Joueur';
  Game.player.lastName = (lastNameField && lastNameField.value.trim()) || 'Anonyme';
  Game.player.gender = genderField ? genderField.value : 'homme';
  // Adresse du serveur : en mode "jouer seul", on vide le champ pour forcer le
  // jeu hors ligne ; sinon on la remplit automatiquement (multijoueur).
  if (wizardPath === 'solo') { const sf = el('charServerUrl'); if (sf) sf.value = ''; }
  else autofillServerUrl();

  // Tout le reste du démarrage (connexion serveur, annonces, entrée en jeu) est
  // regroupé ici afin de pouvoir, à la toute première création de compte,
  // ATTENDRE la fin du son "Bienvenue à Blind City" avant de l'enchaîner —
  // sinon les annonces vocales et la musique d'intro le couperaient en plein
  // milieu (c'était le bug : le son ne jouait pas jusqu'au bout).
  const continueStart = () => {
  const serverUrl = (el('charServerUrl')?.value || '').trim();
  const accountAction = document.querySelector('input[name="accountAction"]:checked')?.value || 'login';
  const accountUsername = (el('accountUsername')?.value || '').trim();
  const accountPassword = el('accountPassword')?.value || '';

  function abortToRetry(message) {
    gameHasStarted = false;
    el('accountStatusOverlay').style.display = 'none';
    announce(message, 'assertive');
  }

  // Un compte est désormais obligatoire dès qu'un serveur est renseigné :
  // pas de "jouer sans compte" possible dans ce cas. Sans adresse de
  // serveur, la section compte est simplement ignorée (jeu solo classique).
  if (serverUrl) {
    if (!accountUsername || !accountPassword) return abortToRetry('Identifiant et mot de passe requis pour rejoindre ce serveur.');
    el('accountStatusOverlay').style.display = 'flex';
    el('accountStatusText').textContent = 'Connexion au serveur en cours...';
    announce('Connexion au serveur pour votre compte...', 'assertive');
    Net.connect(serverUrl,
      (seed) => {
        el('accountStatusText').textContent = accountAction === 'register' ? 'Création du compte...' : 'Connexion au compte...';
        announce(el('accountStatusText').textContent, 'polite');
        const onResult = (msg) => {
          if (!msg.ok) return abortToRetry(msg.reason || 'Échec du compte.');
          if (msg.pending) {
            el('accountStatusOverlay').style.display = 'none';
            gameHasStarted = false;
            announce(`Compte ${msg.username} créé, mais en attente de validation par l'administrateur (réponses insuffisantes à l'entretien RP). Réessayez de vous connecter plus tard.`, 'assertive');
            return;
          }
          el('accountStatusOverlay').style.display = 'none';
          if (msg.saveData) {
            Game._pendingAccountSaveData = msg.saveData;
            announce(`Compte ${msg.username} connecté. Progression retrouvée.`, 'assertive');
          } else {
            announce(`Compte ${msg.username} ${accountAction === 'register' ? 'créé' : 'connecté'}. Nouveau personnage.`, 'assertive');
          }
          startGame(seed);
        };
        if (accountAction === 'register') {
          const securityQuestion = el('securityQuestion')?.value || '';
          const securityAnswer = (el('securityAnswer')?.value || '').trim();
          if (!securityAnswer) return abortToRetry('Répondez à la question de sécurité pour pouvoir récupérer votre compte plus tard.');
          const realFirstName = (el('realFirstName')?.value || '').trim();
          const realLastName = (el('realLastName')?.value || '').trim();
          if (!realFirstName || !realLastName) return abortToRetry('Votre vrai prénom et nom sont requis pour créer un compte.');
          const rpAnswers = {
            q1: document.querySelector('input[name="rpQ1"]:checked')?.value,
            q2: document.querySelector('input[name="rpQ2"]:checked')?.value,
            q3: document.querySelector('input[name="rpQ3"]:checked')?.value,
            q4: document.querySelector('input[name="rpQ4"]:checked')?.value,
            q5: document.querySelector('input[name="rpQ5"]:checked')?.value,
          };
          if (Object.values(rpAnswers).some(v => v === undefined)) return abortToRetry('Répondez aux 5 questions de l\'entretien RP.');
          const correct = { q1: '1', q2: '1', q3: '1', q4: '1', q5: '0' };
          const rpScore = Object.keys(correct).filter(k => rpAnswers[k] === correct[k]).length;
          Net.register({
            username: accountUsername, password: accountPassword, securityQuestion, securityAnswer,
            realFirstName, realLastName, rpScore, rpTotal: 5,
          }, onResult);
        }
        else Net.login(accountUsername, accountPassword, onResult);
      },
      () => abortToRetry('Connexion au serveur impossible : vérifiez l\'adresse du serveur.')
    );
    return;
  }

  startGame();
  };

  // Première création de compte sur cet appareil : on joue "Bienvenue à Blind
  // City" EN ENTIER, puis on enchaîne le reste. Les fois suivantes : direct.
  const firstTime = !localStorage.getItem('blind_city_account_created') && !localStorage.getItem('city_blind_account_created');
  if (firstTime) {
    localStorage.setItem('blind_city_account_created', '1');
    const welcome = AudioLib.playOnce('sfx_bienvenue');
    if (welcome) {
      let proceeded = false;
      const go = () => { if (proceeded) return; proceeded = true; continueStart(); };
      welcome.addEventListener('ended', go, { once: true });
      welcome.addEventListener('error', go, { once: true });
      // Filet de sécurité si l'évènement 'ended' ne se déclenche pas selon le
      // navigateur : on continue après la durée du clip (+ marge), ou 12 s.
      const armFallback = () => setTimeout(go, ((welcome.duration && isFinite(welcome.duration)) ? welcome.duration * 1000 : 12000) + 1500);
      if (welcome.duration && isFinite(welcome.duration)) armFallback();
      else welcome.addEventListener('loadedmetadata', armFallback, { once: true });
      // Dernier filet : si le son ne démarre pas du tout, ne pas rester bloqué.
      setTimeout(go, 15000);
    } else {
      continueStart();
    }
  } else {
    continueStart();
  }
}

// Pré-remplit le champ "Serveur multijoueur" avec l'adresse depuis laquelle le
// jeu est servi (ex : wss://blind-city.onrender.com), pour que la personne
// n'ait rien à taper. Ne touche pas au champ s'il contient déjà une adresse (au
// cas où quelqu'un viserait un AUTRE serveur). Silencieux si ouvert en local
// (file://) ou en cas d'imprévu, pour ne jamais empêcher le démarrage du jeu.
function autofillServerUrl() {
  try {
    const serverField = el('charServerUrl');
    if (serverField && !serverField.value && location.protocol !== 'file:' && location.host) {
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      serverField.value = `${wsProtocol}//${location.host}`;
    }
  } catch (e) { /* ignore : le champ reste vide, comportement inchangé */ }
}
// Parcours choisi sur la première page de l'assistant : 'register' (créer un
// compte), 'login' (se connecter) ou 'solo' (jouer seul, hors ligne).
let wizardPath = 'login';

// Affiche une seule sous-page (étape) de l'assistant et cache les autres, puis
// place le focus sur son titre pour que le lecteur d'écran NATIF (VoiceOver,
// NVDA) l'annonce. IMPORTANT : sur ces écrans, le jeu NE parle PAS lui-même
// (pas de makeInputSpeakable ni de speak) pour ne pas se superposer au lecteur
// d'écran de la personne. Le jeu ne reprend la parole qu'une fois entré en jeu.
function showWizStep(id) {
  document.querySelectorAll('#startOverlay .wizard-step').forEach(s => { s.hidden = (s.id !== id); });
  const step = el(id);
  if (!step) return;
  const title = step.querySelector('.wiz-step-title');
  const first = step.querySelector('input:not([type=hidden]):not([hidden]), select, button');
  const target = title || first;
  if (target) { try { target.focus(); } catch (e) { /* ignore */ } }
}
function setAccountAction(action) {
  const radio = document.querySelector(`input[name="accountAction"][value="${action}"]`);
  if (radio) radio.checked = true;
}
// Prépare l'étape "identifiants", partagée entre création et connexion : le
// bouton principal et le retour changent selon le contexte.
function enterAccountStep(path) {
  const next = el('btnAccountNext');
  const back = el('btnAccountBack');
  const forgot = el('forgotPasswordBtn');
  if (path === 'login') {
    if (next) next.textContent = 'Se connecter et rejoindre 🌆';
    if (forgot) forgot.hidden = false;
    if (back) back.dataset.target = 'wizStepChoice';
  } else {
    if (next) next.textContent = 'Suivant ▶';
    if (forgot) forgot.hidden = true;
    if (back) back.dataset.target = 'wizStepIdentity';
  }
  showWizStep('wizStepAccount');
}
function bindStartButton() {
  autofillServerUrl();
  // Met en avant le bon jeu de commandes selon l'appareil : gestes tactiles sur
  // téléphone, raccourcis clavier sur ordinateur.
  try {
    if (typeof Platform !== 'undefined') {
      const hm = el('helpMobile'), hd = el('helpDesktop');
      if (Platform.isMobile) { if (hd) hd.style.display = 'none'; }
      else { if (hm) hm.style.display = 'none'; }
    }
  } catch (e) { /* ignore */ }
  // Un même utilitaire pour brancher clic + tape tactile (certains navigateurs
  // mobiles avalent le "click" après un tap rapide).
  const on = (id, fn) => {
    const b = el(id);
    if (!b) return;
    b.addEventListener('click', fn);
    b.addEventListener('touchend', (e) => { e.preventDefault(); fn(); }, { passive: false });
  };
  // Page d'accueil : choix du parcours.
  on('btnGoRegister', () => { wizardPath = 'register'; setAccountAction('register'); showWizStep('wizStepIdentity'); });
  on('btnGoLogin', () => { wizardPath = 'login'; setAccountAction('login'); enterAccountStep('login'); });
  on('btnGoSolo', () => { wizardPath = 'solo'; showWizStep('wizStepIdentity'); });
  on('btnGoHelp', () => showWizStep('wizStepHelp'));
  // Boutons "Retour" à cible fixe (attribut data-wiz-back).
  document.querySelectorAll('#startOverlay [data-wiz-back]').forEach(b => {
    const target = b.getAttribute('data-wiz-back');
    b.addEventListener('click', () => showWizStep(target));
    b.addEventListener('touchend', (e) => { e.preventDefault(); showWizStep(target); }, { passive: false });
  });
  // Retour de l'étape "identifiants" : cible variable selon le parcours.
  on('btnAccountBack', () => showWizStep(el('btnAccountBack')?.dataset.target || 'wizStepChoice'));
  // Enchaînements "Suivant".
  on('btnIdentityNext', () => { if (wizardPath === 'solo') showWizStep('wizStepSolo'); else enterAccountStep('register'); });
  on('btnAccountNext', () => { if (wizardPath === 'login') onStartButtonPressed(); else showWizStep('wizStepRecovery'); });
  on('btnRecoveryNext', () => showWizStep('wizStepRP'));
  on('btnRPNext', () => showWizStep('wizStepConfirm'));
  // Boutons "Rejoindre la ville".
  on('btnJoinRegister', onStartButtonPressed);
  on('btnJoinSolo', onStartButtonPressed);
  // Mot de passe oublié (dans l'étape identifiants, visible en mode connexion).
  const forgotBtn = el('forgotPasswordBtn');
  if (forgotBtn) forgotBtn.addEventListener('click', onForgotPasswordPressed);
}
function onForgotPasswordPressed() {
  SpeechFix.unlock();
  const serverUrl = (el('charServerUrl')?.value || '').trim();
  if (!serverUrl) return announce('Renseignez d\'abord l\'adresse du serveur pour récupérer un compte.', 'assertive');
  const proceed = () => {
    AccessibleTextPrompt.open('Mot de passe oublié', 'Quel est votre identifiant ?', el('accountUsername')?.value || '', (username) => {
      if (!username) return;
      announce('Recherche de votre question de sécurité...', 'polite');
      Net.getSecurityQuestion(username, (res) => {
        if (!res.ok) return announce(res.reason || 'Identifiant introuvable.', 'assertive');
        AccessibleTextPrompt.open('Question de sécurité', res.question, '', (answer) => {
          if (!answer) return;
          AccessibleTextPrompt.open('Nouveau mot de passe', 'Choisissez votre nouveau mot de passe (4 caractères minimum).', '', (newPassword) => {
            if (!newPassword) return;
            Net.resetPassword(username, answer, newPassword, (result) => {
              if (result.ok) announce('Mot de passe changé. Vous pouvez maintenant vous connecter avec le nouveau.', 'assertive');
              else announce(result.reason || 'Échec de la réinitialisation.', 'assertive');
            });
          });
        });
      });
    });
  };
  if (Net.connected) proceed();
  else {
    announce('Connexion au serveur...', 'polite');
    Net.connect(serverUrl, () => proceed(), () => announce('Connexion au serveur impossible.', 'assertive'));
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindStartButton);
} else {
  bindStartButton();
}

/* ============================================================
   NAVIGATION CLAVIER PRIORITAIRE (Windows / lecteurs d'écran)
   - Sélecteur de quantité ouvert : flèches Haut/Bas = ±1, Gauche/Droite = ±5,
     Entrée = valider, Échap = annuler.
   - Menu à cartes ouvert : flèches Haut/Bas déplacent la sélection (le même
     principe que pour la quantité), Entrée/Espace valident (déjà géré par
     carte), Échap ferme le menu.
   Cette écoute est posée en phase de capture avec stopImmediatePropagation
   pour éviter que le déplacement du personnage ne se déclenche en même temps.
============================================================ */
document.addEventListener('keydown', (e) => {
  if (QtyPicker.active) {
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); QtyPicker.change(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); QtyPicker.change(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); QtyPicker.change(5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); QtyPicker.change(-5); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); QtyPicker.confirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); QtyPicker.cancel(); }
    return;
  }
  const menuOverlayEl = el('menuOverlay');
  const menuOpen = menuOverlayEl && menuOverlayEl.style.display === 'flex';
  if (menuOpen && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Backspace'].includes(e.key)) {
    e.preventDefault(); e.stopImmediatePropagation();
    // Échap ou Retour arrière : remonter d'un niveau de menu (ferme au menu racine).
    if (e.key === 'Escape' || e.key === 'Backspace') { menuGoBack(); return; }
    const cards = Array.from(document.querySelectorAll('#menuContent .menu-card'));
    if (!cards.length) return;
    let idx = cards.indexOf(document.activeElement);
    if (idx === -1) idx = 0;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') idx = Math.min(cards.length - 1, idx + 1);
    else idx = Math.max(0, idx - 1);
    cards[idx].focus();
    const h4 = cards[idx].querySelector('h4')?.textContent || '';
    const p = cards[idx].querySelector('p')?.textContent || '';
    speak(p ? `${h4}. ${p}` : h4, 'interrupt');
  }
}, true);

/* ============================================================
   NAVIGATION TACTILE ACCESSIBLE DES MENUS À CARTES (mobile/Android)
   - Balayage rapide vers la DROITE = carte suivante
   - Balayage rapide vers la GAUCHE = carte précédente
     (convention standard des lecteurs d'écran tactiles : TalkBack/VoiceOver)
   - Simple tape sur une carte = lui donner le focus et l'annoncer
   - Double-tape sur une carte = la valider (équivalent d'un clic/Entrée)
   Réutilisable pour tout conteneur de cartes, pas seulement le menu
   principal : tous les sous-menus (armes, inventaire, véhicules,
   boutiques, missions...) passent par #menuContent via renderMenu(),
   donc un seul rattachement suffit à tous les couvrir.
============================================================ */
const AccessibleCardMenu = {
  SWIPE_MIN_DIST: 40,       // px minimum pour compter comme un balayage
  SWIPE_MAX_DURATION: 500,  // ms max pour que ce soit "rapide"
  DOUBLE_TAP_DELAY: 350,    // ms max entre deux tapes pour un double-tape
  // Libellé parlé d'une carte/bouton : on privilégie aria-label (description
  // complète, ex. « Me guider à pied vers la station-service, 200 mètres »),
  // sinon le titre h4 + le paragraphe, sinon le texte brut. Ainsi le même
  // système sert aussi bien les cartes du menu principal que les boutons des
  // listes du téléphone (lieux utiles, carte de la ville...).
  cardLabel(card) {
    const vl = card.dataset && card.dataset.voiceLabel;
    if (vl) return vl.trim();
    const aria = card.getAttribute && card.getAttribute('aria-label');
    if (aria) return aria.trim();
    const h4 = card.querySelector && card.querySelector('h4')?.textContent || '';
    const p = card.querySelector && card.querySelector('p')?.textContent || '';
    return (p ? `${h4}. ${p}` : (h4 || card.textContent || '')).trim();
  },
  attach(container, cardSelector) {
    cardSelector = cardSelector || '.menu-card';
    if (!container || container._a11ySwipeAttached) return;
    container._a11ySwipeAttached = true;
    let startX = 0, startY = 0, startTime = 0;
    let lastTapTime = 0, lastTapCard = null;
    let lastMovedCard = null; // dernière carte lue en glissant le doigt (exploration)
    const getCards = () => Array.from(container.querySelectorAll(cardSelector));
    const focusDelta = (delta) => {
      const cards = getCards();
      if (!cards.length) return;
      let idx = cards.indexOf(document.activeElement);
      idx = idx === -1 ? 0 : Math.max(0, Math.min(cards.length - 1, idx + delta));
      cards[idx].focus();
      speak(AccessibleCardMenu.cardLabel(cards[idx]), 'interrupt');
    };
    container.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      startX = t.clientX; startY = t.clientY; startTime = Date.now();
      lastMovedCard = null;
    }, { passive: true });
    // « Toucher pour explorer » (standard VoiceOver) : en glissant le doigt sur
    // le menu, on lit la carte située SOUS le doigt dès qu'elle change. Aucune
    // action n'est déclenchée — seule la lecture. La validation reste le
    // double-tap. Le balayage rapide horizontal (touchend) reste possible.
    container.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      const elem = document.elementFromPoint(t.clientX, t.clientY);
      const card = elem && elem.closest && elem.closest(cardSelector);
      if (card && card !== lastMovedCard && container.contains(card)) {
        lastMovedCard = card;
        card.focus();
        speak(AccessibleCardMenu.cardLabel(card), 'interrupt');
        lastTapTime = 0; lastTapCard = null; // un glissement annule un double-tap en cours
      }
    }, { passive: true });
    container.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - startX, dy = t.clientY - startY;
      const dt = Date.now() - startTime;
      if (Math.abs(dx) > AccessibleCardMenu.SWIPE_MIN_DIST && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < AccessibleCardMenu.SWIPE_MAX_DURATION) {
        // Balayage rapide horizontal : on déplace la sélection, on n'active rien
        e.preventDefault();
        focusDelta(dx > 0 ? 1 : -1);
        lastTapTime = 0; lastTapCard = null;
        return;
      }
      // Carte visée : celle sous le doigt, sinon (double-tap « n'importe où »)
      // la carte actuellement lue/focusée à l'intérieur de ce menu.
      let card = e.target.closest(cardSelector);
      if (!card) {
        const af = document.activeElement;
        if (af && af.matches && af.matches(cardSelector) && container.contains(af)) card = af;
      }
      if (!card) return;
      const now = Date.now();
      if (lastTapCard === card && (now - lastTapTime) < AccessibleCardMenu.DOUBLE_TAP_DELAY) {
        e.preventDefault();
        card.focus();
        card.click(); // déclenche le handler normal de la carte (validation)
        lastTapTime = 0; lastTapCard = null;
      } else {
        e.preventDefault();
        card.focus();
        speak(AccessibleCardMenu.cardLabel(card), 'interrupt');
        lastTapTime = now; lastTapCard = card;
      }
    }, { passive: false });
  },
};
window.AccessibleCardMenu = AccessibleCardMenu;
AccessibleCardMenu.attach(document.getElementById('menuContent'));

/* ============================================================
   NAVIGATION AUX FLÈCHES POUR LES ÉCRANS À BOUTONS (téléphone,
   ordinateur) — ces écrans ne sont pas construits avec le système de
   cartes du menu principal, donc ils avaient besoin de leur propre
   navigation : flèches haut/bas (ou gauche/droite) pour circuler d'un
   bouton/champ focusable à l'autre, Entrée/Espace pour activer (déjà
   géré nativement par le navigateur pour un <button> focus).
============================================================ */
function attachArrowFocusNav(container) {
  if (!container || container._arrowNavAttached) return;
  container._arrowNavAttached = true;
  const focusableSelector = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  container.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    // Ne pas voler les flèches à un champ de texte en cours de saisie (curseur, sélection de fréquence...)
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const items = Array.from(container.querySelectorAll(focusableSelector)).filter(el => el.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault(); e.stopPropagation();
    const curIdx = items.indexOf(document.activeElement);
    let next;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = items[(curIdx + 1 + items.length) % items.length];
    else next = items[(curIdx - 1 + items.length) % items.length];
    next.focus();
    // L'annonce est faite par announceFocusedControl (focusin), avec le rôle.
  });
}
attachArrowFocusNav(document.getElementById('phoneOverlay'));
attachArrowFocusNav(document.getElementById('computerOverlay'));
// Son de navigation propre à l'ordinateur du jeu (K) : un clic à chaque
// déplacement entre les options, comme une vraie interface d'ordinateur.
document.getElementById('computerOverlay')?.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) AudioLib.playOnce('son_nav_ordinateur', { volume: 0.5 });
});
attachArrowFocusNav(document.getElementById('textPromptOverlay'));
attachArrowFocusNav(document.getElementById('confirmPromptOverlay'));

// Annonce globale au focus clavier (Tab), façon NVDA : dès qu'un bouton, un
// champ ou une liste reçoit le focus, on énonce son libellé suivi de son rôle
// ("Enregistrer, bouton"). C'est ce qui rend les menus et boîtes de dialogue
// réellement navigables au clavier SANS lecteur d'écran externe. Les champs de
// texte sont déjà gérés par makeInputSpeakable, on les saute ici pour ne pas
// annoncer deux fois.
function announceFocusedControl(elm) {
  if (!elm || elm === document.body) return;
  // Sur les écrans de démarrage (assistant de création de compte / connexion),
  // on laisse le lecteur d'écran NATIF (VoiceOver, NVDA) faire toute la
  // narration : le jeu se tait ici pour ne pas superposer deux voix. Il ne
  // reprend la parole qu'une fois la personne entrée dans la ville.
  if (elm.closest && elm.closest('#startOverlay')) return;
  const tag = elm.tagName;
  // Les boutons radio et cases à cocher n'étaient narrés nulle part (sauf
  // l'entretien RP, qui a sa propre annonce plus riche ci-dessus — on
  // l'exclut ici pour ne pas l'annoncer deux fois).
  if (tag === 'INPUT' && (elm.type === 'radio' || elm.type === 'checkbox') && !elm.closest('#rpInterviewBlock')) {
    const now = Date.now();
    if (elm === announceFocusedControl._last && now - announceFocusedControl._lastTime < 400) return;
    announceFocusedControl._last = elm; announceFocusedControl._lastTime = now;
    const label = (elm.closest('label')?.textContent || elm.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    if (!label) return;
    const role = elm.type === 'radio' ? 'bouton radio' : 'case à cocher';
    speak(`${label}, ${role}${elm.checked ? ', coché' : ''}`, 'interrupt');
    return;
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // texte libre : déjà géré par makeInputSpeakable
  // Déduplication : ne pas réannoncer le même élément à 400 ms d'intervalle
  // (certains navigateurs émettent focus + focusin coup sur coup).
  const now = Date.now();
  if (elm === announceFocusedControl._last && now - announceFocusedControl._lastTime < 400) return;
  announceFocusedControl._last = elm; announceFocusedControl._lastTime = now;
  const labelText = (elm.getAttribute('aria-label') || elm.textContent || '').trim().replace(/\s+/g, ' ');
  if (!labelText) return;
  let role = '';
  if (tag === 'BUTTON' || elm.getAttribute('role') === 'button') role = ', bouton';
  else if (tag === 'SELECT') role = ', liste déroulante';
  else if (tag === 'A') role = ', lien';
  speak(`${labelText}${role}`, 'interrupt');
}
document.addEventListener('focusin', (e) => announceFocusedControl(e.target));
