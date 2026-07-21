const Game = {
  x: 120, y: 120, altitude: 0, heading: 0, health: 100, maxHealth: 100,
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
  HEADING_NAMES: { 0: 'nord', 2: 'est', 4: 'sud', 6: 'ouest' },
  turn(delta) {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.inVehicle && this.vehicle) {
      this.vehicle.heading = ((this.vehicle.heading + delta) % 8 + 8) % 8; this.heading = this.vehicle.heading;
      const cls = VEHICLE_CATALOG[this.vehicle.type];
      if (cls && !cls.flies) AudioLib.playOnce('clignotant_voiture', { volume: 0.35 });
    }
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
    return { dx: h === 2 ? 1 : h === 6 ? -1 : 0, dy: h === 4 ? 1 : h === 0 ? -1 : 0 };
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
    if (City.isSolid(nx, ny)) {
      Audio.impact(UTIL.clamp(dx, -1, 1) * 0.5);
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
    if (!(surface === 'water' && this.underwater)) Audio.footstep(surface);
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

  // Vehicle physics
  driveVehicle(dx, dy) {
    const v = this.vehicle; const cls = VEHICLE_CATALOG[v.type];
    if (dx !== 0 || dy !== 0) v.heading = (dx > 0 ? 2 : dx < 0 ? 6 : dy > 0 ? 4 : dy < 0 ? 0 : v.heading);
    const isBraking = (dx === 0 && dy === 0);
    // Freinage brutal : freinage engagé alors qu'on roulait vite, détecté une
    // seule fois au début du freinage (pas à chaque image tant qu'on freine).
    if (this.taxiState) {
      if (isBraking && Math.abs(v.speed) > cls.maxSpeed * 0.55 && !this.taxiState.wasBraking) {
        this.taxiState.wasBraking = true;
        this.taxiRoughEvent(UTIL.randInt(8, 18));
      } else if (!isBraking || Math.abs(v.speed) < 0.1) {
        this.taxiState.wasBraking = false;
      }
    }
    // acceleration model
    const accel = (dx === 0 && dy === 0) ? -cls.brake : (cls.accel || 0.06);
    const targetSpeed = (dx === 0 && dy === 0) ? 0 : cls.maxSpeed * (v.fuel > 0 ? 1 : 0.3);
    const offroadFactor = (City.getTile(v.x, v.y) === 'route' || City.getTile(v.x, v.y) === 'rue') ? 1 : cls.offroad;
    const isReverse = (dx === 0 && dy === 0) ? false : this.isReverse(v.heading, dx, dy);
    if (isReverse) v.speed = UTIL.clamp(v.speed - cls.accel, -cls.maxSpeed * 0.3, 0);
    else v.speed = UTIL.clamp(v.speed + (dx === 0 && dy === 0 ? -cls.brake : accel * offroadFactor), -cls.maxSpeed * 0.3, targetSpeed * offroadFactor);
    if (v.fuel <= 0 && v.speed > 0.1) { v.speed *= 0.5; announce('Panne d\'essence.', 'assertive'); }
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
    const step = v.speed * (v.speed < 0 ? -1 : 1);
    const dir = v.heading;
    const ndx = dir === 2 ? step : dir === 6 ? -step : 0;
    const ndy = dir === 4 ? step : dir === 0 ? -step : 0;
    const nx = Math.round(v.x + ndx), ny = Math.round(v.y + ndy);
    if (cls.flies) {
      v.altitude = Math.max(0, v.altitude + (Game.keys.has('shift') ? 2 : Game.keys.has('control') ? -2 : 0));
      this.altitude = v.altitude;
    }
    if (City.isSolid(nx, ny)) {
      const impactDmg = Math.round(Math.abs(v.speed) * 40 * (1 - (cls.armor || 0)));
      v.hp = Math.max(0, v.hp - impactDmg);
      if (this.fragileState) this.fragileState.condition = Math.max(0, this.fragileState.condition - UTIL.randInt(15, 35));
      if (this.taxiState) this.taxiRoughEvent(UTIL.randInt(15, 30));
      if (this.medicalState) {
        const victim = City.npcs.find(n => n.id === this.medicalState.victimId);
        if (victim) { victim.health = Math.max(0, victim.health - UTIL.randInt(8, 18)); announce(`Le blessé encaisse le choc ! Santé : ${Math.round(victim.health)}%.`, 'assertive'); }
      }
      v.speed = 0; Audio.screech(0);
      const otherVehicleHere = City.vehicles.some(ov => ov.id !== v.id && UTIL.dist(ov, { x: nx, y: ny }) < 1.5);
      if (otherVehicleHere) AudioLib.playOnce('veh_kolision_entre_2', { volume: 0.6 });
      else if (impactDmg > 20) AudioLib.playOnce('veh_kolision_4_fort', { volume: 0.65 });
      else if (impactDmg > 8) AudioLib.playOnce(UTIL.pick(['veh_kolision_1', 'veh_kolision_2', 'veh_kolision_3']), { volume: 0.55 });
      announce(`Collision !${impactDmg > 3 ? ` État du véhicule : ${Math.round(v.hp)}%.` : ''}`, 'assertive');
      if (City.isRoad(v.x, v.y)) this.npcVoiceReaction(v.x, v.y, { group: 'impatient', radius: 12, count: 2 });
    } else {
      v.x = UTIL.clamp(nx, 0, City.W - 1); v.y = UTIL.clamp(ny, 0, City.H - 1); v.fuel = Math.max(0, v.fuel - Math.abs(v.speed) * 0.002);
      // Conduite tout-terrain à vitesse notable : chance occasionnelle de
      // taper un trou (juste un bruit, pas de dégâts — la route cahoteuse).
      if (offroadFactor < 1 && Math.abs(v.speed) > cls.maxSpeed * 0.3 && UTIL.chance(0.03)) {
        AudioLib.playOnce(UTIL.pick(['veh_trou_1', 'veh_trou_2', 'veh_trou_3', 'veh_trou_gros_4', 'veh_collision_trou']), { volume: 0.4 });
      }
    }
    const speedRatio = Math.abs(v.speed) / cls.maxSpeed;
    if (cls.flies) RealAirEngine.update(v, cls, speedRatio);
    else if (cls.electric) RealElectricEngine.update(v, speedRatio);
    else if (cls.sport) RealEngine.update(v, cls, speedRatio);
    else RealEngine2.update(v, speedRatio);
    if (!cls.flies) {
      if (Weather.state === 'pluie') { if (!AudioLib.isLoopPlaying('veh_essuie_glaces')) AudioLib.playLoop('veh_essuie_glaces', 0.25); }
      else AudioLib.stopLoop('veh_essuie_glaces');
    }
    updateHud();
  },
  isReverse(heading, dx, dy) {
    if (heading === 0 && dy > 0) return true; // heading north, pressing south
    if (heading === 4 && dy < 0) return true;
    if (heading === 2 && dx < 0) return true;
    if (heading === 6 && dx > 0) return true;
    return false;
  },
  brakeVehicle() {
    if (!this.vehicle) return;
    const v = this.vehicle; const cls = VEHICLE_CATALOG[v.type];
    const speedRatioBefore = Math.abs(v.speed) / cls.maxSpeed;
    v.speed = Math.max(0, Math.abs(v.speed) - 0.15) * (v.speed < 0 ? -1 : 1);
    // Le vrai freinage enregistré (crissement) n'existe que dans le kit
    // sport ; les autres moteurs (véhicule2, électrique, aérien) se
    // contentent d'un ralentissement de régime, déjà audible au prochain pas.
    if (speedRatioBefore > 0.2 && cls.sport) RealEngine.brake(speedRatioBefore);
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
    updateHud();
  },

  // Auto-drive (accessible menu + realistic route following)
  setAutoDrive(destType, destName) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez d\'abord dans un véhicule.', 'assertive');
    const targets = City.pois.filter(p => p.type === destType || p.name.toLowerCase().includes(destName?.toLowerCase() || ''));
    const dest = targets.length ? targets[0] : (destName ? City.pois.find(p => p.name.toLowerCase().includes(destName.toLowerCase())) : null);
    if (!dest) return announce('Destination inconnue.', 'assertive');
    this.vehicle.auto = true; this.vehicle.autoDest = { x: dest.x, y: dest.y, name: dest.name };
    this.vehicle.speed = Math.min(this.vehicle.speed || VEHICLE_CATALOG[this.vehicle.type].maxSpeed * 0.3, VEHICLE_CATALOG[this.vehicle.type].maxSpeed * 0.4);
    announce(`Conduite automatique vers ${dest.name}. Dites stop ou appuyez sur espace pour reprendre le contrôle.`, 'polite');
  },
  autoDriveStep() {
    if (!this.inVehicle || !this.vehicle || !this.vehicle.auto || !this.vehicle.autoDest) return;
    const v = this.vehicle; const dest = v.autoDest; const cls = VEHICLE_CATALOG[v.type];
    const dx = dest.x - v.x, dy = dest.y - v.y; const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) { this.stopAutoDrive(); announce(`Arrivé à ${dest.name}.`, 'assertive'); return; }
    // realistic steering: choose heading toward destination, prefer roads
    let best = v.heading;
    let bestScore = -Infinity;
    for (let h = 0; h < 8; h += 2) { // only cardinal for vehicles
      const nx = v.x + (h === 2 ? 1 : h === 6 ? -1 : 0);
      const ny = v.y + (h === 4 ? 1 : h === 0 ? -1 : 0);
      if (City.isSolid(nx, ny)) continue;
      const ndx = dest.x - nx, ndy = dest.y - ny;
      let score = -Math.sqrt(ndx * ndx + ndy * ndy);
      if (City.isRoad(nx, ny)) score += 4; // prefer roads
      if (h === v.heading) score += 1; // keep direction
      if (score > bestScore) { bestScore = score; best = h; }
    }
    v.heading = best;
    v.speed = Math.min(v.speed + cls.accel, cls.maxSpeed * (City.isRoad(v.x, v.y) ? 0.6 : 0.4));
    this.driveVehicle(0, 0); // apply physics with current heading
    // Voice guidance
    const bearing = UTIL.bearing(dest.x - v.x, dest.y - v.y);
    const remaining = Math.round(dist * CONFIG.METERS_PER_TILE);
    if (Math.random() < 0.04) announce(`${remaining} mètres, cap ${bearing}, vers ${dest.name}.`, 'polite');
  },
  // Signale un crime (vol de véhicule, braquage...) à TOUS les policiers connectés,
  // où qu'ils soient dans la ville. Chacun reçoit une alerte avec la position exacte
  // et peut se laisser guider vocalement ou activer la conduite automatique vers la scène.
  // Compte les vrais joueurs connectés (soi-même inclus) à proximité d'un
  // point. Sert à ajuster la difficulté des missions extrêmes : jouables
  // seul, mais bien plus risquées ; plus on est nombreux à proximité, plus
  // le risque baisse. Jamais un verrou strict, juste un vrai avantage.
  countNearbyRealPlayers(point, radius) {
    let count = UTIL.dist(this, point) < radius ? 1 : 0;
    if (Net.connected) count += Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, point) < radius).length;
    return count;
  },
  // Rappelle l'identifiant de connexion (façon GTA), à communiquer à son équipe.
  announceMyId() {
    if (!Net.connected) return announce('Vous n\'êtes pas connecté à un serveur : pas d\'identifiant à communiquer.', 'assertive');
    announce(`Votre identifiant de connexion est le ${Net.id.replace(/^p/, '')}.`, 'assertive');
  },
  // Missions à IDs façon GTA : au lancement d'une mission (sauf celles
  // recommandées aux nouveaux, comme le taxi), il faut saisir les identifiants
  // de l'équipe qui la joue. Seuls ces identifiants pourront l'accomplir —
  // les identifiants changent à chaque reconnexion, donc à refaire à chaque fois.
  isMissionAuthorized(m) {
    if (BEGINNER_MISSION_TYPES.includes(m.type)) return true;
    if (!m.authorizedIds) return true;
    const myId = Net.connected ? Net.id.replace(/^p/, '') : 'solo';
    return m.authorizedIds.includes(myId);
  },
  reportCrimeToPolice(kind, detail) {
    if (Net.connected) Net.send({ type: 'crime_report', kind, detail });
  },
  onCrimeAlert(kind, detail, x, y) {
    const labels = { vol_vehicule: 'Vol de véhicule', braquage_banque: 'Braquage de banque', coups_de_feu: 'Coups de feu', explosion: 'Explosion / grenade', conduite_dangereuse: 'Conduite dangereuse', intrusion: 'Intrusion détectée', vol_main_armee: 'Vol à main armée' };
    const label = labels[kind] || 'Signalement';
    const bearing = UTIL.bearing(x - this.x, y - this.y);
    const dist = Math.round(UTIL.dist({ x, y }, this) * CONFIG.METERS_PER_TILE);
    this.lastCrimeAlert = { x, y, name: detail || label };
    AudioLib.playOnce('sfx_alerte_police');
    announce(`Alerte police : ${label}${detail ? ' — ' + detail : ''}. À ${dist} mètres, cap ${bearing}.`, 'assertive');
  },
  goToLastCrimeAlert() {
    if (!this.lastCrimeAlert) return announce('Aucune alerte en cours.', 'assertive');
    if (!this.inVehicle) return announce('Montez dans un véhicule pour vous y rendre en mode automatique.', 'assertive');
    this.vehicle.auto = true; this.vehicle.autoDest = this.lastCrimeAlert;
    announce(`Conduite automatique vers ${this.lastCrimeAlert.name}.`, 'assertive');
  },
  stopAutoDrive() {
    if (this.vehicle) { this.vehicle.auto = false; this.vehicle.autoDest = null; this.vehicle.speed = 0; Audio.stopEngine(); }
    updateHud();
  },

  // Enter / exit vehicle
  interactVehicle() {
    if (this.inVehicle) {
      const cls = VEHICLE_CATALOG[this.vehicle.type];
      this.x = Math.round(this.vehicle.x); this.y = Math.round(this.vehicle.y); this.altitude = 0;
      this.inVehicle = false; this.vehicle.auto = false; Audio.stopEngine(); RealEngine.stop(); RealEngine2.stop(); RealElectricEngine.stop(); RealAirEngine.stop(); AudioLib.stopLoop('veh_essuie_glaces');
      if (this.vehicle.siren) { const sk = SIREN_SOUNDS[this.vehicle.type]; if (sk) AudioLib.stopLoop(sk); this.vehicle.siren = false; }
      if (cls && !cls.flies) {
        AudioLib.playOnce('veh_ceinture_out', { volume: 0.6 });
        setTimeout(() => AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 }), 250);
        setTimeout(() => { AudioLib.playOnce('veh1_fermeture_porte', { volume: 0.6 }); AudioLib.playOnce('veh_frein_main', { volume: 0.5 }); }, 700);
      }
      sendWorldEdit('vehicle_position', { id: this.vehicle.id, x: this.vehicle.x, y: this.vehicle.y, locked: this.vehicle.locked });
      // Retenu automatiquement pour pouvoir le retrouver plus tard (touche
      // Maj+F ou "où est ma voiture") — utile de se garer sans s'inquiéter.
      this.lastParkedVehicle = { id: this.vehicle.id, name: this.vehicle.name };
      announce(`Vous descendez du ${this.vehicle.name}.`, 'assertive'); this.vehicle = null;
    } else {
      const nearby = City.vehicles.filter(v => UTIL.dist({ x: this.x, y: this.y }, v) < 4 && !v.owner);
      const v = nearby.sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
      if (!v) return announce('Aucun véhicule à proximité.', 'assertive');
      if (v.locked && !this.ownedVehicles.includes(v.id)) {
        Audio.beep(0, 700);
        AccessibleConfirm.open(`${v.name} est verrouillé`, 'Forcer la portière ? Cela déclenchera l\'alarme antivol et attirera l\'attention.', (force) => {
          if (!force) return announce('Véhicule verrouillé.', 'assertive');
          AudioLib.playOnce('sfx_alarme_antivol');
          Game.reportCrimeToPolice('vol_vehicule', v.name);
          this.wanted = Math.min(100, this.wanted + 15);
          announce('Vous forcez la portière ! L\'alarme antivol retentit une fois : la police est alertée.', 'assertive');
          setTimeout(() => {
            v.locked = false;
            announce('La portière a cédé, vous pouvez monter.', 'polite');
          }, 12000);
        });
        return;
      }
      const cls = VEHICLE_CATALOG[v.type];
      // Le permis est exigé pour conduire/piloter un vrai véhicule — mais pas
      // pour un véhicule-école, qui sert justement à apprendre.
      if (!v.examVehicle && !this.checkLicense(cls?.flies ? 'flying' : 'driving')) return;
      if (cls && !cls.flies) {
        AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 });
        setTimeout(() => { AudioLib.playOnce('veh1_fermeture_porte', { volume: 0.6 }); AudioLib.playOnce('veh_ceinture_in', { volume: 0.6 }); }, 350);
      }
      this.vehicle = v; this.inVehicle = true; this.altitude = v.altitude || 0;
      announce(`Vous montez dans ${v.name}. Flèches pour conduire, espace pour freiner, M pour conduite auto.`, 'assertive');
      if (this.activeMission && this.activeMission.type === 'convoyage' && this.activeMission.vehicleId === v.id && !this.deliveryState) {
        this.startVehicleDelivery(this.activeMission);
      }
    }
    updateHud();
  },

  // Garage: spawn owned vehicle
  openGarage() {
    if (!this.ownedVehicles.length) return announce('Vous ne possédez pas de véhicule.', 'assertive');
    const owned = this.ownedVehicles.map(id => City.vehicles.find(v => v.id === id)).filter(Boolean);
    if (!owned.length) return;
    const v = owned[0];
    v.x = this.x + 1; v.y = this.y + 1; v.fuel = 1; v.hp = 100; v.locked = false;
    announce(`Garage : ${v.name} sorti à côté de vous.`, 'assertive');
  },

  // Inventory system
  inventoryCapacity() {
    let cap = CONFIG.POCKET_CAPACITY;
    if (this.belt) cap += CONFIG.BELT_BONUS;
    if (this.backpack) cap += CONFIG.BACKPACK_CAPACITY;
    return cap;
  },
  inventoryVolume() {
    return this.inventory.reduce((a, i) => a + (i.size || 1) * (i.q || 1), 0);
  },
  canAdd(item) {
    const vol = (item.size || 1) * (item.q || 1);
    return this.inventoryVolume() + vol <= this.inventoryCapacity();
  },
  addItem(item, target = 'pocket') {
    const vol = (item.size || 1) * (item.q || 1);
    if (target === 'pocket' && !this.canAdd(item)) return announce('Vos poches sont pleines.', 'assertive');
    const existing = this.inventory.find(i => i.id === item.id && i.category === item.category && i.name === item.name);
    if (existing && (item.category === 'munition' || item.consumable)) { existing.q = (existing.q || 1) + (item.q || 1); }
    else this.inventory.push({ ...item, q: item.q || 1 });
    if (item.category === 'arme' || item.id?.startsWith('weapon')) this.weapons.push(item.id);
    if (item.category === 'munition') this.ammoReserve[item.id.replace('ammo_', '')] = (this.ammoReserve[item.id.replace('ammo_', '')] || 0) + (item.q || 1);
    Audio.click();
    return true;
  },
  removeItem(id, q = 1) {
    const idx = this.inventory.findIndex(i => i.id === id);
    if (idx === -1) return null;
    const it = this.inventory[idx];
    if ((it.q || 1) > q) { it.q -= q; return { ...it, q }; }
    else { this.inventory.splice(idx, 1); return it; }
  },
  useItem(id) {
    const it = this.inventory.find(i => i.id === id);
    if (!it) return;
    if (it.consumable) {
      if (it.category === 'boisson') AudioLib.playOnce('eau_boire', { volume: 0.6 });
      if (it.hunger) this.hunger = Math.max(0, this.hunger - it.hunger);
      if (it.thirst) this.thirst = Math.max(0, this.thirst - it.thirst);
      if (it.health) this.health = Math.min(this.maxHealth, this.health + it.health);
      it.q--; if (it.q <= 0) this.removeItem(id, 1);
      announce(`Vous utilisez ${it.name}.`, 'polite');
    } else if (it.category === 'vetement') {
      this.outfit.haut = it.name; announce(`Vous portez ${it.name}.`, 'polite');
    } else if (it.category === 'pantalon') {
      this.outfit.bas = it.name; announce(`Vous portez ${it.name}.`, 'polite');
    } else if (it.category === 'chaussure') {
      this.outfit.chaussures = it.name; announce(`Vous portez ${it.name}.`, 'polite');
    } else if (it.category === 'accessoire') {
      if (!this.outfit.accessoires.includes(it.name)) this.outfit.accessoires.push(it.name);
      announce(`Vous portez ${it.name}.`, 'polite');
    } else if (it.category === 'masque') {
      this.outfit.masque = !this.outfit.masque;
      announce(this.outfit.masque ? `Vous mettez ${it.name}. Plus personne ne peut vous identifier ni deviner votre métier.` : `Vous retirez ${it.name}.`, 'assertive');
    } else if (it.category === 'vetement_police') {
      if (!Roles.hasPerm('cni')) return announce('Réservé aux policiers en service.', 'assertive');
      this.outfit.haut = 'uniforme de police'; this.outfit.isPolice = true;
      announce('Vous enfilez votre uniforme de police.', 'assertive');
    } else if (it.category === 'medicament') {
      this.health = Math.min(this.maxHealth, this.health + (it.heal || it.health || 15)); it.q--; if (it.q <= 0) this.removeItem(id, 1);
      announce(`Vous prenez ${it.name}.`, 'polite');
    } else if (it.category === 'outil' && it.repairType) {
      if (!this.vehicle) return announce('Montez d\'abord dans le véhicule à réparer.', 'assertive');
      this.vehicle.hp = Math.min(100, this.vehicle.hp + it.amount); this.vehicle.fuel = Math.min(1, this.vehicle.fuel + 0.2);
      it.q--; if (it.q <= 0) this.removeItem(id, 1);
      this.gainSkill('repair', 1);
      announce(`${it.name} utilisé. État du véhicule : ${Math.round(this.vehicle.hp)}%.`, 'assertive'); Audio.click();
    } else if (it.id === 'coffre_fort') {
      const house = this.ownedHouses.map(hid => City.houses.find(h => h.id === hid)).find(Boolean);
      if (!house) return announce('Achetez d\'abord une maison pour y installer un coffre-fort.', 'assertive');
      house.safe = { capacity: 50, items: [], opened: true }; it.q--; if (it.q <= 0) this.removeItem(id, 1);
      announce(`Coffre-fort installé dans ${house.name}.`, 'assertive');
    } else if (it.id === 'ordinateur') {
      Computer.boot();
    } else if (it.category === 'explosif') {
      this.throwGrenade();
    }
    updateHud();
  },
  announceInventory() {
    if (!this.inventory.length) return announce('Vos poches sont vides.', 'polite');
    const parts = this.inventory.map(i => `${i.q || 1} ${i.name}`).join(', ');
    const vol = this.inventoryVolume(), cap = this.inventoryCapacity();
    announce(`Inventaire : ${parts}. Volume ${vol.toFixed(1)} sur ${cap}.`, 'polite');
  },
  announceLocation() {
    const d = City.getDistrictAt(this.x, this.y);
    const street = City.isRoad(this.x, this.y) ? 'sur la route' : `près d\'un ${City.getTile(this.x, this.y)}`;
    const bearing = UTIL.cardinals[this.heading];
    const alt = this.altitude > 0 ? `, altitude ${Math.round(this.altitude)} mètres` : '';
    announce(`Vous êtes dans ${d.name}, ${street}, cap vers le ${bearing}${alt}.`, 'polite');
  },

  /* ==========================================================
     OUTILS DE NAVIGATION PIÉTONNE (accessibilité non-voyants)
     ========================================================== */

  // C — Boussole sonore : annonce le cap actuel + le premier lieu droit devant.
  soundCompass() {
    const bearing = UTIL.cardinals[this.heading];
    // "Droit devant" = un cône ÉTROIT (~20°). Avant, le cône faisait 57° de
    // chaque côté : des lieux franchement sur le côté étaient annoncés comme
    // "droit devant" et changeaient à chaque pas sans qu'on ait tourné —
    // déroutant. Maintenant : cône étroit pour "droit devant", et ce qui est
    // entre 20° et 45° est annoncé honnêtement "légèrement à gauche/droite".
    const candidates = City.pois
      .map(p => ({ p, dist: UTIL.dist(p, this), ang: this.relativeAngle(p.x, p.y) }))
      .filter(o => o.ang < 0.8 && o.dist < 40)
      .sort((a, b) => a.dist - b.dist);
    const straight = candidates.find(o => o.ang < 0.35);
    const side = !straight ? candidates[0] : null;
    // Petit son de repère devant (centré).
    Audio.tone({ freq: 660, type: 'sine', duration: 0.15, gain: 0.1, pan: 0 });
    if (straight) {
      announce(`Cap vers le ${bearing}. Droit devant : ${straight.p.name}, à ${Math.round(straight.dist * CONFIG.METERS_PER_TILE)} mètres.`, 'interrupt');
    } else if (side) {
      const pan = this.panForPoint(side.p.x, side.p.y);
      const cote = pan < 0 ? 'légèrement à gauche' : 'légèrement à droite';
      announce(`Cap vers le ${bearing}. Rien droit devant. ${side.p.name} se trouve ${cote}, à ${Math.round(side.dist * CONFIG.METERS_PER_TILE)} mètres.`, 'interrupt');
    } else {
      announce(`Cap vers le ${bearing}. Rien d'identifié droit devant.`, 'interrupt');
    }
  },

  // Angle (radians) entre la direction du regard et la direction d'un point.
  relativeAngle(tx, ty) {
    const headingRad = this.heading * Math.PI / 4; // 0=nord, sens horaire
    // Vecteur "regard" : nord = (0,-1), est = (1,0)...
    const hx = Math.sin(headingRad), hy = -Math.cos(headingRad);
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const dot = (hx * dx + hy * dy) / len;
    return Math.acos(Math.max(-1, Math.min(1, dot))); // 0 = pile devant, PI = derrière
  },

  // Pan stéréo (-1 gauche, +1 droite) d'un point selon l'orientation du joueur.
  panForPoint(tx, ty) {
    const headingRad = this.heading * Math.PI / 4;
    const hx = Math.sin(headingRad), hy = -Math.cos(headingRad);
    // Vecteur perpendiculaire (droite du joueur)
    const rx = -hy, ry = hx;
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy) || 1;
    return Math.max(-1, Math.min(1, (rx * dx + ry * dy) / len));
  },

  // F — Radar de balayage : balaie de gauche à droite les lieux proches,
  // chacun joué comme un bip spatialisé (position = pan, distance = hauteur),
  // suivi d'une courte annonce. Donne une "photo sonore" instantanée.
  soundRadar() {
    const near = City.pois
      .map(p => ({ p, dist: UTIL.dist(p, this), pan: this.panForPoint(p.x, p.y), ang: this.relativeAngle(p.x, p.y) }))
      .filter(o => o.dist < 35)
      .sort((a, b) => a.pan - b.pan) // de la gauche vers la droite
      .slice(0, 8);
    if (!near.length) { announce('Radar : aucun lieu identifié à proximité.', 'interrupt'); Audio.tone({ freq: 300, type: 'sine', duration: 0.2, gain: 0.08, pan: 0 }); return; }
    announce(`Radar : ${near.length} lieux autour de vous, de la gauche vers la droite.`, 'interrupt');
    near.forEach((o, i) => {
      setTimeout(() => {
        // Plus c'est proche, plus le son est aigu ; position stéréo = direction réelle.
        const freq = 400 + Math.max(0, (35 - o.dist)) * 18;
        Audio.tone({ freq, type: 'sine', duration: 0.16, gain: 0.1, pan: o.pan });
        const side = o.pan < -0.33 ? 'à gauche' : o.pan > 0.33 ? 'à droite' : 'devant';
        speak(`${o.p.name}, ${side}, ${Math.round(o.dist * CONFIG.METERS_PER_TILE)} mètres`, i === 0 ? 'interrupt' : 'polite');
      }, i * 850);
    });
  },

  // Balises sonores de proximité : appelé en boucle par le gameLoop. Chaque type
  // de lieu proche émet périodiquement un bip discret, spatialisé, dont la
  // cadence augmente à l'approche — comme un détecteur. Activable/désactivable.
  beaconsOn: false,
  toggleBeacons() {
    this.beaconsOn = !this.beaconsOn;
    announce(this.beaconsOn
      ? 'Balises sonores activées : les lieux proches émettent un bip, plus rapide en approchant.'
      : 'Balises sonores désactivées.', 'interrupt');
  },
  _lastBeacon: 0,
  updateBeacons() {
    if (!this.beaconsOn || this.inVehicle) return;
    const now = Date.now();
    // Source de la balise : la DESTINATION guidée si un guidage est actif (vraie
    // balise de ralliement, jusqu'à 500 m), sinon le lieu le plus proche (30 m).
    let target = null, nd = Infinity;
    if (this.guidanceTarget) { target = this.guidanceTarget; nd = UTIL.dist(target, this); }
    else { for (const p of City.pois) { const d = UTIL.dist(p, this); if (d < nd) { nd = d; target = p; } } }
    const maxRange = this.guidanceTarget ? 500 : 30;
    if (!target || nd > maxRange) return;
    // Cadence : plus c'est proche, plus les bips s'enchaînent (200 ms près,
    // ~1200 ms loin), comme un détecteur qui s'affole à l'approche.
    const interval = Math.max(200, 200 + (Math.min(nd, 40) / 40) * 1000);
    if (now - this._lastBeacon < interval) return;
    this._lastBeacon = now;
    // Cadrage directionnel : le pan gauche/droite place la cible dans l'espace,
    // et la hauteur du son dit si elle est DEVANT (aigu) ou DERRIÈRE (grave). On
    // tourne jusqu'à ce que le bip soit à la fois centré ET aigu : on est pile
    // en face. Un vrai repère sonore bien cadré, pas juste un bip.
    const pan = this.panForPoint(target.x, target.y);
    const facing = 1 - this.relativeAngle(target.x, target.y) / Math.PI; // 1 devant, 0 derrière
    const freq = 380 + facing * 620 + Math.max(0, (30 - Math.min(nd, 30))) * 6;
    Audio.tone({ freq, type: 'sine', duration: 0.08, gain: 0.07, pan });
  },

  // GPS piéton guidé : on fixe une destination, une voix guide pas à pas
  // (tourne à gauche/droite, tout droit, distance restante) avec un bip
  // d'approche. Réévalué à chaque déplacement via updateGuidance().
  //
  // Important : on ne calcule PAS un angle continu vers la cible (ça oscille
  // sans arrêt entre gauche/droite/tout droit à cause de l'imprécision, comme
  // signalé). On raisonne uniquement en cases entières et en cap discret
  // (0/2/4/6 = nord/est/sud/ouest, les 4 seules directions où l'on peut
  // avancer) : on choisit UN axe à corriger en priorité (est-ouest ou
  // nord-sud), avec une marge qui empêche de changer d'avis sans arrêt, et on
  // ne change de consigne que quand cet axe est vraiment aligné.
  guidanceTarget: null,
  guidanceAxis: null,
  setGuidance(poi) {
    this.guidanceTarget = poi;
    this.guidanceAxis = null; this.guidanceFollowId = null;
    this.guidancePath = null; this._pathGoal = null; // force un nouveau calcul de chemin
    announce(`Guidage activé vers ${poi.name}. Je vous indique la direction au fur et à mesure, en contournant les obstacles.`, 'interrupt');
    this._lastGuidanceMsg = 0;
    this.updateGuidance(true);
  },
  stopGuidance() {
    if (this.guidanceTarget) { announce('Guidage arrêté.', 'interrupt'); this.guidanceTarget = null; this.guidanceAxis = null; this.guidanceFollowId = null; this.guidancePath = null; this._pathGoal = null; }
  },
  // Guidage automatique EN DIRECT vers un joueur réel qui a partagé sa position
  // GPS avec vous. Le chemin (qui contourne les murs) se met à jour au fur et à
  // mesure qu'il se déplace, jusqu'à ce que vous le rejoigniez.
  followPlayerGPS(id, name) {
    const live = Net.remotePlayers.get(id);
    if (!live) return announce(`${name} n'est pas joignable pour le moment.`, 'assertive');
    this.guidanceFollowId = id;
    this.guidanceTarget = { name, x: live.x, y: live.y };
    this.guidanceAxis = null; this.guidancePath = null; this._pathGoal = null;
    announce(`Guidage automatique vers ${name}. Je vous mène jusqu'à cette personne en contournant les obstacles ; le trajet s'adapte si elle bouge.`, 'interrupt');
    this._lastGuidanceMsg = 0;
    this.updateGuidance(true);
  },
  // Envoie votre position GPS à un joueur réel : il pourra se faire guider
  // vocalement, automatiquement, jusqu'à vous.
  shareMyGPS(targetId, targetName) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    if (!targetId) return announce('Aucune personne sélectionnée.', 'assertive');
    Net.send({ type: 'share_gps', targetId });
    announce(`Votre position GPS a été envoyée à ${targetName || 'cette personne'}. Elle peut maintenant se faire guider automatiquement jusqu'à vous.`, 'assertive');
  },
  _lastGuidanceMsg: 0,
  guidancePath: null, _pathGoal: null, _pathComputedAt: 0, _pathIdx: 0, guidanceFollowId: null,
  updateGuidance(force) {
    const t = this.guidanceTarget; if (!t) return;
    // Cible mobile : guidage EN DIRECT vers un joueur qui a partagé sa position.
    // On rafraîchit ses coordonnées à chaque calcul ; s'il se déplace, le chemin
    // se recalcule tout seul (voir _ensurePath).
    if (this.guidanceFollowId) {
      const live = Net.remotePlayers.get(this.guidanceFollowId);
      if (!live) {
        announce(`${t.name} n'est plus joignable. Guidage arrêté.`, 'assertive');
        this.guidanceTarget = null; this.guidanceFollowId = null; this.guidancePath = null; this._pathGoal = null; return;
      }
      t.x = live.x; t.y = live.y;
    }
    const dist = UTIL.dist(t, this);
    if (dist < 2) {
      announce(this.guidanceFollowId ? `Vous avez rejoint ${t.name}.` : `Vous êtes arrivé à ${t.name}.`, 'interrupt');
      Audio.cash();
      this.guidanceTarget = null; this.guidanceAxis = null; this.guidancePath = null; this._pathGoal = null; this.guidanceFollowId = null; return;
    }
    const now = Date.now();
    if (!force && now - this._lastGuidanceMsg < 2500) return;
    this._lastGuidanceMsg = now;

    // Guidage le long d'un VRAI chemin praticable (contourne les bâtiments et
    // l'eau) : on ne dirige jamais quelqu'un vers un mur. Si aucun chemin n'est
    // trouvé (destination trop lointaine ou isolée), on retombe sur l'ancien
    // guidage direct par axe.
    this._ensurePath(t);
    let instruction = this._pathInstruction();
    if (!instruction) instruction = this._axisInstruction(t);

    // Détection de sur-place : si exactement la même consigne à la même
    // distance revient plusieurs fois d'affilée, c'est que le joueur ne
    // progresse pas — on le lui dit clairement au lieu de répéter en boucle.
    if (instruction === this._lastGuidanceInstruction) {
      this._sameGuidanceCount = (this._sameGuidanceCount || 0) + 1;
      if (this._sameGuidanceCount >= 3) {
        this._sameGuidanceCount = 0;
        speak('Vous ne progressez pas vers la destination. Un obstacle vous bloque peut-être : essayez de contourner, ou faites F pour un balayage.', 'interrupt');
        return;
      }
    } else {
      this._sameGuidanceCount = 0;
      this._lastGuidanceInstruction = instruction;
    }
    Audio.tone({ freq: 700, type: 'sine', duration: 0.1, gain: 0.08, pan: this.panForPoint(t.x, t.y) });
    speak(instruction, 'interrupt');
  },
  // Direction cardinale d'une case à sa voisine (0=nord,2=est,4=sud,6=ouest ;
  // -1 si pas cardinalement adjacentes).
  _dirOf(x0, y0, x1, y1) { const dx = x1 - x0, dy = y1 - y0; if (dx > 0 && dy === 0) return 2; if (dx < 0 && dy === 0) return 6; if (dy > 0 && dx === 0) return 4; if (dy < 0 && dx === 0) return 0; return -1; },
  // (Re)calcule le chemin vers la destination quand c'est nécessaire : au
  // changement de but, si le joueur a quitté le chemin, ou périodiquement (le
  // monde peut changer). Mémorise l'index du point de chemin le plus proche.
  _ensurePath(t) {
    const now = Date.now();
    const px = Math.round(this.x), py = Math.round(this.y);
    const gx = Math.round(t.x), gy = Math.round(t.y);
    const goalMoved = !this._pathGoal || this._pathGoal.x !== gx || this._pathGoal.y !== gy;
    let offPath = true;
    if (this.guidancePath && this.guidancePath.length && !goalMoved) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < this.guidancePath.length; i++) {
        const d = Math.abs(this.guidancePath[i].x - px) + Math.abs(this.guidancePath[i].y - py);
        if (d < best) { best = d; bi = i; }
      }
      this._pathIdx = bi; offPath = best > 1;
    }
    const stale = now - (this._pathComputedAt || 0) > 6000;
    if (goalMoved || !this.guidancePath || !this.guidancePath.length || offPath || stale) {
      this.guidancePath = this.computePath(px, py, t.x, t.y);
      this._pathGoal = { x: gx, y: gy }; this._pathComputedAt = now; this._pathIdx = 0;
    }
  },
  // Consigne pas-à-pas déduite du chemin : direction du segment droit en cours,
  // distance jusqu'au prochain virage, et aperçu du virage suivant. Comme le
  // segment est toujours praticable, "tout droit" ne mène jamais dans un mur.
  _pathInstruction() {
    const path = this.guidancePath;
    if (!path || path.length < 2) return null;
    const px = Math.round(this.x), py = Math.round(this.y);
    let i = Math.min(this._pathIdx || 0, path.length - 1);
    while (i < path.length - 1 && path[i].x === px && path[i].y === py) i++;
    const firstDir = this._dirOf(px, py, path[i].x, path[i].y);
    if (firstDir < 0) return null; // désaligné : repli, recalcul au prochain tick
    let e = i;
    while (e < path.length - 1 && this._dirOf(path[e].x, path[e].y, path[e + 1].x, path[e + 1].y) === firstDir) e++;
    const distToTurn = Math.abs(path[e].x - px) + Math.abs(path[e].y - py);
    const meters = Math.max(CONFIG.METERS_PER_TILE, Math.round(distToTurn * CONFIG.METERS_PER_TILE));
    const diff = ((firstDir - this.heading) % 8 + 8) % 8;
    let instr;
    if (diff === 0) instr = `Tout droit, ${meters} mètres`;
    else if (diff === 2) instr = `Tournez à droite, puis ${meters} mètres`;
    else if (diff === 6) instr = `Tournez à gauche, puis ${meters} mètres`;
    else instr = `Faites demi-tour, puis ${meters} mètres`;
    let nextDir = -1;
    if (e < path.length - 1) nextDir = this._dirOf(path[e].x, path[e].y, path[e + 1].x, path[e + 1].y);
    if (nextDir >= 0) {
      const nd = ((nextDir - firstDir) % 8 + 8) % 8;
      const w = nd === 2 ? 'à droite' : nd === 6 ? 'à gauche' : nd === 4 ? 'demi-tour' : '';
      if (w) instr += `, puis ${w}`;
    } else {
      instr += ', vous arrivez';
    }
    return instr + '.';
  },
  // Ancien guidage direct (repli) : vise l'axe le plus urgent en ligne droite.
  _axisInstruction(t) {
    const dx = t.x - this.x, dy = t.y - this.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    if (!this.guidanceAxis) this.guidanceAxis = absDx >= absDy ? 'x' : 'y';
    else {
      const current = this.guidanceAxis === 'x' ? absDx : absDy;
      const other = this.guidanceAxis === 'x' ? absDy : absDx;
      if (current === 0 || other > current + 5) this.guidanceAxis = this.guidanceAxis === 'x' ? 'y' : 'x';
    }
    let axis = this.guidanceAxis;
    let remaining = axis === 'x' ? absDx : absDy;
    if (remaining === 0) { axis = this.guidanceAxis = (axis === 'x' ? 'y' : 'x'); remaining = axis === 'x' ? absDx : absDy; }
    const targetHeading = axis === 'x' ? (dx > 0 ? 2 : 6) : (dy > 0 ? 4 : 0);
    const diff = ((targetHeading - this.heading) % 8 + 8) % 8;
    const meters = Math.round(remaining * CONFIG.METERS_PER_TILE);
    let instruction;
    if (diff === 0) instruction = `Tout droit, ${meters} mètres.`;
    else if (diff === 2) instruction = `Tournez à droite, puis ${meters} mètres.`;
    else if (diff === 6) instruction = `Tournez à gauche, puis ${meters} mètres.`;
    else instruction = `Faites demi-tour, puis ${meters} mètres.`;
    if (diff === 0) {
      const { dx: hdx, dy: hdy } = this.headingToDelta(this.heading);
      const nx = Math.round(this.x + hdx), ny = Math.round(this.y + hdy);
      if (City.isSolid(nx, ny)) instruction = `Attention, obstacle juste devant. ${instruction}`;
    }
    return instruction;
  },
  // A* piéton sur la grille : ne traverse ni bâtiment (case solide) ni eau.
  // Renvoie la liste des cases de la position au but (case praticable la plus
  // proche du but si le but lui-même est un bâtiment), ou null si rien.
  computePath(sx, sy, tx, ty) {
    const W = City.W, H = City.H;
    const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !City.isSolid(x, y) && City.getTile(x, y) !== 'eau';
    const nearestWalkable = (cx, cy) => {
      cx = UTIL.clamp(Math.round(cx), 0, W - 1); cy = UTIL.clamp(Math.round(cy), 0, H - 1);
      if (walkable(cx, cy)) return { x: cx, y: cy };
      for (let r = 1; r <= 10; r++) {
        for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (walkable(cx + ox, cy + oy)) return { x: cx + ox, y: cy + oy };
        }
      }
      return null;
    };
    const start = nearestWalkable(sx, sy), goal = nearestWalkable(tx, ty);
    if (!start || !goal) return null;
    const sIdx = start.y * W + start.x, gIdx = goal.y * W + goal.x;
    if (sIdx === gIdx) return [{ x: start.x, y: start.y }];
    const came = new Int32Array(W * H).fill(-1);
    const gScore = new Float64Array(W * H);
    const closed = new Uint8Array(W * H);
    const inOpen = new Uint8Array(W * H);
    const heapF = [], heapI = [];
    const push = (f, idx) => {
      heapF.push(f); heapI.push(idx); let c = heapF.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heapF[p] <= heapF[c]) break; const tf = heapF[p]; heapF[p] = heapF[c]; heapF[c] = tf; const ti = heapI[p]; heapI[p] = heapI[c]; heapI[c] = ti; c = p; }
    };
    const pop = () => {
      const ri = heapI[0], n = heapF.length - 1;
      heapF[0] = heapF[n]; heapI[0] = heapI[n]; heapF.pop(); heapI.pop();
      let c = 0; const len = heapF.length;
      while (true) { const l = 2 * c + 1, r = 2 * c + 2; let s = c;
        if (l < len && heapF[l] < heapF[s]) s = l;
        if (r < len && heapF[r] < heapF[s]) s = r;
        if (s === c) break;
        const tf = heapF[s]; heapF[s] = heapF[c]; heapF[c] = tf; const ti = heapI[s]; heapI[s] = heapI[c]; heapI[c] = ti; c = s;
      }
      return ri;
    };
    gScore[sIdx] = 0; push(Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y), sIdx); inOpen[sIdx] = 1;
    let processed = 0; const MAX = 90000;
    while (heapF.length) {
      const cur = pop(); inOpen[cur] = 0;
      if (cur === gIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++processed > MAX) return null; // trop coûteux : repli sur guidage direct
      const cx = cur % W, cy = (cur / W) | 0, g0 = gScore[cur];
      const cand = [[cx + 1, cy, cur + 1], [cx - 1, cy, cur - 1], [cx, cy + 1, cur + W], [cx, cy - 1, cur - W]];
      for (let k = 0; k < 4; k++) {
        const nx = cand[k][0], ny = cand[k][1], ni = cand[k][2];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || closed[ni] || !walkable(nx, ny)) continue;
        const ng = g0 + 1;
        if (inOpen[ni] && ng >= gScore[ni]) continue;
        gScore[ni] = ng; came[ni] = cur;
        push(ng + Math.abs(nx - goal.x) + Math.abs(ny - goal.y), ni); inOpen[ni] = 1;
      }
    }
    if (gIdx !== sIdx && came[gIdx] === -1) return null;
    const path = []; let c = gIdx;
    while (c !== -1) { path.push({ x: c % W, y: (c / W) | 0 }); if (c === sIdx) break; c = came[c]; }
    path.reverse();
    return path;
  },

  // Détection de bord : bip discret quand on passe du trottoir à la route ou
  // inversement, pour "sentir" le bord comme avec une canne. Appelé au déplacement.
  _lastOnRoad: null,
  checkEdge() {
    const onRoad = City.isRoad(this.x, this.y);
    if (this._lastOnRoad === null) { this._lastOnRoad = onRoad; return; }
    if (onRoad !== this._lastOnRoad) {
      this._lastOnRoad = onRoad;
      // Son grave = on entre sur la route (attention voitures) ; aigu = trottoir.
      Audio.tone({ freq: onRoad ? 240 : 900, type: 'sine', duration: 0.12, gain: 0.1, pan: 0 });
      speak(onRoad ? 'Vous êtes sur la route.' : 'Vous êtes sur le trottoir.', 'polite');
    }
  },

  // Lieux personnels enregistrés par le joueur (repères sur la carte).
  savePlaceHere(name) {
    const clean = (name || '').trim().slice(0, 40);
    if (!clean) return announce('Il faut donner un nom au lieu.', 'assertive');
    this.savedPlaces = this.savedPlaces || [];
    this.savedPlaces.push({ name: clean, x: this.x, y: this.y });
    announce(`Lieu "${clean}" enregistré ici.`, 'assertive');
  },
  removeSavedPlace(index) {
    if (!this.savedPlaces || !this.savedPlaces[index]) return;
    const name = this.savedPlaces[index].name;
    this.savedPlaces.splice(index, 1);
    announce(`Lieu "${name}" supprimé.`, 'assertive');
  },

  // Visite guidée vocale de la ville : structure générale, quartiers et leur
  // direction depuis la position actuelle. Relançable par une touche.
  cityTour() {
    const parts = [`Bienvenue. La ville fait ${City.W * CONFIG.METERS_PER_TILE} mètres sur ${City.H * CONFIG.METERS_PER_TILE} mètres. Voici les quartiers autour de vous.`];
    const here = City.getDistrictAt(this.x, this.y);
    parts.push(`Vous êtes actuellement dans ${here.name}.`);
    City.districts.forEach(d => {
      const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
      if (Math.abs(cx - this.x) < 2 && Math.abs(cy - this.y) < 2) return;
      const dir = UTIL.bearing(cx - this.x, cy - this.y);
      const dist = Math.round(UTIL.dist({ x: cx, y: cy }, this) * CONFIG.METERS_PER_TILE);
      parts.push(`${d.name}, vers le ${dir}, à environ ${dist} mètres.`);
    });
    parts.push('Utilisez F pour balayer les lieux proches, C pour la boussole, et le menu carte du téléphone pour vous faire guider vers une destination.');
    announce(parts.join(' '), 'interrupt');
  },

  // Scanner and targeting
  scan() {
    Audio.beep(0, 1200);
    const npcs = City.npcs.filter(n => UTIL.dist(n, this) < CONFIG.SCAN_RADIUS).map(n => ({ ...n, dist: UTIL.dist(n, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(n.x - this.x, n.y - this.y) }));
    const realPlayers = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < CONFIG.SCAN_RADIUS).map(p => ({
      id: p.id, name: `${p.firstName} ${p.lastName}`, job: 'joueur réel', gender: p.gender, outfit: p.outfit, isPlayer: true,
      x: p.x, y: p.y, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y),
    }));
    const people = [...realPlayers, ...npcs].sort((a, b) => a.dist - b.dist).slice(0, 9);
    const pois = City.pois.filter(p => UTIL.dist(p, this) < CONFIG.SCAN_RADIUS).map(p => ({ ...p, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 9);
    const vehicles = City.vehicles.filter(v => !v.owner && UTIL.dist(v, this) < CONFIG.SCAN_RADIUS).map(v => ({ ...v, dist: UTIL.dist(v, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(v.x - this.x, v.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    const ground = (City.groundItems || []).filter(it => UTIL.dist(it, this) < CONFIG.SCAN_RADIUS).map(it => ({ ...it, dist: UTIL.dist(it, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(it.x - this.x, it.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    this.scannedTargets = people;
    let msg = `Scan : ${people.length} personnes, ${pois.length} lieux, ${vehicles.length} véhicules, ${ground.length} objets au sol. `;
    if (people.length) msg += 'Personnes : ' + people.map((n, i) => `${i + 1}, ${n.name}${n.isPlayer ? ' (joueur réel)' : ', ' + n.job}, ${Math.round(n.dist)} m, ${n.bearing}`).join('. ');
    if (pois.length) msg += 'Lieux : ' + pois.map(p => `${p.name}, ${Math.round(p.dist)} m, ${p.bearing}`).join('. ');
    if (vehicles.length) msg += 'Véhicules : ' + vehicles.map(v => `${v.name}, ${Math.round(v.dist)} m, ${v.bearing}`).join('. ');
    if (ground.length) msg += 'Au sol : ' + ground.map(it => `${it.name}${it.q > 1 ? ' ×' + it.q : ''}, ${Math.round(it.dist)} m, ${it.bearing}`).join('. ');
    announce(msg, 'assertive');
    if (people.length) announce('Tapez 1 à 9 pour cibler une personne.', 'polite');
  },
  target(index) {
    const n = this.scannedTargets[index - 1];
    if (!n) return announce('Cible invalide.', 'assertive');
    this.lockedTarget = n;
    announce(`Cible verrouillée : ${n.name}, ${n.isPlayer ? 'joueur réel' : n.job}, ${Math.round(n.dist)} mètres, ${n.bearing}.`, 'assertive');
    updateHud();
  },
  // Résout la cible verrouillée EN DIRECT plutôt que d'utiliser la photo
  // figée prise au moment du scan (bug corrigé : avant, position/santé/état
  // restaient bloqués à l'instant du scan, et menotter un PNJ modifiait une
  // copie sans jamais toucher le vrai PNJ de la ville). Pour un PNJ, renvoie
  // directement l'objet réel de City.npcs (les modifications s'appliquent
  // pour de vrai) ; pour un joueur réel, son état réseau le plus récent.
  getLiveTarget() {
    if (!this.lockedTarget) return null;
    if (this.lockedTarget.isPlayer) {
      const live = Net.remotePlayers.get(this.lockedTarget.id);
      if (!live) return null; // déconnecté ou hors de portée réseau
      return { id: live.id, name: this.lockedTarget.name, isPlayer: true, x: live.x, y: live.y, health: live.health, unconscious: live.unconscious, outfit: live.outfit, role: live.role, policeRank: live.policeRank };
    }
    return City.npcs.find(n => n.id === this.lockedTarget.id) || null;
  },
  changeAim(dir) {
    const idx = CONFIG.AIM_PARTS.indexOf(this.aimPart);
    this.aimPart = CONFIG.AIM_PARTS[(idx + dir + CONFIG.AIM_PARTS.length) % CONFIG.AIM_PARTS.length];
    announce(`Visée : ${this.aimPart}.`, 'polite'); updateHud();
  },

  // Weapons
  toggleWeapon() {
    if (!this.weapons.length) return announce('Vous n\'avez pas d\'arme.', 'assertive');
    if (this.weaponOut) { this.weaponOut = false; announce('Arme rangée.', 'polite'); }
    else { this.weapon = this.weapons.length ? WEAPON_CATALOG[this.weapons[0]] : null; this.weaponOut = !!this.weapon; if (this.weapon) announce(`${this.weapon.name} sorti.`, 'assertive'); }
    updateHud();
  },
  selectWeapon(id) {
    if (!this.weapons.includes(id)) return announce('Arme non possédée.', 'assertive');
    this.weapon = WEAPON_CATALOG[id]; this.weaponOut = true; announce(`${this.weapon.name} équipé.`, 'assertive'); updateHud();
  },
  reload() {
    if (!this.weapon) return;
    const type = this.weapon.ammoType;
    const loaded = this.ammo[type] || 0;
    const capacity = this.weapon.magazine;
    const missing = capacity - loaded;
    if (missing <= 0) return announce('Chargeur déjà plein.', 'polite');
    const reserve = this.ammoReserve[type] || 0;
    if (reserve <= 0) { AudioLib.playOnce('sfx_arme_vide'); announce('Pas de munitions en réserve.', 'assertive'); return; }
    const transfer = Math.min(missing, reserve);
    this.ammo[type] = loaded + transfer;
    this.ammoReserve[type] = reserve - transfer;
    Audio.click();
    AudioLib.playOnce('sfx_recharge');
    announce(`${this.weapon.name} rechargé : ${this.ammo[type]}/${capacity} dans le chargeur, ${this.ammoReserve[type]} en réserve.`, 'polite');
    updateHud();
  },
  shoot() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.isCuffed) return announce('Vous êtes menotté(e), impossible d\'agir.', 'polite');
    if (!this.weaponOut || !this.weapon) return announce('Sortez d\'abord une arme.', 'assertive');
    if (this.ammo[this.weapon.ammoType] <= 0) { AudioLib.playOnce('sfx_arme_vide'); announce('Chargeur vide. Rechargez avec R.', 'assertive'); return; }
    const w = this.weapon;
    const live = this.getLiveTarget();
    const target = live ? { ...this.lockedTarget, ...live } : null;
    const range = target ? UTIL.dist(target, this) : 0;
    // altitude advantage
    const heightBonus = this.altitude > 0 ? Math.min(0.15, this.altitude * 0.01) : 0;
    let acc = w.accuracy;
    if (this.aimPart === 'tete') acc *= 0.75; else if (this.aimPart === 'jambes') acc *= 0.85;
    if (range > w.range) acc *= 0.3;
    acc += heightBonus;
    this.ammo[w.ammoType]--;
    Audio.gunshot(w.name, 0);
    setTimeout(() => Audio.shellDrop(0), 150);
    if (Date.now() - (this._lastGunfireReport || 0) > 8000) {
      this._lastGunfireReport = Date.now();
      Game.reportCrimeToPolice('coups_de_feu', 'Coups de feu entendus');
    }
    if (target && range <= w.range) {
      if (Math.random() < acc) {
        let dmg = w.dmg * (this.aimPart === 'tete' ? 2 : this.aimPart === 'jambes' ? 0.6 : 1);
        if (target.isPlayer) {
          // Chaque client est seul autorité sur sa propre santé : on relaie le
          // coup au joueur visé via le serveur, il s'applique les dégâts lui-même.
          if (!Net.connected) return;
          Net.send({ type: 'player_hit', targetId: target.id, damage: Math.round(dmg), headshot: this.aimPart === 'tete' });
          Audio.impact(0);
          announce(`Touché ${target.name} à la ${this.aimPart}. ${Math.round(dmg)} dégâts.`, 'assertive');
        } else {
          const npc = City.npcs.find(n => n.id === target.id);
          if (npc) {
            npc.health -= Math.round(dmg);
            Audio.impact(0);
            this.playNpcHitCry(npc);
            announce(`Touché ${target.name} à la ${this.aimPart}. ${Math.round(dmg)} dégâts.`, 'assertive');
            if (npc.health <= 0) { this.killNPC(npc); }
            else { if (npc.hostile) npc.relation -= 40; this.npcPanicReaction(npc.x, npc.y, { count: 1 }); }
          }
        }
      } else {
        announce(`Tir manqué sur ${target.name}.`, 'polite');
      }
    } else {
      announce('Tir dans le vide.', 'polite');
    }
    if (w.fireRate) {
      this.cooldown = true; setTimeout(() => this.cooldown = false, w.fireRate * 1000);
    }
    if (w.legal === false) { this.wanted = Math.min(100, this.wanted + 5); this.policeAwareness = Math.min(100, this.policeAwareness + 10); }
    Police.dispatch('tir', this.x, this.y, this.lockedTarget);
    updateHud();
  },
  startBurst() {
    if (this.burstTimer) return;
    if (!this.weaponOut || !this.weapon || !this.weapon.auto) { this.shoot(); return; } // arme non automatique : un seul coup
    if ((this.ammo[this.weapon.ammoType] || 0) <= 0) { AudioLib.playOnce('sfx_arme_vide'); return announce('Chargeur vide. Rechargez avec R.', 'assertive'); }
    // Le son de rafale boucle tant que le doigt/la touche de tir reste enfoncé.
    // Les armes très rapides (cadence ≤ 0.09 s entre coups, comme l'UZI) ont
    // une rafale plus intense et saturée ; les autres armes automatiques
    // (AK-47, M4, plus lentes) gardent la rafale normale.
    this._burstKey = this.weapon.fireRate <= 0.09 ? 'rafale_puissante' : 'sfx_rafale';
    AudioLib.playLoop(this._burstKey);
    const fire = () => {
      if (!this.weaponOut || !this.weapon || !this.weapon.auto) { this.stopBurst(); return; }
      if ((this.ammo[this.weapon.ammoType] || 0) <= 0) { this.stopBurst(); return; }
      this.shoot();
    };
    fire();
    this.burstTimer = setInterval(fire, Math.max(80, this.weapon.fireRate * 1000));
    announce('Rafale !', 'assertive');
  },
  stopBurst() {
    if (this.burstTimer) { clearInterval(this.burstTimer); this.burstTimer = null; }
    AudioLib.stopLoop(this._burstKey || 'sfx_rafale');
  },
  throwGrenade() {
    const it = this.inventory.find(i => i.category === 'explosif');
    if (!it) return announce('Vous n\'avez pas de grenade. Le marché noir en vend.', 'assertive');
    if (this.grenadeFusing) return announce('Une grenade est déjà dégoupillée, attendez l\'explosion.', 'assertive');
    const target = this.getLiveTarget();
    const cx = target ? target.x : this.x, cy = target ? target.y : this.y;
    this.removeItem(it.id, 1);
    this.grenadeFusing = true;
    announce('Grenade dégoupillée ! Mettez-vous à couvert.', 'assertive');
    const FUSE_LOOPS = 3; // le compte à rebours joue au moins 3 fois avant l'explosion
    AudioLib.playRepeated('sfx_decompte', FUSE_LOOPS, () => {
      this.grenadeFusing = false;
      AudioLib.playOnce('sfx_explosion');
      const radius = 6;
      let touched = 0;
      City.npcs.filter(n => !n.dead && UTIL.dist(n, { x: cx, y: cy }) <= radius).forEach(n => {
        n.health -= UTIL.randInt(40, 90); touched++;
        if (n.health <= 0) this.killNPC(n);
      });
      City.vehicles.filter(v => UTIL.dist(v, { x: cx, y: cy }) <= radius).forEach(v => { v.hp = Math.max(0, v.hp - UTIL.randInt(40, 80)); });
      if (UTIL.dist({ x: cx, y: cy }, this) <= radius) this.takeDamage(UTIL.randInt(20, 50), { explosion: true });
      this.wanted = Math.min(100, this.wanted + 25);
      Game.reportCrimeToPolice('explosion', 'Explosion entendue');
      announce(`Explosion ! Zone touchée autour de ${target ? target.name : 'votre position'}. ${touched} personne(s) affectée(s).`, 'assertive');
      this.npcVoiceReaction(cx, cy, { radius: radius + 8, count: 3 });
      updateHud();
    });
  },
  killNPC(npc) {
    announce(`${npc.name} est hors combat.`, 'assertive');
    const deathX = npc.x, deathY = npc.y;
    npc.dead = true; npc.knockedOut = true; // le corps reste sur place, fouillable (voir Game.searchTarget)
    AudioLib.playOnce('bruit_chute', { volume: 0.6 });
    this.npcPanicReaction(deathX, deathY, { count: 2 });
  },
  // Cri d'un PNJ touché (coup ou balle) — voix d'homme, choisi au hasard
  // parmi les 7 variantes disponibles.
  playNpcHitCry(npc) {
    AudioLib.playOnce(UTIL.pick(['cri_png_1', 'cri_png_2', 'cri_png_3', 'cri_png_4', 'cri_png_5', 'cri_png_6', 'cri_png_7']), { volume: 0.6 });
  },

  // Réactions vocales des PNJ selon la situation (témoins de violence, PNJ
  // hostiles/territoriaux, etc.). `opts.group` choisit le groupe de voix
  // (NPCVoiceGroups) à utiliser : "panique" par défaut, "enerve" pour les
  // PNJ hostiles, et d'autres groupes viendront s'ajouter à l'avenir.
  npcVoiceReaction(cx, cy, opts = {}) {
    const radius = opts.radius || 14;
    const count = opts.count || 1;
    const groupName = opts.group || 'panique';
    const group = NPCVoiceGroups[groupName] || NPCVoiceGroups.panique;
    const witnesses = City.npcs.filter(n => !n.dead && UTIL.dist(n, { x: cx, y: cy }) < radius);
    if (!witnesses.length) return;
    const chosen = [];
    for (let i = 0; i < Math.min(count, witnesses.length); i++) chosen.push(UTIL.pick(witnesses));
    chosen.forEach((n, i) => {
      setTimeout(() => {
        const pool = group.filter(l => l.gender === n.gender);
        const line = UTIL.pick(pool.length ? pool : group);
        const pan = Math.max(-1, Math.min(1, (n.x - this.x) / 15));
        AudioLib.playPositional(line.key, pan, 0.85);
      }, i * UTIL.randInt(150, 500)); // léger décalage pour éviter que les voix se superposent exactement
    });
  },
  // Alias conservé pour compatibilité avec le code existant.
  npcPanicReaction(cx, cy, opts = {}) { this.npcVoiceReaction(cx, cy, opts); },

  // Random encounters
  randomEncounters() {
    if (UTIL.chance(0.02)) {
      const options = ['Un chien aboie à l\'est.','Un klaxon retentit au nord.','Des sirènes au loin.','Des enfants rient à proximité.','Un moteur de moto démarre.','Une porte claque.','Un véhicule passe non loin.'];
      const msg = UTIL.pick(options);
      log(msg, 'system');
      if (msg.includes('klaxon') && City.isRoad(this.x, this.y)) {
        AudioLib.playPositional(UTIL.pick(['npc_klaxon_1', 'npc_klaxon_2', 'npc_klaxon_3', 'npc_klaxon_4', 'npc_klaxon_5']), UTIL.randInt(-10, 10) / 10, 0.6);
      } else if (msg.includes('véhicule passe') && City.isRoad(this.x, this.y)) {
        AudioLib.playPositional(UTIL.pick(['npc_veh_passage_1', 'npc_veh_passage_20kmh', 'veh_passage_ext_50kmh']), UTIL.randInt(-10, 10) / 10, 0.4);
      }
    }
    // Le passage d'un avion dans le ciel ne s'entend qu'à l'aéroport : c'est
    // là, et seulement là, que ça a du sens.
    if (UTIL.dist(this, City.pois.find(p => p.type === 'aeroport') || { x: -999, y: -999 }) < 25 && UTIL.chance(0.015)) {
      log('Un avion tourne dans le ciel de l\'aéroport.', 'system');
      AudioLib.playOnce('passage_avion_ciel', { volume: 0.3 });
    }
  },

  // Health and survival
  // Chance qu'un tir touche la tête plutôt qu'ailleurs — rare, mais mortel
  // sans casque de protection (voir takeDamage/permanentDeath).
  rollHeadshot() {
    return Math.random() < 0.08;
  },
  takeDamage(amount, opts = {}) {
    // Le gilet pare-balles réduit les dégâts d'un tir au corps (pas à la
    // tête — c'est le casque qui protège ça — ni d'une explosion).
    if (this.hasVest && !opts.headshot && !opts.explosion) amount = Math.round(amount * 0.65);
    this.health = Math.max(0, this.health - amount); updateHud();
    // Suivi des dégâts récents (15 dernières secondes) pour repérer une vraie
    // hémorragie massive : beaucoup trop d'impacts en peu de temps, pas juste
    // quelques balles.
    const now = Date.now();
    this._recentDamage = (this._recentDamage || []).filter(d => now - d.time < 15000);
    this._recentDamage.push({ time: now, amount });
    const recentTotal = this._recentDamage.reduce((s, d) => s + d.amount, 0);
    if (this.health <= 0) {
      const fatalHeadshot = opts.headshot && !this.hasHelmet;
      const fatalExplosion = !!opts.explosion;
      const bledOut = recentTotal > 200;
      if (fatalHeadshot || fatalExplosion || bledOut) {
        this.permanentDeath({ headshot: fatalHeadshot, explosion: fatalExplosion, bledOut });
      } else {
        this.die();
      }
    }
  },
  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount); updateHud();
  },
  survivalTick() {
    if (this.hunger > 90 || this.thirst > 90) this.takeDamage(0.05);
    if (this.health < 100 && this.hunger < 50 && this.thirst < 50) this.heal(0.02);
  },

  // Interactions
  interact() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
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
    // Check real connected players first (joueurs réels avant les PNJ)
    const nearbyPlayer = Array.from(Net.remotePlayers.values()).map(p => ({
      id: p.id, name: `${p.firstName} ${p.lastName}`, gender: p.gender, outfit: p.outfit, isPlayer: true, x: p.x, y: p.y,
      role: p.role, policeRank: p.policeRank, accountUsername: p.accountUsername || null,
    })).filter(p => UTIL.dist(p, this) < 3).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    if (nearbyPlayer) { this.describePerson(nearbyPlayer); return this.greetPlayer(nearbyPlayer); }
    // Check NPC
    const nearby = City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < 3).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    if (nearby) { this.describePerson(nearby); return this.talkTo(nearby); }
    // Check POI
    const poi = City.pois.find(p => UTIL.dist(p, this) < 3);
    if (poi) return this.enterPOI(poi);
    // Check house
    const house = City.houses.find(h => UTIL.dist(h, this) < 3);
    if (house) return this.enterHouse(house);
    // Check vehicle
    const veh = City.vehicles.filter(v => !this.inVehicle && UTIL.dist(v, this) < 3).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    if (veh) return this.interactVehicle();
    // Check mining site
    const mine = City.miningSites.find(m => UTIL.dist(m, this) < 4);
    if (mine) return this.mine(mine);
    // Check gang hideout (raid de gang, voir beginGangRaid)
    const gang = City.gangs.find(g => UTIL.dist(g, this) < 4);
    if (gang) return this.beginGangRaid(gang);
    // Check objets au sol (ramassage, voir pickUpItems)
    if ((City.groundItems || []).some(it => UTIL.dist(it, this) < 2)) return this.pickUpItems();
    announce('Rien à proximité. Faites un scan.', 'polite');
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
      let desc = `${sujet} masqué${estFemme ? 'e' : ''} est arrêté${estFemme ? 'e' : ''} droit devant vous. Impossible d'identifier qui c'est. `;
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
    let desc = `${sujet} est arrêté droit devant vous : ${displayName}, ${qualif}. `;
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
  talkTo(npc) {
    Audio.voiceHint(0);
    const line = UTIL.pick(npc.dialogue);
    announce(`${npc.name}, ${npc.job} : « ${line} »`, 'polite');
    if (npc.job === 'ganger') {
      // Réplique audio du groupe "énervé" pour renforcer l'hostilité des membres de gang.
      const pool = NPCVoiceGroups.enerve.filter(l => l.gender === npc.gender);
      const voice = UTIL.pick(pool.length ? pool : NPCVoiceGroups.enerve);
      const pan = Math.max(-1, Math.min(1, (npc.x - this.x) / 15));
      AudioLib.playPositional(voice.key, pan, 0.9);
    }
    if (npc.job === 'commercant' || npc.job === 'vendeur') this.openShop(npc);
    if (npc.job === 'mecanicien') this.repairVehicle();
    if (npc.job === 'medecin') { this.heal(30); this.money -= 5000; announce('Soins médicaux : 5 000 FCFA.', 'polite'); }
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
    if (poi.type === 'magasin' || poi.type === 'restaurant' || poi.type === 'pharmacie' || poi.type === 'vetements') { this.openShop(poi); }
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
    else if (poi.type === 'banque') { if (this.activeMission && this.activeMission.type === 'heist' && !this.heistState) this.beginBankHeist(); else this.bank(); }
    else if (poi.type === 'station_essence') { this.refuelVehicle(poi); }
    else if (poi.type === 'prison') { this.openPrison(poi); }
    else if (poi.type === 'aeroport' || poi.type === 'heliport') { this.aircraftMenu(poi); }
    else if (poi.type === 'mine') { const mine = City.miningSites.find(m => m.x === poi.x && m.y === poi.y); if (mine) { if (!this.miningMachine) announce(`Site minier. Ressource : ${mine.resource}. Achetez une machine d'extraction (750 000 FCFA, touche Ctrl+M) pour un bien meilleur rendement.`, 'polite'); this.mine(mine); } }
    else if (poi.type === 'entrepot') { this.openWarehouse(poi); }
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
  bank() {
    announce(`Solde bancaire : ${UTIL.formatMoney(this.money)}. Les banques gèrent vos fonds.`, 'polite');
  },
  aircraftMenu(poi) {
    const types = poi.type === 'heliport' ? ['helico'] : ['avion'];
    const list = City.vehicles.filter(v => types.includes(v.type) && !v.owner);
    if (!list.length) return announce('Aucun appareil disponible.', 'assertive');
    const v = list[0]; v.x = poi.x; v.y = poi.y + 2; v.locked = false;
    announce(`${v.name} prêt sur le tarmac.`, 'assertive');
  },
  openWarehouse(poi) {
    if (!this.ownedWarehouses.includes(poi.id)) {
      const price = 500000;
      if (this.money >= price) { this.money -= price; this.ownedWarehouses.push(poi.id); poi.owner = 'player'; Audio.cash(); announce(`Entrepôt acheté pour ${UTIL.formatMoney(price)}.`, 'assertive'); }
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
    this.money -= it.price; it.q--;
    const bought = { ...it, q: 1 };
    delete bought.q; bought.q = 1;
    this.addItem(bought);
    Audio.cash();
    announce(`Vous achetez ${it.name} pour ${UTIL.formatMoney(it.price)}.`, 'assertive');
    updateHud();
  },
  buyItemQty(index, qty) {
    const ctx = this.shopContext; if (!ctx) return announce('Ouvrez d\'abord un magasin.', 'assertive');
    const it = ctx.stock[index - 1];
    if (!it) return announce('Article non trouvé.', 'assertive');
    qty = Math.min(Math.max(1, Math.floor(qty) || 1), it.q);
    const total = it.price * qty;
    if (this.money < total) return announce(`Pas assez d'argent pour ${qty} ${it.name} (${UTIL.formatMoney(total)}).`, 'assertive');
    this.money -= total; it.q -= qty;
    this.addItem({ ...it, q: qty });
    Audio.cash();
    announce(`Vous achetez ${qty > 1 ? qty + ' ' : ''}${it.name} pour ${UTIL.formatMoney(total)}.`, 'assertive');
    updateHud();
  },
  sellItem() {
    if (!this.inventory.length) return announce('Rien à vendre.', 'assertive');
    const it = this.inventory[0];
    const price = Math.floor((it.price || 1000) * 0.6);
    this.money += price; this.removeItem(it.id, 1);
    Audio.cash(); announce(`Vous vendez ${it.name} pour ${UTIL.formatMoney(price)}.`, 'polite'); updateHud();
  },
  openVehicleShop(poi) {
    const available = Object.entries(VEHICLE_CATALOG).map(([k, v]) => ({ id: k, ...v }));
    this.vehicleShopContext = available;
    openVehicleCategoryMenu(poi, available);
  },
  // Verrouiller/déverrouiller son propre véhicule : possible dedans, ou juste à
  // côté d'un véhicule qu'on possède. Diffusé aux autres joueurs (vehicle_lock).
  toggleVehicleLock() {
    let v = this.inVehicle ? this.vehicle : City.vehicles.find(veh => veh.owner === 'player' && UTIL.dist(veh, this) < 3);
    if (!v) return announce('Aucun véhicule à vous à portée.', 'assertive');
    if (v.owner !== 'player') return announce('Ce véhicule ne vous appartient pas.', 'assertive');
    v.locked = !v.locked;
    sendWorldEdit('vehicle_lock', { id: v.id, locked: v.locked });
    announce(v.locked ? `${v.name} verrouillé.` : `${v.name} déverrouillé.`, 'assertive');
  },
  // Retrouver un véhicule : s'il n'y en a qu'un, guidage direct ; s'il y en a
  // plusieurs (garés à des endroits différents), un vrai choix s'affiche,
  // avec la distance et la direction de chacun. Inclut aussi le dernier
  // véhicule emprunté (non possédé), s'il est différent.
  findMyCar() {
    if (this.inVehicle) return announce('Vous êtes déjà dans un véhicule.', 'polite');
    const owned = (this.ownedVehicles || []).map(id => City.vehicles.find(v => v.id === id)).filter(Boolean);
    const borrowed = (this.lastParkedVehicle && !owned.some(v => v.id === this.lastParkedVehicle.id))
      ? City.vehicles.find(v => v.id === this.lastParkedVehicle.id) : null;
    const all = borrowed ? [...owned, borrowed] : owned;
    if (!all.length) return announce('Vous ne possédez aucun véhicule, et aucun n\'a été utilisé récemment.', 'assertive');
    if (all.length === 1) {
      const v = all[0];
      if (v.owner === 'player') AudioLib.playPositional('veh_alarme_position', UTIL.clamp((v.x - this.x) / 20, -1, 1), 0.5);
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
        if (v.owner === 'player') AudioLib.playPositional('veh_alarme_position', UTIL.clamp((v.x - this.x) / 20, -1, 1), 0.5);
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
    const nv = { id: 'owned_' + Date.now(), type: v.id, name: v.name, x: this.x + 1, y: this.y + 1, fuel: 1, hp: 100, locked: false, owner: 'player', inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: v.price, trunk: v.trunk };
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
    if (!active.length) { renderMenu([{ id: 'empty', title: 'Aucune mission disponible', desc: '' }], () => {}); return; }
    const items = active.map((m, i) => ({ id: String(i), title: `${m.title} — ${UTIL.formatMoney(m.reward)}`, desc: `${m.desc} Danger : ${m.danger}/100.` }));
    this.missionContext = active;
    renderMenu(items, (sel) => { closeMenu(); this.activateMission(parseInt(sel.id, 10) + 1); });
  },
  openExtremeMissions() {
    const active = City.missions.filter(m => (m.active || !m.completed) && m.extreme).slice(0, 12);
    if (typeof Phone !== 'undefined' && Phone.open) Phone.closePhone();
    el('menuOverlay').style.display = 'flex';
    el('menuTitle').textContent = 'Missions extrêmes';
    if (!active.length) { renderMenu([{ id: 'empty', title: 'Aucune mission extrême disponible pour l\'instant', desc: '' }], () => {}); return; }
    const items = active.map((m, i) => ({ id: String(i), title: `💀 ${m.title} — ${UTIL.formatMoney(m.reward)}`, desc: `${m.desc} Danger : ${m.danger}/100.` }));
    this.missionContext = active;
    renderMenu(items, (sel) => { closeMenu(); this.activateMission(parseInt(sel.id, 10) + 1); });
  },
  activateMission(index) {
    const m = this.missionContext?.[index - 1]; if (!m) return;
    this.activeMission = m; m.active = true;
    // Missions à IDs façon GTA : au lancement (sauf missions débutant), il
    // faut saisir les identifiants de toute l'équipe qui va la jouer. Seuls
    // ces identifiants pourront l'accomplir. Ça change à chaque reconnexion.
    // Boîte de saisie accessible (narrée par le jeu) : pas de prompt() natif,
    // qui ne peut pas être lu sans lecteur d'écran externe.
    if (!BEGINNER_MISSION_TYPES.includes(m.type) && !m.authorizedIds) {
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
    this.finishActivateMission(m);
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
    if (m.type === 'combat') return;
    if (m.type === 'convoyage') return;
    if (m.type === 'colis_fragile') return this.tickFragileDelivery(m);
    if (m.type === 'taxi_soigne') return this.tickTaxiSoigne(m);
    if (m.type === 'objet_perdu') return this.tickObjetPerdu(m);
    if (m.type === 'filature') return this.tickFilature(m);
    if (m.type === 'escorte') return this.tickEscorte(m);
    if (m.type === 'contrebande') return this.tickContrebande(m);
    if (m.type === 'urgence_medicale') return this.tickUrgenceMedicale(m);
    if (m.type === 'course_clandestine') return this.tickCourseClandestine(m);
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
      // Certaines missions sont clairement illégales : elles paient en argent
      // sale. Les autres (livraison, taxi, secours, réparation...) sont des jobs
      // légaux payés normalement — avant, TOUTES créditaient de l'argent sale et
      // étaient annoncées comme « illicites », ce qui était faux.
      const illegalTypes = ['trade', 'hunt', 'contrebande', 'gofast', 'recel_vehicule', 'braquage_superette', 'depot_armes_gang', 'planque_gardee'];
      const illegal = illegalTypes.includes(m.type);
      if (illegal) this.dirtyMoney += m.reward; else this.money += m.reward;
      Audio.cash(); m.completed = true; m.active = false; this.activeMission = null; this.completedMissions.push(m.id);
      // Le guidage GPS pointait vers ce point : on le coupe pour ne pas continuer
      // à guider vers une mission déjà terminée.
      this.guidanceTarget = null; this.guidanceAxis = null;
      RPJournal.log('Mission', `Mission accomplie : ${m.title}, ${UTIL.formatMoney(m.reward)}.`, illegal ? 'alert' : 'info');
      announce(`Vous êtes arrivé au point de mission. Mission accomplie ! Vous gagnez ${UTIL.formatMoney(m.reward)}${illegal ? ' d\'argent sale' : ''}.`, 'assertive');
      updateHud();
    } else {
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

  /* ==========================================================
     BRAQUAGE DE BANQUE — mission complète, jamais la même routine :
     chaque banque a un profil de sécurité propre (révélé au repérage),
     qui impose une méthode différente, avec gardes et otages possibles.
     ========================================================== */
  heistState: null,
  beginBankHeist() {
    const bank = City.pois.find(p => p.type === 'banque' && UTIL.dist(p, this) < 4);
    if (!bank) return announce('Approchez-vous de l\'entrée de la banque.', 'assertive');
    if (this.heistState) return announce('Le braquage est déjà en cours.', 'assertive');
    if (this.activeMission && !this.isMissionAuthorized(this.activeMission)) return announce(`Cette mission a été lancée avec d'autres identifiants (${this.activeMission.authorizedIds.join(', ')}).`, 'assertive');
    if (bank.vaultType === undefined) { bank.vaultType = UTIL.pick(['mecanique', 'electronique', 'renforce']); bank.guards = UTIL.randInt(0, 3); bank.cameras = Math.random() < 0.6; }

    const vaultLabel = { mecanique: 'un coffre mécanique classique', electronique: 'un coffre à verrouillage électronique', renforce: 'un coffre blindé renforcé' }[bank.vaultType];
    announce(`Repérage : ${vaultLabel}. ${bank.guards} garde${bank.guards > 1 ? 's' : ''} en poste. ${bank.cameras ? 'Caméras actives : plus grand risque d\'être identifié.' : 'Pas de caméra visible.'}`, 'assertive');

    const grenade = (this.inventory || []).find(i => i.category === 'explosif');
    el('menuTitle').textContent = 'Braquage de banque';
    const items = [];
    if (bank.vaultType === 'mecanique') {
      items.push({ id: 'discret', title: '🤫 Percer discrètement', desc: 'Environ 16 secondes, faible risque d\'alarme.' });
      items.push({ id: 'rapide', title: '💥 Forcer le coffre', desc: 'Environ 6 secondes, alarme presque certaine.' });
    } else if (bank.vaultType === 'electronique') {
      items.push({ id: 'discret', title: '🤫 Pirater discrètement', desc: 'Environ 18 secondes, faible risque d\'alarme.' });
    } else { // renforce
      items.push({ id: 'renforce_info', title: 'ℹ️ Coffre blindé', desc: 'Trop solide pour du perçage ou de la force : seuls des explosifs peuvent l\'ouvrir.' });
    }
    items.push({
      id: 'explosif',
      title: grenade ? '🧨 Faire sauter le coffre' : '🧨 Faire sauter le coffre (nécessite une grenade)',
      desc: bank.vaultType === 'renforce'
        ? 'Seule option contre un coffre blindé. Quasi instantané, mais très bruyant, et risque de blesser quelqu\'un aux alentours.'
        : 'Quasi instantané, mais très bruyant, alarme immédiate et une partie du butin peut être endommagée.',
    });
    items.push({ id: 'annuler', title: '↩️ Annuler', desc: 'Ne pas tenter le braquage maintenant.' });
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'annuler' || sel.id === 'renforce_info') return;
      if (sel.id === 'explosif') {
        if (!grenade) return announce('Il vous faut une grenade pour faire sauter ce coffre. Le marché noir en vend.', 'assertive');
        return this.executeExplosiveHeist(bank);
      }
      this.executeBankHeist(sel.id === 'rapide', bank);
    });
  },
  executeBankHeist(forced, bank) {
    const alarmChance = forced ? 0.9 : 0.25;
    const crackTime = forced ? 6000 : (bank.vaultType === 'electronique' ? 18000 : 16000);
    this.heistState = { forced, alarmed: false, hostage: false, bank };
    announce(forced
      ? 'Vous forcez le coffre. C\'est rapide, mais bruyant. Restez à proximité de la banque.'
      : 'Vous travaillez discrètement. Ça va prendre un moment. Restez à proximité de la banque.', 'assertive');
    if (Math.random() < alarmChance) {
      const delay = forced ? UTIL.randInt(800, 2000) : UTIL.randInt(4000, 12000);
      this.heistState.alarmTimer = setTimeout(() => this.triggerHeistAlarm(), delay);
    }
    // Un garde présent peut vous surprendre pendant l'opération — jamais garanti,
    // jamais au même moment : c'est ça qui évite la routine identique à chaque fois.
    if (bank.guards > 0) {
      const encounterChance = Math.min(0.75, bank.guards * 0.22 + (forced ? 0.15 : 0));
      if (Math.random() < encounterChance) {
        const delay = UTIL.randInt(1500, Math.max(2000, crackTime - 1500));
        this.heistState.guardTimer = setTimeout(() => this.heistGuardEncounter(), delay);
      }
    }
    this.heistState.crackTimer = setTimeout(() => this.finishVaultBreach(1), crackTime);
  },
  executeExplosiveHeist(bank) {
    const grenade = this.inventory.find(i => i.category === 'explosif');
    this.removeItem(grenade.id, 1);
    this.heistState = { forced: true, alarmed: false, hostage: false, bank, explosive: true };
    announce('Vous placez la charge et reculez...', 'assertive');
    setTimeout(() => {
      if (!this.heistState) return; // braquage déjà annulé entre-temps
      [0, 1].forEach(i => setTimeout(() => Audio.tone({ freq: 90, type: 'square', duration: 0.35, gain: 0.2, pan: 0 }), i * 120));
      announce('BOUM ! Le coffre a sauté.', 'assertive');
      this.triggerHeistAlarm();
      // Risque réel de blesser quelqu'un à proximité — change la gravité du délit.
      const bystander = City.npcs.find(n => !n.dead && UTIL.dist(n, this) < 6);
      if (bystander && UTIL.chance(0.35)) {
        bystander.health -= UTIL.randInt(10, 30);
        if (bystander.health <= 0) this.knockOut(bystander);
        announce(`${bystander.name} est blessé${bystander.gender === 'femme' ? 'e' : ''} par le souffle de l'explosion !`, 'assertive');
        this.wanted = Math.min(100, this.wanted + 25);
        this.reportCrimeToPolice('braquage_banque', 'Braquage violent avec explosifs, blessé signalé');
      }
      // Le butin est un peu endommagé par le souffle (multiplicateur 0.8).
      this.finishVaultBreach(0.8);
    }, 2200);
  },
  triggerHeistAlarm() {
    if (!this.heistState || this.heistState.alarmed) return;
    this.heistState.alarmed = true;
    // Alarme synthétisée localement : le fichier antivol reste réservé au vol de véhicule.
    [0, 1, 2, 3, 4].forEach(i => setTimeout(() => {
      if (this.heistState) Audio.tone({ freq: 1400, type: 'square', duration: 0.18, gain: 0.12, pan: 0 });
    }, i * 320));
    announce('L\'alarme se déclenche ! La police a été alertée, dépêchez-vous.', 'assertive');
    this.reportCrimeToPolice('braquage_banque', 'Braquage en cours');
    this.wanted = Math.min(100, this.wanted + 40);
  },
  // Un garde vous surprend : un vrai choix, pas juste "combat ou fuite".
  heistGuardEncounter() {
    if (!this.heistState) return;
    announce('Un garde vous surprend !', 'assertive');
    el('menuTitle').textContent = 'Un garde vous a repéré';
    const items = [
      { id: 'fight', title: '👊 Le neutraliser', desc: 'Risque de dégâts, et l\'alarme se déclenche presque à coup sûr.' },
      { id: 'hostage', title: '🔫 Le prendre en otage', desc: 'Il ne peut plus donner l\'alarme, mais une prise d\'otage est prise très au sérieux si elle est découverte.' },
      { id: 'flee', title: '🏃 Abandonner le braquage', desc: 'Vous partez immédiatement, sans le butin.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (!this.heistState) return; // le temps du menu, le perçage a pu se terminer
      if (sel.id === 'fight') {
        const dmg = UTIL.randInt(5, 20); this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`Vous neutralisez le garde, mais vous encaissez ${dmg} dégâts dans la bagarre.`, 'assertive');
        this.triggerHeistAlarm();
      } else if (sel.id === 'hostage') {
        this.takeHostage();
      } else {
        this.abortBankHeist();
      }
    });
  },
  takeHostage() {
    if (!this.heistState) return;
    const npc = City.npcs.find(n => !n.dead && UTIL.dist(n, this) < 6);
    this.heistState.hostage = true;
    this.hostageNPC = npc || null;
    announce(`Vous prenez ${npc ? npc.name : 'un employé'} en otage. Il ne donnera plus l'alarme pour l'instant, mais si la police l'apprend, c'est bien plus grave pour vous.`, 'assertive');
  },
  finishVaultBreach(lootMultiplier) {
    if (!this.heistState) return;
    if (this.heistState.hostage) {
      el('menuTitle').textContent = 'Que faire de l\'otage ?';
      const items = [
        { id: 'liberer', title: '🕊️ Libérer sans lui faire de mal', desc: 'Conséquences moins graves pour vous à l\'avenir.' },
        { id: 'assommer', title: '👊 L\'assommer avant de partir', desc: 'Retarde son témoignage, mais plus grave si vous êtes identifié.' },
      ];
      renderMenu(items, (sel) => {
        closeMenu();
        if (sel.id === 'assommer' && this.hostageNPC) this.knockOut(this.hostageNPC);
        this.hostageNPC = null;
        this.reportCrimeToPolice('prise_otage', 'Prise d\'otage lors d\'un braquage');
        this.wanted = Math.min(100, this.wanted + (sel.id === 'assommer' ? 35 : 15));
        this.finalizeBankHeistLoot(lootMultiplier);
      });
    } else {
      this.finalizeBankHeistLoot(lootMultiplier);
    }
  },
  finalizeBankHeistLoot(lootMultiplier) {
    const m = this.activeMission;
    if (!m) { this.heistState = null; return; }
    const amount = Math.max(30000, Math.round((m.reward + UTIL.randInt(-20000, 60000)) * lootMultiplier));
    this.dirtyMoney += amount;
    m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
    RPJournal.log('Mission', `Braquage réussi : ${UTIL.formatMoney(amount)} d'argent sale.`, 'alert');
    const alarmed = this.heistState.alarmed;
    this.heistState = null;
    announce(`Coffre percé ! Vous embarquez ${UTIL.formatMoney(amount)}. ${alarmed ? 'Fuyez avant que la police n\'arrive !' : 'Personne n\'a rien remarqué.'}`, 'assertive');
    updateHud();
  },
  abortBankHeist() {
    if (!this.heistState) return;
    clearTimeout(this.heistState.alarmTimer); clearTimeout(this.heistState.crackTimer); clearTimeout(this.heistState.guardTimer);
    if (this.heistState.hostage && this.hostageNPC) this.hostageNPC = null;
    this.heistState = null;
    announce('Le braquage est interrompu, le coffre reste intact.', 'assertive');
  },

  /* ==========================================================
     RAID DE REPAIRE DE GANG — mission de combat dont la récompense
     est du VRAI butin (armes + munitions), pas de l'argent.
     ========================================================== */
  beginGangRaid(gang) {
    if (!this.activeMission || this.activeMission.type !== 'combat') {
      return announce(`Repaire des ${gang.name} repéré. Activez une mission de combat depuis la tablette pour tenter un assaut ici.`, 'polite');
    }
    if (this.gangRaidState) return announce('L\'assaut est déjà en cours.', 'assertive');
    if (!this.isMissionAuthorized(this.activeMission)) return announce(`Cette mission a été lancée avec d'autres identifiants (${this.activeMission.authorizedIds.join(', ')}).`, 'assertive');
    announce(`Repérage : repaire des ${gang.name}. Environ ${gang.members} membre(s) armé(s), niveau de puissance ${gang.power}.`, 'assertive');
    el('menuTitle').textContent = `Assaut : ${gang.name}`;
    const items = [
      { id: 'frontal', title: '🔫 Assaut frontal', desc: 'Combat direct : les membres du gang apparaissent réellement, armés, et ripostent. Butin complet si vous survivez, mais très risqué et bruyant.' },
      { id: 'infiltration', title: '🥷 Infiltration discrète', desc: 'Tenter de voler l\'arsenal sans déclencher le combat. Moins de butin, moins de risque, mais chance réelle d\'être repéré et de devoir combattre quand même.' },
      { id: 'annuler', title: '↩️ Annuler', desc: 'Ne pas tenter l\'assaut maintenant.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'annuler') return;
      if (sel.id === 'frontal') this.launchGangCombat(gang, false);
      else this.attemptGangInfiltration(gang);
    });
  },
  attemptGangInfiltration(gang) {
    const caught = UTIL.chance(0.35 + gang.power / 300);
    if (caught) {
      announce('Vous êtes repéré en pleine infiltration ! Ils prennent les armes.', 'assertive');
      return this.launchGangCombat(gang, true);
    }
    announce('Vous filez discrètement avec une partie de l\'arsenal, sans un coup de feu.', 'assertive');
    gang.relation = Math.max(-100, gang.relation - 10);
    this.grantGangLoot(gang, 0.5);
  },
  // Fait apparaître de vrais PNJ du gang (position, arme, santé propres),
  // ciblables et combattables avec le système existant (scan, verrouillage,
  // tir, coup de poing) — plus un calcul abstrait de probabilité.
  launchGangCombat(gang, surprised) {
    const firstNames = ['Boukary', 'Idrissa', 'Salif', 'Mamadou', 'Aboubacar', 'Yacouba', 'Adama', 'Ousmane'];
    const lastNames = ['Sana', 'Zongo', 'Compaoré', 'Kaboré', 'Ilboudo', 'Ouédraogo', 'Nikiema'];
    const count = Math.max(1, Math.min(gang.members, 5));
    const pool = gang.power > 60 ? ['ak47', 'm4', 'pompe'] : gang.power > 30 ? ['pistolet_9', 'uzi'] : ['pistolet_9', 'revolver_38'];
    const npcIds = [];
    for (let i = 0; i < count; i++) {
      const job = 'ganger';
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: `gangnpc_${gang.id}_${Date.now()}_${i}`,
        name: `${UTIL.pick(firstNames)} ${UTIL.pick(lastNames)}`, job, gender,
        x: UTIL.clamp(gang.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(gang.y + UTIL.randInt(-3, 3), 0, City.H - 1),
        health: 100, relation: -100, money: UTIL.randInt(2000, 15000), inCar: false,
        dialogue: ['Dégage de mon territoire !', 'Vous n\'auriez pas dû venir ici.', 'On va vous faire regretter ça !'],
        home: { x: gang.x, y: gang.y }, hostile: true,
        weapon: UTIL.pick(pool), gender_: gender, outfit: generateNPCAppearance(job),
      };
      City.npcs.push(npc);
      npcIds.push(npc.id);
    }
    this.gangRaidState = { gang, npcIds };
    this.reportCrimeToPolice('coups_de_feu', `Fusillade au repaire des ${gang.name}`);
    announce(`${count} membre${count > 1 ? 's' : ''} du gang ${gang.name} vous font face${surprised ? ', surpris par votre présence' : ''} ! Faites un scan pour les localiser et les verrouiller comme cible.`, 'assertive');
    if (surprised) {
      const dmg = UTIL.randInt(5, 15);
      this.takeDamage(dmg, { headshot: this.rollHeadshot() });
      announce(`Ils ouvrent le feu en premier : ${dmg} dégâts avant que vous ne puissiez réagir.`, 'assertive');
    }
  },
  // Appelé en continu depuis gameLoop tant qu'un assaut de gang est en cours :
  // fait riposter les membres encore vivants, détecte victoire/défaite/fuite.
  updateGangCombat() {
    const rs = this.gangRaidState; if (!rs) return;
    if (this.health <= 0) { this.gangRaidState = null; return; } // die() gère déjà l'hôpital
    const squad = rs.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) return this.finishGangCombat(rs.gang, true);
    if (UTIL.dist(rs.gang, this) > 20) {
      this.gangRaidState = null;
      announce('Vous vous êtes trop éloigné : le repaire reste sous le contrôle du gang.', 'polite');
      return;
    }
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 14) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      const fireChance = Math.max(0.05, 0.35 - d * 0.015);
      if (weapon && UTIL.chance(fireChance)) {
        const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
        this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`${n.name} vous touche avec son ${weapon.name} ! ${dmg} dégâts.`, 'assertive');
      }
    });
  },
  finishGangCombat(gang, victory) {
    this.gangRaidState = null;
    if (!victory) return;
    gang.relation = Math.max(-100, gang.relation - 40);
    gang.power = Math.max(0, gang.power - 20);
    announce(`Repaire des ${gang.name} neutralisé !`, 'assertive');
    this.grantGangLoot(gang, 1);
  },

  /* ==========================================================
     TROIS MISSIONS FACILES — légales, sans combat, pour découvrir les
     outils de navigation en douceur.
     ========================================================== */

  // 1. Colis fragile : chronométré, à pied ou en véhicule léger ; chaque
  // collision (voir driveVehicle) abîme un peu plus le colis.
  fragileState: null,
  tickFragileDelivery(m) {
    if (!this.fragileState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        const distMeters = UTIL.dist({ x: m.x, y: m.y }, { x: m.dropX, y: m.dropY }) * CONFIG.METERS_PER_TILE;
        const timeLimit = Math.round(distMeters / 3) * 1000 + 25000;
        this.fragileState = { missionId: m.id, condition: 100, deadline: Date.now() + timeLimit };
        announce(`Colis récupéré ! Livrez-le à ${m.dropName} avant environ ${Math.round(timeLimit / 1000)} secondes. Évitez les chocs.`, 'assertive');
      }
      return;
    }
    if (Date.now() > this.fragileState.deadline) {
      announce('Trop de temps écoulé : le client renonce à la livraison.', 'assertive');
      this.fragileState = null; this.activeMission = null;
      return;
    }
    if (UTIL.dist({ x: this.x, y: this.y }, { x: m.dropX, y: m.dropY }) < 3) {
      const cond = Math.round(this.fragileState.condition);
      const amount = Math.round(m.reward * Math.max(0.3, cond / 100));
      this.money += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.fragileState = null;
      RPJournal.log('Mission', `Colis livré à ${cond}% d'état : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`Colis livré à ${cond}% d'état ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 2. Taxi soigné : monter le client, le conduire sans le secouer.
  taxiState: null,
  boardTaxiClient(npc, m) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule avant de faire monter le client.', 'assertive');
    this.vehicle.passengers = this.vehicle.passengers || [];
    this.vehicle.passengers.push({ id: npc.id, name: npc.name, health: npc.health });
    npc.dead = true; npc.x = -999; // le PNJ "monte" : on le retire du monde pendant la course
    this.taxiState = { missionId: m.id, satisfaction: 100, lastSpeed: 0, wasBraking: false };
    announce(`${npc.name} monte à bord. Conduisez-le à ${m.dropName} en douceur.`, 'assertive');
  },
  // Menu d'embarquement, ouvert une seule fois sur demande (touche E) — pas
  // à chaque image, ce qui rendait le menu inutilisable auparavant.
  openTaxiBoardMenu(client, m) {
    el('menuTitle').textContent = 'Course VIP';
    const items = [
      { id: 'board', title: `🚕 Faire monter ${client.name}`, desc: this.inVehicle ? `Direction : ${m.dropName}.` : 'Montez d\'abord dans un véhicule.' },
      { id: 'annuler', title: '↩️ Pas maintenant', desc: '' },
    ];
    renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'board') this.boardTaxiClient(client, m); });
  },
  // Appelé à chaque collision/freinage brutal pendant une course (voir driveVehicle).
  taxiRoughEvent(severity) {
    if (!this.taxiState) return;
    this.taxiState.satisfaction = Math.max(0, this.taxiState.satisfaction - severity);
    if (severity > 5) announce(UTIL.pick(['Aïe ! Doucement !', 'Vous auriez pu freiner plus tôt !', 'C\'est bien secouant, tout ça...']), 'polite');
  },
  tickTaxiSoigne(m) {
    if (!this.taxiState) return; // en attente d'embarquement, voir interact() / boardTaxiClient
    if (!this.inVehicle || !this.vehicle) return; // client à bord, en pause tant qu'on n'est pas au volant
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 4) {
      const sat = Math.round(this.taxiState.satisfaction);
      const amount = Math.round(m.reward * Math.max(0.2, sat / 100));
      this.money += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== m.clientId);
      this.taxiState = null;
      RPJournal.log('Mission', `Course VIP terminée, satisfaction ${sat}% : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`${sat >= 80 ? 'Client ravi' : sat >= 40 ? 'Client satisfait' : 'Client agacé'} ! Pourboire : ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Objet perdu : repérage sonore progressif (radar/balises), pas de risque.
  tickObjetPerdu(m) {
    const d = UTIL.dist({ x: this.x, y: this.y }, m);
    if (d < 2) {
      const amount = m.reward;
      this.money += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      RPJournal.log('Mission', `Objet retrouvé : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`Objet retrouvé ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    const now = Date.now();
    if (now - (this._lastObjetBeep || 0) > Math.max(150, d * 40)) {
      this._lastObjetBeep = now;
      Audio.tone({ freq: 900, type: 'sine', duration: 0.08, gain: 0.08, pan: this.panForPoint(m.x, m.y) });
    }
  },

  /* ==========================================================
     QUATRE MISSIONS DE DIFFICULTÉ MOYENNE
     ========================================================== */

  // 1. Filature discrète : rester dans la bonne fourchette de distance.
  filatureState: null,
  tickFilature(m) {
    const suspect = City.npcs.find(n => n.id === m.suspectId && !n.dead);
    if (!suspect) { this.activeMission = null; this.filatureState = null; return; }
    if (!this.filatureState) this.filatureState = { goodMs: 0, lastTick: Date.now(), lastWander: 0, suspicion: 0 };
    const fs = this.filatureState;
    const now = Date.now();
    const dt = Math.min(2000, now - fs.lastTick); fs.lastTick = now;
    if (now - fs.lastWander > 2000) {
      fs.lastWander = now;
      const nx = suspect.x + UTIL.randInt(-2, 2), ny = suspect.y + UTIL.randInt(-2, 2);
      if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { suspect.x = nx; suspect.y = ny; }
    }
    const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
    const d = UTIL.dist(suspect, myPos);
    if (d < 3) {
      fs.suspicion += dt / 1000 * 15;
      if (fs.suspicion > 100) {
        announce(`${suspect.name} vous a repéré et s'enfuit ! Filature ratée.`, 'assertive');
        this.filatureState = null; this.activeMission = null;
      }
    } else if (d <= 12) {
      fs.suspicion = Math.max(0, fs.suspicion - dt / 1000 * 5);
      fs.goodMs += dt;
      if (fs.goodMs > 40000) {
        const amount = m.reward;
        this.dirtyMoney += amount; Audio.cash();
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        this.filatureState = null;
        RPJournal.log('Mission', `Filature réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Vous découvrez la destination du suspect ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
      }
    } else {
      fs.goodMs = Math.max(0, fs.goodMs - dt * 2);
      if (d > 20) {
        announce('Vous avez perdu le suspect de vue. Filature ratée.', 'assertive');
        this.filatureState = null; this.activeMission = null;
      }
    }
  },

  // 2. Escorte sous menace : client réel à bord, embuscade possible avec de
  // vrais assaillants (mêmes principes que le raid de gang).
  escorteState: null,
  openEscorteBoardMenu(client, m) {
    el('menuTitle').textContent = 'Escorte';
    const items = [
      { id: 'board', title: `🛡️ Faire monter ${client.name}`, desc: `Direction : ${m.dropName}. Restez vigilant, une embuscade est possible.` },
      { id: 'annuler', title: '↩️ Pas maintenant', desc: '' },
    ];
    renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'board') this.boardEscorteClient(client, m); });
  },
  boardEscorteClient(npc, m) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule avant de faire monter le client.', 'assertive');
    this.vehicle.passengers = this.vehicle.passengers || [];
    this.vehicle.passengers.push({ id: npc.id, name: npc.name, health: npc.health });
    this.escorteState = { missionId: m.id, clientId: npc.id, ambushDone: false, npcIds: [] };
    announce(`${npc.name} monte, nerveux. Direction ${m.dropName}. Restez sur vos gardes.`, 'assertive');
  },
  triggerEscorteAmbush() {
    const es = this.escorteState; if (!es || !this.vehicle) return;
    announce('Une embuscade armée vous prend pour cible !', 'assertive');
    this.reportCrimeToPolice('coups_de_feu', 'Fusillade lors d\'une escorte');
    const firstNames = ['Rachid', 'Sidiki', 'Tahirou', 'Abdoul'];
    const lastNames = ['Barry', 'Cissé', 'Diakité'];
    const count = UTIL.randInt(1, 2);
    for (let i = 0; i < count; i++) {
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: 'ambushnpc_' + Date.now() + '_' + i, name: `${UTIL.pick(firstNames)} ${UTIL.pick(lastNames)}`, job: 'ganger', gender,
        x: UTIL.clamp(this.vehicle.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(this.vehicle.y + UTIL.randInt(-3, 3), 0, City.H - 1),
        health: 80, relation: -100, money: 0, inCar: false, dialogue: [], home: { x: this.vehicle.x, y: this.vehicle.y }, hostile: true,
        weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('ganger'),
      };
      City.npcs.push(npc); es.npcIds.push(npc.id);
    }
  },
  tickEscorte(m) {
    if (!this.escorteState) return; // le menu s'ouvre via interact(), voir openEscorteBoardMenu
    const es = this.escorteState;
    const client = City.npcs.find(n => n.id === es.clientId);
    if (!client || client.health <= 0) {
      announce('Votre client n\'a pas survécu. Escorte ratée.', 'assertive');
      this.escorteState = null; this.activeMission = null;
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    if (!es.ambushDone && Math.random() < 0.008) { es.ambushDone = true; this.triggerEscorteAmbush(); }
    if (es.npcIds.length) {
      const squad = es.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
      if (!squad.length) { es.npcIds = []; announce('Les assaillants sont neutralisés. La route est libre.', 'assertive'); }
      else {
        squad.forEach(n => {
          const d = UTIL.dist(n, this.vehicle);
          if (d > 12) return;
          const weapon = WEAPON_CATALOG[n.weapon];
          if (weapon && UTIL.chance(Math.max(0.05, 0.3 - d * 0.02))) {
            if (UTIL.chance(0.4)) {
              const dmg = Math.round(weapon.dmg * 0.6);
              client.health = Math.max(0, client.health - dmg);
              announce(`${client.name} est touché ! Santé : ${Math.round(client.health)}%.`, 'assertive');
            } else {
              const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
              this.takeDamage(dmg, { headshot: this.rollHeadshot() });
              announce(`${n.name} vous touche ! ${dmg} dégâts.`, 'assertive');
            }
          }
        });
        return;
      }
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 4) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== es.clientId);
      this.escorteState = null;
      RPJournal.log('Mission', `Escorte réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${client.name} arrive sain et sauf ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Contrebande : choix d'itinéraire, risque de contrôle policier.
  contrebandeState: null,
  tickContrebande(m) {
    if (!this.contrebandeState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        el('menuTitle').textContent = 'Contrebande — choisir l\'itinéraire';
        const items = [
          { id: 'centre', title: '🏙️ Passer par le centre-ville', desc: 'Plus court, mais bien plus de contrôles policiers.' },
          { id: 'peripherie', title: '🌾 Contourner par la périphérie', desc: 'Plus long, mais bien moins surveillé.' },
        ];
        renderMenu(items, (sel) => {
          closeMenu();
          const risky = sel.id === 'centre';
          this.contrebandeState = { missionId: m.id, risky };
          announce(`Cargaison de ${m.cargo} récupérée, itinéraire ${risky ? 'par le centre-ville' : 'par la périphérie'}.`, 'assertive');
        });
      }
      return;
    }
    const cs = this.contrebandeState;
    if (UTIL.dist({ x: this.x, y: this.y }, { x: m.dropX, y: m.dropY }) < 3) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.contrebandeState = null;
      RPJournal.log('Mission', `Contrebande livrée : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Cargaison livrée sans encombre ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    const chance = cs.risky ? 0.003 : 0.001;
    if (Math.random() < chance) {
      const caught = UTIL.chance(cs.risky ? 0.7 : 0.35);
      if (caught) {
        announce('Contrôle de police ! Vous êtes fouillé et la cargaison est saisie.', 'assertive');
        this.wanted = Math.min(100, this.wanted + 30);
        this.money = Math.max(0, this.money - 20000);
        this.activeMission = null; this.contrebandeState = null;
      } else {
        announce('Un contrôle de police est en vue... vous parvenez à l\'éviter de justesse.', 'polite');
      }
    }
  },

  // 4. Urgence médicale : repérage sonore, transport, dégradation dans le temps.
  medicalState: null,
  tickUrgenceMedicale(m) {
    if (!this.medicalState) {
      const victim = City.npcs.find(n => n.id === m.victimId && !n.dead);
      if (!victim) { this.activeMission = null; return; }
      const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
      const d = UTIL.dist(victim, myPos);
      if (d < 2) {
        if (!this.inVehicle || !this.vehicle) return announce('Trouvez un véhicule pour transporter le blessé.', 'assertive');
        this.vehicle.passengers = this.vehicle.passengers || [];
        this.vehicle.passengers.push({ id: victim.id, name: victim.name, health: victim.health });
        this.medicalState = { missionId: m.id, victimId: victim.id, lastTick: Date.now() };
        announce(`${victim.name} est installé(e) dans le véhicule. Direction l'hôpital, vite !`, 'assertive');
        return;
      }
      const now = Date.now();
      if (now - (this._lastMedBeep || 0) > Math.max(150, d * 40)) {
        this._lastMedBeep = now;
        Audio.tone({ freq: 500, type: 'sine', duration: 0.1, gain: 0.09, pan: this.panForPoint(victim.x, victim.y) });
      }
      return;
    }
    const ms = this.medicalState;
    const victim = City.npcs.find(n => n.id === ms.victimId);
    if (!victim) { this.medicalState = null; this.activeMission = null; return; }
    const now = Date.now();
    const dt = Math.min(2000, now - ms.lastTick); ms.lastTick = now;
    victim.health = Math.max(0, victim.health - dt / 1000 * 0.6);
    if (victim.health <= 0) {
      announce(`${victim.name} n'a pas survécu. Mission échouée.`, 'assertive');
      this.medicalState = null; this.activeMission = null;
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    const hopital = City.pois.find(p => p.type === 'hopital');
    if (hopital && UTIL.dist(this.vehicle, hopital) < 4) {
      const amount = m.reward;
      this.money += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== ms.victimId);
      victim.dead = true; victim.x = -999;
      this.medicalState = null;
      RPJournal.log('Mission', `Urgence médicale réussie : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`${victim.name} est sauvé(e) ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  /* ==========================================================
     TROIS MISSIONS SOLO SUPPLÉMENTAIRES
     ========================================================== */

  // 1. Course clandestine : un vrai rival avance en temps réel sur la carte.
  courseState: null,
  tickCourseClandestine(m) {
    if (!this.courseState) {
      if (!this.inVehicle || !this.vehicle) return;
      if (UTIL.dist(this.vehicle, m) < 3) {
        this.courseState = { missionId: m.id, rival: { x: m.x, y: m.y, speed: UTIL.rand(0.55, 0.85) } };
        announce(`Course lancée contre ${m.rivalName} ! Premier arrivé à ${m.dropName} gagne.`, 'assertive');
      }
      return;
    }
    const cs = this.courseState;
    const dx = m.dropX - cs.rival.x, dy = m.dropY - cs.rival.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = cs.rival.x + (dx / len) * cs.rival.speed, ny = cs.rival.y + (dy / len) * cs.rival.speed;
    if (City.isSolid(Math.round(nx), Math.round(ny))) { nx = cs.rival.x + UTIL.randInt(-1, 1); ny = cs.rival.y + UTIL.randInt(-1, 1); }
    cs.rival.x = UTIL.clamp(nx, 0, City.W - 1); cs.rival.y = UTIL.clamp(ny, 0, City.H - 1);
    if (UTIL.dist(cs.rival, { x: m.dropX, y: m.dropY }) < 3) {
      announce(`${m.rivalName} franchit la ligne d'arrivée avant vous. Course perdue.`, 'assertive');
      this.courseState = null; this.activeMission = null;
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    const cls = VEHICLE_CATALOG[this.vehicle.type];
    if (Math.abs(this.vehicle.speed) > cls.maxSpeed * 0.7 && City.npcs.some(n => !n.dead && UTIL.dist(n, this.vehicle) < 3) && UTIL.chance(0.05)) {
      this.reportCrimeToPolice('conduite_dangereuse', 'Course-poursuite dangereuse près de piétons');
      this.wanted = Math.min(100, this.wanted + 8);
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 3) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.courseState = null;
      RPJournal.log('Mission', `Course clandestine gagnée : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Vous franchissez la ligne en premier ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 2. Sabotage industriel : gardes patrouillant réellement, détection progressive.
  sabotageState: null,
  tickSabotage(m) {
    const guards = (m.guardIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    // Patrouille : chaque garde va-et-vient entre ses deux points de passage.
    guards.forEach(g => {
      if (!g.patrol) return;
      const target = g.patrol[g.patrolIdx || 0];
      if (UTIL.dist(g, target) < 1) { g.patrolIdx = ((g.patrolIdx || 0) + 1) % g.patrol.length; }
      else {
        const dx = Math.sign(target.x - g.x), dy = Math.sign(target.y - g.y);
        const nx = g.x + dx, ny = g.y + dy;
        if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { g.x = nx; g.y = ny; }
      }
    });
    if (this.sabotageState?.combat) {
      const squad = guards.filter(g => UTIL.dist(g, this) < 14);
      if (!squad.length || !guards.length) { this.sabotageState.combat = false; announce('Les gardes ne vous poursuivent plus.', 'polite'); return; }
      squad.forEach(g => {
        const d = UTIL.dist(g, this);
        const weapon = WEAPON_CATALOG[g.weapon];
        if (weapon && UTIL.chance(Math.max(0.05, 0.3 - d * 0.015))) {
          const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
          this.takeDamage(dmg, { headshot: this.rollHeadshot() });
          announce(`${g.name} vous touche ! ${dmg} dégâts.`, 'assertive');
        }
      });
      return;
    }
    // Détection : chance croissante à mesure qu'un garde s'approche.
    guards.forEach(g => {
      const d = UTIL.dist(g, this);
      if (d < 6 && UTIL.chance(Math.max(0, (6 - d) * 0.03))) {
        announce(`${g.name} vous repère ! L'alarme se déclenche.`, 'assertive');
        this.reportCrimeToPolice('intrusion', 'Intrusion détectée sur un site industriel');
        this.sabotageState = { missionId: m.id, combat: true };
      }
    });
    if (UTIL.dist({ x: this.x, y: this.y }, { x: m.objectiveX, y: m.objectiveY }) < 2 && !this.sabotageState?.combat) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.sabotageState = null;
      RPJournal.log('Mission', `Sabotage réussi sans être repéré : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Objectif atteint sans être repéré ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Chasse aux primes : capturer vivant, menotter, transporter (réutilise
  // le système existant : verrouillage, U pour menotter, P pour faire suivre).
  bountyState: null,
  tickChassePrimes(m) {
    const fugitive = City.npcs.find(n => n.id === m.fugitiveId);
    if (!fugitive) { this.activeMission = null; this.bountyState = null; return; }
    if (fugitive.dead && !fugitive.subdued) {
      announce(`${fugitive.name} est mort : la prime exige une capture vivante. Mission échouée.`, 'assertive');
      this.activeMission = null; this.bountyState = null;
      return;
    }
    if (!this.bountyState) {
      if (fugitive.menotte && fugitive.follow) {
        const station = City.pois.filter(p => p.type === 'police').sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
        this.bountyState = { missionId: m.id, fugitiveId: fugitive.id, stationX: station?.x, stationY: station?.y, stationName: station?.name || 'un commissariat' };
        const dir = station ? UTIL.bearing(station.x - this.x, station.y - this.y) : '';
        const dist = station ? Math.round(UTIL.dist(station, this) * CONFIG.METERS_PER_TILE) : 0;
        announce(`${fugitive.name} est maîtrisé et vous suit. Emmenez-le vivant à ${this.bountyState.stationName}, vers le ${dir}, à ${dist} mètres.`, 'assertive');
      }
      return;
    }
    if (UTIL.dist(this, { x: this.bountyState.stationX, y: this.bountyState.stationY }) < 3 && fugitive.menotte) {
      const amount = m.reward;
      this.money += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      fugitive.dead = true; fugitive.x = -999; fugitive.follow = false;
      this.bountyState = null;
      RPJournal.log('Mission', `Prime capturée vivante : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`${fugitive.name} est remis vivant à la police ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    if (Math.random() < 0.004) {
      if (UTIL.chance(0.4)) {
        fugitive.menotte = false; fugitive.follow = false;
        this.bountyState = null;
        announce(`${fugitive.name} profite d'un instant d'inattention et s'échappe !`, 'assertive');
      } else {
        announce(`${fugitive.name} tente de s'échapper, mais vous le rattrapez.`, 'polite');
      }
    }
  },

  /* ==========================================================
     MISSION EXTRÊME — DÉFENSE DE TERRITOIRE (multijoueur obligatoire)
     3 entrées distinctes à couvrir en même temps par de vrais joueurs
     réels : impossible de la déclencher seul.
     ========================================================== */
  defenseState: null,
  tickDefenseTerritoire(m) {
    if (!this.defenseState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 5) {
        const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
        const coverage = m.entrances.map(e => (UTIL.dist(this, e) < 6 ? 1 : 0) + others.filter(p => UTIL.dist(p, e) < 6).length);
        const coveredCount = coverage.filter(c => c > 0).length;
        if (coveredCount < 3) {
          announce(`Mission extrême "Défense de territoire" : il faut un joueur réel posté à chacune des 3 entrées en même temps pour déclencher l'assaut. Actuellement ${coveredCount} sur 3 couvertes. Coordonnez-vous.`, 'assertive');
          return;
        }
        this.defenseState = { missionId: m.id, wave: 1, npcIds: [] };
        this.reportCrimeToPolice('coups_de_feu', `Fusillade au repaire des ${m.gangName}`);
        announce(`Les 3 entrées sont couvertes ! La défense du repaire des ${m.gangName} commence.`, 'assertive');
        this.spawnDefenseWave(m);
      }
      return;
    }
    const ds = this.defenseState;
    const squad = ds.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 12) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.25 - d * 0.015))) {
        const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
        this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`${n.name} vous touche ! ${dmg} dégâts.`, 'assertive');
      }
    });
    if (!squad.length) {
      if (ds.wave >= 3) {
        const amount = m.reward;
        this.dirtyMoney += amount; Audio.cash();
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        this.defenseState = null;
        RPJournal.log('Mission', `Défense de territoire réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Les trois vagues sont repoussées ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
      } else {
        ds.wave++;
        announce(`Vague ${ds.wave} sur 3 !`, 'assertive');
        this.spawnDefenseWave(m);
      }
    }
  },
  spawnDefenseWave(m) {
    const ds = this.defenseState; if (!ds) return;
    const count = UTIL.randInt(2, 3) * ds.wave;
    for (let i = 0; i < count; i++) {
      const entrance = UTIL.pick(m.entrances);
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: 'defwave_' + Date.now() + '_' + i, name: `Assaillant ${i + 1}`, job: 'ganger', gender,
        x: UTIL.clamp(entrance.x + UTIL.randInt(-1, 1), 0, City.W - 1), y: UTIL.clamp(entrance.y + UTIL.randInt(-1, 1), 0, City.H - 1),
        health: 100, relation: -100, money: 0, inCar: false, dialogue: [], home: entrance, hostile: true,
        weapon: UTIL.pick(['pistolet_9', 'uzi', 'ak47']), outfit: generateNPCAppearance('ganger'),
      };
      City.npcs.push(npc); ds.npcIds.push(npc.id);
    }
  },

  /* ==========================================================
     MISSION EXTRÊME — CASSE À DEUX RÔLES (multijoueur obligatoire)
     Un poste électronique et un poste mécanique, à deux endroits
     séparés de la banque : il faut un joueur réel à chacun, en même
     temps, sinon le piratage/perçage se réinitialise entièrement.
     ========================================================== */
  extremeHeistState: null,
  tickCasseExtreme(m) {
    const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
    const meAtServer = UTIL.dist(this, m.serverPoint) < 3, meAtVault = UTIL.dist(this, m.vaultPoint) < 3;
    const serverCovered = meAtServer || others.some(p => UTIL.dist(p, m.serverPoint) < 3);
    const vaultCovered = meAtVault || others.some(p => UTIL.dist(p, m.vaultPoint) < 3);
    if (!this.extremeHeistState) {
      if (meAtServer || meAtVault) {
        if (serverCovered && vaultCovered) {
          this.extremeHeistState = { missionId: m.id, startedAt: Date.now(), crackTime: 25000 };
          announce('Les deux postes sont occupés à la fois ! Piratage et perçage démarrent en parallèle. Restez chacun à votre poste.', 'assertive');
          if (UTIL.chance(0.3)) this.extremeHeistState.alarmTimer = setTimeout(() => this.reportCrimeToPolice('braquage_banque', 'Casse à deux rôles en cours'), UTIL.randInt(5000, 15000));
        } else {
          announce(`Casse à deux rôles : il faut un joueur réel à la salle des serveurs ET un autre à la chambre forte, en même temps. Serveur ${serverCovered ? 'couvert' : 'non couvert'}, coffre ${vaultCovered ? 'couvert' : 'non couvert'}.`, 'assertive');
        }
      }
      return;
    }
    if (!(serverCovered && vaultCovered)) {
      clearTimeout(this.extremeHeistState.alarmTimer);
      this.extremeHeistState = null;
      announce('Un des deux postes a été abandonné : le piratage et le perçage se réinitialisent !', 'assertive');
      return;
    }
    if (Date.now() - this.extremeHeistState.startedAt > this.extremeHeistState.crackTime) {
      const amount = m.reward + UTIL.randInt(-50000, 150000);
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.extremeHeistState = null;
      RPJournal.log('Mission', `Casse à deux rôles réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Coffre ouvert des deux côtés à la fois ! Butin : ${UTIL.formatMoney(amount)}, à partager entre complices.`, 'assertive');
      updateHud();
    }
  },

  /* ==========================================================
     MISSION EXTRÊME — ATTAQUE DE CONVOI BLINDÉ (multijoueur obligatoire)
     Garde avant et garde arrière, à deux extrémités séparées : le camp
     laissé sans adversaire en face reçoit du renfort, punissant les
     tentatives en solo.
     ========================================================== */
  convoyState: null,
  tickConvoiBlinde(m) {
    const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
    const frontEngaged = UTIL.dist(this, m.frontPoint) < 6 || others.some(p => UTIL.dist(p, m.frontPoint) < 6);
    const rearEngaged = UTIL.dist(this, m.rearPoint) < 6 || others.some(p => UTIL.dist(p, m.rearPoint) < 6);
    if (!this.convoyState) {
      const meNear = UTIL.dist(this, m.frontPoint) < 6 || UTIL.dist(this, m.rearPoint) < 6;
      if (meNear && !(frontEngaged && rearEngaged)) {
        announce(`Attaque de convoi : il faut engager l'avant ET l'arrière en même temps, avec un joueur réel à chaque extrémité. Avant ${frontEngaged ? 'engagé' : 'libre'}, arrière ${rearEngaged ? 'engagé' : 'libre'}.`, 'assertive');
      }
      if (frontEngaged && rearEngaged) {
        this.convoyState = { missionId: m.id, lastReinforce: 0 };
        this.reportCrimeToPolice('coups_de_feu', 'Fusillade lors d\'une attaque de convoi');
        announce('Les deux extrémités du convoi sont engagées à la fois ! Neutralisez les gardes avant qu\'un camp ne reçoive du renfort.', 'assertive');
      }
      return;
    }
    const frontSquad = (m.frontIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    const rearSquad = (m.rearIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    [...frontSquad, ...rearSquad].forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 10) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.28 - d * 0.015))) {
        const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
        this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`${n.name} vous touche ! ${dmg} dégâts.`, 'assertive');
      }
    });
    const now = Date.now();
    if (frontSquad.length === 0 && rearSquad.length > 0 && !rearEngaged && now - this.convoyState.lastReinforce > 15000) {
      this.convoyState.lastReinforce = now;
      this.reinforceConvoySide(m, 'rear');
      announce('L\'arrière du convoi, laissé sans adversaire, reçoit du renfort !', 'assertive');
    }
    if (rearSquad.length === 0 && frontSquad.length > 0 && !frontEngaged && now - this.convoyState.lastReinforce > 15000) {
      this.convoyState.lastReinforce = now;
      this.reinforceConvoySide(m, 'front');
      announce('L\'avant du convoi, laissé sans adversaire, reçoit du renfort !', 'assertive');
    }
    if (frontSquad.length === 0 && rearSquad.length === 0) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.convoyState = null;
      RPJournal.log('Mission', `Convoi blindé neutralisé : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Convoi neutralisé aux deux extrémités ! Butin : ${UTIL.formatMoney(amount)}, à partager entre complices.`, 'assertive');
      updateHud();
    }
  },
  reinforceConvoySide(m, side) {
    const point = side === 'front' ? m.frontPoint : m.rearPoint;
    const idsArr = side === 'front' ? m.frontIds : m.rearIds;
    for (let g = 0; g < 2; g++) {
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: `convoy_reinf_${side}_${Date.now()}_${g}`, name: `Renfort ${side === 'front' ? 'avant' : 'arrière'}`, job: 'garde', gender,
        x: UTIL.clamp(point.x + UTIL.randInt(-1, 1), 0, City.W - 1), y: UTIL.clamp(point.y + UTIL.randInt(-1, 1), 0, City.H - 1),
        health: 100, relation: -80, money: 0, inCar: false, dialogue: [], home: point, hostile: true,
        weapon: UTIL.pick(['uzi', 'ak47']), outfit: generateNPCAppearance('garde'),
      };
      City.npcs.push(npc); idsArr.push(npc.id);
    }
  },

  /* ==========================================================
     DEUX MISSIONS EXTRÊMES SUPPLÉMENTAIRES — toutes jouables seul, mais
     avec un vrai risque accru ; la présence de vrais joueurs proches
     (voir countNearbyRealPlayers) réduit ce risque sans jamais bloquer
     la tentative solo.
     ========================================================== */

  // 1. Dépôt d'armes de gang : trois systèmes à gérer, jonglage nécessaire seul.
  depotState: null,
  tickDepotArmesGang(m) {
    const nearAny = UTIL.dist(this, m.camPoint) < 4 || UTIL.dist(this, m.patrolPoint) < 4 || UTIL.dist(this, m.vaultPoint) < 4;
    if (!this.depotState) {
      if (!nearAny) return;
      this.depotState = { missionId: m.id, cam: 0, patrol: 0, vault: 0, lastTick: Date.now() };
      announce('Vous entrez sur le site : caméras, patrouille et coffre à gérer en même temps, sans rien laisser stagner trop longtemps.', 'assertive');
    }
    const ds = this.depotState;
    const now = Date.now();
    const dt = Math.min(2000, now - ds.lastTick); ds.lastTick = now;
    const clamp01 = (v) => Math.max(0, Math.min(100, v));
    ds.cam = clamp01(ds.cam + (this.countNearbyRealPlayers(m.camPoint, 3) > 0 ? dt / 1000 * 8 : -dt / 1000 * 3));
    ds.patrol = clamp01(ds.patrol + (this.countNearbyRealPlayers(m.patrolPoint, 3) > 0 ? dt / 1000 * 8 : -dt / 1000 * 3));
    ds.vault = clamp01(ds.vault + (this.countNearbyRealPlayers(m.vaultPoint, 3) > 0 ? dt / 1000 * 6 : -dt / 1000 * 3));
    const guard = City.npcs.find(n => n.id === m.guardId);
    if (guard && !guard.dead) {
      const d = UTIL.dist(guard, this);
      if (d < 8) {
        const weapon = WEAPON_CATALOG[guard.weapon];
        if (weapon && UTIL.chance(Math.max(0.05, 0.2 - d * 0.015))) {
          const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
          this.takeDamage(dmg, { headshot: this.rollHeadshot() });
          announce(`${guard.name} vous repère et tire ! ${dmg} dégâts.`, 'assertive');
        }
        guard.x += Math.sign(this.x - guard.x); guard.y += Math.sign(this.y - guard.y);
      }
    }
    if (ds.cam >= 100 && ds.patrol >= 100 && ds.vault >= 100) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.depotState = null;
      RPJournal.log('Mission', `Dépôt d'armes du gang neutralisé : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Les trois systèmes sont neutralisés ! Butin : ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 2. Extraction VIP : escorte à travers un territoire hostile.
  vipState: null,
  tickExtractionVip(m) {
    const vip = City.npcs.find(n => n.id === m.vipId);
    if (!vip || vip.dead) { this.activeMission = null; this.vipState = null; return; }
    if (!this.vipState) {
      if (UTIL.dist(this, vip) < 3) {
        this.vipState = { missionId: m.id, lastAmbush: 0, lastAttackerId: null };
        vip.follow = true;
        announce(`${vip.name} vous suit. Direction ${m.extractName}, à travers un territoire hostile.`, 'assertive');
      }
      return;
    }
    vip.x = this.x; vip.y = this.y;
    const now = Date.now();
    const allies = this.countNearbyRealPlayers(this, 10);
    if (now - this.vipState.lastAmbush > (allies > 1 ? 20000 : 12000) && UTIL.chance(0.15)) {
      this.vipState.lastAmbush = now;
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = { id: 'vipambush_' + now, name: 'Assaillant', job: 'ganger', gender, x: UTIL.clamp(this.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(this.y + UTIL.randInt(-3, 3), 0, City.H - 1), health: 90, relation: -100, money: 0, inCar: false, dialogue: [], home: { x: this.x, y: this.y }, hostile: true, weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('ganger') };
      City.npcs.push(npc);
      this.vipState.lastAttackerId = npc.id;
      announce('Une embuscade vous prend pour cible pendant l\'extraction !', 'assertive');
    }
    if (this.vipState.lastAttackerId) {
      const attacker = City.npcs.find(n => n.id === this.vipState.lastAttackerId);
      if (attacker && !attacker.dead) {
        const d = UTIL.dist(attacker, this);
        if (d < 8 && UTIL.chance(0.3)) {
          const weapon = WEAPON_CATALOG[attacker.weapon];
          if (UTIL.chance(0.3)) { vip.health -= UTIL.randInt(10, 25); announce(`${vip.name} est touché ! Santé : ${Math.round(vip.health)}%.`, 'assertive'); }
          else { const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6)); this.takeDamage(dmg, { headshot: this.rollHeadshot() }); announce(`${attacker.name} vous touche ! ${dmg} dégâts.`, 'assertive'); }
        }
      } else { this.vipState.lastAttackerId = null; }
    }
    if (vip.health <= 0) {
      announce(`${vip.name} n'a pas survécu à l'extraction. Mission échouée.`, 'assertive');
      vip.dead = true; this.activeMission = null; this.vipState = null;
      return;
    }
    if (UTIL.dist(this, { x: m.extractX, y: m.extractY }) < 3) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      vip.follow = false; vip.dead = true; vip.x = -999;
      this.vipState = null;
      RPJournal.log('Mission', `Extraction VIP réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${vip.name} est en sécurité ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Braquage de supérette/station-service : rapide, classique, à haut risque de témoin.
  superetteState: null,
  tickBraquageSuperette(m) {
    if (!this.superetteState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        this.superetteState = { missionId: m.id, startedAt: Date.now(), crackTime: 9000 };
        announce(`Vous menacez la caisse de ${m.shopName} ! Vidage en cours, restez sur place...`, 'assertive');
        if (UTIL.chance(0.45)) this.superetteState.alarmTimer = setTimeout(() => this.reportCrimeToPolice('vol_main_armee', `Braquage signalé à ${m.shopName}`), UTIL.randInt(2000, 7000));
      }
      return;
    }
    if (UTIL.dist({ x: this.x, y: this.y }, m) > 4) {
      clearTimeout(this.superetteState.alarmTimer);
      this.superetteState = null;
      announce('Vous êtes parti trop vite : le braquage échoue.', 'assertive');
      return;
    }
    if (Date.now() - this.superetteState.startedAt > this.superetteState.crackTime) {
      const amount = Math.max(20000, m.reward + UTIL.randInt(-10000, 20000));
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.superetteState = null;
      RPJournal.log('Mission', `Braquage de supérette réussi : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Caisse vidée ! Vous embarquez ${UTIL.formatMoney(amount)}. Fuyez avant que ça ne remonte.`, 'assertive');
      updateHud();
    }
  },

  // 4. Go-fast : livraison de stupéfiants chronométrée, plusieurs points, risque de contrôle.
  gofastState: null,
  tickGofast(m) {
    if (!this.gofastState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        const totalDist = m.drops.reduce((acc, d, idx) => acc + UTIL.dist(idx === 0 ? m : m.drops[idx - 1], d), 0) * CONFIG.METERS_PER_TILE;
        const timeLimit = Math.round(totalDist / 10) * 1000 + 30000;
        this.gofastState = { missionId: m.id, dropIdx: 0, deadline: Date.now() + timeLimit };
        announce(`Cargaison récupérée. ${m.drops.length} points de dépose, environ ${Math.round(timeLimit / 1000)} secondes au total. Évitez les contrôles.`, 'assertive');
      }
      return;
    }
    const gs = this.gofastState;
    if (Date.now() > gs.deadline) {
      announce('Trop de temps écoulé, les acheteurs se sont désistés. Mission échouée.', 'assertive');
      this.gofastState = null; this.activeMission = null;
      return;
    }
    if (Math.random() < 0.0025) {
      if (UTIL.chance(0.4)) {
        announce('Contrôle de police ! Cargaison saisie.', 'assertive');
        this.wanted = Math.min(100, this.wanted + 25);
        this.gofastState = null; this.activeMission = null;
        return;
      } else {
        announce('Un contrôle en vue... évité de justesse.', 'polite');
      }
    }
    const drop = m.drops[gs.dropIdx];
    if (UTIL.dist({ x: this.x, y: this.y }, drop) < 3) {
      gs.dropIdx++;
      if (gs.dropIdx >= m.drops.length) {
        const amount = m.reward;
        this.dirtyMoney += amount; Audio.cash();
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        this.gofastState = null;
        RPJournal.log('Mission', `Go-fast terminé : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Toutes les livraisons faites ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
      } else {
        announce(`Livraison ${gs.dropIdx} sur ${m.drops.length} faite. Direction ${m.drops[gs.dropIdx].name}.`, 'assertive');
      }
    }
  },

  // 5. Planque gardée : un point précis avec du butin, gardé par des vigiles
  // armés. Repéré, ils attaquent ; tous éliminés, le butin devient accessible.
  stashState: null,
  tickPlanqueGardee(m) {
    const squad = (m.guardIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        const amount = m.reward;
        this.dirtyMoney += amount;
        const pool = ['pistolet_9', 'uzi', 'ak47'];
        const weaponId = UTIL.pick(pool); const weapon = WEAPON_CATALOG[weaponId];
        const ammoQty = UTIL.randInt(30, 80);
        this.addItem({ ...weapon, id: weaponId, category: 'arme', q: 1 });
        if (!this.weapons.includes(weaponId)) this.weapons.push(weaponId);
        this.addItem({ ...AMMO_CATALOG[weapon.ammoType], id: 'ammo_' + weapon.ammoType, category: 'munition', q: ammoQty });
        Audio.cash();
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        RPJournal.log('Mission', `Planque gardée pillée : ${UTIL.formatMoney(amount)} + ${weapon.name}.`, 'alert');
        announce(`Vigiles éliminés, butin récupéré : ${UTIL.formatMoney(amount)}, un ${weapon.name} et ${ammoQty} munitions.`, 'assertive');
        updateHud();
      } else if (!this.stashState) {
        announce('Les vigiles sont neutralisés. Approchez-vous du point pour récupérer le butin.', 'polite');
        this.stashState = true;
      }
      return;
    }
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 12) return;
      if (d < 8 && !this.stashState) { this.stashState = 'engaged'; this.reportCrimeToPolice('coups_de_feu', 'Fusillade sur une planque gardée'); announce('Les vigiles vous repèrent et ouvrent le feu !', 'assertive'); }
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.28 - d * 0.015))) {
        const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
        this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`${n.name} vous touche ! ${dmg} dégâts.`, 'assertive');
      }
    });
  },

  // 6. Recel de véhicule : voler le véhicule précis demandé et le livrer intact.
  chopState: null,
  tickRecelVehicule(m) {
    const vehicle = City.vehicles.find(v => v.id === m.vehicleId);
    if (!vehicle) { this.activeMission = null; return; }
    if (!this.inVehicle || this.vehicle?.id !== vehicle.id) {
      if (UTIL.dist({ x: this.x, y: this.y }, vehicle) < 3 && !vehicle.locked) {
        announce(`Montez dans ${vehicle.name} pour le livrer à ${m.dropName}.`, 'polite');
      }
      return;
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 4) {
      const conditionFactor = Math.max(0.4, this.vehicle.hp / 100);
      const amount = Math.round(m.reward * conditionFactor);
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      const vId = this.vehicle.id;
      this.interactVehicle();
      City.vehicles = City.vehicles.filter(v => v.id !== vId);
      RPJournal.log('Mission', `Véhicule recelé : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${m.vehicleTypeName} livré au garage clandestin, à ${Math.round(conditionFactor * 100)}% d'état. Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  /* ==========================================================
     ÉQUIPE D'INTERVENTION (niveau de recherche élevé, sans PNJ patrouille) —
     déclenchée par Police.tick() après un délai si le niveau de recherche
     reste trop haut. Pas de policier PNJ visible qui vous suit partout :
     juste un rattrapage abstrait, avec un vrai choix à ce moment-là.
     ========================================================== */
  wantedResponseState: null,
  triggerPoliceResponse() {
    if (this.wantedResponseState) return;
    this.wantedResponseState = { stage: 'menu' };
    announce('Une équipe d\'intervention vous a localisé !', 'assertive');
    el('menuTitle').textContent = 'Intervention policière';
    const items = [
      { id: 'render', title: '🙌 Se rendre', desc: 'Amende proportionnelle à votre niveau de recherche, qui retombe ensuite à zéro.' },
      { id: 'resister', title: '🔫 Résister', desc: 'Combat contre l\'équipe d\'intervention. Risqué, mais vous gardez tout si vous l\'emportez.' },
      { id: 'fuir', title: '🏃 Tenter de fuir', desc: this.inVehicle ? 'Meilleures chances en véhicule rapide.' : 'À pied, les chances sont faibles.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'render') this.surrenderToPolice();
      else if (sel.id === 'resister') this.resistPoliceResponse();
      else this.fleePoliceResponse();
    });
  },
  surrenderToPolice() {
    const fine = Math.min(this.money, Math.round(this.wanted * 800));
    this.money -= fine;
    this.wanted = 0;
    this.wantedResponseState = null;
    RPJournal.log('Police', `Reddition : amende de ${UTIL.formatMoney(fine)}.`, 'info');
    announce(`Vous vous rendez. Amende de ${UTIL.formatMoney(fine)}, niveau de recherche remis à zéro.`, 'assertive');
    updateHud();
  },
  resistPoliceResponse() {
    const firstNames = ['Agent Somé', 'Agent Kientega', 'Agent Zerbo'];
    const count = UTIL.randInt(1, 3);
    const npcIds = [];
    for (let i = 0; i < count; i++) {
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: 'wantedresp_' + Date.now() + '_' + i, name: UTIL.pick(firstNames), job: 'policier', gender,
        x: UTIL.clamp(this.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(this.y + UTIL.randInt(-3, 3), 0, City.H - 1),
        health: 100, relation: -100, money: 0, inCar: false, dialogue: [], home: { x: this.x, y: this.y }, hostile: true,
        weapon: UTIL.pick(['pistolet_9', 'pompe']), outfit: generateNPCAppearance('policier'),
      };
      City.npcs.push(npc); npcIds.push(npc.id);
    }
    this.wantedResponseState = { stage: 'combat', npcIds };
    announce(`${count} agent${count > 1 ? 's' : ''} vous encerclent !`, 'assertive');
  },
  fleePoliceResponse() {
    const chance = this.inVehicle && this.vehicle ? 0.6 : 0.3;
    if (UTIL.chance(chance)) {
      this.wanted = Math.max(0, this.wanted - 20);
      this.wantedResponseState = null;
      announce('Vous parvenez à leur échapper. Niveau de recherche réduit.', 'assertive');
    } else {
      announce('Ils vous rattrapent avant que vous ne puissiez fuir !', 'assertive');
      this.resistPoliceResponse();
    }
  },
  // Appelé en continu tant que l'équipe d'intervention est en combat.
  updateWantedResponseCombat() {
    const ws = this.wantedResponseState; if (!ws || ws.stage !== 'combat') return;
    if (this.health <= 0) { this.wantedResponseState = null; return; } // die() gère déjà l'hôpital
    const squad = ws.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) {
      this.wanted = Math.max(0, this.wanted - 30);
      this.wantedResponseState = null;
      announce('Vous avez neutralisé l\'équipe d\'intervention. Niveau de recherche réduit.', 'assertive');
      return;
    }
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 12) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.3 - d * 0.015))) {
        const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6));
        this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`${n.name} vous touche ! ${dmg} dégâts.`, 'assertive');
      }
    });
  },

  grantGangLoot(gang, multiplier) {
    const pool = gang.power > 60 ? ['ak47', 'm4', 'pompe'] : gang.power > 30 ? ['pistolet_9', 'uzi'] : ['pistolet_9', 'revolver_38'];
    const weaponId = UTIL.pick(pool);
    const weapon = WEAPON_CATALOG[weaponId];
    const ammoQty = Math.max(10, Math.round(UTIL.randInt(20, 60) * multiplier));
    // category: 'arme'/'munition' explicites : indispensable pour qu'addItem()
    // mette aussi à jour this.weapons et this.ammo (pas seulement l'inventaire
    // visible), sans quoi l'arme récupérée ne serait pas réellement équipable.
    this.addItem({ ...weapon, id: weaponId, category: 'arme', q: 1 });
    if (!this.weapons.includes(weaponId)) this.weapons.push(weaponId);
    this.addItem({ ...AMMO_CATALOG[weapon.ammoType], id: 'ammo_' + weapon.ammoType, category: 'munition', q: ammoQty });
    const m = this.activeMission;
    if (m) { m.completed = true; this.activeMission = null; this.completedMissions.push(m.id); }
    RPJournal.log('Mission', `Raid de gang réussi : ${weapon.name} + ${ammoQty} munitions récupérées.`, 'alert');
    announce(`Butin récupéré : un ${weapon.name}, prêt à équiper (touche G), et ${ammoQty} munitions correspondantes.`, 'assertive');
    updateHud();
  },

  /* ==========================================================
     CONVOYAGE DE VÉHICULE — mission avec choix d'itinéraire, minuterie
     et risque réel d'embuscade ; la récompense dépend de l'état du
     véhicule à l'arrivée (pas de "marche jusqu'au point" simpliste).
     ========================================================== */
  deliveryState: null,
  startVehicleDelivery(m) {
    const distMeters = UTIL.dist({ x: m.x, y: m.y }, { x: m.dropX, y: m.dropY }) * CONFIG.METERS_PER_TILE;
    el('menuTitle').textContent = 'Convoyage : choisir l\'itinéraire';
    const items = [
      { id: 'rapide', title: '⚡ Route rapide (centre-ville)', desc: 'Plus court, mais très surveillé : bien plus de risques de vous faire repérer ou intercepter.' },
      { id: 'sur', title: '🛣️ Route détournée (périphérie)', desc: 'Plus long, mais bien plus discret.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      const risky = sel.id === 'rapide';
      const timeLimit = Math.round(distMeters / (risky ? 14 : 9)) * 1000 + 15000;
      this.deliveryState = { missionId: m.id, vehicleId: m.vehicleId, risky, deadline: Date.now() + timeLimit, ambushDone: false };
      announce(`Livraison lancée, ${risky ? 'route rapide' : 'route détournée'}. Environ ${Math.round(timeLimit / 1000)} secondes pour livrer le véhicule à ${m.dropName}, à ${Math.round(distMeters)} mètres. Le véhicule doit arriver en bon état pour la prime complète.`, 'assertive');
    });
  },
  // Appelé en continu depuis gameLoop tant qu'une livraison est en cours.
  updateVehicleDelivery() {
    const ds = this.deliveryState; if (!ds) return;
    const m = this.activeMission;
    if (!m || m.id !== ds.missionId) { this.deliveryState = null; return; }
    if (!this.inVehicle || !this.vehicle || this.vehicle.id !== ds.vehicleId) return; // en pause, pas annulé
    if (Date.now() > ds.deadline) {
      announce('Trop de temps écoulé : le client s\'est désisté, la livraison est un échec.', 'assertive');
      this.deliveryState = null; this.activeMission = null;
      return;
    }
    if (!ds.ambushDone && Math.random() < (ds.risky ? 0.006 : 0.002)) {
      ds.ambushDone = true;
      return this.deliveryAmbush();
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 5) this.completeVehicleDelivery();
  },
  deliveryAmbush() {
    if (!this.deliveryState || !this.vehicle) return;
    announce('Une bande rivale vous bloque la route et veut le véhicule !', 'assertive');
    el('menuTitle').textContent = 'Embuscade';
    const items = [
      { id: 'fight', title: '🔫 Résister', desc: 'Combat pour garder le véhicule : risque de dégâts pour vous et pour le véhicule.' },
      { id: 'flee', title: '🏎️ Forcer le passage', desc: 'Tenter de foncer : le véhicule risque d\'être abîmé, mais rien d\'autre.' },
      { id: 'abandon', title: '🏳️ Abandonner le véhicule', desc: 'Ils repartent avec. La livraison échoue.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (!this.deliveryState || !this.vehicle) return;
      if (sel.id === 'fight') {
        const dmg = UTIL.randInt(10, 25); this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        this.vehicle.hp = Math.max(0, this.vehicle.hp - UTIL.randInt(10, 30));
        announce(`Vous repoussez l'attaque, mais vous encaissez ${dmg} dégâts et le véhicule est abîmé.`, 'assertive');
      } else if (sel.id === 'flee') {
        this.vehicle.hp = Math.max(0, this.vehicle.hp - UTIL.randInt(15, 35));
        announce('Vous forcez le passage : le véhicule encaisse des dégâts au passage.', 'assertive');
      } else {
        announce('Vous abandonnez le véhicule aux mains de la bande. La livraison échoue.', 'assertive');
        const vId = this.vehicle.id;
        this.activeMission = null; this.deliveryState = null;
        if (this.inVehicle) this.interactVehicle();
        City.vehicles = City.vehicles.filter(v => v.id !== vId);
      }
    });
  },
  completeVehicleDelivery() {
    const m = this.activeMission;
    if (!m || !this.vehicle) { this.deliveryState = null; return; }
    const conditionPct = Math.round(this.vehicle.hp);
    const conditionFactor = Math.max(0.4, this.vehicle.hp / 100);
    const amount = Math.round(m.reward * conditionFactor);
    const vId = this.vehicle.id;
    this.dirtyMoney += amount;
    m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
    this.deliveryState = null;
    this.interactVehicle(); // descend automatiquement, la livraison est remise sur place
    City.vehicles = City.vehicles.filter(v => v.id !== vId);
    RPJournal.log('Mission', `Convoyage livré à ${conditionPct}% d'état : ${UTIL.formatMoney(amount)}.`, 'alert');
    announce(`Livraison réussie, véhicule remis à ${conditionPct}% d'état. Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
    updateHud();
  },


  // Voice navigation guide
  guide() {
    const around = [];
    const poi = City.pois.filter(p => UTIL.dist(p, this) < 40).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    if (poi) around.push(`${poi.name} à ${Math.round(UTIL.dist(poi, this) * CONFIG.METERS_PER_TILE)} m, ${UTIL.bearing(poi.x - this.x, poi.y - this.y)}`);
    const road = this.nearestRoadInfo();
    if (road) around.push(`Route la plus proche : ${road.dist} m, ${road.bearing}`);
    const house = City.houses.find(h => UTIL.dist(h, this) < 25);
    if (house) around.push(`Logement ${house.name} à ${Math.round(UTIL.dist(house, this) * CONFIG.METERS_PER_TILE)} m`);
    const msg = around.length ? 'Autour de vous : ' + around.join('. ') : 'Aucun repère notable à proximité.';
    announce(msg, 'polite');
  },
  nearestRoadInfo() {
    let best = null;
    for (let ax of City.roadAxes) {
      const dist = ax.axis === 'x' ? Math.abs(this.y - ax.pos) : Math.abs(this.x - ax.pos);
      const bearing = ax.axis === 'x' ? UTIL.bearing(0, ax.pos - this.y) : UTIL.bearing(ax.pos - this.x, 0);
      if (!best || dist < best.dist) best = { dist: Math.round(dist * CONFIG.METERS_PER_TILE), bearing };
    }
    return best;
  },
  compass() { announce(`Cap actuel : ${UTIL.cardinals[this.heading]}.`, 'polite'); },

  autoDriveMenu() {
    if (!this.inVehicle || !this.vehicle) return announce('Montez d\'abord dans un véhicule.', 'assertive');
    const dests = ['hôpital','police','banque','magasin','armurerie','concessionnaire','aéroport','héliport','port','mine','maison'];
    announce('Conduite automatique : dites un lieu, par exemple hôpital, police, banque, magasin, armurerie, aéroport, héliport, port, mine.', 'polite');
  },
  help() {
    announce('Commandes : flèches pour se déplacer, E interagir, T tirer, R recharger, A arme, P téléphone, K ordinateur, B inventaire, L position, C boussole, F radar de balayage, V micro de proximité, S maintenue pour parler au talkie, Maj+C visite guidée, Maj+B balises sonores, Maj+G arrêter le guidage, Maj+P fouiller sa poche, Maj+U faire suivre une cible menottée, X coup de poing, Y porter, Shift+Z installer dans véhicule, Shift+T testament au commissariat, Ctrl+J menu véhicule, Ctrl+F fouille cible, Alt+F fouille soi, Ctrl+L verrouiller son véhicule, Ctrl+S sirène, Ctrl+M acheter une machine d\'extraction minière, Ctrl+O ma tenue, Ctrl+A mode staff, F9-F12 raccourcis, Ctrl+1-9 ciblage rapide. Dans les menus et pour choisir une quantité à donner ou déposer : flèches Haut/Bas pour ±1 ou se déplacer, Gauche/Droite pour ±5, Entrée pour valider, Échap pour annuler. Sur mobile, le même geste de glissement sert à naviguer et à ajuster une quantité, et le double-tap valide.', 'polite');
  },

  // Save / load
  save() {
    const payload = {
      x: this.x, y: this.y, altitude: this.altitude, heading: this.heading, health: this.health, money: this.money,
      bank: this.bank, dirtyMoney: this.dirtyMoney, hunger: this.hunger, thirst: this.thirst, energy: this.energy,
      inventory: this.inventory, weapons: this.weapons, ammo: this.ammo, ammoReserve: this.ammoReserve, ownedVehicles: this.ownedVehicles,
      // Les véhicules achetés sont créés dynamiquement (pas générés par la
      // ville) : il faut sauvegarder leurs données complètes, sinon ils
      // n'existeraient simplement plus après un rechargement.
      ownedVehicleData: this.ownedVehicles.map(id => City.vehicles.find(v => v.id === id)).filter(Boolean),
      ownedHouses: this.ownedHouses, ownedWarehouses: this.ownedWarehouses, wanted: this.wanted,
      completedMissions: this.completedMissions, activeMissionId: this.activeMission?.id || null,
      role: this.role, policeRank: this.policeRank, licenses: this.licenses, skills: this.skills,
      will: this.will, tickets: this.tickets, invoices: this.invoices,
      player: this.player, outfit: this.outfit, miningMachine: this.miningMachine, talkie: this.talkie,
      rolesCurrent: Roles.current, rolesRecruiters: Roles.recruiters, savedPlaces: this.savedPlaces, ownsTablet: this.ownsTablet,
      phones: this.phones, activePhoneIndex: this.activePhoneIndex, lastParkedVehicle: this.lastParkedVehicle, theoryPassed: this.theoryPassed, flightTheoryPassed: this.flightTheoryPassed, myContacts: this.myContacts,
      hasHelmet: this.hasHelmet, hasVest: this.hasVest, pendingBills: this.pendingBills,
    };
    localStorage.setItem('blind_city_v18', JSON.stringify(payload));
    // Si un compte joueur est connecté, pousse aussi la sauvegarde côté
    // serveur : c'est ce qui permet de la retrouver depuis un autre appareil.
    if (Net.connected && Net.accountUsername) Net.saveProgressToServer(payload);
    announce('Partie sauvegardée.', 'polite');
  },
  load() {
    const s = localStorage.getItem('blind_city_v18') || localStorage.getItem('blind_city_v17') || localStorage.getItem('city_blind_v16') || localStorage.getItem('city_blind_v15') || localStorage.getItem('city_blind_v12') || localStorage.getItem('city_blind_v10'); if (!s) return;
    try { this.applySaveData(JSON.parse(s)); } catch(e) { console.error(e); }
  },
  // Applique un objet de sauvegarde (venant du stockage local OU d'un compte
  // serveur) — doit être appelé APRÈS City.generate(), puisque la
  // resynchronisation des missions/véhicules a besoin que la ville existe déjà.
  applySaveData(d) {
    try {
      Object.assign(this, d);
      if (!this.player) this.player = { firstName: 'Joueur', lastName: 'Anonyme', gender: 'homme', registered: false };
      if (!this.outfit) this.outfit = { haut: null, bas: null, chaussures: null, couleurHaut: null, couleurBas: null, couleurChaussures: null, coiffure: null, lunettes: null, accessoires: [] };
      else for (const k of ['couleurHaut', 'couleurBas', 'couleurChaussures', 'coiffure', 'lunettes']) if (!(k in this.outfit)) this.outfit[k] = null;
      if (!('isPolice' in this.outfit)) this.outfit.isPolice = false;
      if (!('masque' in this.outfit)) this.outfit.masque = false;
      if (!this.talkie) this.talkie = { owned: false, battery: 1, on: false, frequency: 151.5 };
      if (!Array.isArray(this.savedPlaces)) this.savedPlaces = [];
      if (!Array.isArray(this.myContacts)) this.myContacts = [];
      if (!Array.isArray(this.pendingBills)) this.pendingBills = [];
      if (!this.ammoReserve || typeof this.ammoReserve !== 'object') this.ammoReserve = {};
      if (!Array.isArray(this.completedMissions)) this.completedMissions = [];
      // Réinjecte les véhicules possédés (créés dynamiquement, donc absents
      // de la ville fraîchement régénérée) sans dupliquer s'ils y sont déjà.
      (d.ownedVehicleData || []).forEach(v => {
        if (!City.vehicles.some(existing => existing.id === v.id)) City.vehicles.push(v);
      });
      if (d.rolesCurrent) Roles.current = d.rolesCurrent;
      if (d.rolesRecruiters) Roles.recruiters = d.rolesRecruiters;
      // Resynchronise les missions déjà accomplies lors d'une session
      // précédente : sans ça, elles réapparaissaient comme disponibles après
      // un rechargement, puisque la ville est régénérée à chaque démarrage.
      this.completedMissions.forEach(id => {
        const m = City.missions.find(mm => mm.id === id);
        if (m) m.completed = true;
      });
      // Restaure la mission active (juste son assignation ; l'état de combat
      // éphémère d'une action en cours — braquage, assaut, etc. — n'est
      // volontairement pas conservé, il faudrait recommencer cette tentative).
      if (d.activeMissionId) {
        const m = City.missions.find(mm => mm.id === d.activeMissionId && !mm.completed);
        this.activeMission = m || null;
        if (m) announce(`Mission en cours retrouvée : ${m.title}.`, 'polite');
      }
      announce('Partie chargée.', 'polite');
    } catch(e) { console.error(e); }
  },


  // Talkie-walkie
  buyTalkie() {
    if (this.talkie.owned) return announce('Vous possédez déjà un talkie-walkie.', 'polite');
    const price = 45000;
    if (this.money < price) return announce(`Talkie-walkie : ${UTIL.formatMoney(price)}.`, 'assertive');
    this.money -= price; this.talkie.owned = true; this.talkie.battery = 1;
    Audio.cash();
    announce('Talkie-walkie acheté, batterie pleine.', 'assertive');
    updateHud();
  },
  // Tablette : appareil séparé du téléphone, exigé pour consulter et accepter
  // les missions (combats de gangs, livraisons, braquages...).
  buyTablet() {
    if (this.ownsTablet) return announce('Vous possédez déjà une tablette.', 'polite');
    const price = 60000;
    if (this.money < price) return announce(`Tablette : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.ownsTablet = true;
    Audio.cash();
    announce('Tablette achetée. Vous l\'avez maintenant sur vous, avec le téléphone : fouillez votre poche (Maj+P) pour choisir lequel ouvrir.', 'assertive');
    updateHud();
  },
  // Casque de protection : seule protection contre un tir ou un coup de
  // couteau à la tête, qui serait autrement mortel de façon définitive.
  hasHelmet: false,
  buyHelmet() {
    if (this.hasHelmet) return announce('Vous portez déjà un casque de protection.', 'polite');
    const price = 35000;
    if (this.money < price) return announce(`Casque de protection : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.hasHelmet = true;
    Audio.cash();
    announce('Casque de protection porté. Il vous protège d\'un tir ou d\'un coup à la tête qui serait autrement mortel.', 'assertive');
    updateHud();
  },
  hasVest: false,
  buyVest() {
    if (this.hasVest) return announce('Vous portez déjà un gilet pare-balles.', 'polite');
    const price = 45000;
    if (this.money < price) return announce(`Gilet pare-balles : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.hasVest = true;
    Audio.cash();
    announce('Gilet pare-balles porté. Il réduit les dégâts d\'un tir au corps.', 'assertive');
    updateHud();
  },
  // Numéros de téléphone : chaque téléphone a le sien, purement pour
  // l'affichage — on peut renommer le nom qui s'affiche chez les autres
  // (façon téléphone prépayé/professionnel), indépendamment de son vrai nom.
  buyBurnerPhone() {
    const price = 25000;
    if (this.money < price) return announce(`Téléphone prépayé : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price;
    this.phones.push({ number: UTIL.generatePhoneNumber(), label: '' });
    Net.registerNumbers();
    Audio.cash();
    announce(`Nouveau téléphone acheté, numéro ${this.phones[this.phones.length - 1].number}. Renommez-le pour lui donner un nom affiché aux autres.`, 'assertive');
    updateHud();
  },
  renamePhoneLabel(index) {
    const phone = this.phones[index]; if (!phone) return;
    AccessibleTextPrompt.open('Renommer ce numéro', `Nom affiché aux autres quand vous appelez ou écrivez depuis le ${phone.number}. Actuellement : ${phone.label || 'aucun nom, votre vrai nom sera visible'}.`, phone.label || '', (name) => {
      phone.label = (name || '').trim();
      Net.registerNumbers();
      announce(`Numéro ${phone.number} : ${phone.label || 'aucun nom, votre vrai nom sera visible'}.`, 'assertive');
    });
  },
  setActivePhone(index) {
    if (!this.phones[index]) return;
    this.activePhoneIndex = index;
    const p = this.phones[index];
    announce(`Numéro actif : ${p.number}${p.label ? ', affiché comme ' + p.label : ''}.`, 'assertive');
  },
  // Nom affiché aux autres pour l'appel/message en cours : le nom personnalisé
  // du numéro actif, sinon le vrai nom du personnage par défaut.
  activeCallerName() {
    const p = this.phones[this.activePhoneIndex];
    return (p && p.label) ? p.label : `${this.player.firstName} ${this.player.lastName}`;
  },
  openMyPhoneNumbers() {
    el('menuTitle').textContent = 'Mes numéros';
    const items = this.phones.map((p, i) => ({
      id: String(i),
      title: `${i === this.activePhoneIndex ? '✅ ' : ''}${p.number}${p.label ? ' — ' + p.label : ''}`,
      desc: i === this.activePhoneIndex ? 'Numéro actif pour vos appels et messages.' : 'Sélectionnez pour l\'activer, ou renommez-le.',
    }));
    if (typeof Phone !== 'undefined' && Phone.open) Phone.closePhone();
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      const idx = parseInt(sel.id, 10);
      el('menuTitle').textContent = this.phones[idx].number;
      const subItems = [
        { id: 'activate', title: '✅ Activer ce numéro', desc: 'Utilisé pour vos prochains appels/messages.' },
        { id: 'rename', title: '✏️ Renommer', desc: 'Changer le nom affiché aux autres.' },
        { id: 'back', title: '↩️ Retour', desc: '' },
      ];
      renderMenu(subItems, (sub) => {
        if (sub.id === 'activate') { closeMenu(); this.setActivePhone(idx); }
        else if (sub.id === 'rename') { closeMenu(); this.renamePhoneLabel(idx); }
        else this.openMyPhoneNumbers();
      });
    });
  },
  // "Fouiller sa poche" façon GTA : téléphone et tablette peuvent être
  // possédés en même temps, on choisit ici lequel ouvrir (plus l'ordinateur/
  // outil de piratage, qui est un appareil à part entière).
  openPocketDevices() {
    el('menuTitle').textContent = 'Votre poche';
    const items = [
      { id: 'phone', title: '📱 Téléphone', desc: 'Contacts, messages, appels, garage, carte, réglages.' },
      { id: 'tablet', title: '📲 Tablette', desc: this.ownsTablet ? 'Tout ce qu\'a le téléphone, plus les missions extrêmes.' : 'Non possédée — 60 000 FCFA.' },
      { id: 'computer', title: '💻 Ordinateur (outil de piratage)', desc: 'Terminal de piratage : banque, coffres, systèmes.' },
      { id: 'market', title: '🛒 Market (livraison par drone)', desc: 'Achetez un article, un drone vous le livre où que vous soyez.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'phone') Phone.openAs('phone');
      else if (sel.id === 'tablet') {
        if (!this.ownsTablet) {
          AccessibleConfirm.open('Vous ne possédez pas de tablette', 'L\'acheter maintenant pour 60 000 FCFA ?', (bought) => {
            if (bought) this.buyTablet(); else announce('Achetez une tablette pour l\'avoir sur vous.', 'assertive');
          });
        } else Phone.openAs('tablet');
      }
      else if (sel.id === 'computer') Computer.boot();
      else if (sel.id === 'market') this.openMarket();
    });
  },
  toggleTalkiePower() {
    if (!this.talkie.owned) return announce('Vous n\'avez pas de talkie-walkie. Achetez-en un dans le menu Talkie.', 'assertive');
    if (!this.talkie.on && this.talkie.battery <= 0.02) return announce('Batterie du talkie déchargée. Rechargez-le.', 'assertive');
    this.talkie.on = !this.talkie.on;
    announce(this.talkie.on ? `Talkie allumé, fréquence ${this.talkie.frequency.toFixed(3)} mégahertz.` : 'Talkie éteint.', 'assertive');
  },
  setTalkieFrequency(freq) {
    this.talkie.frequency = freq;
    announce(`Talkie réglé sur ${freq.toFixed(3)} mégahertz.`, 'polite');
  },
  chargeTalkie() {
    if (!this.talkie.owned) return announce('Vous n\'avez pas de talkie-walkie.', 'assertive');
    const near = City.pois.find(p => (p.type === 'magasin' || p.type === 'station_essence') && UTIL.dist(p, this) < 4);
    if (!near) return announce('Rendez-vous dans un magasin ou une station-service pour recharger le talkie.', 'assertive');
    const missing = 1 - this.talkie.battery;
    if (missing <= 0.01) return announce('Batterie déjà pleine.', 'polite');
    const cost = Math.floor(missing * 8000);
    if (this.money < cost) return announce(`Recharge du talkie : ${UTIL.formatMoney(cost)}.`, 'assertive');
    this.money -= cost; this.talkie.battery = 1; Audio.cash();
    announce(`Talkie rechargé chez ${near.name} pour ${UTIL.formatMoney(cost)}. Batterie à 100%.`, 'assertive');
    updateHud();
  },
  talkieTick() {
    if (this.talkie.owned && this.talkie.on) {
      this.talkie.battery = Math.max(0, this.talkie.battery - 0.01);
      if (this.talkie.battery <= 0) { this.talkie.on = false; announce('Batterie du talkie-walkie épuisée. Il s\'éteint.', 'assertive'); }
    }
  },
  talkiePTT(message) {
    if (!this.talkie.owned || !this.talkie.on) return announce('Allumez d\'abord votre talkie-walkie.', 'assertive');
    if (this.talkie.battery <= 0.02) return announce('Batterie trop faible pour émettre.', 'assertive');
    this.talkie.battery = Math.max(0, this.talkie.battery - 0.01);
    AudioLib.playOnce('son_talkie_bip', { volume: 0.6 });
    const txt = message || 'Message reçu, à vous.';
    announce(`Vous émettez sur ${this.talkie.frequency.toFixed(3)} mégahertz : « ${txt} »`, 'polite');
    Net.talkiePTT(txt);
    RPJournal.log('Talkie', `Émission sur ${this.talkie.frequency.toFixed(3)} MHz : ${txt}`, 'info');
  },
  giveTalkie(targetName) {
    if (!this.talkie.owned) return announce('Vous n\'avez pas de talkie-walkie à donner.', 'assertive');
    const target = targetName ? City.npcs.find(n => n.name.toLowerCase().includes(targetName.toLowerCase())) : this.lockedTarget;
    if (!target) return announce('Aucun destinataire. Verrouillez une cible avant de donner le talkie.', 'assertive');
    if (target.isPlayer) {
      Net.giveTalkieTo(target.id);
      this.talkie.owned = false;
      announce(`Vous tendez votre talkie-walkie à ${target.name} (joueur réel). En attente de sa réponse.`, 'assertive');
      return;
    }
    target.heldTalkie = { ...this.talkie };
    this.talkie.owned = false;
    announce(`Vous donnez votre talkie-walkie à ${target.name} pour qu'il ou elle règle la fréquence.`, 'assertive');
  },
};

/* ============================================================
   MENU OVERLAY (accessible, keyboard-friendly, screen-reader)
============================================================ */
