const Game = {
  x: 120, y: 120, altitude: 0, floor: 0, heading: 0, health: 100, maxHealth: 100,
  money: 100000, bank: 0, dirtyMoney: 0, handsUp: false, hunger: 50, thirst: 50, energy: 100,
  inVehicle: false, vehicle: null, ownedVehicles: [], driveAssist: true,
  // Piégé après avoir volé un véhicule conduit par un PNJ (voir enterAsDriver
  // et tickNpcTraffic) : bloque la sortie normale (interactVehicle) tant qu'un
  // autre VRAI joueur ne vient pas aider depuis l'extérieur (voir
  // helpFreeTrappedPlayer / onFreedFromVehicle).
  stuckInVehicle: false,
  // Chute libre après avoir sauté d'un aéronef en plein vol (voir
  // _exitAircraftInFlight / tickFreeFall) : bloque les actions normales tant
  // qu'on n'a pas touché le sol.
  freeFalling: false,
  // Facteur d'échelle appliqué au déplacement RÉEL des véhicules (voir
  // driveVehicle) : sans lui, à 60 images/seconde, une berline à pleine
  // vitesse roulait à l'équivalent d'environ 900 km/h — bien trop vite pour
  // qu'un guidage vocal (rythmé en secondes) puisse suivre.
  MOVE_SCALE: 1 / 12,
  inventory: [], backpack: false, belt: false, holster: null,
  weapons: [], weapon: null, weaponOut: false, ammo: {}, ammoReserve: {},
  // Enrayage : chance qu'une arme à feu se bloque en tirant (voir shoot/reload).
  weaponJammed: false, JAM_CHANCE: 0.03,
  lockedTarget: null, scannedTargets: [], aimPart: 'torse',
  activeMission: null, completedMissions: [],
  ownedHouses: [], ownedWarehouses: [], savedPlaces: [], ownsTablet: false, plantations: [],
  phones: [], activePhoneIndex: 0,
  wanted: 0, policeAwareness: 0,
  keys: new Set(), lastMoved: 0,
  lastAnnounce: 0,
  skills: { repair: 0, heal: 0, driving: 0, hacking: 0 },
  carriedPlayer: null, will: null, tickets: [], invoices: [],
  // Historique complet des PV et factures (payés ET en attente), consultable
  // dans le téléphone — contrairement à `tickets`/`pendingBills` qui ne
  // contiennent que ce qui reste à payer et disparaissent une fois réglés.
  finesHistory: [],
  // Casier judiciaire : chaque délit signalé (voir reportCrimeToPolice) et
  // chaque incarcération purgée, horodatés — persiste au delà du niveau de
  // recherche (wanted), qui lui redescend et ne garde aucune trace.
  criminalRecord: [], jailedAt: null,
  player: { firstName: 'Joueur', lastName: 'Anonyme', gender: 'homme', registered: false },
  outfit: { haut: null, bas: null, chaussures: null, couleurHaut: null, couleurBas: null, couleurChaussures: null, coiffure: null, lunettes: null, isPolice: false, masque: false, accessoires: [] },
  miningMachine: false,
  talkie: { owned: false, battery: 1, on: false, frequency: 151.5 },
  portableRadio: { owned: false }, // débloque le raccourci Ctrl+R : lire/pause la musique perso partout, sans ouvrir le téléphone
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
    if (this.freeFalling) return announce('Vous êtes en chute libre, impossible d\'agir.', 'polite');
    if (this.ridingWith) return announce('Vous êtes passager. Appuyez sur Interagir pour descendre.', 'polite');
    if (this.inVehicle && this.vehicle) {
      const cls = VEHICLE_CATALOG[this.vehicle.type];
      // Même modèle qu'à pied désormais pour TOUS les véhicules (terrestres
      // comme aériens) : virage fin par 45° à chaque appui. Avant, les
      // véhicules terrestres tournaient par paliers de 90° forcés, ce qui
      // faisait dépasser le cap voulu et provoquait le même zigzag que pour
      // un avion ("tournez à droite" puis "à gauche" juste après, sans
      // jamais se stabiliser) — la marche à pied n'a jamais eu ce problème.
      this.vehicle.heading = ((this.vehicle.heading + delta) % 8 + 8) % 8; this.heading = this.vehicle.heading;
      if (!cls?.flies) AudioLib.playOnce('clignotant_voiture', { volume: 0.35 });
      // Crissement de pneus si l'on tourne à vive allure : avant, un virage
      // à pleine vitesse ne sonnait pas différemment d'un virage à l'arrêt.
      // Utilise maintenant les vrais fichiers de freinage/décélération de
      // chaque véhicule (comme au freinage à l'espace) au lieu d'un son
      // synthétisé — mêmes fichiers fournis, cohérents avec le reste.
      if (!cls?.flies && !cls?.human && Math.abs(this.vehicle.speed || 0) / (cls?.maxSpeed || 1) > 0.5) {
        const speedRatio = Math.abs(this.vehicle.speed) / cls.maxSpeed;
        if (cls.sport) RealEngine.brake(speedRatio);
        else if (cls.electric) RealElectricEngine.brake(speedRatio);
        else RealEngine2.brake(speedRatio);
      }
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
      if (!this.interior && (dd.dx || dd.dy) && City.isSolid(Math.round(this.x + dd.dx), Math.round(this.y + dd.dy))) msg += ' Attention, obstacle juste devant.';
      announce(msg, 'polite');
    }
    updateHud();
  },
  // Signale un obstacle DROIT DEVANT avant qu'on ne le heurte (essentiel pour
  // naviguer sans voir). Throttlé pour ne pas répéter en boucle.
  warnObstacleAhead() {
    if (this.inVehicle || this.unconscious || this.guidanceTarget || this.interior) return;
    const { dx, dy } = this.headingToDelta(this.heading);
    if (dx === 0 && dy === 0) return;
    if (City.isSolid(Math.round(this.x + dx), Math.round(this.y + dy))) {
      const now = Date.now();
      if (now - (this._lastObstacleWarn || 0) > 1500) {
        this._lastObstacleWarn = now;
        announce('Attention, obstacle juste devant.', 'assertive', { tag: 'obstacle' });
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
    if (this.freeFalling) return announce('Vous êtes en chute libre, impossible d\'agir.', 'polite');
    if (this.inVehicle && this.vehicle) { const { dx, dy } = this.headingToDelta(this.vehicle.heading); this.driveVehicle(dx, dy); return; }
    const { dx, dy } = this.headingToDelta(this.heading);
    this.move(dx, dy, { keepHeading: true });
  },
  moveBackward() {
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.freeFalling) return announce('Vous êtes en chute libre, impossible d\'agir.', 'polite');
    if (this.inVehicle && this.vehicle) { this.driveVehicle(0, 0); return; } // le frein/marche arrière véhicule reste sur Espace
    const { dx, dy } = this.headingToDelta(this.heading);
    this.move(-dx, -dy, { keepHeading: true, reverse: true });
  },
  move(dx, dy, opts = {}) {
    if (this.jailed) return announce('Vous êtes en cellule. Seul un policier peut vous libérer.', 'polite');
    // La planque (Alt+H) exige l'immobilité : bouger la rompt aussitôt.
    if (this.hidden) { this.hidden = false; announce('Vous quittez votre cachette en bougeant.', 'polite'); }
    if (this.interior) return this._moveInterior(dx, dy); // déplacement dans le plan intérieur
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
      Audio.footstep(surface, this.hasVest);
      return;
    }
    this._moveAccum -= 1;
    const nx = Math.round(this.x + dx), ny = Math.round(this.y + dy);
    // En diagonale, on ne se faufile pas à travers le coin de deux murs : si les
    // deux cases orthogonales sont solides, le passage est bloqué.
    if (dx !== 0 && dy !== 0 && City.isSolid(Math.round(this.x + dx), Math.round(this.y)) && City.isSolid(Math.round(this.x), Math.round(this.y + dy))) {
      Audio.impact(UTIL.clamp(dx, -1, 1) * 0.5);
      // Tag 'obstacle' + throttle : en glissement tactile maintenu, move()
      // est rappelé toutes les 300 ms — sans throttle, chaque appel contre le
      // même mur empilait une annonce dans la file, qui continuait à être
      // lue en rafale ("mur, mur, mur...") bien après avoir lâché/tourné.
      // Le tag fait aussi remplacer une annonce déjà en attente/en cours de
      // la même catégorie plutôt que de s'y ajouter.
      const nowB = Date.now();
      if (nowB - (this._lastObstacleAnnounce || 0) > 1200) {
        this._lastObstacleAnnounce = nowB;
        announce('Passage bloqué entre deux murs. Tournez un peu pour les contourner.', 'assertive', { tag: 'obstacle' });
      }
      return;
    }
    if (City.isSolid(nx, ny)) {
      Audio.impact(UTIL.clamp(dx, -1, 1) * 0.5);
      if (Net.connected) Net.emitSound('synth:impact', { vol: 0.5 });
      const nowO = Date.now();
      if (nowO - (this._lastObstacleAnnounce || 0) > 1200) {
        this._lastObstacleAnnounce = nowO;
        announce('Obstacle, vous n\'avancez pas. ' + City.getTile(nx, ny), 'assertive', { tag: 'obstacle' });
      }
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
      const stepKey = Audio.footstep(surface, this.hasVest);
      // Pas audibles par les joueurs proches (spatialisés chez eux).
      if (Net.connected && stepKey) Net.emitSound(stepKey, { vol: 0.35 });
    }
    // En déplacement continu (touche maintenue), annoncer "vous avancez" à chaque
    // pas ferait annuler la synthèse vocale avant qu'elle n'ait eu le temps de
    // sortir un seul mot (nouvelle annonce = coupe la précédente). On espace donc
    // ces annonces routinières dans le temps ; les infos importantes (obstacle,
    // rencontre...) restent, elles, toujours annoncées immédiatement.
    // Espacé de 900 ms à 3,5 s : à 900 ms, cette annonce purement routinière
    // (on le sait déjà, la touche est maintenue) revenait sans arrêt pendant
    // une marche continue, au point de saturer l'attention même en priorité
    // 'polite'.
    const now = Date.now();
    if (now - (this._lastMoveAnnounce || 0) > 3500) {
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
    // Un moteur thermique/électrique ne répond pas instantanément : il faut le
    // démarrer, et pour un avion/hélico le laisser se stabiliser avant de
    // pouvoir décoller — avant, monter dedans suffisait à pouvoir s'envoler
    // tout de suite, ce qui rendait le pilotage bien trop simple. Un vélo
    // (cls.human) n'a pas de moteur : jamais concerné. v.engineOn est
    // `undefined` (donc "faux") tant que le moteur n'a jamais été démarré.
    if (!cls.human && !v.engineOn) {
      const wantsMove = dx !== 0 || dy !== 0;
      if (!v.engineStartAt) {
        if (!wantsMove) return; // moteur coupé, aucune tentative de partir : rien à faire
        v.engineStartAt = Date.now();
        announce(cls.flies ? 'Démarrage du moteur... Patientez qu\'il se stabilise avant de décoller.' : 'Démarrage du moteur...', 'assertive');
        return;
      }
      const startMs = cls.flies ? 4000 : 1500;
      if (Date.now() - v.engineStartAt < startMs) {
        if (wantsMove) {
          const now = Date.now();
          if (now - (v._lastStartWarn || 0) > 1500) { v._lastStartWarn = now; announce(cls.flies ? 'Moteur pas encore stabilisé, patientez.' : 'Moteur en cours de démarrage, patientez.', 'polite'); }
        }
        return;
      }
      v.engineOn = true; v.engineStartAt = null;
      announce(cls.flies ? 'Moteur stabilisé : vous pouvez décoller.' : 'Moteur démarré.', 'assertive');
    }
    // dx,dy viennent toujours de headingToDelta(v.heading) (avancer) ou de son
    // opposé (reculer) : le cap est déjà correct, posé par turn() — TOUS les
    // véhicules tournent maintenant par 45° comme à pied (voir turn()), y
    // compris sur des caps diagonaux. Le re-déduire ici à partir de dx,dy avec
    // un mapping uniquement cardinal écraserait un cap diagonal en le
    // ramenant au cap cardinal le plus proche : inutile, donc supprimé.
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
    // Un vélo (cls.human) n'a pas de moteur : l'essence ne le concerne jamais,
    // ni pour la vitesse ni pour la panne — un vélo ne "tombe pas en panne
    // d'essence", il n'en consomme même pas. Le véhicule-école (examVehicle)
    // non plus : sinon son plein s'épuisait en cours de circuit (~20s), avant
    // même d'avoir fait le tour des 4 points, ce qui bloquait l'examen.
    const noFuelNeeded = cls.human || v.examVehicle;
    const accel = cls.accel || 0.06;
    // Boîte manuelle (motos et voitures sport) : la vitesse engagée (1 à 5)
    // plafonne la vitesse atteignable, comme une vraie boîte à vitesses —
    // avant, l'accélération était juste automatique jusqu'au maximum, sans
    // aucune gestion de rapport pour ces véhicules pourtant sportifs.
    const gearCap = cls.manualGearbox ? (this.GEAR_RATIOS[(v.gear || 1) - 1] || 1) : 1;
    const targetSpeed = cls.maxSpeed * gearCap * (noFuelNeeded || v.fuel > 0 ? 1 : 0.3);
    const offroadFactor = (City.getTile(v.x, v.y) === 'route' || City.getTile(v.x, v.y) === 'rue') ? 1 : cls.offroad;
    const isReverse = (dx === 0 && dy === 0) ? false : this.isReverse(v.heading, dx, dy);
    if (dx === 0 && dy === 0) {
      // Freinage : on décélère jusqu'à l'ARRÊT, sans repartir tout seul en
      // marche arrière (avant, le relâché faisait reculer le véhicule).
      if (v.speed > 0) v.speed = Math.max(0, v.speed - cls.brake);
      else if (v.speed < 0) v.speed = Math.min(0, v.speed + cls.brake);
    } else if (isReverse) {
      v.speed = UTIL.clamp(v.speed - cls.accel, -cls.maxSpeed * 0.3, 0);
    } else {
      v.speed = UTIL.clamp(v.speed + accel * offroadFactor, -cls.maxSpeed * 0.3, targetSpeed * offroadFactor);
    }
    if (!noFuelNeeded && v.fuel <= 0 && v.speed > 0.1) {
      v.speed *= 0.5;
      // Throttlé : sinon annoncé en 'assertive' (coupe la parole) à chaque
      // image tant qu'on essaie d'avancer, plusieurs dizaines de fois par
      // seconde — un spam vocal incessant.
      const now = Date.now();
      if (now - (this._lastFuelWarn || 0) > 4000) { this._lastFuelWarn = now; announce('Panne d\'essence.', 'assertive'); }
    }
    // Véhicule détruit (0 % de vie) EN COURS DE ROUTE (accidents répétés) :
    // le moteur cale immédiatement, il faut le faire réparer. Avant, rien
    // n'empêchait de continuer à rouler avec une épave à 0 % de vie.
    if (!cls.human && (v.hp || 0) <= 0 && v.speed !== 0) {
      v.speed = 0; v.engineOn = false;
      const now = Date.now();
      if (now - (this._lastHpWarn || 0) > 4000) { this._lastHpWarn = now; announce(`${v.name} est hors d'usage : le moteur cale. Il faut le faire réparer.`, 'assertive'); }
    }
    // Seulement au freinage : sinon, hors route, accel*offroadFactor (souvent
    // < 0.05, ex. berline 0.07×0.4) était remis à zéro à CHAQUE image avant de
    // pouvoir s'accumuler — le véhicule ne démarrait jamais (bloqué à
    // l'auto-école, dont le véhicule est posé sur une tuile hors-route).
    if (isBraking && Math.abs(v.speed) < 0.05) v.speed = 0;
    // Garder le SIGNE de la vitesse : positif = avance dans le cap, négatif =
    // recule (déplacement inverse du cap). Avant, step était toujours positif
    // (valeur absolue), donc la marche arrière avançait quand même.
    // v.speed (vitesse "logique", pour les sons/dégâts/ratios) n'est PAS mise à
    // l'échelle ici : seul le déplacement PHYSIQUE réel l'est, via MOVE_SCALE.
    // Sans ça, à 60 images/seconde une berline à pleine vitesse roulait à
    // l'équivalent de ~900 km/h : bien trop vite pour qu'un guidage vocal
    // (rythmé en secondes) puisse suivre — d'où le blocage à l'auto-école et
    // le zigzag ("tournez à droite" puis "à gauche" après avoir dépassé le cap).
    const step = v.speed * this.MOVE_SCALE;
    const dir = v.heading;
    // headingToDelta gère les 8 caps (dont les 4 diagonaux, utilisés par un
    // avion/hélico en virage fin) ; pour un véhicule terrestre, cap toujours
    // cardinal (0/2/4/6), donc dx/dy valent exactement comme avant (0 ou ±1).
    const dirDelta = this.headingToDelta(dir);
    const ndx = dirDelta.dx * step;
    const ndy = dirDelta.dy * step;
    // Avancement fluide même à basse vitesse : à vitesse suffisante on arrondit
    // (comportement classique), sinon on ACCUMULE la fraction de case parcourue
    // et on ne franchit une case entière que quand le cumul l'atteint. Sans ça,
    // Math.round(120 + 0.06) = 120 : le véhicule restait bloqué sur place au
    // démarrage (impossible de passer le permis).
    let nx, ny;
    if (Math.abs(step) >= 0.5) { nx = Math.round(v.x + ndx); ny = Math.round(v.y + ndy); v._moveAccum = 0; }
    else {
      v._moveAccum = (v._moveAccum || 0) + step;
      let adv = 0;
      if (v._moveAccum >= 1) { v._moveAccum -= 1; adv = 1; }
      else if (v._moveAccum <= -1) { v._moveAccum += 1; adv = -1; }
      nx = v.x + dirDelta.dx * adv;
      ny = v.y + dirDelta.dy * adv;
    }
    if (cls.flies) {
      const climbRate = cls.climbRate || 2;
      if (Game.keys.has('shift')) {
        // Un hélicoptère (vtol) décolle et grimpe à la verticale, à l'arrêt.
        // Un avion a besoin d'une vraie vitesse de piste avant de prendre de
        // l'altitude — avant, les deux montaient pareil, sans distinction.
        const minRatio = cls.vtol ? 0 : (cls.minTakeoffSpeedRatio || 0);
        const speedRatio = Math.abs(v.speed) / (cls.maxSpeed || 1);
        if (speedRatio < minRatio) {
          const now = Date.now();
          if (now - (v._lastTakeoffWarn || 0) > 3000) { v._lastTakeoffWarn = now; announce('Vitesse insuffisante pour décoller : accélérez d\'abord.', 'polite'); }
        } else {
          v.altitude = Math.max(0, v.altitude + climbRate);
        }
      } else if (Game.keys.has('control')) {
        // Dernier mètre avant de toucher le sol : on vérifie qu'il n'y a
        // personne pile en dessous (PNJ ou joueur réel), pour ne pas
        // atterrir sur quelqu'un — avant, rien n'empêchait de se poser
        // n'importe où, au hasard. Un obstacle bloque juste la toute
        // dernière portion de descente ; le reste de la descente n'est pas
        // concerné (uniquement dangereux au ras du sol).
        if (v.altitude - climbRate <= 0 && this.groundOccupiedAt(v.x, v.y)) {
          const now = Date.now();
          if (now - (v._lastLandingWarn || 0) > 2500) { v._lastLandingWarn = now; announce('Impossible d\'atterrir ici : quelqu\'un se trouve juste en dessous. Déplacez-vous avant de vous poser.', 'assertive'); }
          v.altitude = Math.max(climbRate, v.altitude - climbRate * 0.3); // freine la descente sans se poser
        } else {
          v.altitude = Math.max(0, v.altitude - climbRate);
        }
      }
      this.altitude = v.altitude;
    }
    // Un aéronef EN VOL (altitude > 0) survole les bâtiments : pas de collision
    // au sol. Il ne heurte que s'il roule au sol (altitude 0).
    if (!(cls.flies && v.altitude > 0) && City.isSolid(nx, ny)) {
      // Un seul impact compté par collision RÉELLE : rester coincé contre le
      // même mur (touche maintenue) rappelait cette branche à chaque tick et
      // infligeait des dégâts à répétition pour un seul choc physique. On ne
      // ré-inflige des dégâts que lors du PREMIER tick de contact contre cet
      // obstacle ; tant qu'on reste collé dessus, plus aucun nouveau dégât
      // (le véhicule ne bouge de toute façon plus). Se dégager en changeant
      // de direction (cellule cible différente, non solide) réarme un
      // prochain impact.
      const alreadyColliding = v._collisionActive;
      v._collisionActive = true;
      if (!alreadyColliding) {
        const impactDmg = Math.round(Math.abs(v.speed) * 40 * (1 - (cls.armor || 0)));
        v.hp = Math.max(0, v.hp - impactDmg);
        if (this.fragileState) this.fragileState.condition = Math.max(0, this.fragileState.condition - UTIL.randInt(15, 35));
        if (this.taxiState) this.taxiRoughEvent(UTIL.randInt(15, 30));
        if (this.medicalState) {
          const victim = City.npcs.find(n => n.id === this.medicalState.victimId);
          if (victim) { victim.health = Math.max(0, victim.health - UTIL.randInt(8, 18)); announce(`Le blessé encaisse le choc ! Santé : ${Math.round(victim.health)}%.`, 'assertive'); }
        }
        const otherVehicleHere = City.vehicles.some(ov => ov.id !== v.id && UTIL.dist(ov, { x: nx, y: ny }) < 1.5);
        // Diffusée aux joueurs proches (passager compris, qui se trouve à la
        // même position que le véhicule) : avant, seul le conducteur entendait
        // sa propre collision.
        const collisionKey = otherVehicleHere ? 'veh_kolision_entre_2' : impactDmg > 20 ? 'veh_kolision_4_fort' : impactDmg > 8 ? UTIL.pick(['veh_kolision_1', 'veh_kolision_2', 'veh_kolision_3']) : null;
        if (collisionKey) {
          AudioLib.playOnce(collisionKey, { volume: otherVehicleHere ? 0.6 : (impactDmg > 20 ? 0.65 : 0.55), exclusive: 'veh_collision_' + v.id });
          if (Net.connected) Net.emitSound(collisionKey, { vol: 0.6 });
        }
        announce(`Collision !${impactDmg > 3 ? ` État du véhicule : ${Math.round(v.hp)}%.` : ''}`, 'assertive');
        if (City.isRoad(v.x, v.y)) this.npcVoiceReaction(v.x, v.y, { group: 'impatient', radius: 12, count: 2 });
      }
      v.speed = 0; Audio.screech(0);
    } else {
      v._collisionActive = false;
      v.x = UTIL.clamp(nx, 0, City.W - 1); v.y = UTIL.clamp(ny, 0, City.H - 1);
      // Consommation VRAIMENT constante par case parcourue (4 m), indépendante
      // de la vitesse instantanée — avant, le calcul multipliait par v.speed
      // malgré ce commentaire qui promettait déjà l'inverse : résultat, chaque
      // augmentation de la vitesse max des véhicules (voir catalogs.js) faisait
      // aussi fondre le réservoir plus vite, en plus d'un plein déjà trop
      // court. Constante choisie pour ~27 km par plein, un plein qui dure
      // vraiment une session de jeu au lieu de s'épuiser en quelques minutes.
      if (!noFuelNeeded) v.fuel = Math.max(0, v.fuel - 0.00015);
      // Conduite tout-terrain à vitesse notable : chance occasionnelle de
      // taper un trou (juste un bruit, pas de dégâts — la route cahoteuse).
      if (offroadFactor < 1 && Math.abs(v.speed) > cls.maxSpeed * 0.3 && UTIL.chance(0.03)) {
        AudioLib.playOnce(UTIL.pick(['veh_trou_1', 'veh_trou_2', 'veh_trou_3', 'veh_trou_gros_4', 'veh_collision_trou']), { volume: 0.4, exclusive: 'veh_trou_' + v.id });
      }
    }
    const speedRatio = Math.abs(v.speed) / cls.maxSpeed;
    if (cls.flies) RealAirEngine.update(v, cls, speedRatio);
    else if (cls.electric) RealElectricEngine.update(v, speedRatio);
    else if (cls.sport) RealEngine.update(v, cls, speedRatio);
    else if (!cls.human) RealEngine2.update(v, speedRatio); // le vélo n'a PAS de moteur : ses propres sons (updateBikeAudio) suffisent
    if (!cls.flies) {
      if (Weather.state === 'pluie') { if (!AudioLib.isLoopPlaying('veh_essuie_glaces')) AudioLib.playLoop('veh_essuie_glaces', 0.25); }
      else AudioLib.stopLoop('veh_essuie_glaces');
    } else if (Weather.state === 'pluie') {
      // Avion/hélicoptère : la pluie d'ambiance (amb_pluie) joue déjà partout,
      // mais à son volume normal (0.18) elle est noyée par le moteur avion/
      // hélico, bien plus fort. On la renforce tant qu'on est en vol pour
      // qu'elle reste audible par-dessus, comme l'essuie-glace le fait au sol.
      if (!AudioLib.isLoopPlaying('amb_pluie')) AudioLib.playLoop('amb_pluie', 0.4);
      const rainEl = AudioLib.loopElements['amb_pluie'];
      if (rainEl) rainEl.volume = 0.4;
    }
    // Le guidage GPS ne se réévaluait qu'au virage (voir turn()) : en ligne
    // droite, rien ne le rafraîchissait jamais pendant la conduite. Résultat,
    // dépasser un virage sans tourner laissait la consigne périmée en place ;
    // le prochain recalcul (au virage suivant, bien plus loin) partait d'une
    // position si éloignée du chemin prévu qu'il fallait faire demi-tour pour
    // le rejoindre — ce qui ressemblait à un trajet qui recommence à zéro. On
    // aligne sur la marche à pied (move(), qui rafraîchit à chaque pas).
    if (this.guidanceTarget) this.updateGuidance();
    updateHud();
  },
  // Généralisé aux 8 caps (dont les diagonaux, pour un avion/hélico en virage
  // fin) via un produit scalaire avec la direction du cap : négatif = on
  // pousse globalement à l'opposé de là où l'on regarde, donc marche arrière.
  // Équivalent exact de l'ancien test cardinal-only pour les 4 caps 0/2/4/6.
  isReverse(heading, dx, dy) {
    const hd = this.headingToDelta(heading);
    return (dx * hd.dx + dy * hd.dy) < 0;
  },
  brakeVehicle() {
    if (!this.vehicle) return;
    const v = this.vehicle; const cls = VEHICLE_CATALOG[v.type];
    const speedRatioBefore = Math.abs(v.speed) / cls.maxSpeed;
    v.speed = Math.max(0, Math.abs(v.speed) - 0.15) * (v.speed < 0 ? -1 : 1);
    // Vrai son de freinage à l'appui d'espace : avant, seul le kit sport avait
    // un crissement dédié — les autres véhicules (normaux, électriques)
    // restaient silencieux, le changement de régime étant à peine perceptible.
    // Seuil abaissé (0,2 -> 0,08) : à vitesse de ville modérée, le freinage
    // restait complètement silencieux, alors qu'un vrai coup de frein
    // s'entend même en roulant doucement.
    if (speedRatioBefore > 0.08) {
      const stoppedNow = Math.abs(v.speed) < 0.02; // ce freinage vient de nous arrêter net
      if (cls.sport) RealEngine.brake(speedRatioBefore, stoppedNow);
      else if (cls.electric) RealElectricEngine.brake(speedRatioBefore);
      else if (!cls.human && !cls.flies) RealEngine2.brake(speedRatioBefore);
    }
    // Vélo : vrai son de frein (une variante au hasard), throttlé pour ne pas
    // se répéter en boucle si l'on maintient le frein.
    if (cls.human && speedRatioBefore > 0.05 && Date.now() - (this._lastBikeBrake || 0) > 500) {
      this._lastBikeBrake = Date.now();
      AudioLib.playOnce(UTIL.pick(['velo_frein_1', 'velo_frein_2', 'velo_frein_3']), { volume: 0.5 });
    }
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
    updateHud();
  },

  // Système sonore du vrai vélo : tant qu'on PÉDALE (touche avancer, ou
  // pédalage automatique), le son de pédalage tourne en boucle ; dès qu'on
  // arrête de pédaler mais que le vélo roule encore (roue libre), le son de
  // « point mort » prend le relais en ralentissant ; à l'arrêt, tout se coupe.
  // Le volume suit la vitesse. Frein et clochette sont des sons ponctuels.
  updateBikeAudio() {
    if (!window.AudioLib) return;
    const v = this.vehicle;
    if (!this.inVehicle || !v) { AudioLib.stopLoop('velo_pedale'); AudioLib.stopLoop('velo_point_mort'); return; }
    const cls = VEHICLE_CATALOG[v.type];
    const speed = Math.abs(v.speed || 0);
    const maxS = (cls && cls.maxSpeed) || 1;
    if (speed < 0.02) { AudioLib.stopLoop('velo_pedale'); AudioLib.stopLoop('velo_point_mort'); return; }
    // Pédale-t-on ? En conduite manuelle : la flèche avancer est enfoncée.
    // En pédalage automatique : oui tant que le vélo avance.
    const pedaling = v.auto ? true : this.keys.has('arrowup');
    const vol = 0.3 + 0.45 * Math.min(1, speed / maxS);
    if (pedaling) {
      AudioLib.playLoop('velo_pedale', vol);
      AudioLib.stopLoop('velo_point_mort');
    } else {
      // Roue libre : le son de point mort prend le relais, un peu plus doux.
      AudioLib.playLoop('velo_point_mort', vol * 0.85);
      AudioLib.stopLoop('velo_pedale');
    }
  },
  // Coupe tous les sons du vélo (descente, changement de véhicule).
  stopBikeAudio() {
    if (!window.AudioLib) return;
    AudioLib.stopLoop('velo_pedale');
    AudioLib.stopLoop('velo_point_mort');
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
    // Suit un vrai chemin praticable (même A* que le guidage GPS piéton/vocal,
    // computePath) au lieu de choisir juste le cap qui rapproche le plus à vol
    // d'oiseau à CHAQUE image sans jamais voir plus loin qu'une case : ce
    // calcul glouton pouvait revenir sur ses pas dans un quartier dense (cap
    // qui oscille, "ne progresse pas") et, pire, rester bloqué à foncer sans
    // fin contre un obstacle si les 4 cases voisines étaient solides — d'où
    // les dégâts qui s'accumulaient jusqu'à détruire le véhicule.
    const px = Math.round(v.x), py = Math.round(v.y);
    const gx = Math.round(dest.x), gy = Math.round(dest.y);
    const goalMoved = !v._autoPathGoal || v._autoPathGoal.x !== gx || v._autoPathGoal.y !== gy;
    let offPath = true;
    if (v.autoPath && v.autoPath.length && !goalMoved) {
      let bd = Infinity, bi = 0;
      for (let i = 0; i < v.autoPath.length; i++) {
        const d = Math.abs(v.autoPath[i].x - px) + Math.abs(v.autoPath[i].y - py);
        if (d < bd) { bd = d; bi = i; }
      }
      v._autoPathIdx = bi; offPath = bd > 1;
    }
    const stale = Date.now() - (v._autoPathAt || 0) > 6000;
    if (goalMoved || !v.autoPath || !v.autoPath.length || offPath || stale) {
      v.autoPath = (!(cls.flies && v.altitude > 0)) ? this.computePath(px, py, dest.x, dest.y) : null;
      v._autoPathGoal = { x: gx, y: gy }; v._autoPathAt = Date.now(); v._autoPathIdx = 0;
    }
    // Filet de sécurité : si la position ne progresse plus du tout depuis
    // plusieurs secondes malgré le pilotage actif (chemin introuvable, ou cas
    // limite non prévu), on arrête proprement au lieu de continuer à foncer
    // indéfiniment dans ce qui bloque.
    if (!v._autoLastPos || UTIL.dist(v._autoLastPos, v) > 0.3) {
      v._autoLastPos = { x: v.x, y: v.y }; v._autoStuckSince = Date.now();
    } else if (Date.now() - (v._autoStuckSince || Date.now()) > 5000) {
      this.stopAutoDrive();
      announce('Conduite automatique bloquée par un obstacle. Contrôle repris.', 'assertive');
      return;
    }
    let best = v.heading;
    if (v.autoPath && v.autoPath.length > 1) {
      let i = Math.min(v._autoPathIdx || 0, v.autoPath.length - 1);
      while (i < v.autoPath.length - 1 && v.autoPath[i].x === px && v.autoPath[i].y === py) i++;
      const dirOf = this._dirOf(px, py, v.autoPath[i].x, v.autoPath[i].y);
      if (dirOf >= 0) best = dirOf;
    } else if (!v.autoPath) {
      if (cls.flies && v.altitude > 0) {
        // En vol, on survole tout : cap DIRECT vers la cible (8 directions,
        // diagonales comprises), pas un cap cardinal en escalier — sinon le
        // pilotage automatique zigzaguait ("tournait sans arrêt") en plein ciel.
        const ndx = dest.x - v.x, ndy = dest.y - v.y;
        const angle = Math.atan2(ndx, -ndy) * 180 / Math.PI;
        best = Math.round((angle < 0 ? angle + 360 : angle) / 45) % 8;
      } else {
        // Repli au sol (chemin introuvable) : ancien calcul direct à vol d'oiseau, cap cardinal uniquement.
        let bestScore = -Infinity;
        for (let h = 0; h < 8; h += 2) {
          const nx = v.x + (h === 2 ? 1 : h === 6 ? -1 : 0);
          const ny = v.y + (h === 4 ? 1 : h === 0 ? -1 : 0);
          if (City.isSolid(nx, ny)) continue;
          const ndx = dest.x - nx, ndy = dest.y - ny;
          let score = -Math.sqrt(ndx * ndx + ndy * ndy);
          if (City.isRoad(nx, ny)) score += 4;
          if (h === v.heading) score += 1;
          if (score > bestScore) { bestScore = score; best = h; }
        }
      }
    }
    v.heading = best;
    // driveVehicle(0,0) = freinage (aucune entrée), pas "avancer dans le cap" :
    // la conduite auto ne bougeait donc JAMAIS (elle freinait à chaque image,
    // annulant l'accélération qu'on venait juste de lui donner ci-dessus,
    // d'où la boucle sans avancer). driveVehicle calcule lui-même
    // l'accélération selon le cap : on lui donne le vrai dx,dy du cap choisi.
    const hd = this.headingToDelta(v.heading);
    this.driveVehicle(hd.dx, hd.dy);
    // Voice guidance
    const bearing = UTIL.bearing(dest.x - v.x, dest.y - v.y);
    const remaining = Math.round(dist * CONFIG.METERS_PER_TILE);
    if (Math.random() < 0.04) announce(`${remaining} mètres, cap ${bearing}, vers ${dest.name}.`, 'polite');
  },

  // Conduite MANUELLE continue : appelée à chaque image de la boucle de jeu.
  // Accélère/tourne tant qu'une direction est maintenue — au clavier (Game.keys)
  // OU au tactile (Game._touchDriveDir) — pour une conduite fluide sans dépendre
  // de la répétition des touches, et surtout pour que le tactile fonctionne
  // (avant, seul le clavier était pris en compte : rien ne bougeait sur mobile).
  tickManualDrive() {
    if (!this.inVehicle || !this.vehicle || this.vehicle.auto) return;
    const td = this._touchDriveDir;
    const fwd = Game.keys.has('arrowup') || td === 'up';
    const back = Game.keys.has('arrowdown') || td === 'down';
    const { dx, dy } = this.headingToDelta(this.vehicle.heading);
    if (fwd) this.driveVehicle(dx, dy);
    else if (back) this.driveVehicle(-dx, -dy);
    else this.driveVehicle(0, 0); // relâché : freinage naturel jusqu'à l'arrêt
    const now2 = Date.now();
    if (now2 - (this._lastContinuousMove || 0) > 220) {
      if (Game.keys.has('arrowleft') || td === 'left') { this.turn(-1); this._lastContinuousMove = now2; }
      else if (Game.keys.has('arrowright') || td === 'right') { this.turn(1); this._lastContinuousMove = now2; }
    }
  },
  // Passager d'un VRAI joueur (ridingWith) : avant, seul le conducteur
  // entendait le moteur de son propre véhicule — le passager roulait dans un
  // silence total. On synthétise localement le même moteur, d'après le type
  // et le ratio de vitesse envoyés par le conducteur (voir Net.sendState).
  tickPassengerAudio() {
    const driver = this.ridingWith && this.ridingWith.id ? Net.remotePlayers.get(this.ridingWith.id) : null;
    if (!driver || !driver.inVehicle || !driver.vehicleType) {
      if (this._passengerEngine) { this._passengerEngine.stop(); this._passengerEngine = null; }
      return;
    }
    const cls = VEHICLE_CATALOG[driver.vehicleType];
    if (!cls) return;
    const engine = cls.flies ? RealAirEngine : cls.electric ? RealElectricEngine : cls.sport ? RealEngine : cls.human ? null : RealEngine2;
    if (!engine) return; // vélo : pas de moteur à synthétiser
    if (this._passengerEngine && this._passengerEngine !== engine) this._passengerEngine.stop();
    this._passengerEngine = engine;
    const fakeVehicle = { id: 'passenger_of_' + driver.id, type: driver.vehicleType };
    const ratio = UTIL.clamp(driver.vehicleSpeedRatio || 0, 0, 1);
    // RealEngine (sport) et RealAirEngine attendent (v, cls, ratio) ; les
    // moteurs "échantillon" (RealEngine2/RealElectricEngine) attendent
    // seulement (v, ratio) — signatures différentes, voir leurs définitions.
    if (cls.flies || cls.sport) engine.update(fakeVehicle, cls, ratio); else engine.update(fakeVehicle, ratio);
  },
  // Un piéton (ou un conducteur d'un AUTRE véhicule) à proximité d'un joueur
  // réel qui conduit doit l'entendre, spatialisé selon sa position — avant,
  // seul le passager EMBARQUÉ avec ce conducteur (tickPassengerAudio) captait
  // quoi que ce soit ; à pied, un véhicule ou un avion piloté par quelqu'un
  // d'autre passait dans un silence total. Rayon large pour un avion/hélico
  // (on l'entend de loin), plus court pour un véhicule au sol.
  tickAmbientVehicles() {
    if (!window.AudioLib || typeof AudioLib.playLoopInstance !== 'function') return;
    // En vol (altitude), le rayon d'écoute des véhicules AU SOL doit être plus
    // large : avant, il restait fixé à 16 cases comme à pied, alors qu'un
    // avion/hélicoptère couvre bien plus de terrain d'un coup — la
    // circulation au sol (motos, voitures) devenait quasi inaudible depuis
    // les airs.
    const airborne = this.altitude > 5;
    const active = new Set();
    if (Net.connected) {
      Net.remotePlayers.forEach((p, pid) => {
        if (this.ridingWith && this.ridingWith.id === pid) return; // déjà géré par tickPassengerAudio
        if (!p.inVehicle || !p.vehicleType) return;
        const cls = VEHICLE_CATALOG[p.vehicleType];
        if (!cls || cls.human) return;
        const dist = UTIL.dist(p, this);
        const pan = this.panForPoint(p.x, p.y);
        const radius = cls.flies ? 45 : (airborne ? 28 : 16);
        if (dist <= radius) {
          const instanceId = 'ambveh_' + pid;
          active.add(instanceId);
          const key = cls.flies ? (p.vehicleType === 'avion' ? 'avion_stable' : 'helico_stable') : cls.electric ? 'veh_elec_vitesse_moyenne' : cls.sport ? 'veh1_cruise' : 'veh2_vitesse_moyenne';
          const ratio = UTIL.clamp(p.vehicleSpeedRatio || 0, 0, 1);
          const vol = UTIL.clamp((1 - dist / radius) * (0.15 + ratio * 0.25), 0, 0.4);
          AudioLib.playLoopInstance(instanceId, key, vol, pan);
        }
        // Sirène : le VRAI fichier audio (même son que celui qui l'a activée),
        // en boucle continue et spatialisée selon la distance/position —
        // avant, les autres joueurs n'entendaient qu'un son de synthèse court
        // ré-émis toutes les 850 ms, haché et bien différent du son réel.
        // Portée indépendante de celle du moteur : une sirène s'entend de
        // plus loin.
        const sirenKey = p.siren ? SIREN_SOUNDS[p.vehicleType] : null;
        const sirenRadius = 40;
        if (sirenKey && dist <= sirenRadius) {
          const sirenId = 'ambsiren_' + pid;
          active.add(sirenId);
          AudioLib.playLoopInstance(sirenId, sirenKey, UTIL.clamp((1 - dist / sirenRadius) * 0.6, 0, 0.6), pan);
        }
      });
    }
    // Circulation de PNJ (voir tickNpcTraffic) : même traitement, pour que ces
    // véhicules qui roulent seuls dans la ville s'entendent aussi, solo comme en ligne.
    (this._trafficVehicleIds || new Set()).forEach(vid => {
      const v = City.vehicles.find(vv => vv.id === vid);
      if (!v) return;
      const cls = VEHICLE_CATALOG[v.type];
      if (!cls) return;
      const radius = airborne ? 28 : 16;
      const dist = UTIL.dist(v, this);
      if (dist > radius) return;
      const instanceId = 'ambveh_ai_' + vid;
      active.add(instanceId);
      const key = cls.electric ? 'veh_elec_vitesse_moyenne' : cls.sport ? 'veh1_cruise' : 'veh2_vitesse_moyenne';
      const ratio = UTIL.clamp((v.speed || 0) / (cls.maxSpeed || 1), 0, 1);
      const vol = UTIL.clamp((1 - dist / radius) * (0.15 + ratio * 0.25), 0, 0.4);
      AudioLib.playLoopInstance(instanceId, key, vol, this.panForPoint(v.x, v.y));
    });
    (this._ambientVehicleIds || []).forEach(instanceId => { if (!active.has(instanceId)) AudioLib.stopLoopInstance(instanceId); });
    this._ambientVehicleIds = active;
  },
  // Fait "vivre" la ville en animant quelques véhicules non possédés à
  // proximité, comme une petite circulation de PNJ (avant, un véhicule garé le
  // restait pour toujours, sans qu'aucun PNJ ne le conduise jamais). Rayon
  // limité au voisinage du joueur : inutile de simuler du trafic à l'autre
  // bout de la ville, que personne ne peut voir ni entendre.
  // Libère le PNJ conducteur d'un véhicule de trafic : redevient un piéton
  // normal (marche aléatoire, voir moveNPCs) à l'endroit où le véhicule s'arrête.
  _releaseTrafficDriver(v) {
    if (v.driverNpcId) {
      const npc = City.npcs.find(n => n.id === v.driverNpcId);
      if (npc) { npc.inCar = false; npc.drivingVehicleId = null; npc.x = Math.round(v.x); npc.y = Math.round(v.y); }
      v.driverNpcId = null;
    }
    v.aiTraffic = false; v.aiPath = null; v.speed = 0;
  },
  tickNpcTraffic() {
    const MAX_TRAFFIC = 4, RADIUS = 35;
    if (!this._trafficVehicleIds) this._trafficVehicleIds = new Set();
    for (const id of Array.from(this._trafficVehicleIds)) {
      const v = City.vehicles.find(vv => vv.id === id);
      if (!v || v.owner || (this.inVehicle && this.vehicle === v) || !v.aiTraffic) { this._trafficVehicleIds.delete(id); if (v) this._releaseTrafficDriver(v); continue; }
      if (!v.aiPath || v.aiPathIdx >= v.aiPath.length || UTIL.dist(v, this) > RADIUS * 1.5) {
        this._releaseTrafficDriver(v); this._trafficVehicleIds.delete(id); continue;
      }
      const step = v.aiPath[v.aiPathIdx];
      v.x = step.x; v.y = step.y; v.aiPathIdx++;
      v.speed = (VEHICLE_CATALOG[v.type]?.maxSpeed || 1) * 0.4;
      // Le PNJ conducteur suit le véhicule (il ne marche plus tout seul tant qu'il conduit).
      if (v.driverNpcId) { const npc = City.npcs.find(n => n.id === v.driverNpcId); if (npc) { npc.x = v.x; npc.y = v.y; } }
    }
    if (this._trafficVehicleIds.size < MAX_TRAFFIC && UTIL.chance(0.3)) {
      const candidates = City.vehicles.filter(v => {
        const cls = VEHICLE_CATALOG[v.type];
        return !v.owner && !v.aiTraffic && cls && !cls.flies && !cls.human && !(this.inVehicle && this.vehicle === v) && UTIL.dist(v, this) < RADIUS;
      });
      if (candidates.length) {
        const v = UTIL.pick(candidates);
        // Il faut un VRAI PNJ pour conduire : sans ça le véhicule reste tel
        // quel (pas de voiture fantôme qui roule sans personne dedans).
        const driver = City.npcs.find(n => !n.dead && !n.inCar && !n.hostile && !n.menotte && !n.knockedOut && !n.handsUp && UTIL.dist(n, v) < 6);
        if (!driver) return;
        const d = UTIL.randInt(8, 20), angle = Math.random() * Math.PI * 2;
        const destX = UTIL.clamp(Math.round(v.x + Math.cos(angle) * d), 0, City.W - 1);
        const destY = UTIL.clamp(Math.round(v.y + Math.sin(angle) * d), 0, City.H - 1);
        const path = this.computePath(v.x, v.y, destX, destY);
        if (path && path.length > 2) {
          v.aiTraffic = true; v.aiPath = path; v.aiPathIdx = 1; v.driverNpcId = driver.id;
          driver.inCar = true; driver.drivingVehicleId = v.id; driver.x = v.x; driver.y = v.y;
          this._trafficVehicleIds.add(v.id);
        }
      }
    }
  },
  // Conduite automatique vers un point précis {name,x,y}.
  setAutoDriveTo(dest) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez d\'abord dans un véhicule.', 'assertive');
    if (!dest) return announce('Destination inconnue.', 'assertive');
    const cls = VEHICLE_CATALOG[this.vehicle.type];
    this.vehicle.auto = true; this.vehicle.autoDest = { x: Math.round(dest.x), y: Math.round(dest.y), name: dest.name || 'la destination' };
    this.vehicle.speed = Math.max(this.vehicle.speed || 0, cls.maxSpeed * 0.3);
    if (this.guidanceTarget) this.stopGuidance();
    announce(`Conduite automatique vers ${this.vehicle.autoDest.name}. Je vous annonce les quartiers et les routes au fur et à mesure. Espace pour reprendre le volant à tout moment.`, 'assertive');
  },

  // Menu accessible à la demande (Ctrl+J, ou Mode de conduite) : automatique,
  // manuel guidé, ou libre. Comme tout menu du jeu, il se navigue au clavier
  // (flèches Haut/Bas entre les cartes, Entrée pour valider) — plus de raccourci
  // spécial qui le refermait au premier appui sur une flèche, ce qui empêchait
  // un lecteur d'écran (dont les flèches SONT la navigation) d'y accéder.
  openDriveModeMenu(v) {
    if (!this.inVehicle || !this.vehicle) return;
    v = v || this.vehicle;
    if (typeof ensureMenuOpen === 'function') ensureMenuOpen();
    el('menuTitle').textContent = `Conduite : ${v.name}`;
    const items = [
      { id: 'auto', title: '🧭 Conduite automatique', desc: 'Choisissez une destination : le véhicule vous y conduit tout seul, avec les annonces de quartiers et de routes.' },
      { id: 'manuel', title: '🕹️ Conduite manuelle guidée', desc: 'Choisissez une destination : vous conduisez, une voix vous guide en continu (tournez, tout droit, distance).' },
      { id: 'libre', title: '🚗 Conduite libre', desc: 'Conduire sans destination ni guidage.' },
    ];
    renderMenu(items, (sel) => {
      if (sel.id === 'libre') { closeMenu(); announce('Conduite libre. Flèches pour conduire, espace pour freiner.', 'assertive'); return; }
      this.openVehicleDestinationMenu(sel.id);
    });
    el('menuOverlay').style.display = 'flex';
    announce(`Vous êtes au volant de ${v.name}. Choisissez : conduite automatique, manuelle guidée, ou libre (Échap pour revenir à la conduite libre directement).`, 'assertive');
  },
  // Choix de la destination pour le véhicule (mode 'auto' ou 'manuel').
  openVehicleDestinationMenu(mode) {
    if (typeof ensureMenuOpen === 'function') ensureMenuOpen();
    el('menuTitle').textContent = mode === 'auto' ? 'Où aller ? (automatique)' : 'Où aller ? (guidage)';
    const items = [];
    (this.savedPlaces || []).forEach((p, i) => {
      items.push({ id: 'saved_' + i, poi: p, title: `📌 ${p.name}`, desc: `Lieu enregistré, ${Math.round(UTIL.dist(p, this) * CONFIG.METERS_PER_TILE)} m.` });
    });
    City.pois.map(p => ({ p, d: UTIL.dist(p, this) })).filter(o => o.d < 200).sort((a, b) => a.d - b.d).slice(0, 14)
      .forEach(o => items.push({ id: 'poi_' + (o.p.id || o.p.name), poi: o.p, title: `🏢 ${o.p.name}`, desc: `${Math.round(o.d * CONFIG.METERS_PER_TILE)} m, vers le ${UTIL.bearing(o.p.x - this.x, o.p.y - this.y)}.` }));
    City.districts.forEach(d => {
      const cx = Math.round((d.x1 + d.x2) / 2), cy = Math.round((d.y1 + d.y2) / 2);
      items.push({ id: 'dist_' + d.name, poi: { name: d.name, x: cx, y: cy }, title: `🗺️ Quartier ${d.name}`, desc: `${Math.round(UTIL.dist({ x: cx, y: cy }, this) * CONFIG.METERS_PER_TILE)} m.` });
    });
    if (!items.length) items.push({ id: 'none', title: 'Aucune destination', desc: 'Approchez-vous d\'un lieu ou enregistrez-en un.' });
    renderMenu(items, (sel) => {
      if (!sel.poi) return;
      closeMenu();
      if (mode === 'auto') this.setAutoDriveTo(sel.poi);
      else {
        this.vehicle.auto = false;
        this.setGuidance({ name: sel.poi.name, x: sel.poi.x, y: sel.poi.y });
        announce(`Conduisez vers ${sel.poi.name}. Je vous guide en continu : suivez mes indications de direction.`, 'assertive');
      }
    });
    el('menuOverlay').style.display = 'flex';
    announce('Choisissez votre destination.', 'polite');
  },

  // Retour de progression en véhicule : c'est ce qui fait « sentir » qu'on
  // avance (un non-voyant n'a que le son). Émet un tic de roulement à chaque
  // case franchie et annonce les changements de quartier et de type de route,
  // plus un rappel périodique de cap et de vitesse. Vaut en manuel ET en auto.
  updateVehicleProgress() {
    if (!this.inVehicle || !this.vehicle) { this._vehProg = null; return; }
    const v = this.vehicle;
    const tx = Math.round(v.x), ty = Math.round(v.y);
    const moving = Math.abs(v.speed) > 0.02;
    if (!this._vehProg) this._vehProg = { x: tx, y: ty, district: City.getDistrictAt(tx, ty).name, road: City.isRoad(tx, ty), lastTic: 0, lastMsg: 0 };
    const p = this._vehProg;
    const now = Date.now();
    if ((tx !== p.x || ty !== p.y)) {
      p.x = tx; p.y = ty;
      // Tic de roulement (feedback « je bouge »), throttlé pour ne pas saturer
      // à haute vitesse. Aigu = vite, grave = lentement.
      if (moving && now - p.lastTic > 130) {
        p.lastTic = now;
        const ratio = Math.min(1, Math.abs(v.speed) / (VEHICLE_CATALOG[v.type].maxSpeed || 1));
        Audio.tone({ freq: 90 + ratio * 120, type: 'sine', duration: 0.05, gain: 0.05, pan: 0 });
      }
      // Changement de quartier.
      const dName = City.getDistrictAt(tx, ty).name;
      if (dName !== p.district) { p.district = dName; announce(`Vous entrez dans ${dName}.`, 'polite'); }
      // Passage route / hors-route : ne s'applique qu'au sol — un aéronef EN
      // VOL (altitude > 0) survole tout, la notion de route au sol ne le
      // concerne plus (sinon « vous quittez la route » sonnait à tort en
      // plein ciel, dès que le sol survolé n'était pas une route).
      const cls = VEHICLE_CATALOG[v.type];
      const onRoad = City.isRoad(tx, ty);
      if (!(cls.flies && v.altitude > 0) && onRoad !== p.road) { p.road = onRoad; announce(onRoad ? 'Vous êtes sur la route.' : 'Attention, vous quittez la route.', 'polite'); }
      else if (cls.flies && v.altitude > 0) p.road = onRoad; // garde l'état à jour sans l'annoncer, pour ne pas annoncer faussement au posé
    }
    // Rappel périodique de cap et de vitesse (sensation de progression continue).
    if (moving && now - p.lastMsg > 7000) {
      p.lastMsg = now;
      const kmh = Math.round(Math.abs(v.speed) * 60);
      announce(`Vous roulez vers le ${UTIL.cardinals[v.heading]}, environ ${kmh} kilomètres heure, dans ${p.district}.`, 'polite');
    }
    // Synchronise périodiquement le carburant/les dégâts en cours de route
    // (pas seulement à la descente) : sinon une longue session de conduite
    // sans se garer ne se répercutait jamais côté serveur en cas de crash,
    // déconnexion, ou simplement pour un autre joueur qui regarde ce
    // véhicule en même temps.
    if (moving && Net.connected && now - (p.lastSync || 0) > 10000) {
      p.lastSync = now;
      sendWorldEdit('vehicle_position', { id: v.id, x: v.x, y: v.y, locked: v.locked, fuel: v.fuel, hp: v.hp });
    }
  },
  // Assistant de conduite (aide à la conduite manuelle sans la vue) : bascule
  // activé par défaut. Prévient des obstacles DROIT DEVANT le véhicule avant la
  // collision, avec une distance d'anticipation proportionnelle à la vitesse.
  toggleDriveAssist() {
    this.driveAssist = !this.driveAssist;
    announce(this.driveAssist ? 'Assistant de conduite activé. Vous serez prévenu des obstacles devant.' : 'Assistant de conduite désactivé.', 'assertive');
  },
  warnVehicleHazard() {
    if (!this.driveAssist || !this.inVehicle || !this.vehicle) return;
    const v = this.vehicle; const cls = VEHICLE_CATALOG[v.type];
    // Un aéronef EN VOL survole les obstacles : pas d'alerte au sol.
    if (cls && cls.flies && v.altitude > 0) return;
    const spd = Math.abs(v.speed);
    if (spd < 0.05) { this._hazardClear = true; return; } // à l'arrêt : rien à signaler
    const { dx, dy } = this.headingToDelta(v.heading);
    if (dx === 0 && dy === 0) return;
    // Distance de balayage : de 2 cases (lent) à 6 cases (rapide) — on anticipe
    // d'autant plus loin qu'on roule vite.
    const look = Math.min(6, Math.max(2, Math.round(spd / (cls.maxSpeed || 1) * 6) + 1));
    let hitAt = 0;
    for (let i = 1; i <= look; i++) {
      if (City.isSolid(Math.round(v.x + dx * i), Math.round(v.y + dy * i))) { hitAt = i; break; }
    }
    const now = Date.now();
    if (hitAt) {
      if (now - (this._lastHazardWarn || 0) > 1200) {
        this._lastHazardWarn = now; this._hazardClear = false;
        announce(hitAt <= 2 ? 'Freinez, obstacle juste devant !' : `Obstacle à ${hitAt * CONFIG.METERS_PER_TILE} mètres, ralentissez.`, 'assertive');
      }
    } else if (this._hazardClear === false) {
      this._hazardClear = true;
      announce('Voie dégagée.', 'polite');
    }
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
  // Rappel de la mission active à tout moment (raccourci séparé de Ctrl+I qui
  // donne SON PROPRE identifiant) : son identifiant à elle, son type, la
  // récompense, et les identifiants d'équipe déjà autorisés à l'accomplir.
  announceActiveMissionId() {
    const m = this.activeMission;
    if (!m) return announce('Aucune mission active pour le moment.', 'assertive');
    const parts = [`Mission active : ${m.title}, identifiant ${m.id}, récompense ${UTIL.formatMoney(m.reward)}`];
    if (m.authorizedIds && m.authorizedIds.length) parts.push(`identifiants autorisés : ${m.authorizedIds.join(', ')}`);
    const d = Math.round(UTIL.dist(m, this) * CONFIG.METERS_PER_TILE);
    parts.push(`objectif à ${d} mètres, vers le ${UTIL.bearing(m.x - this.x, m.y - this.y)}`);
    announce(parts.join(', ') + '.', 'assertive');
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
    // Toujours, même hors ligne : ce qu'on vient de faire reste inscrit à son
    // propre casier judiciaire (contrairement au niveau de recherche, qui lui
    // redescend avec le temps sans laisser de trace).
    this.criminalRecord.push({ kind, detail, time: Date.now() });
    // Répercute aussi sur l'économie locale : les gens se méfient et les
    // commerces se couvrent davantage dans un quartier où ça braque souvent.
    City.recordCrimeInDistrict(City.getDistrictAt(this.x, this.y).name);
    if (Net.connected) Net.send({ type: 'crime_report', kind, detail });
  },
  onCrimeAlert(kind, detail, x, y) {
    const label = CRIME_LABELS[kind] || 'Signalement';
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

  // Enter / exit vehicle. `targetVehicle` : véhicule PRÉCIS choisi dans le
  // menu de interact() — indispensable quand deux véhicules du même nom sont
  // garés côte à côte : avant, cette fonction retrouvait TOUJOURS elle-même
  // « le plus proche » en ignorant complètement lequel avait été choisi dans
  // le menu, donc les deux entrées identiques du menu faisaient exactement
  // la même chose et il était impossible d'atteindre le second véhicule.
  interactVehicle(targetVehicle) {
    if (this.inVehicle) {
      if (this.stuckInVehicle) return announce('Vous êtes piégé(e) à l\'intérieur : les portières sont verrouillées de l\'extérieur. Il faut qu\'un autre joueur vienne vous libérer.', 'assertive');
      const clsCheck = VEHICLE_CATALOG[this.vehicle.type];
      // Aéronef réellement EN VOL (altitude > 0) : sortir maintenant, c'est
      // sauter dans le vide sans parachute. On demande confirmation avant, et
      // l'appareil livré à lui-même continue de voler (voir tickRiderlessAircraft)
      // jusqu'à s'écraser faute de pilote.
      if (clsCheck && clsCheck.flies && this.vehicle.altitude > 0) {
        const alt = Math.round(this.vehicle.altitude);
        AccessibleConfirm.open(
          'Sortir en plein vol ?',
          `Vous êtes en vol à ${alt} mètres d'altitude, à bord de ${this.vehicle.name}. Sortir maintenant vous fera tomber en chute libre, sans parachute — c'est très dangereux. L'appareil continuera de voler seul, sans personne aux commandes, jusqu'à s'écraser. Voulez-vous vraiment sortir ?`,
          (confirmed) => { if (confirmed) this._exitAircraftInFlight(); }
        );
        return;
      }
      const cls = VEHICLE_CATALOG[this.vehicle.type];
      this.x = Math.round(this.vehicle.x); this.y = Math.round(this.vehicle.y); this.altitude = 0;
      // Le moteur se coupe en descendant : il faudra le redémarrer (et le
      // laisser se stabiliser pour un avion/hélico) au prochain tour au volant.
      this.vehicle.engineOn = false; this.vehicle.engineStartAt = null;
      this.inVehicle = false; this.vehicle.auto = false; Audio.stopEngine(); RealEngine.stop(); RealEngine2.stop(); RealElectricEngine.stop(); RealAirEngine.stop(); AudioLib.stopLoop('veh_essuie_glaces');
      if (this.vehicle.siren) { const sk = SIREN_SOUNDS[this.vehicle.type]; if (sk) AudioLib.stopLoop(sk); this.vehicle.siren = false; }
      if (cls && !cls.flies && !cls.human) { // pas de portière/ceinture/frein à main pour un vélo
        AudioLib.playOnce('veh_ceinture_out', { volume: 0.6 });
        setTimeout(() => AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 }), 250);
        setTimeout(() => { AudioLib.playOnce('veh1_fermeture_porte', { volume: 0.6 }); AudioLib.playOnce('veh_frein_main', { volume: 0.5 }); }, 700);
      }
      // Le carburant et les dégâts encaissés sont désormais synchronisés (pas
      // seulement la position) : sinon, un véhicule repris par un AUTRE
      // joueur (ou retrouvé après reconnexion) réapparaissait toujours à
      // plein d'essence et en parfait état, quoi qu'il se soit vraiment
      // passé pendant que quelqu'un le conduisait.
      sendWorldEdit('vehicle_position', { id: this.vehicle.id, x: this.vehicle.x, y: this.vehicle.y, locked: this.vehicle.locked, fuel: this.vehicle.fuel, hp: this.vehicle.hp });
      // Retenu automatiquement pour pouvoir le retrouver plus tard (touche
      // Maj+F ou "où est ma voiture") — utile de se garer sans s'inquiéter.
      this.lastParkedVehicle = { id: this.vehicle.id, name: this.vehicle.name };
      announce(`Vous descendez du ${this.vehicle.name}.`, 'assertive'); this.vehicle = null;
    } else if (this.ridingWith) {
      // Déjà passager : appuyer de nouveau fait descendre.
      this.leavePassengerSeat();
    } else {
      // Choix de la PORTIÈRE. On repère le(s) véhicule(s) proche(s) (possédé ou
      // non — un taxi peut appartenir à son chauffeur) et un éventuel chauffeur
      // réel au volant tout près.
      const driver = this.getNearbyRemoteDriver();
      const nearby = City.vehicles.filter(vv => UTIL.dist(vv, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this));
      if (!nearby.length && !driver && !targetVehicle) { updateHud(); return announce('Aucun véhicule à proximité.', 'assertive'); }
      // Plusieurs véhicules à portée à la fois (garés côte à côte) : on
      // proposait avant TOUJOURS le plus proche au mètre près, sans un mot —
      // impossible de choisir précisément lequel rejoindre (le sien, celui
      // qu'un autre joueur vient de proposer...), surtout si deux véhicules
      // portent le même nom (même modèle).
      if (!targetVehicle && nearby.length > 1) return this.openNearbyVehiclesMenu(nearby, driver);
      const v = targetVehicle || nearby[0];
      // Vélo / véhicule à une seule place sans portières : pas de menu de
      // portières (une seule place). On monte directement pour l'utiliser.
      const vcls = v ? VEHICLE_CATALOG[v.type] : null;
      if (v && !driver && (vcls?.doors === 0 || vcls?.seats <= 1)) return this.enterAsDriver(v);
      this.openVehicleDoorMenu(v, driver);
    }
    updateHud();
  },
  // Saut confirmé en plein vol (voir interactVehicle) : l'aéronef est libéré
  // à lui-même (continue de voler seul, voir tickRiderlessAircraft) et le
  // joueur entame une chute libre depuis l'altitude au moment du saut.
  _exitAircraftInFlight() {
    const v = this.vehicle; if (!v) return;
    const fallAltitude = v.altitude;
    v.riderless = true; v.speed = Math.max(v.speed, 0.2);
    this.x = Math.round(v.x); this.y = Math.round(v.y);
    this.inVehicle = false; this.vehicle = null;
    Audio.stopEngine(); RealEngine.stop(); RealEngine2.stop(); RealElectricEngine.stop(); RealAirEngine.stop();
    sendWorldEdit('vehicle_position', { id: v.id, x: v.x, y: v.y, locked: v.locked, riderless: true });
    this.freeFalling = true; this.altitude = fallAltitude; this._fallStartAltitude = fallAltitude;
    AudioLib.playOnce('bruit_chute', { volume: 0.7 });
    announce(`Vous sautez de ${v.name} en plein vol ! Chute libre depuis ${Math.round(fallAltitude)} mètres...`, 'assertive');
    updateHud();
  },
  // Chute libre en cours (voir _exitAircraftInFlight) : l'altitude diminue
  // jusqu'à l'impact au sol, qui inflige des dégâts proportionnels à
  // l'altitude de départ — sans parachute, sauter d'un avion en vol depuis
  // une hauteur significative est presque toujours mortel, cohérent avec le
  // reste du jeu (takeDamage/die gèrent déjà la suite : hôpital ou pire).
  FALL_RATE: 5, // mètres perdus par tic (voir setInterval tickFreeFall)
  tickFreeFall() {
    if (!this.freeFalling) return;
    this.altitude = Math.max(0, this.altitude - this.FALL_RATE);
    updateHud();
    if (this.altitude <= 0) {
      this.freeFalling = false;
      AudioLib.playOnce('bruit_chute', { volume: 0.9 });
      const dmg = Math.min(150, Math.round(this._fallStartAltitude * 1.2));
      announce('Vous vous écrasez au sol après votre chute libre !', 'assertive');
      this.takeDamage(dmg, {});
    }
  },
  // Aéronef abandonné en plein vol (voir _exitAircraftInFlight) : personne
  // aux commandes pour le stabiliser, il dérive légèrement de cap et perd
  // doucement de l'altitude jusqu'à s'écraser au sol.
  RIDERLESS_ALT_LOSS: 0.6, // mètres perdus par tic (voir setInterval tickRiderlessAircraft)
  tickRiderlessAircraft() {
    City.vehicles.forEach(v => {
      if (!v.riderless) return;
      const cls = VEHICLE_CATALOG[v.type];
      if (!cls || !cls.flies) { v.riderless = false; return; }
      // Dérive de cap aléatoire, sans personne pour stabiliser l'appareil.
      if (UTIL.chance(0.1)) v.heading = ((v.heading + (UTIL.chance(0.5) ? 1 : -1)) % 8 + 8) % 8;
      const { dx, dy } = this.headingToDelta(v.heading);
      const step = (v.speed || 0.2) * this.MOVE_SCALE;
      v.x = UTIL.clamp(v.x + dx * step, 0, City.W - 1);
      v.y = UTIL.clamp(v.y + dy * step, 0, City.H - 1);
      v.altitude = Math.max(0, v.altitude - this.RIDERLESS_ALT_LOSS);
      if (v.altitude <= 0) {
        v.riderless = false; v.hp = 0; v.speed = 0; v.engineOn = false; v.altitude = 0;
        const d = UTIL.dist(v, this);
        if (d < 60) AudioLib.playPositional('sfx_explosion', this.panForPoint(v.x, v.y), Math.max(0.15, 1 - d / 60));
        if (d < 25) announce(`${v.name} s'écrase au loin, livré à lui-même depuis que son pilote a sauté en vol !`, 'polite');
        RPJournal.log('Aviation', `${v.name} s'écrase, sans personne aux commandes.`, 'alert');
        sendWorldEdit('vehicle_position', { id: v.id, x: v.x, y: v.y, locked: v.locked, riderless: false, hp: 0, altitude: 0 });
      }
    });
  },
  // Choix du véhicule quand plusieurs sont à portée en même temps (garés côte
  // à côte) — avant, E prenait toujours le plus proche au mètre près, sans
  // qu'on puisse choisir. Distance ET orientation (bearing) distinguent deux
  // véhicules même s'ils portent EXACTEMENT le même nom, et "le vôtre" lève
  // toute ambiguïté sur lequel vous appartient réellement.
  openNearbyVehiclesMenu(nearby, driver) {
    ensureMenuOpen();
    el('menuTitle').textContent = 'Plusieurs véhicules à proximité — lequel ?';
    const items = nearby.slice(0, 9).map((v, i) => {
      const dist = Math.round(UTIL.dist(v, this) * CONFIG.METERS_PER_TILE);
      const bearing = UTIL.bearing(v.x - this.x, v.y - this.y);
      const mine = (this.ownedVehicles || []).includes(v.id);
      return { id: v.id, title: `${i + 1}. ${v.name}${mine ? ' (le vôtre)' : ''}`, desc: `${dist} mètres vers le ${bearing}${v.locked ? ', verrouillé' : ''}.`, veh: v };
    });
    renderMenu(items, (sel) => {
      closeMenu();
      const v = sel.veh;
      const vcls = VEHICLE_CATALOG[v.type];
      if (!driver && (vcls?.doors === 0 || vcls?.seats <= 1)) return this.enterAsDriver(v);
      this.openVehicleDoorMenu(v, driver);
    });
  },
  // Menu des portières : le joueur choisit par où monter. La portière CONDUCTEUR
  // exige le permis ; les portières PASSAGER laissent monter sans permis (on ne
  // conduit pas). Si un joueur réel conduit déjà, seules les portières passager
  // sont proposées.
  openVehicleDoorMenu(v, driver) {
    const name = v ? v.name : (driver && driver.vehicleName ? driver.vehicleName : 'le véhicule');
    this.doorCue();
    if (typeof ensureMenuOpen === 'function') ensureMenuOpen(); else el('menuOverlay').style.display = 'flex';
    el('menuTitle').textContent = `Monter dans ${name}`;
    const items = [];
    if (!driver && v) items.push({ id: 'driver', title: '🚗 Portière conducteur', desc: 'Se mettre au volant et conduire. Nécessite le permis (ou un véhicule-école).' });
    items.push({ id: 'front', title: '🧍 Portière passager avant', desc: 'Monter à l\'avant sans conduire. Aucun permis requis.' });
    items.push({ id: 'rear', title: '🚪 Portière passager arrière', desc: 'Monter à l\'arrière sans conduire. Aucun permis requis.' });
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'driver') this.enterAsDriver(v);
      else this.enterAsPassengerSeat(v, driver);
    });
  },
  enterAsDriver(v) {
    if (!v) return announce('Aucun véhicule à conduire ici.', 'assertive');
    if (v.locked) {
      // Même le propriétaire ne peut pas monter tant qu'il n'a pas déverrouillé
      // (Ctrl+L) : sinon le verrouillage n'avait aucun effet réel pour lui,
      // impossible de vraiment vérifier qu'il est bien verrouillé.
      if (this.ownedVehicles.includes(v.id)) return announce(`${v.name} est verrouillé. Déverrouillez-le d'abord (Ctrl+L).`, 'assertive');
      const forceCls = VEHICLE_CATALOG[v.type];
      // Un aéronef a un verrouillage bien plus solide (impossible de le forcer
      // à la volée comme une portière de voiture) ; un véhicule haut de gamme
      // est aussi mieux protégé. Avant, 12 secondes suffisaient pour N'IMPORTE
      // quel véhicule, avion ou hélicoptère compris : le vol était trivial.
      let forceMs = 25000, forceLabel = 'La portière a cédé';
      if (forceCls?.flies) { forceMs = 120000; forceLabel = 'Le verrouillage a fini par céder'; }
      else if (forceCls?.price >= 8000000) { forceMs = 60000; forceLabel = 'La portière a fini par céder'; }
      else if (forceCls?.type === 'poids lourd') { forceMs = 40000; }
      Audio.beep(0, 700);
      const forceWarning = forceCls?.flies
        ? 'Forcer le verrouillage ? C\'est très long sur un aéronef, ça déclenchera l\'alarme et attirera l\'attention pendant tout ce temps.'
        : 'Forcer la portière ? Cela déclenchera l\'alarme antivol et attirera l\'attention pendant tout ce temps.';
      AccessibleConfirm.open(`${v.name} est verrouillé`, forceWarning, (force) => {
        if (!force) return announce('Véhicule verrouillé.', 'assertive');
        AudioLib.playOnce('sfx_alarme_antivol');
        Game.reportCrimeToPolice('vol_vehicule', v.name);
        this.wanted = Math.min(100, this.wanted + 15);
        announce(`Vous forcez ${forceCls?.flies ? 'le verrouillage' : 'la portière'} ! L'alarme antivol retentit : la police est alertée. Ça va prendre du temps.`, 'assertive');
        setTimeout(() => { v.locked = false; announce(`${forceLabel}, vous pouvez monter.`, 'polite'); }, forceMs);
      });
      return;
    }
    const cls = VEHICLE_CATALOG[v.type];
    // Le permis est exigé pour conduire — mais pas pour un véhicule-école, ni
    // pour un vélo ou tout véhicule à propulsion humaine (cls.noLicense).
    if (!v.examVehicle && !cls?.noLicense && !this.checkLicense(cls?.flies ? 'flying' : 'driving')) return;
    // Un véhicule totalement détruit (0 % de vie, suite à des accidents
    // répétés) ne doit plus pouvoir démarrer — avant, rien n'empêchait de
    // rouler avec une épave. Il faut d'abord le faire réparer.
    if ((v.hp || 0) <= 0) return announce(`${v.name} est hors d'usage : le moteur ne démarre plus. Il faut le faire réparer avant de pouvoir le conduire.`, 'assertive');
    if (cls && !cls.flies && !cls.human && cls.doors > 0) { // pas de portière/ceinture pour un vélo, ni pour une moto/scooter/quad (aucune portière)
      AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 });
      if (Net.connected) Net.emitSound('veh1_ouverture_porte', { vol: 0.5 }); // porte audible par les joueurs proches
      setTimeout(() => { AudioLib.playOnce('veh1_fermeture_porte', { volume: 0.6 }); AudioLib.playOnce('veh_ceinture_in', { volume: 0.6 }); }, 350);
    }
    // Ce véhicule est occupé par un PNJ (circulation, voir tickNpcTraffic) :
    // monter dedans, c'est le lui voler de force. Il en est éjecté (redevient
    // un piéton normal), mais dans la panique peut verrouiller les portières
    // de l'extérieur en représailles avant de fuir — piégeant le voleur à
    // l'intérieur, jusqu'à ce qu'un autre VRAI joueur vienne l'aider depuis
    // l'extérieur (voir stuckInVehicle / helpFreeTrappedPlayer).
    let carjackedDriverName = null;
    if (v.aiTraffic) {
      const driver = v.driverNpcId ? City.npcs.find(n => n.id === v.driverNpcId) : null;
      carjackedDriverName = driver ? driver.name : null;
      this._releaseTrafficDriver(v);
      if (this._trafficVehicleIds) this._trafficVehicleIds.delete(v.id);
      if (carjackedDriverName) {
        this.reportCrimeToPolice('vol_vehicule', v.name);
        this.wanted = Math.min(100, this.wanted + 20);
      }
    }
    this.vehicle = v; this.inVehicle = true; this.altitude = v.altitude || 0; this.floor = 0;
    const trappedByCarjack = carjackedDriverName && UTIL.chance(0.4);
    if (trappedByCarjack) this.stuckInVehicle = true;
    // On conduit TOUT DE SUITE avec les flèches, librement, sans qu'aucun menu
    // ne s'impose : c'était la principale source de confusion (« impossible
    // d'avancer sans choisir de destination d'abord »). Pour un guidage vers
    // un lieu précis, le téléphone (Lieux utiles / Carte, bouton 🧭) reste
    // disponible à tout moment, sans jamais bloquer la conduite libre.
    // Boîte manuelle (motos et voitures sport) : annoncé une seule fois à la
    // montée, sans quoi les touches (crochet droit/gauche du clavier, sans
    // rapport avec le cap) restaient invisibles pour le joueur.
    const gearboxHint = cls?.manualGearbox ? ` Boîte manuelle à ${this.GEAR_RATIOS.length} rapports : les deux touches à droite du clavier, juste avant la touche Entrée (crochet fermant pour monter d'un rapport, celle juste avant pour redescendre), plafonnent votre vitesse tant que vous ne passez pas le rapport suivant.` : '';
    if (trappedByCarjack) {
      announce(`Vous arrachez ${carjackedDriverName} de son véhicule et prenez le volant ! Mais ${carjackedDriverName} verrouille les portières de l'extérieur avant de fuir : vous êtes piégé(e) à l'intérieur.${gearboxHint} Il faudra qu'un autre joueur vienne vous libérer depuis l'extérieur.`, 'assertive');
    } else if (carjackedDriverName) {
      announce(`Vous arrachez ${carjackedDriverName} de son véhicule et prenez le volant !${gearboxHint}`, 'assertive');
    } else if (cls?.human) announce(`Vous enfourchez ${v.name}. Flèches pour pédaler et tourner, espace pour freiner.`, 'assertive');
    else if (cls?.doors === 0) announce(`Vous enfourchez ${v.name}. Flèche haut pour démarrer le moteur, puis accélérer et tourner, espace pour freiner.${gearboxHint}`, 'assertive'); // moto / scooter / quad : on accélère, on ne pédale pas
    else announce(`Vous montez au volant de ${v.name}. Flèche haut pour démarrer le moteur${cls?.flies ? ' et le laisser se stabiliser' : ''}, puis conduire. Espace pour freiner.${gearboxHint}`, 'assertive');
    if (this.activeMission && this.activeMission.type === 'convoyage' && this.activeMission.vehicleId === v.id && !this.deliveryState) this.startVehicleDelivery(this.activeMission);
    // Le taxi PNJ qu'on a fait venir (Ctrl+X) n'a pas de chauffeur : contrairement
    // aux autres véhicules, on promet explicitement "dites un lieu" en l'appelant
    // — il faut donc bien proposer le choix de destination à la montée, pas
    // laisser le joueur chercher ça de son côté dans le téléphone.
    if (v.type === 'taxi' && !v.owner) setTimeout(() => this.autoDriveMenu(), 400);
    this._vehProg = null; // réinitialise le suivi de progression
    updateHud();
  },
  enterAsPassengerSeat(v, driver) {
    // Un chauffeur réel conduit : on le suit en direct (position du chauffeur).
    if (driver) { this.boardAsPassenger(driver); updateHud(); return; }
    if (!v) return announce('Aucun véhicule où s\'asseoir ici.', 'assertive');
    AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 });
    setTimeout(() => AudioLib.playOnce('veh1_fermeture_porte', { volume: 0.6 }), 350);
    // On s'assied côté passager : on suit la position du véhicule (utile si un
    // autre joueur prend le volant), sans permis et sans conduire.
    this.ridingWith = { id: null, name: v.name, vehicleId: v.id };
    announce(`Vous montez côté passager de ${v.name}. Vous ne conduisez pas ; il faut quelqu'un au volant pour rouler. Appuyez sur Interagir pour descendre.`, 'assertive');
    updateHud();
  },

  // Monter comme passager avec un autre joueur (taxi, covoiturage) : aucun
  // permis requis, on suit sa position. Utile notamment après avoir appelé un
  // vrai chauffeur : il vient, on monte, il conduit.
  ridingWith: null,
  getNearbyRemoteDriver() {
    if (!Net.connected) return null;
    // Rayon large (8 cases ~ 32 m) : le taxi qu'on a appelé s'arrête souvent à
    // quelques pas, pas pile sur nous.
    let best = null, bd = Infinity;
    for (const p of Net.remotePlayers.values()) {
      if (!p.inVehicle) continue;
      const d = UTIL.dist(p, this);
      if (d < 8 && d < bd) { bd = d; best = p; }
    }
    return best;
  },
  boardAsPassenger(driver) {
    this.ridingWith = { id: driver.id, name: `${driver.firstName} ${driver.lastName}`, vehicleName: driver.vehicleName || null };
    AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 });
    setTimeout(() => { AudioLib.playOnce('veh1_fermeture_porte', { volume: 0.6 }); AudioLib.playOnce('veh_ceinture_in', { volume: 0.6 }); }, 350);
    announce(`Vous montez comme passager avec ${this.ridingWith.name}${driver.vehicleName ? ', dans ' + driver.vehicleName : ''}. Vous suivez le trajet. Appuyez sur Interagir pour descendre.`, 'assertive');
    // Avant, aucun moyen d'indiquer où l'on veut aller ni de faire suivre un
    // message reçu (par exemple une adresse) au chauffeur une fois monté.
    setTimeout(() => this.openTaxiPassengerMenu(driver), 900);
  },
  openTaxiPassengerMenu(driver) {
    if (!this.ridingWith || this.ridingWith.id !== driver.id) return; // déjà descendu entre-temps
    el('menuTitle').textContent = 'Avec le chauffeur';
    const items = [
      { id: 'dest', title: '🗣️ Indiquer une destination', desc: 'Envoyer un message au chauffeur pour lui dire où aller.' },
      { id: 'forward', title: '📩 Transmettre un message reçu', desc: 'Faire suivre un message récent (par exemple une adresse) au chauffeur.' },
      { id: 'skip', title: '↩️ Rien pour l\'instant', desc: '' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'dest') {
        AccessibleTextPrompt.open('Destination', 'Où voulez-vous aller ?', '', (text) => {
          if (!text) return;
          Net.smsSend(driver.id, `Destination souhaitée : ${text}`, (res) => { if (!res.ok) announce(res.reason || 'Message non envoyé.', 'assertive'); else announce('Destination transmise au chauffeur.', 'polite'); });
        });
      } else if (sel.id === 'forward') {
        Phone.pickReceivedMessage(driver.id, `${driver.firstName} ${driver.lastName}`);
      }
    });
  },
  leavePassengerSeat() {
    if (!this.ridingWith) return;
    const name = this.ridingWith.name;
    this.ridingWith = null;
    AudioLib.playOnce('veh_ceinture_out', { volume: 0.6 });
    setTimeout(() => AudioLib.playOnce('veh1_ouverture_porte', { volume: 0.6 }), 200);
    announce(`Vous descendez du véhicule de ${name}.`, 'assertive');
    updateHud();
  },

  // ===== Garages et livraison de véhicule (façon GTA RP) =====
  // Un véhicule n'apparaît plus n'importe où sur demande : sa position RÉELLE
  // (v.x, v.y) détermine où il se trouve. S'il est garé dans un des 3 garages
  // principaux de la ville, un chauffeur PNJ peut le livrer via le téléphone.
  // S'il est chez soi (maison possédée), il faut aller le chercher sur place,
  // ou demander son transfert vers un garage principal. Un aéronef n'est
  // jamais livré : uniquement récupérable là où il se trouve physiquement.
  // Boîte manuelle : 5 rapports, chacun plafonnant la vitesse atteignable à
  // une fraction du maximum du véhicule (comme une vraie boîte à vitesses).
  GEAR_RATIOS: [0.3, 0.5, 0.7, 0.85, 1.0],
  shiftGear(delta) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez d\'abord dans un véhicule.', 'assertive');
    const v = this.vehicle; const cls = VEHICLE_CATALOG[v.type];
    if (!cls.manualGearbox) return announce('Ce véhicule n\'a pas de boîte manuelle.', 'polite');
    v.gear = v.gear || 1;
    const next = UTIL.clamp(v.gear + delta, 1, this.GEAR_RATIOS.length);
    if (next === v.gear) return announce(delta > 0 ? 'Déjà au rapport le plus haut.' : 'Déjà au point mort le plus bas.', 'polite');
    v.gear = next;
    Audio.click(); // clic mécanique bref pour l'embrayage/changement de vitesse
    announce(`Vitesse ${v.gear} sur ${this.GEAR_RATIOS.length} engagée.`, 'polite');
  },
  GARAGE_RADIUS: 5, // ~20 m : rayon de détection "garé à cet endroit"
  mainGarages() { return City.pois.filter(p => p.type === 'garage' && p.principal); },
  // Détermine où se trouve RÉELLEMENT un véhicule possédé.
  getVehicleLocationInfo(v) {
    const cls = VEHICLE_CATALOG[v.type];
    if (cls?.flies) {
      const airport = City.pois.find(p => p.type === 'aeroport' && UTIL.dist(v, p) < this.GARAGE_RADIUS * 3);
      return airport ? { kind: 'aeroport', poi: airport } : { kind: 'ailleurs' };
    }
    const garage = this.mainGarages().find(g => UTIL.dist(v, g) < this.GARAGE_RADIUS);
    if (garage) return { kind: 'garage_principal', poi: garage };
    const house = this.ownedHouses.map(hid => City.houses.find(h => h.id === hid)).find(h => h && UTIL.dist(v, h) < this.GARAGE_RADIUS);
    if (house) return { kind: 'garage_maison', house };
    return { kind: 'ailleurs' };
  },
  // Phrase courte décrivant OÙ se trouve le véhicule (catégorie), pour le
  // téléphone et pour expliquer pourquoi une livraison est refusée. Ne donne
  // pas la distance/le cap : voir describeVehicleLocationFull pour ça.
  describeVehicleLocation(v) {
    const loc = this.getVehicleLocationInfo(v);
    if (loc.kind === 'garage_principal') return `garé au ${loc.poi.name}`;
    if (loc.kind === 'garage_maison') return `garé dans votre parking personnel (${loc.house.name || 'votre maison'})`;
    if (loc.kind === 'aeroport') return `à ${loc.poi.name}`;
    return `dernier emplacement connu, quartier ${City.getDistrictAt(v.x, v.y).name}`;
  },
  // Description complète (catégorie + distance + cap depuis le joueur), pour
  // la fonction "Localiser" du téléphone : dire seulement "garage principal 2"
  // ne suffit pas à s'y rendre sans repère de direction/distance.
  describeVehicleLocationFull(v) {
    const d = Math.round(UTIL.dist(v, this) * CONFIG.METERS_PER_TILE);
    const bearing = UTIL.bearing(v.x - this.x, v.y - this.y);
    return `${this.describeVehicleLocation(v)}, à ${d} mètres, cap ${bearing}`;
  },
  // Menu du garage (touche O) : choisir un véhicule possédé pour demander sa
  // livraison (s'il est dans un garage principal) — la position affichée
  // vous dit tout de suite si c'est possible ou pas.
  openGarage() {
    if (!this.ownedVehicles.length) return announce('Vous ne possédez pas de véhicule.', 'assertive');
    const owned = this.ownedVehicles.map(id => City.vehicles.find(v => v.id === id)).filter(Boolean);
    if (!owned.length) return announce('Aucun de vos véhicules n\'est disponible pour le moment.', 'assertive');
    if (owned.length === 1) return this.requestVehicleDelivery(owned[0]);
    if (typeof ensureMenuOpen === 'function') ensureMenuOpen();
    el('menuTitle').textContent = '🚗 Mon parking — appeler un véhicule';
    const items = owned.map((v, i) => ({
      id: 'veh_' + i,
      title: v.name,
      desc: `${VEHICLE_CATALOG[v.type]?.type || v.type}, ${this.describeVehicleLocation(v)}.`,
      veh: v,
    }));
    renderMenu(items, (it) => { if (it.veh) { closeMenu(); this.requestVehicleDelivery(it.veh); } });
    el('menuOverlay').style.display = 'flex';
    announce(`Vous possédez ${owned.length} véhicules. Choisissez celui à faire livrer.`, 'assertive');
  },
  // Demande la livraison d'un véhicule par un chauffeur PNJ : uniquement
  // possible s'il est actuellement garé dans un des 3 garages principaux.
  requestVehicleDelivery(v) {
    const cls = VEHICLE_CATALOG[v.type];
    if (cls?.flies) return announce(`${v.name} est un aéronef : pas de livraison possible. Il ne se récupère que là où il se trouve — ${this.describeVehicleLocationFull(v)}.`, 'assertive');
    if (v.pendingService) return announce(`${v.name} est déjà en cours de service (${v.pendingService === 'livraison' ? 'livraison' : 'transfert'} en cours).`, 'assertive');
    const loc = this.getVehicleLocationInfo(v);
    if (loc.kind !== 'garage_principal') {
      const extra = loc.kind === 'garage_maison' ? ' Depuis le téléphone, vous pouvez demander son transfert vers un parking principal pour pouvoir ensuite le faire livrer.' : '';
      return announce(`${v.name} n'est pas dans un parking principal (${this.describeVehicleLocationFull(v)}) : impossible de le faire livrer.${extra}`, 'assertive');
    }
    const delaySec = UTIL.randInt(30, 60);
    v.pendingService = 'livraison';
    announce(`Un chauffeur va vous livrer ${v.name} depuis ${loc.poi.name}. Patientez environ ${delaySec} secondes.`, 'assertive');
    setTimeout(() => {
      v.pendingService = null;
      if (!City.vehicles.includes(v)) return; // vendu/supprimé entre-temps
      v.x = Math.round(this.x) + 1; v.y = Math.round(this.y) + 1; v.fuel = Math.max(v.fuel, 0.5); v.locked = false;
      if (window.AudioLib) AudioLib.playOnce('sfx_notification', { volume: 0.4 });
      announce(`${v.name} vient d'être livré juste à côté de vous.`, 'assertive');
    }, delaySec * 1000);
  },
  // Demande le transfert d'un véhicule depuis le garage personnel (maison)
  // vers un des 3 garages principaux, pour pouvoir ensuite le faire livrer.
  openVehicleTransferMenu(v) {
    const loc = this.getVehicleLocationInfo(v);
    if (loc.kind !== 'garage_maison') return announce(`${v.name} n'est pas dans un parking personnel (${this.describeVehicleLocationFull(v)}).`, 'assertive');
    if (v.pendingService) return announce(`${v.name} est déjà en cours de service.`, 'assertive');
    const garages = this.mainGarages();
    if (typeof ensureMenuOpen === 'function') ensureMenuOpen();
    el('menuTitle').textContent = `Transférer ${v.name} vers...`;
    const items = garages.map((g, i) => ({ id: 'g_' + i, title: g.name, desc: `${Math.round(UTIL.dist(g, this) * CONFIG.METERS_PER_TILE)} m d'ici.`, garage: g }));
    renderMenu(items, (it) => { if (it.garage) { closeMenu(); this.transferVehicleToGarage(v, it.garage); } });
    el('menuOverlay').style.display = 'flex';
    announce(`Choisissez le parking principal vers lequel transférer ${v.name}.`, 'assertive');
  },
  transferVehicleToGarage(v, garage) {
    const delaySec = UTIL.randInt(60, 120);
    v.pendingService = 'transfert';
    announce(`Transfert de ${v.name} vers ${garage.name} demandé. Cela prendra quelques minutes.`, 'assertive');
    setTimeout(() => {
      v.pendingService = null;
      if (!City.vehicles.includes(v)) return;
      v.x = garage.x; v.y = garage.y; v.locked = false;
      announce(`${v.name} est arrivé au ${garage.name}. Vous pouvez maintenant demander sa livraison depuis le téléphone.`, 'assertive');
    }, delaySec * 1000);
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
    // Toute arme (achetée, donnée, ramassée, butin) doit apparaître dans la
    // liste des armes. On la reconnaît par sa catégorie OU parce que son id est
    // une arme du catalogue, et on évite les doublons.
    if ((item.category === 'arme' || item.id?.startsWith('weapon') || (typeof WEAPON_CATALOG !== 'undefined' && WEAPON_CATALOG[item.id])) && !this.weapons.includes(item.id)) this.weapons.push(item.id);
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
    if (it.category === 'stupefiant') {
      // Consommer un stupéfiant : effet passager (énergie/euphorie/calme) mais
      // ça attire l'attention de la police et ce n'est jamais bon pour la santé.
      if (it.effect === 'energie') { this.energy = Math.min(100, this.energy + 40); }
      else if (it.effect === 'euphorie') { this.energy = Math.min(100, this.energy + 20); this.hunger = Math.max(0, this.hunger - 15); }
      else { this.thirst = Math.max(0, this.thirst - 10); } // 'calme'
      this.health = Math.max(1, this.health - 5);
      this.policeAwareness = Math.min(100, (this.policeAwareness || 0) + 10);
      it.q--; if (it.q <= 0) this.removeItem(id, 1);
      Audio.click();
      announce(`Vous consommez ${it.name}. Effet ${it.effect || 'passager'}. Attention, la police veille.`, 'assertive');
      updateHud();
      return;
    }
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
  // Bilan vocal de son propre état : santé, faim, soif, énergie, argent (poche,
  // banque, sale), et essence/batterie si en véhicule — rien de tout ça
  // n'était consultable auparavant (seul un HUD visuel existait, inutile pour
  // un joueur aveugle).
  // Bilan volontairement COURT : uniquement l'essentiel toujours utile (santé,
  // faim, soif, énergie, argent en poche), le reste seulement quand ça change
  // vraiment quelque chose. Avant, casque/gilet étaient annoncés à chaque
  // fois même quand non portés ("pas de casque, pas de gilet"), ce qui
  // rallongeait le bilan sans rien apporter — trop d'informations à chaque F6.
  announceStatus() {
    const parts = [`Santé ${Math.round(this.health)}%`, `faim à ${Math.round(this.hunger)}%`, `soif à ${Math.round(this.thirst)}%`, `énergie ${Math.round(this.energy)}%`, `argent en poche : ${UTIL.formatMoney(this.money)}`];
    if (this.bank) parts.push(`en banque : ${UTIL.formatMoney(this.bank)}`);
    if (this.dirtyMoney) parts.push(`argent sale : ${UTIL.formatMoney(this.dirtyMoney)}`);
    if (this.hasHelmet) parts.push('casque blindé porté');
    if (this.hasVest) parts.push('gilet blindé porté');
    if (this.inVehicle && this.vehicle) {
      const cls = VEHICLE_CATALOG[this.vehicle.type];
      if (!cls.human) parts.push(`${cls.electric ? 'batterie' : 'essence'} ${Math.round(this.vehicle.fuel * 100)}%`);
    }
    announce(parts.join(', ') + '.', 'polite');
  },
  // Détail complémentaire (joueurs connectés, type de connexion) séparé du
  // bilan principal (F6) pour ne pas l'alourdir — consultable à part via F7.
  // Le type de connexion (Wi-Fi/données mobiles) aide à comprendre pourquoi la
  // voix de proximité passe ou pas : en données mobiles, le lien direct entre
  // deux joueurs échoue souvent (NAT symétrique/CGNAT côté opérateur) et tout
  // repose alors sur le relais TURN de secours, moins fiable.
  announceServerInfo() {
    const netType = typeof getNetworkTypeLabel === 'function' ? getNetworkTypeLabel() : null;
    const netMsg = netType ? `Votre connexion : ${netType}.` : '';
    if (!Net.connected) return announce(`Vous jouez en solo (hors ligne). ${netMsg}`.trim(), 'polite');
    const n = Net.remotePlayers.size + 1;
    announce(`${n} joueur${n > 1 ? 's' : ''} connecté${n > 1 ? 's' : ''} dans la ville. ${netMsg}`.trim(), 'polite');
  },
  announceLocation() {
    const d = City.getDistrictAt(this.x, this.y);
    const street = City.isRoad(this.x, this.y) ? 'sur la route' : `près d\'un ${City.getTile(this.x, this.y)}`;
    const bearing = UTIL.cardinals[this.heading];
    const alt = this.altitude > 0 ? `, altitude ${Math.round(this.altitude)} mètres` : '';
    const etage = (!this.inVehicle && this.floor > 0) ? `, étage ${this.floor}` : '';
    announce(`Vous êtes dans ${d.name}, ${street}, cap vers le ${bearing}${etage}${alt}.`, 'polite');
  },
  // Heure et phase du cycle jour/nuit (voir DayNight) : partagée par tout le
  // monde en multijoueur, calculée localement en solo.
  announceTime() {
    if (typeof DayNight === 'undefined') return announce('Cycle jour/nuit indisponible.', 'assertive');
    const h = Math.floor(DayNight.hour);
    const m = Math.floor((DayNight.hour - h) * 60);
    const phaseLabel = { aube: 'l\'aube', jour: 'la journée', crepuscule: 'le crépuscule', nuit: 'la nuit' }[DayNight.phase] || DayNight.phase;
    announce(`Il est ${h} heure${h > 1 ? 's' : ''} ${m > 0 ? m + ' ' : ''}dans la ville : c'est ${phaseLabel}.`, 'polite');
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

  // Joue un son émis par un autre joueur (reçu du serveur), spatialisé et
  // atténué selon la distance et sa position relative à notre cap. Sons du
  // monde partagés : moteurs, pas, tirs, klaxon, sirène, portes, collisions.
  playRemoteSound(msg) {
    if (!msg || typeof msg.x !== 'number' || !msg.key) return;
    const R = 30; // rayon audible (doit correspondre au SOUND_RADIUS serveur)
    const d = UTIL.dist(msg, this);
    if (d > R) return;
    const pan = this.panForPoint(msg.x, msg.y);
    const atten = Math.max(0, 1 - d / R);
    const vol = Math.max(0.03, (typeof msg.vol === 'number' ? msg.vol : 0.5) * atten);
    // Clés « synth:… » : effets synthétisés rejoués localement (mêmes sons que
    // ceux entendus par l'émetteur), spatialisés par le pan.
    if (msg.key.slice(0, 6) === 'synth:') {
      const fx = msg.key.slice(6);
      if (!window.Audio) return;
      if (fx === 'gunshot') { Audio.gunshot('', pan); if (typeof GuideDog !== 'undefined') GuideDog.onDangerNear(msg.x, msg.y); }
      else if (fx === 'impact') Audio.impact(pan);
      else if (fx === 'siren') Audio.siren(vol);
      else if (fx === 'screech') Audio.screech(pan);
      else if (fx === 'engine') Audio.tone({ freq: 90, type: 'sawtooth', duration: 0.3, gain: vol * 0.25, pan });
      return;
    }
    // Sinon : fichier audio joué de façon panoramique.
    if (window.AudioLib) {
      if (AudioLib.playPositional) AudioLib.playPositional(msg.key, pan, vol);
      else if (AudioLib.playOnce) AudioLib.playOnce(msg.key, { volume: vol });
    }
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

  // F — Radar de PROXIMITÉ : « photo sonore » instantanée de tout ce qui vous
  // entoure — personnes (PNJ ET vrais joueurs), véhicules et lieux — chacun
  // joué comme un bip spatialisé (position stéréo = direction réelle, hauteur =
  // proximité) avec un TIMBRE distinct par catégorie (reconnaissable à l'oreille),
  // balayé de la gauche vers la droite, puis un résumé parlé du plus proche de
  // chaque type. Le détail verbal complet reste sur le Scan.
  RADAR_CATS: {
    joueur:   { type: 'square',   base: 560, label: 'joueur réel' },
    personne: { type: 'sine',     base: 500, label: 'personne' },
    vehicule: { type: 'sawtooth', base: 340, label: 'véhicule' },
    lieu:     { type: 'triangle', base: 280, label: 'lieu' },
  },
  soundRadar() {
    const R = 35;
    const items = [];
    City.npcs.forEach(n => { const d = UTIL.dist(n, this); if (d < R) items.push({ x: n.x, y: n.y, dist: d, name: n.name || 'personne', cat: 'personne' }); });
    if (Net.connected) Array.from(Net.remotePlayers.values()).forEach(p => { if (!p || p.unconscious) return; const d = UTIL.dist(p, this); if (d < R) items.push({ x: p.x, y: p.y, dist: d, name: (p.firstName || 'Joueur') + ' (joueur réel)', cat: 'joueur' }); });
    City.vehicles.forEach(v => { if (v.owner) return; const d = UTIL.dist(v, this); if (d < R) items.push({ x: v.x, y: v.y, dist: d, name: v.name || 'véhicule', cat: 'vehicule' }); });
    City.pois.forEach(p => { const d = UTIL.dist(p, this); if (d < R) items.push({ x: p.x, y: p.y, dist: d, name: p.name, cat: 'lieu' }); });
    if (!items.length) { announce('Radar de proximité : rien à signaler autour de vous.', 'interrupt'); Audio.tone({ freq: 300, type: 'sine', duration: 0.2, gain: 0.08, pan: 0 }); return; }
    // On garde les plus proches, puis on les ordonne de la gauche vers la droite.
    const near = items.slice().sort((a, b) => a.dist - b.dist).slice(0, 12).map(o => ({ ...o, pan: this.panForPoint(o.x, o.y) })).sort((a, b) => a.pan - b.pan);
    const c = { personne: 0, joueur: 0, vehicule: 0, lieu: 0 };
    near.forEach(o => c[o.cat]++);
    const people = c.personne + c.joueur;
    announce(`Radar de proximité : ${people} personne${people > 1 ? 's' : ''}, ${c.vehicule} véhicule${c.vehicule > 1 ? 's' : ''}, ${c.lieu} lieu${c.lieu > 1 ? 'x' : ''}. Balayage de la gauche vers la droite.`, 'interrupt');
    // Phase 1 : bip spatialisé par entité, timbre selon le type.
    near.forEach((o, i) => {
      setTimeout(() => {
        const cat = this.RADAR_CATS[o.cat];
        Audio.tone({ freq: cat.base + Math.max(0, (R - o.dist)) * 12, type: cat.type, duration: 0.13, gain: 0.09, pan: o.pan });
      }, i * 220);
    });
    // Phase 2 : résumé parlé — l'entité la plus proche de chaque type.
    const nearestOf = (kinds) => items.filter(o => kinds.includes(o.cat)).sort((a, b) => a.dist - b.dist)[0];
    const lines = [];
    [['personne', 'joueur'], ['vehicule'], ['lieu']].forEach(kinds => {
      const o = nearestOf(kinds);
      if (o) lines.push(`${o.name}, ${Math.round(o.dist * CONFIG.METERS_PER_TILE)} mètres vers le ${UTIL.bearing(o.x - this.x, o.y - this.y)}`);
    });
    if (lines.length) setTimeout(() => speak('Le plus proche : ' + lines.join(' ; ') + '.', 'polite'), near.length * 220 + 250);
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
      // Arrivée : on invite explicitement à l'action à faire sur place (petit
      // tutoriel contextuel), pour ne pas laisser le joueur planté sans savoir
      // quoi faire. Un bâtiment/véhicule proche ? On dit d'appuyer sur E.
      let hint = '';
      if (!this.guidanceFollowId) {
        const canInteract = City.pois.some(p => UTIL.dist(p, this) < 4)
          || City.houses.some(h => UTIL.dist(h, this) < 4)
          || City.vehicles.some(v => UTIL.dist(v, this) < 3)
          || City.npcs.some(n => !n.dead && UTIL.dist(n, this) < 3);
        if (canInteract) {
          const nearBuilding = City.pois.some(p => UTIL.dist(p, this) < 4) || City.houses.some(h => UTIL.dist(h, this) < 4);
          hint = ' Appuyez sur E pour interagir' + (nearBuilding ? ', ou la touche Q pour entrer' : '') + '.';
        }
      }
      announce((this.guidanceFollowId ? `Vous avez rejoint ${t.name}.` : `Vous êtes arrivé à ${t.name}.`) + hint, 'interrupt');
      Audio.cash();
      this.guidanceTarget = null; this.guidanceAxis = null; this.guidancePath = null; this._pathGoal = null; this.guidanceFollowId = null; return;
    }
    // Silence total si on ne progresse pas : avant, la voix continuait à
    // répéter la consigne toutes les 2,5 s même à l'arrêt complet (stationné
    // à pied ou véhicule immobile) — inutile et dérangeant.
    const moving = (this.inVehicle && this.vehicle) ? Math.abs(this.vehicle.speed || 0) > 0.02
      : UTIL.dist({ x: this.x, y: this.y }, this._lastGuidancePos || { x: this.x, y: this.y }) > 0.05;
    this._lastGuidancePos = { x: this.x, y: this.y };
    if (!force && !moving) return;

    const now = Date.now();
    // Intervalle de réévaluation adapté à la vitesse : plus on va vite, plus
    // tôt une consigne de virage arrive (jusqu'à deux fois plus tôt à pleine
    // vitesse), pour avoir le temps de réagir — avant, un intervalle fixe de
    // 2,5 s ne tenait aucun compte de l'allure.
    const speedRatio = (this.inVehicle && this.vehicle) ? UTIL.clamp(Math.abs(this.vehicle.speed || 0) / ((VEHICLE_CATALOG[this.vehicle.type] || {}).maxSpeed || 1), 0, 1) : 0;
    if (!force && now - this._lastGuidanceMsg < 2500 - speedRatio * 1200) return;
    this._lastGuidanceMsg = now;

    // En vol (aéronef, altitude > 0) : on survole les bâtiments, donc une
    // ligne DROITE (diagonale comprise) vers la cible, jamais le chemin au sol
    // qui contourne les immeubles — sinon le guidage faisait "tourner" un
    // avion en plein ciel comme s'il marchait entre des maisons.
    const vcls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    // Mémorisé AVANT de recalculer l'instruction (qui écrase _lastTurnDiff en
    // sous-main, voir _turnInstruction) : sert plus bas à ne reparler que si
    // le VIRAGE À FAIRE change réellement, indépendamment de la distance en
    // mètres qui, elle, varie en continu et rendait la comparaison de texte
    // ("Tout droit, 40 mètres" puis "Tout droit, 37 mètres"...) presque
    // toujours "différente" — d'où la voix qui semblait répéter sans arrêt.
    const prevTurnDiff = this._lastTurnDiff;
    let instruction;
    if (vcls && vcls.flies && this.vehicle.altitude > 0) {
      instruction = this._flightInstruction(t);
    } else {
      // Guidage le long d'un VRAI chemin praticable (contourne les bâtiments et
      // l'eau) : on ne dirige jamais quelqu'un vers un mur. Si aucun chemin n'est
      // trouvé (destination trop lointaine ou isolée), on retombe sur l'ancien
      // guidage direct par axe.
      this._ensurePath(t);
      instruction = this._pathInstruction();
      if (!instruction) instruction = this._axisInstruction(t);
    }

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
    // Mode bips directionnels : pour ceux que la voix répétée dérange, un
    // simple bip suffit à indiquer où tourner (activé/désactivé par Maj+N).
    // La voix classique reste le mode par défaut, inchangé.
    if (CONFIG.GPS_BEEP_MODE) { this._playGuidanceBeep(this._lastTurnDiff || 0); return; }
    // Petit bip de confirmation à CHAQUE recalcul (toujours audible, discret,
    // jamais gênant) ; la phrase complète, elle, n'est reparlée que si le
    // virage à faire a réellement changé (nouveau virage, ou retour à "tout
    // droit") — avant, elle repassait en priorité 'interrupt' toutes les
    // 2,5 s même sans rien de nouveau à dire, coupant systématiquement
    // n'importe quelle autre annonce en cours, plus importante ou non.
    Audio.tone({ freq: 700, type: 'sine', duration: 0.1, gain: 0.08, pan: this.panForPoint(t.x, t.y) });
    // Tag 'guidance' : si une instruction de virage est encore en train
    // d'être lue (ou en attente) quand une NOUVELLE instruction, différente,
    // devient due, l'ancienne est forcément périmée — elle est coupée/
    // remplacée au lieu de s'empiler derrière, pour ne plus jamais avoir
    // "tu pars à gauche, tu pars à droite, tu pars à gauche..." qui
    // s'accumule et se joue en retard.
    if (force || this._lastTurnDiff !== prevTurnDiff) speak(instruction, 'assertive', { tag: 'guidance' });
  },
  // Bip directionnel (mode Maj+N) : un bip aigu centré tout droit, un bip
  // panoramique à droite/gauche selon le virage, doublé si le virage est
  // franc, deux bips graves pour un demi-tour — reconnaissable sans écouter
  // aucune phrase.
  _playGuidanceBeep(diff) {
    diff = ((diff % 8) + 8) % 8;
    const beep = (freq, pan, delay) => setTimeout(() => { if (window.Audio && Audio.tone) Audio.tone({ freq, type: 'sine', duration: 0.12, gain: 0.12, pan }); }, delay || 0);
    if (diff === 0 || diff === 1 || diff === 7) beep(880, 0);
    else if (diff === 4) { beep(300, 0); beep(300, 0, 160); }
    else if (diff === 2) beep(600, 0.8);
    else if (diff === 3) { beep(600, 0.8); beep(600, 0.8, 160); }
    else if (diff === 6) beep(600, -0.8);
    else if (diff === 5) { beep(600, -0.8); beep(600, -0.8, 160); }
  },
  // Bascule le mode de guidage GPS entre voix parlée (par défaut) et bips
  // directionnels seuls, pour ceux que les annonces vocales répétées
  // dérangent en conduite. Persisté indépendamment de la sauvegarde de partie.
  toggleGpsBeeps() {
    CONFIG.GPS_BEEP_MODE = !CONFIG.GPS_BEEP_MODE;
    UserSettings.save();
    announce(CONFIG.GPS_BEEP_MODE ? 'Guidage GPS par bips sonores activé : un bip aigu tout droit, un bip à droite ou à gauche selon le virage, deux bips graves pour un demi-tour.' : 'Guidage GPS vocal réactivé.', 'assertive');
  },
  // Direction cardinale d'une case à sa voisine (0=nord,2=est,4=sud,6=ouest ;
  // -1 si pas cardinalement adjacentes).
  _dirOf(x0, y0, x1, y1) { const dx = x1 - x0, dy = y1 - y0; if (dx > 0 && dy === 0) return 2; if (dx < 0 && dy === 0) return 6; if (dy > 0 && dx === 0) return 4; if (dy < 0 && dx === 0) return 0; return -1; },
  // Consigne de virage selon l'écart de cap (en huitièmes de tour, 0..7) : gère
  // aussi les diagonales, puisqu'à pied on s'oriente maintenant par 45°.
  // 0 devant, 1 légèrement à droite, 2 à droite, 3 franchement à droite,
  // 4 demi-tour, 5 franchement à gauche, 6 à gauche, 7 légèrement à gauche.
  _turnInstruction(diff, meters) {
    diff = ((diff % 8) + 8) % 8;
    this._lastTurnDiff = diff; // mémorisé pour le mode bips (voir updateGuidance)
    // Un écart de 45° ou moins (diff 0, 1 ou 7) est traité comme « tout droit » :
    // avec la rotation fine à 45°, un simple dépassement d'un cran faisait sinon
    // dire « légèrement à gauche » puis « légèrement à droite » en boucle (le
    // zigzag signalé). On ne demande un virage que pour un écart d'au moins 90°.
    if (diff === 0 || diff === 1 || diff === 7) return `Tout droit, ${meters} mètres`;
    if (diff === 4) return `Faites demi-tour, puis ${meters} mètres`;
    const cote = diff <= 3 ? 'à droite' : 'à gauche';
    const nuance = (diff === 3 || diff === 5) ? 'franchement ' : '';
    return `Tournez ${nuance}${cote}, puis ${meters} mètres`;
  },
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
    let instr = this._turnInstruction(diff, meters);
    let nextDir = -1;
    if (e < path.length - 1) nextDir = this._dirOf(path[e].x, path[e].y, path[e + 1].x, path[e + 1].y);
    if (nextDir < 0) {
      instr += ', vous arrivez';
    } else if (distToTurn <= 6) {
      // Aperçu du virage suivant donné seulement s'il est PROCHE : annoncé dès
      // le début d'un long segment droit (ex. "Tout droit, 92 mètres, puis à
      // droite"), ce "puis à droite" final ressemblait à une consigne
      // immédiate et poussait à tourner bien trop tôt — d'où le zigzag
      // rapporté (le joueur tournait puis devait sans cesse se corriger).
      const nd = ((nextDir - firstDir) % 8 + 8) % 8;
      const w = nd === 2 ? 'à droite' : nd === 6 ? 'à gauche' : nd === 4 ? 'demi-tour' : '';
      if (w) instr += `, bientôt ${w}`;
    }
    return instr + '.';
  },
  // Guidage en vol (aéronef en altitude) : cap direct (les 8 directions, donc
  // diagonales comprises) vers la cible, en ligne droite puisqu'on survole
  // tout. Contrairement à _axisInstruction (qui corrige un axe puis l'autre,
  // donc "tourne" deux fois), un seul cap diagonal suffit ici la plupart du
  // temps — d'où beaucoup moins de virages annoncés en vol.
  _flightInstruction(t) {
    const dx = t.x - this.x, dy = t.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
    const targetHeading = Math.round((angle < 0 ? angle + 360 : angle) / 45) % 8;
    const meters = Math.max(CONFIG.METERS_PER_TILE, Math.round(dist * CONFIG.METERS_PER_TILE));
    const diff = ((targetHeading - this.heading) % 8 + 8) % 8;
    return this._turnInstruction(diff, meters) + '.';
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
    let instruction = this._turnInstruction(diff, meters) + '.';
    if (diff === 0) {
      const { dx: hdx, dy: hdy } = this.headingToDelta(this.heading);
      const nx = Math.round(this.x + hdx), ny = Math.round(this.y + hdy);
      if (City.isSolid(nx, ny)) instruction = `Attention, obstacle juste devant. ${instruction}`;
    }
    return instruction;
  },
  // Ligne de vue directe entre deux points (tracé de Bresenham) : renvoie
  // faux dès qu'un bâtiment (case solide) se trouve entre les deux — sert à
  // la dissimulation (se planquer derrière un pâté de maisons) et à rendre
  // les poursuites/le repérage moins « à travers les murs ».
  hasLineOfSight(x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    let guard = 0;
    while ((x !== x1 || y !== y1) && guard++ < 2000) {
      if ((x !== x0 || y !== y0) && (x !== x1 || y !== y1) && City.isSolid(x, y)) return false;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  },
  // Se planquer/se relever : accroupi près d'une couverture (véhicule ou
  // bâtiment tout proche) et immobile, on devient bien plus difficile à
  // repérer — voir hidden dans _updatePnjChase/_updateRealChase et scan().
  // Répond au « on ne peut que scanner puis tirer, c'est trop simple » : une
  // vraie planque change maintenant l'issue d'une poursuite ou d'un scan.
  toggleHide() {
    if (this.hidden) {
      this.hidden = false;
      announce('Vous sortez de votre cachette.', 'assertive');
      updateHud();
      return;
    }
    if (this.inVehicle) return announce('Descendez d\'abord du véhicule pour vous cacher.', 'assertive');
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    const hasCover = City.vehicles.some(v => UTIL.dist(v, this) < 2.2) || (City.houses || []).some(h => UTIL.dist(h, this) < 2.2) || City.pois.some(p => UTIL.dist(p, this) < 2.2);
    if (!hasCover) return announce('Rien à proximité pour vous couvrir : approchez-vous d\'un véhicule ou d\'un bâtiment.', 'assertive');
    this.hidden = true;
    AudioLib.playOnce('sfx_notification', { volume: 0.2 });
    announce('Vous vous planquez, accroupi. Restez immobile : bougez ou attaquez et vous serez repéré à nouveau.', 'assertive');
    updateHud();
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
    // Direction empruntée pour ARRIVER à chaque case (0=est,1=ouest,2=sud,
    // 3=nord) : sert à pénaliser légèrement un changement de direction, pour
    // que l'algorithme préfère une ligne droite à un chemin en escalier (même
    // distance totale, mais ça donnait "gauche, droite, gauche, droite" en
    // boucle à la voix au lieu d'un "tout droit" qui dure).
    const dirAt = new Int8Array(W * H).fill(-1);
    const TURN_PENALTY = 0.35;
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
      const cand = [[cx + 1, cy, cur + 1, 0], [cx - 1, cy, cur - 1, 1], [cx, cy + 1, cur + W, 2], [cx, cy - 1, cur - W, 3]];
      for (let k = 0; k < 4; k++) {
        const nx = cand[k][0], ny = cand[k][1], ni = cand[k][2], dir = cand[k][3];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || closed[ni] || !walkable(nx, ny)) continue;
        const turnCost = (dirAt[cur] !== -1 && dirAt[cur] !== dir) ? TURN_PENALTY : 0;
        const ng = g0 + 1 + turnCost;
        if (inOpen[ni] && ng >= gScore[ni]) continue;
        gScore[ni] = ng; came[ni] = cur; dirAt[ni] = dir;
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
  // Renommer un lieu enregistré (ex. « Ma maison 1 » -> « Chez moi »).
  renameSavedPlace(index, newName) {
    if (!this.savedPlaces || !this.savedPlaces[index]) return;
    const clean = (newName || '').trim().slice(0, 40);
    if (!clean) return announce('Il faut donner un nom au lieu.', 'assertive');
    this.savedPlaces[index].name = clean;
    announce(`Lieu renommé « ${clean} ».`, 'assertive');
  },
  // Enregistre automatiquement une propriété achetée (maison, entrepôt,
  // boutique) dans « Mes lieux », avec un nom numéroté et renommable.
  // On peut en posséder plusieurs : « Ma maison 1 », « Ma maison 2 »…
  registerOwnedProperty(kind, obj) {
    if (!obj) return;
    this.savedPlaces = this.savedPlaces || [];
    const base = kind === 'maison' ? 'Ma maison'
      : kind === 'entrepôt' ? 'Mon entrepôt'
      : kind === 'boutique' ? 'Ma boutique'
      : 'Ma propriété';
    const propId = 'prop_' + kind + '_' + (obj.id != null ? obj.id : (Math.round(obj.x) + '_' + Math.round(obj.y)));
    // Déjà enregistrée ? (rachat/relance) -> on ne duplique pas.
    if (this.savedPlaces.some(p => p.propId === propId)) return;
    const n = this.savedPlaces.filter(p => p.name && p.name.indexOf(base) === 0).length + 1;
    this.savedPlaces.push({
      name: `${base} ${n}`,
      x: obj.x, y: obj.y,
      propId, kind,
    });
    announce(`Propriété ajoutée à Mes lieux : « ${base} ${n} ».`, 'polite');
  },
  // Balise sonore de porte : localise la porte accessible la plus proche
  // (bâtiment ou véhicule) et la fait « sonner » avec spatialisation stéréo,
  // puis annonce la direction et la distance en pas. Touche D.
  pingNearestDoor() {
    // À L'INTÉRIEUR d'un lieu avec un comptoir/guichet (banque, etc.) : rien
    // ne guidait jusque-là vers ce point de service une fois entré — seuls
    // les noms de pièce étaient annoncés en marchant, sans direction ni
    // distance, ce qui rendait le guichet introuvable à l'aveugle (« aucune
    // réaction »). Même touche D, réutilisée pour guider vers le service.
    if (this.interior && this.interior.service) {
      const it = this.interior, svc = it.service;
      const dx = svc.x - it.ix, dy = svc.y - it.iy;
      if (dx === 0 && dy === 0) { announce(`${svc.label}, juste devant vous.`, 'assertive'); return; }
      const pas = Math.max(1, Math.abs(dx) + Math.abs(dy)); // cases réelles à franchir, comme dehors
      this.doorCue(UTIL.clamp(dx, -1, 1) * 0.6);
      announce(`${svc.label}, ${UTIL.bearing(dx, dy)}, ${pas} pas.`, 'assertive');
      return;
    }
    const candidates = [];
    const R = 20; // rayon de recherche en tuiles
    // Points d'intérêt (bâtiments) avec une porte.
    (City.pois || []).forEach(poi => {
      const d = UTIL.dist(poi, this);
      if (d <= R) candidates.push({ x: poi.x, y: poi.y, name: poi.name || 'bâtiment', d });
    });
    // Véhicules à proximité (portières).
    (City.vehicles || []).forEach(v => {
      const d = UTIL.dist(v, this);
      if (d <= R) candidates.push({ x: v.x, y: v.y, name: v.name || 'véhicule', d });
    });
    if (!candidates.length) {
      return announce('Aucune porte à proximité. Rapprochez-vous d\'un bâtiment ou d\'un véhicule.', 'assertive');
    }
    candidates.sort((a, b) => a.d - b.d);
    const t = candidates[0];
    // « pas » = nombre réel de déplacements (cases) à franchir pour y
    // arriver, pas une fausse unité de 30 cm sans rapport avec le
    // déplacement réel (qui avance d'une case entière par pression) — sinon
    // le compte annoncé ne correspondait jamais au nombre d'actions
    // nécessaires pour y arriver.
    const pas = Math.max(1, Math.round(t.d));
    // Direction relative au cap du joueur pour spatialiser + décrire.
    const pan = this.panForPoint(t.x, t.y);         // -1 gauche … +1 droite
    const rel = this.relativeAngle(t.x, t.y);        // 0 devant … PI derrière
    let cote;
    if (rel < 0.55) cote = 'droit devant';
    else if (rel > Math.PI - 0.55) cote = 'derrière vous';
    else cote = (pan < 0) ? 'à gauche' : 'à droite';
    // Son de porte synthétique spatialisé (le bip directionnel ci-dessous
    // complète le repérage).
    const vol = Math.max(0.15, Math.min(0.9, 1 - t.d / (R + 4)));
    this.doorCue(pan);
    // Bip directionnel panoramique en renfort (grave = loin, aigu = proche).
    if (window.Audio && Audio.tone) {
      Audio.tone({ freq: 480 + (1 - vol) * -160 + 220 * vol, type: 'triangle', duration: 0.18, gain: 0.14, pan });
    }
    announce(`Porte de ${t.name}, ${cote}, ${pas} pas.`, 'assertive');
  },

  // Y a-t-il quelqu'un DE VIVANT pile à cet endroit (PNJ ou joueur réel) ?
  // Sert à empêcher un aéronef de se poser directement sur quelqu'un.
  groundOccupiedAt(x, y) {
    const nx = Math.round(x), ny = Math.round(y);
    if (City.npcs.some(n => !n.dead && Math.round(n.x) === nx && Math.round(n.y) === ny)) return true;
    if (Net.connected && Array.from(Net.remotePlayers.values()).some(p => Math.round(p.x) === nx && Math.round(p.y) === ny)) return true;
    return false;
  },
  // Scan manuel du point d'atterrissage (touche dédiée), pour savoir AVANT
  // de descendre ce qu'il y a au sol, plutôt que de le découvrir en
  // atterrissant dessus au hasard — demandé explicitement : impossible
  // jusque-là de savoir ce qu'il y avait sous un avion/hélicoptère en vol.
  scanLandingZone() {
    if (!this.inVehicle || !this.vehicle) return announce('Vous n\'êtes pas en véhicule.', 'assertive');
    const cls = VEHICLE_CATALOG[this.vehicle.type];
    if (!cls || !cls.flies) return announce('Cette balise ne concerne que le pilotage d\'un aéronef.', 'assertive');
    const v = this.vehicle;
    const occupant = City.npcs.find(n => !n.dead && UTIL.dist(n, v) < 1)
      || (Net.connected ? Array.from(Net.remotePlayers.values()).find(p => UTIL.dist(p, v) < 1) : null);
    if (occupant) {
      const name = occupant.firstName ? `${occupant.firstName} ${occupant.lastName}` : occupant.name;
      return announce(`Attention : ${name} se trouve juste en dessous. N'atterrissez pas ici.`, 'assertive');
    }
    const solid = City.isSolid(Math.round(v.x), Math.round(v.y));
    const tile = City.getTile(Math.round(v.x), Math.round(v.y));
    if (solid) announce(`Sous vous : toit ou structure (${tile}). Personne détecté à cet endroit, mais un atterrissage sur un bâtiment reste risqué pour l'appareil.`, 'assertive');
    else announce(`Sous vous : ${tile}, dégagé. Vous pouvez vous poser ici en toute sécurité.`, 'assertive');
  },

  // Positions surélevées (étages). On peut monter dans un bâtiment à étages
  // pour prendre un avantage de tireur embusqué : +5 % de précision par étage
  // gravi. On redescend automatiquement au rez-de-chaussée en quittant le
  // bâtiment. Bornage à MAX_FLOOR_BONUS pour rester équilibré.
  MAX_FLOOR_BONUS: 0.4, // +40 % max (au-delà du 8e étage, plus de gain)

  // Grimper sur un véhicule ou le toit d'une maison proche : meilleure vue,
  // donc meilleure précision ET portée de tir effective (voir shoot()). Se
  // redescend en bougeant (_syncFloorOnMove) ou en rappuyant sur la touche.
  climbedOn: null,
  toggleClimb() {
    if (this.climbedOn) {
      const name = this.climbedOn.name;
      this.x = this.climbedOn.returnX; this.y = this.climbedOn.returnY;
      this.climbedOn = null;
      announce(`Vous redescendez de ${name}.`, 'assertive');
      updateHud();
      return;
    }
    if (this.inVehicle) return announce('Descendez d\'abord du véhicule.', 'assertive');
    // Rayon aligné sur celui de toggleIndoor() (entrer dans un lieu) : 2,5
    // cases était plus strict, donnant l'impression que la touche ne
    // réagissait pas alors qu'on se croyait déjà "à côté" (juste hors de
    // cette portée plus étroite).
    const v = City.vehicles.filter(vv => UTIL.dist(vv, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    const h = (City.houses || []).filter(hh => UTIL.dist(hh, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    const vd = v ? UTIL.dist(v, this) : Infinity;
    const hd = h ? UTIL.dist(h, this) : Infinity;
    if (!v && !h) return announce('Rien à proximité sur quoi grimper : approchez-vous d\'un véhicule ou d\'une maison.', 'assertive');
    const returnX = this.x, returnY = this.y;
    if (vd <= hd) {
      this.climbedOn = { type: 'vehicle', name: v.name, x: v.x, y: v.y, returnX, returnY, level: 1 };
      this.x = v.x; this.y = v.y;
      announce(`Vous grimpez sur ${v.name}. Meilleure vue pour viser au loin.`, 'assertive');
    } else {
      const level = Math.max(1, h.floors || 1);
      this.climbedOn = { type: 'house', name: h.name, x: h.x, y: h.y, returnX, returnY, level };
      this.x = h.x; this.y = h.y;
      announce(`Vous grimpez sur le toit de ${h.name}. Meilleure vue pour viser au loin.`, 'assertive');
    }
    updateHud();
  },
  // Bâtiment à étages sur lequel se tient le joueur (rez-de-chaussée compris).
  getCurrentTallBuilding() {
    let best = null, bd = 2.5;
    (City.pois || []).forEach(p => {
      if ((p.floors || 1) <= 1) return;
      const d = UTIL.dist(p, this);
      if (d < bd) { bd = d; best = p; }
    });
    // Les maisons à étages (City.houses, séparées des POI) doivent aussi
    // compter : sinon Shift+E répondait toujours « vous n'êtes pas dans un
    // immeuble » chez soi dans une maison à étages.
    (City.houses || []).forEach(h => {
      if ((h.floors || 1) <= 1) return;
      const d = UTIL.dist(h, this);
      if (d < bd) { bd = d; best = h; }
    });
    return best;
  },
  // Monte (+1) ou descend (−1) d'un étage dans le bâtiment courant.
  changeFloor(dir) {
    if (this.inVehicle) return announce('Impossible de changer d\'étage en véhicule.', 'assertive');
    const b = this.getCurrentTallBuilding();
    if (!b) return announce('Vous n\'êtes pas dans un bâtiment à étages. Approchez-vous d\'un immeuble.', 'assertive');
    const maxFloor = (b.floors || 1) - 1;
    const nf = UTIL.clamp((this.floor || 0) + dir, 0, maxFloor);
    if (nf === this.floor) {
      return announce(dir > 0 ? `Dernier étage atteint : étage ${nf} sur ${maxFloor}.` : 'Vous êtes déjà au rez-de-chaussée.', 'assertive');
    }
    this.floor = nf;
    // Son d'ascension/descente (aigu en montant, grave en descendant).
    if (window.Audio && Audio.tone) Audio.tone({ freq: dir > 0 ? 660 : 330, type: 'sine', duration: 0.14, gain: 0.1, pan: 0 });
    const bonus = Math.min(this.MAX_FLOOR_BONUS, this.floor * 0.05);
    const etage = this.floor === 0 ? 'rez-de-chaussée' : `étage ${this.floor}`;
    announce(`${b.name}, ${etage}${this.floor > 0 ? `, précision de tir plus ${Math.round(bonus * 100)} pour cent` : ''}.`, 'assertive');
  },
  // Appelé au déplacement à pied : si l'on s'éloigne du bâtiment, on redescend.
  _syncFloorOnMove() {
    if ((this.floor || 0) > 0 && !this.getCurrentTallBuilding()) {
      this.floor = 0;
      announce('Vous quittez le bâtiment. Retour au rez-de-chaussée.', 'polite');
    }
    // Grimpé sur un véhicule/toit : le moindre déplacement en fait descendre
    // (comme sauter au sol), plutôt que de rester "collé" en l'air ailleurs.
    if (this.climbedOn && (this.x !== this.climbedOn.x || this.y !== this.climbedOn.y)) {
      const name = this.climbedOn.name;
      this.climbedOn = null;
      announce(`Vous redescendez de ${name}.`, 'polite');
    }
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
    parts.push('Utilisez F pour le radar de proximité qui balaye tout ce qui vous entoure, C pour la boussole, et le menu carte du téléphone pour vous faire guider vers une destination.');
    announce(parts.join(' '), 'interrupt');
  },

  // Rafraîchit silencieusement scannedTargets (mêmes filtres que scan(), sans
  // la moindre annonce ni le bip) : sans ça, la liste numérotée (touches
  // 1-9) restait figée sur l'instantané du DERNIER scan manuel — tirer sur
  // quelqu'un qui vient de mourir laissait sa fiche dans la liste, et un
  // nouvel assaillant arrivé entre-temps restait invisible tant qu'on ne
  // relançait pas un scan complet. Appelée après chaque tir (voir shoot())
  // pour que la liste reste juste sans avoir à re-scanner à la voix.
  refreshScannedTargets() {
    const cls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    const airborne = !!(cls && cls.flies && this.altitude > 5);
    const RADIUS = airborne ? CONFIG.SCAN_RADIUS * 2.5 : CONFIG.SCAN_RADIUS;
    const npcs = City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < RADIUS).map(n => ({ ...n, dist: UTIL.dist(n, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(n.x - this.x, n.y - this.y) }));
    const realPlayers = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < RADIUS).map(p => {
      const masked = !!p.outfit?.masque;
      const contactMatch = !masked ? this.resolveContactName({ isPlayer: true, accountUsername: p.accountUsername }) : null;
      const displayName = masked ? 'Individu masqué' : (contactMatch ? contactMatch.label : `${p.firstName} ${p.lastName}`);
      return {
        id: p.id, name: displayName, job: 'joueur réel', gender: p.gender, outfit: p.outfit, isPlayer: true,
        x: p.x, y: p.y, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y),
      };
    });
    const people = [...realPlayers, ...npcs].sort((a, b) => a.dist - b.dist).slice(0, 9);
    const vehicles = City.vehicles.filter(v => UTIL.dist(v, this) < RADIUS).map(v => ({ ...v, isVehicle: true, dist: UTIL.dist(v, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(v.x - this.x, v.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    this.scannedTargets = [...people, ...vehicles];
  },
  // Scanner and targeting
  scan() {
    Audio.beep(0, 1200);
    // Survol en avion/hélicoptère à altitude : rayon de recherche bien plus
    // large (on voit large depuis le ciel), utile pour la police en
    // patrouille aérienne à la recherche de criminels au sol — avant, le
    // scan gardait le même rayon qu'à pied, inutile depuis les airs.
    const cls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    const airborne = !!(cls && cls.flies && this.altitude > 5);
    const RADIUS = airborne ? CONFIG.SCAN_RADIUS * 2.5 : CONFIG.SCAN_RADIUS;
    // !n.dead : un PNJ éliminé (voir killNPC) reste sur place, fouillable,
    // mais ne doit plus apparaître comme cible vivante — avant, un scan après
    // avoir descendu un garde continuait à l'afficher exactement comme s'il
    // était toujours debout, sans le moindre indice qu'il était hors combat.
    const npcs = City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < RADIUS).map(n => ({ ...n, dist: UTIL.dist(n, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(n.x - this.x, n.y - this.y) }));
    // Nom affiché : masqué (cagoule) -> identité cachée, comme describePerson/
    // greetPlayer déjà en face-à-face ; sinon, le nom enregistré dans VOS
    // contacts s'il y en a un (resolveContactName), sinon le vrai nom du
    // personnage. Avant, le scan révélait toujours le vrai nom brut, sans
    // tenir compte ni d'un masque ni d'un contact enregistré — les deux
    // avaient beau déjà exister pour l'interaction directe (E), le scan les
    // ignorait complètement.
    const realPlayers = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < RADIUS).map(p => {
      const masked = !!p.outfit?.masque;
      const contactMatch = !masked ? this.resolveContactName({ isPlayer: true, accountUsername: p.accountUsername }) : null;
      const displayName = masked ? 'Individu masqué' : (contactMatch ? contactMatch.label : `${p.firstName} ${p.lastName}`);
      return {
        id: p.id, name: displayName, job: 'joueur réel', gender: p.gender, outfit: p.outfit, isPlayer: true,
        x: p.x, y: p.y, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y),
      };
    });
    const people = [...realPlayers, ...npcs].sort((a, b) => a.dist - b.dist).slice(0, 9);
    const pois = City.pois.filter(p => UTIL.dist(p, this) < RADIUS).map(p => ({ ...p, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 9);
    // Les véhicules (dont avions/hélicoptères posés ou en vol si assez proches)
    // sont maintenant aussi CIBLABLES, pas juste annoncés : on peut tirer
    // dessus (crever un pneu, l'endommager, l'empêcher de rouler/voler — voir
    // shoot() et enterAsDriver()). Numérotés à la suite des personnes, pour ne
    // pas changer la numérotation existante (Ctrl+1-9) pour cibler une personne.
    const vehicles = City.vehicles.filter(v => UTIL.dist(v, this) < RADIUS).map(v => ({ ...v, isVehicle: true, dist: UTIL.dist(v, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(v.x - this.x, v.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    const ground = (City.groundItems || []).filter(it => UTIL.dist(it, this) < RADIUS).map(it => ({ ...it, dist: UTIL.dist(it, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(it.x - this.x, it.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    this.scannedTargets = [...people, ...vehicles];
    let msg = airborne ? `Recherche aérienne : ${people.length} personnes repérées au sol, dont ${npcs.filter(n => n.hostile).length} individu(s) suspect(s), ${vehicles.length} véhicules. ` : `Scan : ${people.length} personnes, ${pois.length} lieux, ${vehicles.length} véhicules, ${ground.length} objets au sol. `;
    if (people.length) msg += 'Personnes : ' + people.map((n, i) => `${i + 1}, ${n.name}${n.isPlayer ? ' (joueur réel)' : n.hostile ? ', suspect' : ', ' + n.job}, ${Math.round(n.dist)} m, ${n.bearing}`).join('. ');
    if (pois.length) msg += 'Lieux : ' + pois.map(p => `${p.name}, ${Math.round(p.dist)} m, ${p.bearing}`).join('. ');
    if (vehicles.length) msg += 'Véhicules : ' + vehicles.map((v, i) => `${people.length + i + 1}, ${v.name}, ${Math.round(v.dist)} m, ${v.bearing}`).join('. ');
    if (ground.length) msg += 'Au sol : ' + ground.map(it => `${it.name}${it.q > 1 ? ' ×' + it.q : ''}, ${Math.round(it.dist)} m, ${it.bearing}`).join('. ');
    announce(msg, 'assertive');
    if (people.length || vehicles.length) announce('Tapez 1 à 9 pour cibler une personne ou un véhicule.', 'polite');
  },
  // Repère un tireur (PNJ) sans avoir à refaire un scan complet : à chaque
  // tir essuyé, une chance croissante de révéler sa position exacte et de
  // pouvoir le verrouiller directement — avant, rien ne permettait de
  // retrouver qui tirait si le dernier scan ne l'avait pas repéré (embuscade
  // apparue après coup, tireur hors du dernier balayage...).
  revealShooter(npc) {
    if (!npc || npc.dead) return;
    this.scannedTargets = this.scannedTargets || [];
    if (this.scannedTargets.some(t => t.id === npc.id)) return; // déjà repéré
    const dist = UTIL.dist(npc, this) * CONFIG.METERS_PER_TILE;
    const bearing = UTIL.bearing(npc.x - this.x, npc.y - this.y);
    this.scannedTargets.push({ ...npc, dist, bearing });
    Audio.beep(0, 900);
    announce(`Tir repéré : ${npc.name}, ${Math.round(dist)} m, ${bearing}. Touche ${this.scannedTargets.length} pour le verrouiller.`, 'assertive');
  },
  target(index) {
    const n = this.scannedTargets[index - 1];
    // Cibler (touches 1-9) est une COMMANDE explicite du joueur, pas une
    // narration passive : elle doit couper net ce qui est en train d'être
    // dit (la narration du scan, souvent longue, ou toute autre annonce) —
    // avant, la priorité 'assertive'/'combat' ne faisait QUE se mettre en
    // file d'attente sans jamais interrompre la parole en cours, donnant
    // l'impression que la touche ne réagissait pas tant que le scan parlait.
    if (!n) return announce('Cible invalide.', 'interrupt');
    this.lockedTarget = n;
    if (n.isVehicle) {
      announce(`Cible verrouillée : ${n.name} (véhicule), ${Math.round(n.dist)} mètres, ${n.bearing}.`, 'interrupt');
      updateHud();
      return;
    }
    // Verrouiller un VRAI joueur (potentiellement un allié venu avec vous, pas
    // forcément un ennemi) mérite une confirmation qu'on ne peut pas louper :
    // un bip distinct, pour éviter de tirer par erreur sur quelqu'un de son
    // groupe faute d'avoir bien entendu qui vient d'être verrouillé.
    if (n.isPlayer && window.Audio && Audio.beep) Audio.beep(0, 500);
    announce(`Cible verrouillée : ${n.name}, ${n.isPlayer ? 'joueur réel' : n.job}, ${Math.round(n.dist)} mètres, ${n.bearing}.`, 'interrupt');
    // Braquer une arme en verrouillant : la cible PNJ réagit tout de suite
    // (mains en l'air si acculée, sinon fuite) — le reste est géré par npcTick.
    if (this.weaponOut && !n.isPlayer) {
      const live = City.npcs.find(x => x.id === n.id);
      if (live && !live.hostile && !live.menotte && !live.knockedOut && !live.handsUp && !live.fleeing && live.job !== 'police') {
        if (UTIL.dist(live, this) < 3) { live.handsUp = true; announce(`${live.name} lève les mains, terrifié(e).`, 'polite'); }
        else { live.fleeing = true; announce(`${live.name} prend la fuite !`, 'polite'); }
        // Réaction PERSONNELLE de la cible menacée (pas les témoins alentour) :
        // le nouveau groupe dédié (voix homme uniquement, contenu fourni) pour
        // un PNJ homme, l'ancien groupe générique "panique" sinon (pas de
        // contenu équivalent en voix femme pour l'instant).
        this.npcVoiceReaction(live.x, live.y, { group: live.gender === 'homme' ? 'menace_directe' : 'panique', count: 1, radius: 12 });
      }
    }
    // Verrouiller un VRAI joueur, arme sortie : intention de tirer. Il
    // reçoit une alerte sonore distincte (voir Audio.targetedWarning /
    // onPlayerTargetedMe) pour pouvoir réagir — se mettre à couvert, fuir,
    // riposter — au lieu de se faire tirer dessus sans le moindre signe
    // avant-coureur.
    if (this.weaponOut && n.isPlayer && Net.connected) {
      Net.send({ type: 'player_targeted', targetId: n.id });
    }
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
    let live;
    if (this.lockedTarget.isVehicle) {
      const v = City.vehicles.find(vv => vv.id === this.lockedTarget.id);
      if (!v) return null;
      live = { id: v.id, name: v.name, isVehicle: true, x: v.x, y: v.y, health: v.hp };
      this.lockedTarget.x = live.x; this.lockedTarget.y = live.y; this.lockedTarget.hp = v.hp;
      return live;
    }
    if (this.lockedTarget.isPlayer) {
      const p = Net.remotePlayers.get(this.lockedTarget.id);
      if (!p) return null; // déconnecté ou hors de portée réseau
      live = { id: p.id, name: this.lockedTarget.name, isPlayer: true, x: p.x, y: p.y, health: p.health, unconscious: p.unconscious, isCuffed: p.isCuffed, outfit: p.outfit, role: p.role, policeRank: p.policeRank };
    } else {
      live = City.npcs.find(n => n.id === this.lockedTarget.id) || null;
      if (!live) return null;
    }
    // Rafraîchit la « photo » du verrou (position et santé) : l'affichage HUD et
    // toute lecture qui s'appuie encore sur lockedTarget restent ainsi à jour
    // quand la cible se déplace ou encaisse des dégâts.
    this.lockedTarget.x = live.x; this.lockedTarget.y = live.y;
    if (typeof live.health === 'number') this.lockedTarget.health = live.health;
    return live;
  },
  // Rafraîchit et RÉANNONCE la cible verrouillée en direct : distance, cap,
  // santé et état à jour. Si elle n'est plus repérable (PNJ disparu, joueur
  // déconnecté), on déverrouille proprement.
  announceTarget() {
    if (!this.lockedTarget) return announce('Aucune cible verrouillée. Scannez, puis tapez 1 à 9 pour en choisir une.', 'assertive');
    const live = this.getLiveTarget();
    if (!live) { const name = this.lockedTarget.name; this.lockedTarget = null; updateHud(); return announce(`${name} n'est plus repérable. Cible déverrouillée.`, 'assertive'); }
    const d = Math.round(UTIL.dist(live, this) * CONFIG.METERS_PER_TILE);
    const bearing = UTIL.bearing(live.x - this.x, live.y - this.y);
    let state = '';
    if (live.dead) state = ', à terre, sans vie';
    else if (live.knockedOut || live.unconscious) state = ', inconsciente';
    if (live.menotte || live.isCuffed) state += ', menottée';
    const hp = typeof live.health === 'number' ? `, santé ${Math.round(live.health)} pour cent` : '';
    announce(`Cible : ${this.lockedTarget.name || live.name}, ${d} mètres vers le ${bearing}${hp}${state}. Visée : ${this.aimPart}.`, 'assertive');
    if (window.Audio && Audio.tone) Audio.tone({ freq: 700, type: 'sine', duration: 0.12, gain: 0.1, pan: this.panForPoint(live.x, live.y) });
  },
  // Marcher vers la cible verrouillée : cette localisation-là (pour SE
  // DÉPLACER, pas pour tirer) est toujours fiable à 100%, quelle que soit la
  // distance — seule la précision au TIR (voir shoot) dépend de la distance.
  // Avant, ce n'était possible qu'en passant par le chien guide
  // (GuideDog.guideToCurrentTarget) ; désormais accessible à tout le monde.
  guideToLockedTarget() {
    const live = this.getLiveTarget();
    if (!live) return announce('Aucune cible verrouillée ou repérable. Scannez, puis tapez 1 à 9 pour en choisir une.', 'assertive');
    const name = this.lockedTarget?.name || live.name || 'la cible';
    this.setGuidance({ name, x: live.x, y: live.y });
    announce(`Guidage activé vers ${name}.`, 'assertive');
  },
  // Invalidation automatique : si la cible verrouillée n'est plus repérable
  // (disparue/déconnectée), on la déverrouille au lieu de la garder figée.
  refreshTargetValidity() {
    if (!this.lockedTarget) return;
    if (!this.getLiveTarget()) {
      const name = this.lockedTarget.name; this.lockedTarget = null; updateHud();
      announce(`${name} n'est plus en vue. Cible déverrouillée.`, 'polite');
    }
  },
  changeAim(dir) {
    const idx = CONFIG.AIM_PARTS.indexOf(this.aimPart);
    this.aimPart = CONFIG.AIM_PARTS[(idx + dir + CONFIG.AIM_PARTS.length) % CONFIG.AIM_PARTS.length];
    announce(`Visée : ${this.aimPart}.`, 'polite'); updateHud();
  },

  // Weapons
  // État des munitions d'une arme (compatibilité) : sert à prévenir tout de
  // suite si l'arme est utilisable ou s'il manque le bon calibre (bug #13).
  _weaponAmmoStatus(w) {
    if (!w) return '';
    if (!w.ammoType) return 'Arme de contact, pas de munitions nécessaires.'; // matraque, etc.
    const loaded = this.ammo[w.ammoType] || 0;
    const reserve = this.ammoReserve[w.ammoType] || 0;
    const calibre = (typeof AMMO_CATALOG !== 'undefined' && AMMO_CATALOG[w.ammoType]?.name) || w.caliber || w.ammoType;
    if (loaded + reserve <= 0) return `Attention : aucune munition de calibre ${calibre}. Arme inutilisable tant que vous n'en avez pas.`;
    return `Chargeur ${loaded} sur ${w.magazine}, réserve ${reserve}, calibre ${calibre}.`;
  },
  toggleWeapon() {
    if (!this.weapons.length) return announce('Vous n\'avez pas d\'arme.', 'assertive');
    if (this.weaponOut) { this.weaponOut = false; announce('Arme rangée.', 'polite'); }
    else {
      // On ressort la DERNIÈRE arme sélectionnée si on la possède encore,
      // sinon la première de la liste.
      const id = (this.lastWeaponId && this.weapons.includes(this.lastWeaponId)) ? this.lastWeaponId : this.weapons[0];
      this.weapon = WEAPON_CATALOG[id] || null; this.lastWeaponId = id; this.weaponOut = !!this.weapon;
      if (this.weapon) { announce(`${this.weapon.name} sorti. ${this._weaponAmmoStatus(this.weapon)}`, 'assertive'); this.reactNearbyToWeapon(); }
    }
    updateHud();
  },
  selectWeapon(id) {
    if (!this.weapons.includes(id)) return announce('Arme non possédée.', 'assertive');
    const alreadyOut = this.weaponOut;
    this.weapon = WEAPON_CATALOG[id]; this.lastWeaponId = id; this.weaponOut = true;
    this.weaponJammed = false; // une autre arme qu'on prend en main n'est jamais déjà enrayée
    announce(`${this.weapon.name} équipé. ${this._weaponAmmoStatus(this.weapon)}`, 'assertive'); updateHud();
    if (!alreadyOut) this.reactNearbyToWeapon();
  },
  // PNJ civils qui REMARQUENT une arme sortie à proximité, même sans être
  // verrouillés comme cible : avant, seule la cible explicitement verrouillée
  // réagissait (voir target()), tous les autres PNJ à côté restaient
  // totalement indifférents à une arme brandie devant eux.
  reactNearbyToWeapon() {
    // En plein vol (aéronef en altitude), les PNJ sont au sol, bien trop
    // loin pour voir ni entendre une arme sortie dans le cockpit — sinon
    // ils réagissaient à tort comme si l'arme était brandie juste devant eux.
    const vcls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    if (vcls && vcls.flies && this.altitude > 5) return;
    const nearby = City.npcs.filter(n => !n.dead && !n.hostile && !n.menotte && !n.knockedOut && !n.handsUp && !n.fleeing && n.job !== 'police' && UTIL.dist(n, this) < 6);
    if (!nearby.length) return;
    nearby.forEach(n => { n.fleeing = true; });
    const closest = nearby.reduce((a, b) => UTIL.dist(a, this) < UTIL.dist(b, this) ? a : b);
    this.npcVoiceReaction(closest.x, closest.y, { group: 'panique', count: Math.min(3, nearby.length), radius: 8 });
    announce(`${nearby.length > 1 ? nearby.length + ' personnes proches paniquent' : `${closest.name} panique`} en voyant votre arme.`, 'polite');
  },
  reload() {
    if (!this.weapon) return;
    // Arme enrayée (voir shoot) : R sert d'abord à la dégager, sans
    // consommer de munition — un vrai rechargement suit sur un appui suivant.
    if (this.weaponJammed) {
      this.weaponJammed = false;
      Audio.click();
      AudioLib.playOnce('sfx_recharge', { volume: 0.5 });
      announce(`Vous dégagez l'enrayage de ${this.weapon.name}. Prête à retirer.`, 'assertive');
      updateHud();
      return;
    }
    const type = this.weapon.ammoType;
    if (!type) return announce('Cette arme ne se recharge pas.', 'polite');
    const loaded = this.ammo[type] || 0;
    const capacity = this.weapon.magazine;
    const missing = capacity - loaded;
    if (missing <= 0) return announce('Chargeur déjà plein.', 'polite');
    const reserve = this.ammoReserve[type] || 0;
    const calibre = (typeof AMMO_CATALOG !== 'undefined' && AMMO_CATALOG[type]?.name) || this.weapon.caliber || type;
    if (reserve <= 0) { AudioLib.playOnce('sfx_arme_vide'); announce(`Pas de munitions de calibre ${calibre} en réserve. Achetez-en à l'armurerie ou au marché noir.`, 'assertive'); return; }
    const transfer = Math.min(missing, reserve);
    this.ammo[type] = loaded + transfer;
    this.ammoReserve[type] = reserve - transfer;
    Audio.click();
    AudioLib.playOnce('sfx_recharge');
    announce(`${this.weapon.name} rechargé : ${this.ammo[type]}/${capacity} dans le chargeur, ${this.ammoReserve[type]} en réserve.`, 'polite');
    updateHud();
  },
  shoot() {
    if (this.cooldown) return; // cadence de l'arme : this.cooldown était défini mais jamais vérifié, la cadence n'était jamais appliquée
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.isCuffed) return announce('Vous êtes menotté(e), impossible d\'agir.', 'polite');
    if (this.hidden) { this.hidden = false; announce('Le coup de feu révèle votre position.', 'polite'); } // tirer casse la planque

    if (!this.weaponOut || !this.weapon) return announce('Sortez d\'abord une arme.', 'assertive');
    if (this.weaponJammed) return announce(`${this.weapon.name} est enrayée. Dégagez-la avec R avant de retirer.`, 'assertive');
    if (this.ammo[this.weapon.ammoType] <= 0) { AudioLib.playOnce('sfx_arme_vide'); announce('Chargeur vide. Rechargez avec R.', 'assertive'); return; }
    const w = this.weapon;
    // Enrayage : une arme à feu (pas une arme de contact comme la matraque,
    // magazine: 0) peut occasionnellement se bloquer au tir. Ne consomme pas
    // de munition ; il faut la dégager (touche R) avant de pouvoir retirer.
    if (w.magazine > 0 && UTIL.chance(this.JAM_CHANCE)) {
      this.weaponJammed = true;
      AudioLib.playOnce('sfx_arme_enrayee', { volume: 0.6, exclusive: 'weapon_shot' });
      if (Net.connected) Net.emitSound('sfx_arme_enrayee', { vol: 0.5 });
      announce(`${w.name} s'enraye ! Dégagez-la avec R avant de pouvoir retirer.`, 'assertive');
      this.cooldown = true; setTimeout(() => this.cooldown = false, w.fireRate * 1000);
      updateHud();
      return;
    }
    const live = this.getLiveTarget();
    const target = live ? { ...this.lockedTarget, ...live } : null;
    const range = target ? UTIL.dist(target, this) : 0;
    // Avantage de hauteur : altitude (véhicule volant), étage, OU grimpé sur
    // un véhicule/toit de maison (voir toggleClimb) — ce dernier étend aussi
    // la PORTÉE effective (viser plus loin depuis un point haut), pas
    // seulement la précision.
    const heightBonus = this.altitude > 0 ? Math.min(0.15, this.altitude * 0.01) : 0;
    const floorBonus = (!this.inVehicle && this.floor > 0) ? Math.min(this.MAX_FLOOR_BONUS, this.floor * 0.05) : 0;
    const climbBonus = this.climbedOn ? Math.min(this.MAX_FLOOR_BONUS, (this.climbedOn.level || 1) * 0.08) : 0;
    const effRange = this.climbedOn ? w.range * 1.6 : w.range;
    let acc = w.accuracy;
    if (this.aimPart === 'tete') acc *= 0.75; else if (this.aimPart === 'jambes') acc *= 0.85;
    if (range > effRange) {
      acc *= 0.3; // au-delà de la portée effective : très imprécis
    } else {
      // Comme dans la vraie vie : plus la cible est proche, plus elle est
      // facile à toucher ; plus elle est loin (jusqu'à la portée de l'arme),
      // plus c'est difficile. Avant, seule la limite de portée comptait — un
      // tir à bout portant et un tir à la limite de portée avaient exactement
      // la même précision, ce qui ne visait jamais que 100% ou presque.
      const distRatio = effRange > 0 ? UTIL.clamp(range / effRange, 0, 1) : 0;
      acc *= (1 - distRatio * 0.55); // jusqu'à -55% de précision à portée max
    }
    acc += heightBonus + floorBonus + climbBonus;
    this.ammo[w.ammoType]--;
    // Armes lourdes avec un son de tir réel dédié (voir WEAPON_CATALOG) :
    // sinon, tir synthétisé générique comme avant.
    if (w.shotSound) AudioLib.playOnce(w.shotSound, { volume: 0.9, exclusive: 'weapon_shot' });
    else Audio.gunshot(w.name, 0);
    if (Net.connected) Net.emitSound(w.shotSound || 'synth:gunshot', { vol: 0.95 }); // audible par les joueurs proches
    if (typeof GuideDog !== 'undefined') GuideDog.onDangerNear(this.x, this.y); // le chien alerte / se cache
    setTimeout(() => Audio.shellDrop(0), 150);
    if (Date.now() - (this._lastGunfireReport || 0) > 8000) {
      this._lastGunfireReport = Date.now();
      Game.reportCrimeToPolice('coups_de_feu', 'Coups de feu entendus');
    }
    if (target && range <= effRange) {
      if (Math.random() < acc) {
        let dmg = w.dmg * (this.aimPart === 'tete' ? 2 : this.aimPart === 'jambes' ? 0.6 : 1);
        // Comme dans la vraie vie : un projectile perd de la vitesse (donc de
        // l'énergie/du pouvoir d'arrêt) en parcourant de la distance — un tir
        // à bout portant fait plus mal qu'un tir à la limite de portée
        // effective de l'arme, tête comprise (jusqu'à -35 % à portée max ;
        // au-delà, déjà très imprécis, voir le calcul de acc ci-dessus).
        if (effRange > 0) dmg *= (1 - UTIL.clamp(range / effRange, 0, 1) * 0.35);
        if (target.isVehicle) {
          const v = City.vehicles.find(vv => vv.id === target.id);
          if (v) {
            v.hp = Math.max(0, (v.hp || 100) - Math.round(dmg));
            Audio.impact(0);
            if (Net.connected) Net.emitSound('veh_kolision_1', { vol: 0.5 });
            announce(`Véhicule touché : ${target.name}, vie à ${Math.round(v.hp)} pour cent.`, 'assertive');
            if (v.hp <= 0) announce(`${target.name} est hors d'usage.`, 'assertive');
          }
        } else if (target.isPlayer) {
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
            else {
              if (npc.hostile) npc.relation -= 40;
              // Le cri d'impact (playNpcHitCry, ci-dessus) reste inchangé — ceci
              // est la réaction PARLÉE qui suit, propre à la victime elle-même.
              this.npcPanicReaction(npc.x, npc.y, { count: 1, group: npc.gender === 'homme' ? 'menace_directe' : 'panique' });
            }
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
    // Liste de ciblage (1-9) tenue à jour après chaque tir, sans re-scanner
    // à la voix (voir refreshScannedTargets) : les nouveaux assaillants
    // arrivés depuis le dernier scan deviennent immédiatement ciblables.
    this.refreshScannedTargets();
    updateHud();
  },
  startBurst() {
    if (this.burstTimer) return;
    if (!this.weaponOut || !this.weapon || !this.weapon.auto) { this.shoot(); return; } // arme non automatique : un seul coup
    if (this.weaponJammed) { this.shoot(); return; } // laisse shoot() annoncer l'enrayage
    if ((this.ammo[this.weapon.ammoType] || 0) <= 0) { AudioLib.playOnce('sfx_arme_vide'); return announce('Chargeur vide. Rechargez avec R.', 'assertive'); }
    // Le son de rafale boucle tant que le doigt/la touche de tir reste enfoncé.
    // Les armes très rapides (cadence ≤ 0.09 s entre coups, comme l'UZI) ont
    // une rafale plus intense et saturée ; les autres armes automatiques
    // (AK-47, M4, plus lentes) gardent la rafale normale.
    this._burstKey = this.weapon.fireRate <= 0.09 ? 'rafale_puissante' : 'sfx_rafale';
    AudioLib.playLoop(this._burstKey);
    const fire = () => {
      if (!this.weaponOut || !this.weapon || !this.weapon.auto) { this.stopBurst(); return; }
      // Enrayage en cours de rafale : coupe la rafale, un seul avertissement.
      if (this.weaponJammed) { this.stopBurst(); return; }
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
    // Portée réaliste d'un lancer de grenade à la main : environ 35 m (~9
    // cases à 4 m/case) pour un lancer efficace — avant, elle pouvait
    // exploser sur une cible verrouillée à n'importe quelle distance, ce qui
    // n'a aucun sens pour un lancer à bras. Au-delà, elle retombe avant
    // d'arriver, plus près de vous, comme dans la vraie vie.
    const MAX_THROW = 9;
    let cx = target ? target.x : this.x, cy = target ? target.y : this.y;
    if (target) {
      const throwDist = UTIL.dist(target, this);
      if (throwDist > MAX_THROW) {
        const ratio = MAX_THROW / throwDist;
        cx = this.x + (target.x - this.x) * ratio;
        cy = this.y + (target.y - this.y) * ratio;
        announce(`${target.name} est hors de portée de lancer (${Math.round(throwDist * CONFIG.METERS_PER_TILE)} m, portée maximale environ ${MAX_THROW * CONFIG.METERS_PER_TILE} m) : la grenade retombe avant d'arriver.`, 'assertive');
      }
    }
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
    // Le bruit de chute (ci-dessous) suffit déjà à savoir que la cible est
    // hors combat : l'annonce vocale qui redisait "X est hors combat" en
    // 'assertive' n'apportait rien de plus, mais coupait systématiquement
    // toute autre annonce en cours (souvent plus importante en plein combat).
    const deathX = npc.x, deathY = npc.y;
    npc.dead = true; npc.knockedOut = true; // le corps reste sur place, fouillable (voir Game.searchTarget)
    AudioLib.playOnce('bruit_chute', { volume: 0.6 });
    this.npcPanicReaction(deathX, deathY, { count: 2 });
  },
  // Cri d'un PNJ touché (coup ou balle) — voix d'homme, choisi au hasard
  // parmi les 7 variantes disponibles.
  playNpcHitCry(npc) {
    // Un seul cri par personne dans un court laps de temps : frapper plusieurs
    // fois de suite ne doit pas empiler des cris qui se chevauchent.
    const now = Date.now();
    if (npc && npc._lastCry && now - npc._lastCry < 700) return;
    if (npc) npc._lastCry = now;
    const key = UTIL.pick(['cri_png_1', 'cri_png_2', 'cri_png_3', 'cri_png_4', 'cri_png_5', 'cri_png_6', 'cri_png_7']);
    if (AudioLib.playVoice) AudioLib.playVoice(key, { volume: 0.6 });
    else AudioLib.playOnce(key, { volume: 0.6 });
    // Les autres joueurs réels à proximité entendent aussi ce cri de douleur.
    if (Net.connected) Net.emitSound(key, { vol: 0.5 });
  },

  // Réactions vocales des PNJ selon la situation (témoins de violence, PNJ
  // hostiles/territoriaux, etc.). `opts.group` choisit le groupe de voix
  // (NPCVoiceGroups) à utiliser : "panique" par défaut, "enerve" pour les
  // PNJ hostiles, et d'autres groupes viendront s'ajouter à l'avenir.
  npcVoiceReaction(cx, cy, opts = {}) {
    // Anti-empilement : on ne déclenche pas une nouvelle salve de voix si la
    // précédente vient tout juste de partir (sinon les réactions se compilent).
    const now = Date.now();
    if (now - (this._lastNpcVoice || 0) < 800) return;
    this._lastNpcVoice = now;
    const radius = opts.radius || 14;
    const count = opts.count || 1;
    const groupName = opts.group || 'panique';
    const group = NPCVoiceGroups[groupName] || NPCVoiceGroups.panique;
    const witnesses = City.npcs.filter(n => !n.dead && UTIL.dist(n, { x: cx, y: cy }) < radius);
    if (!witnesses.length) return;
    const chosen = [];
    for (let i = 0; i < Math.min(count, witnesses.length); i++) chosen.push(UTIL.pick(witnesses));
    const muffle = this.vehicleSoundMuffle();
    chosen.forEach((n, i) => {
      setTimeout(() => {
        const pool = group.filter(l => l.gender === n.gender);
        const line = UTIL.pick(pool.length ? pool : group);
        const pan = Math.max(-1, Math.min(1, (n.x - this.x) / 15));
        AudioLib.playPositional(line.key, pan, 0.85 * muffle);
        // Comme dans GTA RP : les autres joueurs réels à proximité entendent
        // aussi cette réaction de PNJ, pas seulement soi-même.
        if (Net.connected) Net.emitSound(line.key, { vol: 0.6 });
      }, i * UTIL.randInt(150, 500)); // léger décalage pour éviter que les voix se superposent exactement
    });
  },
  // Alias conservé pour compatibilité avec le code existant.
  npcPanicReaction(cx, cy, opts = {}) { this.npcVoiceReaction(cx, cy, opts); },
  // Atténuation des sons extérieurs (paroles des PNJ) selon où l'on se
  // trouve : dans la vraie vie, un habitacle fermé étouffe déjà beaucoup les
  // bruits du dehors, et en plein vol on n'entend quasiment plus rien au
  // sol — avant, les répliques des PNJ passaient exactement comme à pied,
  // que l'on soit enfermé dans une voiture ou en plein vol en avion/hélico.
  vehicleSoundMuffle() {
    if (!this.inVehicle || !this.vehicle) return 1;
    const vcls = VEHICLE_CATALOG[this.vehicle.type];
    if (!vcls) return 1;
    if (vcls.flies && this.altitude > 5) return 0.08; // en plein vol : quasiment rien du sol
    if (!vcls.human && vcls.doors > 0) return 0.3; // habitacle fermé (pas une moto) : très étouffé
    return 1;
  },

  // Bribes de conversation de passants entendues en marchant près d'un PNJ
  // (pas d'interaction directe) : donne l'impression d'une ville vivante,
  // avec de vraies voix positionnées à la vraie position du PNJ (contrairement
  // à randomEncounters() ci-dessous, dont le panoramique est purement
  // aléatoire, sans PNJ réel derrière).
  tickPassersby() {
    if (this.inVehicle || this.unconscious || this.interior) return;
    const now = Date.now();
    if (now - (this._lastPassantLine || 0) < 12000) return; // pas plus d'une bribe toutes les 12 s
    const nearby = City.npcs.filter(n => !n.dead && !n.hostile && !n.menotte && !n.knockedOut && !n.handsUp && UTIL.dist(n, this) < 8);
    if (!nearby.length || !UTIL.chance(0.35)) return;
    this._lastPassantLine = now;
    const n = UTIL.pick(nearby);
    const slug = UTIL.pick(PASSANT_LINES);
    const key = `passant_${slug}_${n.gender === 'femme' ? 'f' : 'h'}`;
    const dist = UTIL.dist(n, this);
    const vol = UTIL.clamp(0.7 - dist / 12, 0.15, 0.7);
    AudioLib.playPositional(key, this.panForPoint(n.x, n.y), vol);
    // Les autres joueurs réels à proximité entendent aussi cette bribe de conversation.
    if (Net.connected) Net.emitSound(key, { vol: 0.5 });
  },
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
    // Être À L'INTÉRIEUR d'un véhicule protège des tirs, selon son blindage
    // (armor du catalogue) — un char ou un fourgon blindé absorbe l'essentiel
    // d'un tir, une voiture normale un peu (carrosserie de base), une moto
    // ou un véhicule sans portières (doors: 0) aucune protection. Avant,
    // rien ne différenciait être dans un véhicule blindé d'être à découvert
    // à pied : on se faisait tirer dessus pareil, sans même être sorti.
    if (this.inVehicle && this.vehicle && !opts.explosion) {
      const vcls = VEHICLE_CATALOG[this.vehicle.type];
      if (vcls && !vcls.human && vcls.doors > 0) {
        const reduction = Math.max(vcls.armor || 0, 0.2); // au moins une carrosserie de base
        amount = Math.round(amount * (1 - reduction));
      }
    }
    // Le gilet pare-balles réduit les dégâts d'un tir au corps (pas à la
    // tête — c'est le casque qui protège ça — ni d'une explosion).
    const vestAbsorbs = this.hasVest && !opts.headshot && !opts.explosion;
    if (vestAbsorbs) amount = Math.round(amount * 0.65);
    // Le casque réduisait déjà le RISQUE de mort immédiate lors d'un tir à la
    // tête (voir plus bas, fatalHeadshot), mais n'amortissait jamais le
    // moindre point de dégâts : on encaissait le même choc brutal qu'à nu,
    // casque ou pas — il ne « protégeait » donc pas vraiment. Il réduit
    // maintenant aussi les dégâts eux-mêmes, comme le gilet pour le corps.
    const helmetAbsorbs = this.hasHelmet && opts.headshot && !opts.explosion;
    if (helmetAbsorbs) amount = Math.round(amount * 0.5);
    this.health = Math.max(0, this.health - amount); updateHud();
    // Retour sonore de l'impact : on ignore l'usure passive (faim/soif, très
    // faibles montants) pour ne jouer un son que lors d'un vrai coup/explosion.
    // Casque/gilet qui absorbent le choc -> son étouffé plutôt qu'invisible.
    if (amount >= 1 && window.Audio && Audio.playerHit) {
      const protectedHit = (opts.headshot && this.hasHelmet) || vestAbsorbs;
      // Spatialisé vers le tireur quand sa position est connue (opts.attackerX/Y) :
      // avant, playerHit() était toujours appelé sans pan, donc toujours entendu
      // pile au centre, sans indication de la direction réelle du tir.
      const pan = (typeof opts.attackerX === 'number') ? this.panForPoint(opts.attackerX, opts.attackerY) : 0;
      Audio.playerHit(protectedHit, pan);
    }
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
      // Seuil relevé (200 -> 450) : dans une mission à plusieurs adversaires
      // armés (repaire de gang, convoi, planque gardée...), 200 dégâts en 15
      // secondes s'atteignaient très facilement avec des tirs au corps tout
      // à fait normaux — un simple échange de tirs se terminait en mort
      // DÉFINITIVE au lieu de juste tomber inconscient (voir die()), ce qui
      // n'a rien de réaliste façon GTA RP : on doit pouvoir survivre à une
      // vraie fusillade tant qu'on n'est pas achevé (tête sans casque,
      // explosion). Le seuil reste néanmoins réel, pour une hémorragie
      // vraiment massive et prolongée.
      const bledOut = recentTotal > 450;
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
    // Inconscient : on ne touche plus à la santé (ni dégâts de faim, ni soin) —
    // le réveil est géré par tickUnconscious. Éviter d'infliger des dégâts ici
    // empêche de rappeler die() en boucle tant que la santé est à zéro.
    if (this.unconscious) return;
    if (this.hunger > 90 || this.thirst > 90) this.takeDamage(0.05);
    if (this.health < 100 && this.hunger < 50 && this.thirst < 50) this.heal(0.02);
    this._survivalAlerts();
  },
  // Alertes vocales de survie : préviennent le joueur quand sa santé baisse
  // (paliers 75, 50, 25, 10 %) et l'invitent à manger / boire quand la faim ou
  // la soif montent. Chaque palier n'est annoncé qu'une fois (réarmé quand la
  // valeur revient à la normale), pour ne pas répéter en boucle.
  _survivalAlerts() {
    const hp = Math.round(this.health);
    const hpLevel = hp <= 10 ? 10 : hp <= 25 ? 25 : hp <= 50 ? 50 : hp <= 75 ? 75 : 0;
    if (hpLevel && hpLevel !== this._lastHealthAlert) {
      this._lastHealthAlert = hpLevel;
      if (hp <= 10) announce(`Danger vital : santé ${hp} pour cent. Mangez, buvez ou allez vite à l'hôpital, sinon vous allez perdre connaissance.`, 'assertive');
      else if (hp <= 25) announce(`Santé critique : ${hp} pour cent. Mangez et buvez sans tarder, ou passez à l'hôpital.`, 'assertive');
      else announce(`Attention, votre santé baisse : ${hp} pour cent. Pensez à manger et à boire.`, 'assertive');
    } else if (hp > 78) this._lastHealthAlert = 0;

    const hg = Math.round(this.hunger);
    const hungerLevel = hg >= 95 ? 95 : hg >= 80 ? 80 : hg >= 60 ? 60 : 0;
    if (hungerLevel && hungerLevel !== this._lastHungerAlert) {
      this._lastHungerAlert = hungerLevel;
      announce(hungerLevel >= 95 ? 'Vous êtes affamé : vous perdez de la vie. Mangez tout de suite (achetez à manger dans un magasin ou un restaurant).' : hungerLevel >= 80 ? 'Vous avez très faim. Mangez quelque chose.' : 'Vous commencez à avoir faim.', 'assertive');
    } else if (hg < 55) this._lastHungerAlert = 0;

    const th = Math.round(this.thirst);
    const thirstLevel = th >= 95 ? 95 : th >= 80 ? 80 : th >= 60 ? 60 : 0;
    if (thirstLevel && thirstLevel !== this._lastThirstAlert) {
      this._lastThirstAlert = thirstLevel;
      announce(thirstLevel >= 95 ? 'Vous êtes déshydraté : vous perdez de la vie. Buvez tout de suite.' : thirstLevel >= 80 ? 'Vous avez très soif. Buvez quelque chose.' : 'Vous commencez à avoir soif.', 'polite');
    } else if (th < 55) this._lastThirstAlert = 0;
  },

  // État « à l'intérieur d'un lieu » : tant qu'il est actif, l'ambiance de la
  // ville reste assourdie (voir updateRoadAmbience) et l'on reste dedans jusqu'à
  // ressortir volontairement (Ctrl+Alt+E). On ne commente PAS le bruit.
  indoors: null,
  // Son de porte SYNTHÉTIQUE (le fichier de porte fourni a été retiré à la
  // demande — on garde uniquement un son de synthèse) : un petit « toc » grave,
  // éventuellement panoramique.
  doorCue(pan = 0) {
    if (!window.Audio || !Audio.tone) return;
    Audio.tone({ freq: 150, type: 'sine', duration: 0.16, gain: 0.09, pan });
    setTimeout(() => { if (window.Audio && Audio.tone) Audio.tone({ freq: 105, type: 'sine', duration: 0.13, gain: 0.07, pan }); }, 85);
  },
  // Franchissement d'une porte : son de porte synthétique + on marque qu'on est
  // à l'intérieur du lieu (l'ambiance s'assourdit d'elle-même, sans l'annoncer).
  announceEnterBuilding(name, zone, ref) {
    this.doorCue();
    const lieu = zone === 'cour' ? `la cour de ${name}` : name;
    // On mémorise le lieu où l'on entre : tant qu'on est dedans, la touche E
    // rouvre CE lieu (son contenu interne), jamais l'extérieur.
    this.indoors = { name: lieu, ref: ref || null, kind: zone === 'cour' ? 'house' : 'poi' };
    announce(`Vous entrez dans ${lieu}. Touche E pour interagir avec ce qui s'y trouve, touche Q ou Ctrl+Alt+E pour ressortir.`, 'assertive');
  },
  // Entrer dans un bâtiment via sa porte (annonce + son), puis ouvrir le lieu.
  enterBuilding(poi) {
    const noDoor = ['station_essence', 'mine', 'aeroport', 'heliport', 'port', 'terrain_agricole'];
    if (!noDoor.includes(poi.type)) this.announceEnterBuilding(poi.name, 'porte', poi);
    this.enterPOI(poi);
  },
  // Ctrl+Alt+E : entrer dans le lieu le plus proche, ou en ressortir si on y est
  // déjà. Une fois dedans, on peut interagir librement avec E sans ressortir, et
  // continuer à se déplacer ; on ne ressort que par un nouveau Ctrl+Alt+E.
  toggleIndoor() {
    if (this.jailed) return announce('Vous êtes en cellule. Seul un policier peut vous libérer.', 'assertive');
    if (this.interior) return this.exitInterior();
    if (this.inVehicle) return announce('Descendez du véhicule pour entrer dans un lieu.', 'assertive');
    if (this.indoors) {
      // Si on s'est éloigné du lieu sans avoir formellement refait
      // Ctrl+Alt+E pour en sortir (parti à pied vers un autre lieu), on
      // considère qu'on est déjà dehors : sinon Ctrl+Alt+E annonçait
      // toujours « vous sortez de [l'ANCIEN lieu] » au lieu de faire entrer
      // dans le nouveau lieu où l'on se trouve réellement.
      if (this.indoors.ref && UTIL.dist(this.indoors.ref, this) > 4) {
        this.indoors = null;
      } else {
        const name = this.indoors.name;
        this.indoors = null;
        this.doorCue();
        announce(`Vous sortez de ${name}. Vous êtes de nouveau dehors.`, 'assertive');
        return;
      }
    }
    // Chercher un lieu (bâtiment ou maison) à portée pour y entrer.
    const poi = City.pois.map(p => ({ p, d: UTIL.dist(p, this) })).filter(o => o.d < 4).sort((a, b) => a.d - b.d)[0];
    const house = City.houses.map(h => ({ h, d: UTIL.dist(h, this) })).filter(o => o.d < 4).sort((a, b) => a.d - b.d)[0];
    // Une maison à soi (ou dont on a les clés) : on entre DANS la maison, en
    // grille de pièces à parcourir. Une maison qu'on ne possède pas : proposition
    // d'achat (comportement existant).
    if (house && (!poi || house.d <= poi.d)) {
      const h = house.h;
      const owned = this.ownedHouses.includes(h.id) || (h.authorizedUsers || []).includes(Net.accountUsername);
      if (owned) return this.enterHouseInterior(h);
      return this.enterHouse(h);
    }
    if (poi) {
      // Lieux publics « bâtis » (boutiques, banque, commissariat, hôpital…) :
      // on entre dans un intérieur à parcourir. Les autres (station-service,
      // monuments…) gardent l'accès direct à leur service.
      if (this._poiHasInterior(poi.p.type)) return this.enterPOIInterior(poi.p);
      this.announceEnterBuilding(poi.p.name, 'porte', poi.p); this.enterPOI(poi.p); return;
    }
    announce('Aucun lieu où entrer ici. Approchez-vous d\'une porte, puis refaites Ctrl+Alt+E.', 'assertive');
  },
  // Types de POI dotés d'un intérieur à parcourir.
  _poiHasInterior(type) {
    return ['banque', 'police', 'prison', 'hopital', 'magasin', 'restaurant', 'pharmacie', 'armurerie', 'vetements', 'quincaillerie', 'electronique', 'magasin_general', 'bar', 'concessionnaire', 'marche_noir', 'marche_noir_lointain'].includes(type);
  },
  _poiInteriorKey(type) {
    if (type === 'banque') return 'banque';
    if (type === 'police' || type === 'prison') return 'commissariat';
    if (type === 'hopital') return 'hopital';
    if (['magasin', 'restaurant', 'pharmacie', 'armurerie', 'vetements', 'quincaillerie', 'electronique', 'magasin_general', 'bar', 'concessionnaire', 'marche_noir', 'marche_noir_lointain'].includes(type)) return 'commerce';
    return 'service';
  },
  enterPOIInterior(poi) {
    const tpl = (typeof POI_INTERIORS !== 'undefined' && POI_INTERIORS[this._poiInteriorKey(poi.type)]) || (POI_INTERIORS && POI_INTERIORS.service);
    const ent = tpl.entrance || { x: 0, y: 0 };
    this.interior = { ref: poi, poi, kind: 'poi', name: poi.name, rooms: tpl.rooms, service: tpl.service, ix: ent.x, iy: ent.y, room: null, returnX: this.x, returnY: this.y };
    this.indoors = { name: poi.name, ref: poi, kind: 'interior' };
    this.doorCue();
    const room = this._roomAt(ent.x, ent.y);
    this.interior.room = room ? room.name : null;
    announce(`Vous entrez dans ${poi.name}. Pièce : ${room ? room.name : 'entrée'}. Allez au ${tpl.service.label} et appuyez sur E pour être servi. Touche Q ou Ctrl+Alt+E pour sortir.`, 'assertive');
    updateHud();
  },
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
    if (!grenade) return announce('Il vous faut une grenade pour faire sauter ce coffre. Le marché noir en vend.', 'assertive');
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
    if (!this.activeMission || (this.activeMission.type !== 'combat' && this.activeMission.type !== 'hunt')) {
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
    // Plafond volontaire : ni sniper ni fusil à pompe pour un PNJ, quel qu'il
    // soit (gang, garde, police) — trop lourd/puissant pour un adversaire
    // que le combat peut faire apparaître en nombre. AK-47 reste le haut du
    // barème.
    const pool = gang.power > 60 ? ['ak47', 'm4'] : gang.power > 30 ? ['pistolet_9', 'uzi'] : ['pistolet_9', 'revolver_38'];
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
        weapon: UTIL.pick(pool), outfit: generateNPCAppearance(job),
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
    // Des gardes au sol, armés d'armes de poing/fusils, ne peuvent pas
    // toucher efficacement quelqu'un en plein vol (aéronef en altitude) —
    // avant, ils vous tiraient dessus même en hélicoptère, avant même d'avoir
    // atterri, ce qui n'a aucun sens.
    const myVcls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    if (myVcls && myVcls.flies && this.altitude > 5) return;
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
        this.resolveNpcShotAtPlayer(n, weapon, d, 14);
        // Chaque tir essuyé (touché ou raté) augmente la chance de le repérer précisément.
        n._shotsAtPlayer = (n._shotsAtPlayer || 0) + 1;
        if (UTIL.chance(Math.min(0.9, 0.25 + n._shotsAtPlayer * 0.15))) this.revealShooter(n);
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
  // Throttle partagé pour la résolution de tir des PNJ dans les tick* de
  // mission (tickSabotage, tickEscorte, tickConvoiBlinde, tickDepotArmesGang,
  // tickExtractionVip, tickPlanqueGardee, tickDefenseTerritoire), tous
  // appelés depuis checkMission() — lui-même exécuté à CHAQUE frame
  // (~60 fois/seconde, via requestAnimationFrame dans la boucle de jeu), et
  // non toutes les ~1,5 s comme updateGangCombat()/updateWantedResponseCombat()
  // (throttlés en setInterval). Sans ce throttle, un garde avec ne serait-ce
  // que 20-30% de "chance de tir" par appel tirait en réalité des dizaines de
  // fois par seconde : aucun gilet, casque ou blindage ne pouvait absorber un
  // tel volume de tirs, et la synthèse vocale, submergée d'annonces de tir en
  // boucle, ne pouvait plus rien annoncer d'autre (verrouillage de cible,
  // etc.). Même cadence que les combats déjà throttlés ailleurs.
  // Résout un tir d'un PNJ hostile sur le joueur — point d'entrée unique
  // réutilisé par updateGangCombat() ET tous les tick* de mission en combat
  // (au lieu de dupliquer la même logique 8 fois, divergente à chaque site) :
  // - Comme pour le joueur (voir shoot()), TIRER ne veut pas dire TOUCHER —
  //   avant, dès qu'un PNJ "tentait" un tir, il touchait systématiquement,
  //   sans le moindre jet de précision. Un vrai jet, dégressif avec la
  //   distance, décide maintenant si le tir part dans le vide ou touche.
  // - Le bruit réel de l'arme (dédié au catalogue si fourni, sinon
  //   synthétisé) est joué, spatialisé selon la position du tireur par
  //   rapport au joueur, et diffusé aux autres joueurs proches — avant, ces
  //   combats ne jouaient AUCUN son de tir, uniquement du texte.
  // - Une réplique hostile du groupe "énervé" (déjà fournie pour les gangs,
  //   étendue aux gardes) est jouée de temps en temps pendant l'échange, pas
  //   à chaque tir pour ne pas noyer les annonces de combat.
  // Renvoie true si le tir touche (dégâts appliqués), false s'il rate.
  resolveNpcShotAtPlayer(npc, weapon, d, maxRange) {
    const pan = this.panForPoint(npc.x, npc.y);
    if (weapon.shotSound) AudioLib.playPositional(weapon.shotSound, pan, 0.7);
    else Audio.gunshot(weapon.name, pan);
    if (Net.connected) Net.emitSound(weapon.shotSound || 'synth:gunshot', { vol: 0.6 });
    if (UTIL.chance(0.22)) this.npcVoiceReaction(npc.x, npc.y, { group: 'enerve', count: 1, radius: 14 });
    const acc = Math.max(0.3, (weapon.accuracy || 0.6) - UTIL.clamp(d / maxRange, 0, 1) * 0.4);
    if (!UTIL.chance(acc)) {
      announce(`${npc.name} tire mais rate sa cible.`, 'polite');
      return false;
    }
    const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6) * (1 - UTIL.clamp(d / maxRange, 0, 1) * 0.35));
    this.takeDamage(dmg, { headshot: this.rollHeadshot(), attackerX: npc.x, attackerY: npc.y });
    announce(`${npc.name} vous touche avec son ${weapon.name} ! ${dmg} dégâts.`, 'combat');
    return true;
  },
  missionCombatTick(key) {
    this._missionCombatCooldowns = this._missionCombatCooldowns || {};
    const now = Date.now();
    if (now - (this._missionCombatCooldowns[key] || 0) < 1500) return false;
    this._missionCombatCooldowns[key] = now;
    return true;
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
    // Réplique hostile AVANT le premier tir (pas seulement pendant l'échange,
    // voir resolveNpcShotAtPlayer) : le joueur entend l'embuscade réagir dès
    // qu'elle se déclenche, avant de commencer à essuyer des tirs.
    this.npcVoiceReaction(this.vehicle.x, this.vehicle.y, { group: 'enerve', count: 1, radius: 14 });
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
    // Arrivée au point d'exfiltration : vérifiée AVANT le "return" qui exige
    // d'être en véhicule, et sur la position du JOUEUR (proche du véhicule
    // qu'on vient de quitter) autant que sur celle du véhicule — avant,
    // cette vérification était coincée après le "return si pas en véhicule",
    // donc descendre à l'arrivée (comme demandé par le message d'arrivée du
    // guidage, "appuyez sur E") rendait la mission bloquée pour toujours :
    // plus aucun code de fin n'était jamais exécuté.
    const dropPos = (this.inVehicle && this.vehicle) ? this.vehicle : this;
    if (UTIL.dist(dropPos, { x: m.dropX, y: m.dropY }) < 5) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      if (this.vehicle) this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== es.clientId);
      this.escorteState = null;
      RPJournal.log('Mission', `Escorte réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${client.name} arrive sain et sauf ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    if (!es.ambushDone && Math.random() < 0.008) { es.ambushDone = true; this.triggerEscorteAmbush(); }
    if (es.npcIds.length) {
      const squad = es.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
      if (!squad.length) { es.npcIds = []; announce('Les assaillants sont neutralisés. La route est libre.', 'assertive'); }
      else if (this.missionCombatTick('escorte')) {
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
              this.resolveNpcShotAtPlayer(n, weapon, d, 12);
            }
          }
        });
      }
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
      if (!this.missionCombatTick('sabotage')) return;
      squad.forEach(g => {
        const d = UTIL.dist(g, this);
        const weapon = WEAPON_CATALOG[g.weapon];
        if (weapon && UTIL.chance(Math.max(0.05, 0.3 - d * 0.015))) this.resolveNpcShotAtPlayer(g, weapon, d, 14);
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
        // Réplique hostile AVANT le premier tir (pas seulement pendant
        // l'échange, voir resolveNpcShotAtPlayer).
        this.npcVoiceReaction(g.x, g.y, { group: 'enerve', count: 1, radius: 14 });
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
    if (this.missionCombatTick('defense')) squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 12) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.25 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 12);
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
    // Réplique hostile AVANT le premier tir (pas seulement pendant
    // l'échange, voir resolveNpcShotAtPlayer).
    this.npcVoiceReaction(this.x, this.y, { group: 'enerve', count: Math.min(2, count), radius: 20 });
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
        // Réplique hostile AVANT le premier tir (pas seulement pendant
        // l'échange, voir resolveNpcShotAtPlayer).
        this.npcVoiceReaction(m.frontPoint.x, m.frontPoint.y, { group: 'enerve', count: 1, radius: 20 });
      }
      return;
    }
    const frontSquad = (m.frontIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    const rearSquad = (m.rearIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (this.missionCombatTick('convoi')) [...frontSquad, ...rearSquad].forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 10) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.28 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 10);
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
        // Réplique hostile AVANT le premier tir (une seule fois, à la
        // première détection) — avant, ce garde ouvrait le feu en silence,
        // sans le moindre avertissement.
        if (!ds.spotted) { ds.spotted = true; announce(`${guard.name} vous repère !`, 'assertive'); this.npcVoiceReaction(guard.x, guard.y, { group: 'enerve', count: 1, radius: 14 }); }
        const weapon = WEAPON_CATALOG[guard.weapon];
        if (weapon && this.missionCombatTick('depot') && UTIL.chance(Math.max(0.05, 0.2 - d * 0.015))) this.resolveNpcShotAtPlayer(guard, weapon, d, 8);
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
      // Réplique hostile AVANT le premier tir (pas seulement pendant
      // l'échange, voir resolveNpcShotAtPlayer).
      this.npcVoiceReaction(npc.x, npc.y, { group: 'enerve', count: 1, radius: 14 });
    }
    if (this.vipState.lastAttackerId) {
      const attacker = City.npcs.find(n => n.id === this.vipState.lastAttackerId);
      if (attacker && !attacker.dead) {
        const d = UTIL.dist(attacker, this);
        if (d < 8 && this.missionCombatTick('vip') && UTIL.chance(0.3)) {
          const weapon = WEAPON_CATALOG[attacker.weapon];
          if (UTIL.chance(0.3)) { vip.health -= UTIL.randInt(10, 25); announce(`${vip.name} est touché ! Santé : ${Math.round(vip.health)}%.`, 'assertive'); }
          else this.resolveNpcShotAtPlayer(attacker, weapon, d, 8);
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
        this.setGuidance({ name: m.drops[0].name || 'la première dépose', x: m.drops[0].x, y: m.drops[0].y });
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
        if (this.guidanceTarget) this.stopGuidance();
        RPJournal.log('Mission', `Go-fast terminé : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Toutes les livraisons faites ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
      } else {
        announce(`Livraison ${gs.dropIdx} sur ${m.drops.length} faite. Direction ${m.drops[gs.dropIdx].name}.`, 'assertive');
        this.setGuidance({ name: m.drops[gs.dropIdx].name || 'la dépose suivante', x: m.drops[gs.dropIdx].x, y: m.drops[gs.dropIdx].y });
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
      } else {
        // Ancien bug : ce message réutilisait le même stashState que le
        // déclenchement du combat ('engaged'), donc n'était plus jamais
        // annoncé une fois la fusillade commencée — le joueur, tous les
        // gardes abattus, n'était jamais informé qu'il fallait s'approcher
        // du point d'origine pour récupérer le butin. Flag dédié + rappel
        // espacé (pas juste une fois, au cas où le message se perde parmi
        // d'autres annonces de fin de combat).
        // Deuxième bug, resté même après ce correctif : le rappel ne disait
        // JAMAIS où se trouvait ce point. Les vigiles ne se déplacent pas
        // (ils tirent sur place), mais le combat pouvait très bien se
        // dérouler à distance de tir (jusqu'à une douzaine de cases) — une
        // fois tous morts, plus aucun repère sonore pour retrouver le point
        // exact. Comme pour la chasse aux primes (tickChassePrimes) et le
        // rappel d'ID de mission (announceActiveMissionId), distance ET
        // direction réelles vers m (le point de la planque, fixe depuis sa
        // création — voir City.generateExtremeMissions).
        const now = Date.now();
        if (now - (this._stashLootHintAt || 0) > 8000) {
          this._stashLootHintAt = now;
          const d = Math.round(UTIL.dist(m, this) * CONFIG.METERS_PER_TILE);
          const dir = UTIL.bearing(m.x - this.x, m.y - this.y);
          announce(`Vigiles neutralisés. Butin au sol à ${d} mètres, vers le ${dir}.`, 'assertive', { tag: 'stash-loot' });
        }
      }
      return;
    }
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 12) return;
      if (d < 8 && !this.stashState) {
        this.stashState = 'engaged'; this.reportCrimeToPolice('coups_de_feu', 'Fusillade sur une planque gardée');
        announce('Les vigiles vous repèrent et ouvrent le feu !', 'assertive');
        // Réplique hostile AVANT le premier tir (pas seulement pendant
        // l'échange, voir resolveNpcShotAtPlayer).
        this.npcVoiceReaction(n.x, n.y, { group: 'enerve', count: 1, radius: 14 });
      }
    });
    if (this.missionCombatTick('planque')) squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 12) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      if (weapon && UTIL.chance(Math.max(0.05, 0.28 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 12);
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
        weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('policier'), // pas de fusil à pompe : plafond volontaire pour tout PNJ
      };
      City.npcs.push(npc); npcIds.push(npc.id);
    }
    this.wantedResponseState = { stage: 'combat', npcIds };
    announce(`${count} agent${count > 1 ? 's' : ''} vous encerclent !`, 'assertive');
  },
  fleePoliceResponse() {
    // Vraie course-poursuite : au lieu d'un simple lancer de dé, des unités de
    // police vous prennent en chasse. On leur échappe en creusant l'écart
    // (bien plus facile en véhicule rapide) — voir startPoliceChase/updateWantedChase.
    this.startPoliceChase();
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
      if (weapon && UTIL.chance(Math.max(0.05, 0.3 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 12);
    });
  },

  /* ==========================================================
     COURSE-POURSUITE. Dans ce jeu, la police est composée de VRAIS
     JOUEURS humains : une poursuite se joue donc d'abord contre eux.
     Côté fuyard, on fournit le retour audio (sirène plus forte quand
     ils se rapprochent, distance et cap annoncés) à partir de la
     position réelle des policiers connectés ; on s'échappe en creusant
     l'écart, et on est interpellé quand un policier réel vous menotte
     (mécanique existante). Les PNJ ne servent QUE de filet en solo,
     quand aucun policier humain n'est connecté à proximité.
     ========================================================== */
  // Policiers RÉELS (joueurs humains) connectés à portée.
  _nearbyRealPolice(radius = 60) {
    if (!Net.connected) return [];
    return Array.from(Net.remotePlayers.values()).filter(p => p && p.role === 'police' && !p.unconscious && UTIL.dist(p, this) < radius);
  },
  startPoliceChase() {
    this._chaseSirenOn = true;
    const cops = this._nearbyRealPolice(60);
    if (cops.length) {
      // Poursuite entre joueurs réels : on prévient la police (mécanique de
      // signalement existante) et on laisse le retour audio suivre leurs
      // positions réelles. Aucun PNJ n'est créé.
      this.wantedResponseState = { stage: 'chase', real: true, farTicks: 0, lastDistMsg: 0 };
      AudioLib.playLoop('sirene_vehicule_police', 0.4);
      this.reportCrimeToPolice('fuite', 'Refus d\'obtempérer : le suspect prend la fuite');
      announce(`Vous prenez la fuite ! ${cops.length} policier${cops.length > 1 ? 's réels sont' : ' réel est'} à vos trousses. Semez-${cops.length > 1 ? 'les' : 'le'} en creusant l'écart.`, 'assertive');
      return;
    }
    // FILET SOLO — aucun policier humain à proximité : une patrouille automatique
    // prend le relais pour que « être recherché » ait un effet même hors ligne.
    const count = UTIL.randInt(2, 3);
    const npcIds = [];
    for (let i = 0; i < count; i++) {
      let px = this.x, py = this.y, tries = 0;
      do {
        const ang = Math.random() * Math.PI * 2, r = UTIL.randInt(6, 9);
        px = UTIL.clamp(Math.round(this.x + Math.cos(ang) * r), 0, City.W - 1);
        py = UTIL.clamp(Math.round(this.y + Math.sin(ang) * r), 0, City.H - 1);
      } while (City.isSolid(px, py) && ++tries < 8);
      const npc = {
        id: 'chase_' + Date.now() + '_' + i, name: UTIL.pick(['Agent Somé', 'Agent Kientega', 'Agent Zerbo', 'Agent Ilboudo']),
        job: 'policier', gender: UTIL.pick(['homme', 'femme']), x: px, y: py,
        health: 100, relation: -100, money: 0, inCar: true, dialogue: [], home: { x: this.x, y: this.y },
        hostile: true, weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('policier'), // pas de fusil à pompe : plafond volontaire pour tout PNJ
      };
      City.npcs.push(npc); npcIds.push(npc.id);
    }
    this.wantedResponseState = { stage: 'chase', real: false, npcIds, farTicks: 0, lastDistMsg: 0 };
    AudioLib.playLoop('sirene_vehicule_police', 0.5);
    announce(`Aucun policier réel dans les parages : une patrouille automatique vous prend en chasse. Semez-la en creusant l'écart ${this.inVehicle ? 'au volant' : 'à pied'}.`, 'assertive');
  },
  // Fait avancer un poursuivant PNJ de `speed` cases vers le joueur, en
  // contournant sommairement les obstacles (filet solo uniquement).
  _stepChaserToward(n, speed) {
    for (let s = 0; s < speed; s++) {
      const dx = this.x - n.x, dy = this.y - n.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
      const sy = sx === 0 ? Math.sign(dy) : 0;
      if (!City.isSolid(n.x + sx, n.y + sy)) { n.x += sx; n.y += sy; }
      else { // bloqué : essayer l'autre axe pour contourner
        const ax = Math.sign(dx), ay = Math.sign(dy);
        if (sx === 0 && ax && !City.isSolid(n.x + ax, n.y)) n.x += ax;
        else if (sy === 0 && ay && !City.isSolid(n.x, n.y + ay)) n.y += ay;
      }
    }
  },
  updateWantedChase() {
    const ws = this.wantedResponseState; if (!ws || ws.stage !== 'chase') return;
    if (this.health <= 0) { this.endPoliceChase(false); return; }
    if (ws.real) return this._updateRealChase(ws);
    return this._updatePnjChase(ws);
  },
  // Poursuite contre de VRAIS policiers : on suit leurs positions réseau, sans
  // les déplacer nous-mêmes. L'interpellation se fait quand un policier réel
  // vous menotte (isCuffed) — on ne « capture » jamais de force côté fuyard.
  _updateRealChase(ws) {
    if (this.isCuffed) { this.endPoliceChase(false, 'La police vous a interpellé.'); return; }
    const cops = this._nearbyRealPolice(80);
    if (!cops.length) { // plus aucun policier réel à portée : on les a semés / ils ont abandonné
      if ((ws.farTicks = (ws.farTicks || 0) + 1) >= 3) { this.wanted = Math.max(0, this.wanted - 20); this.endPoliceChase(true, 'Vous avez semé la police. Niveau de recherche réduit.'); }
      return;
    }
    let nearest = Infinity, closest = cops[0];
    cops.forEach(p => { const d = UTIL.dist(p, this); if (d < nearest) { nearest = d; closest = p; } });
    AudioLib.playLoop('sirene_vehicule_police', UTIL.clamp(0.72 - nearest * 0.02, 0.1, 0.72));
    // Planqué (Alt+H) ET hors de vue directe de TOUS les policiers proches :
    // on sème beaucoup plus vite, même à faible distance — jusque-là, seule
    // la distance comptait, sans aucune notion de dissimulation réelle.
    const wellHidden = this.hidden && !cops.some(p => this.hasLineOfSight(p.x, p.y, this.x, this.y));
    if (nearest > 24 || wellHidden) {
      if ((ws.farTicks = (ws.farTicks || 0) + (wellHidden ? 2 : 1)) >= 3) {
        this.wanted = Math.max(0, this.wanted - 20);
        this.endPoliceChase(true, wellHidden ? 'Bien planqué(e), vous avez semé la police.' : 'Vous avez semé la police. Niveau de recherche réduit.');
        return;
      }
    } else ws.farTicks = 0;
    const now = Date.now();
    if (now - (ws.lastDistMsg || 0) > 3000) {
      ws.lastDistMsg = now;
      const m = Math.round(nearest * CONFIG.METERS_PER_TILE);
      if (wellHidden) announce(`Planqué(e) : la police est à ${m} mètres mais ne vous voit pas. Restez immobile.`, 'polite');
      else announce(nearest > 12 ? `Vous creusez l'écart : police à ${m} mètres.` : `La police est à ${m} mètres, vers le ${UTIL.bearing(closest.x - this.x, closest.y - this.y)}.`, nearest <= 6 ? 'assertive' : 'polite');
    }
  },
  // Filet SOLO : poursuivants PNJ qui se déplacent vraiment vers vous.
  _updatePnjChase(ws) {
    const squad = ws.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) { this.wanted = Math.max(0, this.wanted - 30); this.endPoliceChase(true, 'Vous avez neutralisé la patrouille. Niveau de recherche réduit.'); return; }
    const speed = (this.inVehicle && this.vehicle) ? 2 : 1;
    // Planqué ET hors de vue directe de TOUTE la patrouille : elle ne fonce
    // plus droit sur vous (elle n'a plus votre position), sans quoi se
    // cacher n'aurait aucun effet une fois repéré une première fois.
    const wellHidden = this.hidden && !squad.some(n => this.hasLineOfSight(n.x, n.y, this.x, this.y));
    if (!wellHidden) squad.forEach(n => this._stepChaserToward(n, speed));
    let nearest = Infinity, closest = squad[0];
    squad.forEach(n => { const d = UTIL.dist(n, this); if (d < nearest) { nearest = d; closest = n; } });
    AudioLib.playLoop('sirene_vehicule_police', UTIL.clamp(0.72 - nearest * 0.035, 0.12, 0.72));
    if (!wellHidden && nearest <= 1.6) { announce('La patrouille vous rattrape et vous bloque la route !', 'assertive'); this.endPoliceChase(false, null, true); return; }
    if (nearest > 14 || wellHidden) {
      ws.farTicks = (ws.farTicks || 0) + (wellHidden ? 2 : 1);
      if (ws.farTicks >= 3) {
        this.wanted = Math.max(0, this.wanted - 25);
        this.endPoliceChase(true, wellHidden ? 'Bien planqué(e), vous avez semé la patrouille.' : 'Vous l\'avez semée ! Niveau de recherche réduit.');
        return;
      }
    } else ws.farTicks = 0;
    const now = Date.now();
    if (now - (ws.lastDistMsg || 0) > 3000) {
      ws.lastDistMsg = now;
      if (wellHidden) { announce('Planqué(e) : la patrouille cherche sans vous voir. Restez immobile.', 'polite'); return; }
      const m = Math.round(nearest * CONFIG.METERS_PER_TILE);
      announce(nearest > 10 ? `Vous creusez l'écart : patrouille à ${m} mètres.` : `La patrouille est à ${m} mètres, vers le ${UTIL.bearing(closest.x - this.x, closest.y - this.y)}.`, nearest <= 5 ? 'assertive' : 'polite');
    }
  },
  endPoliceChase(escaped, msg, toCombat) {
    // Couper la sirène de poursuite — sauf si c'est celle du véhicule du joueur (policier).
    if (this._chaseSirenOn && !(this.vehicle && this.vehicle.siren)) AudioLib.stopLoop('sirene_vehicule_police');
    this._chaseSirenOn = false;
    const ws = this.wantedResponseState;
    if (toCombat) { this.wantedResponseState = { stage: 'combat', npcIds: (ws && ws.npcIds) || [] }; return; }
    if (ws && ws.npcIds) City.npcs = City.npcs.filter(n => !ws.npcIds.includes(n.id)); // les poursuivants abandonnent
    this.wantedResponseState = null;
    if (msg) announce(msg, 'assertive');
    updateHud();
  },

  grantGangLoot(gang, multiplier) {
    // Même plafond que launchGangCombat : un gang ne détient (et ne laisse
    // donc tomber) ni sniper ni fusil à pompe.
    const pool = gang.power > 60 ? ['ak47', 'm4'] : gang.power > 30 ? ['pistolet_9', 'uzi'] : ['pistolet_9', 'revolver_38'];
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
      // Guidage vocal jusqu'au point de livraison (fonctionne en conduisant).
      this.setGuidance({ name: m.dropName || 'le point de livraison', x: m.dropX, y: m.dropY });
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
    if (this.guidanceTarget) this.stopGuidance();
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

  // Avant, ce menu se contentait d'ANNONCER "dites un lieu" sans jamais rien
  // capter en retour : aucune destination n'était réellement sélectionnable,
  // ce qui rendait la conduite automatique inaccessible depuis ce menu (le
  // même problème touchait le taxi : "monter, mais aucun menu de destination").
  autoDriveMenu() {
    if (!this.inVehicle || !this.vehicle) return announce('Montez d\'abord dans un véhicule.', 'assertive');
    const dests = [
      { type: 'hopital', label: 'Hôpital' }, { type: 'police', label: 'Police' }, { type: 'banque', label: 'Banque' },
      { type: 'magasin', label: 'Magasin' }, { type: 'armurerie', label: 'Armurerie' }, { type: 'concessionnaire', label: 'Concessionnaire' },
      { type: 'aeroport', label: 'Aéroport' }, { type: 'heliport', label: 'Héliport' }, { type: 'port', label: 'Port' }, { type: 'mine', label: 'Mine' },
    ];
    el('menuTitle').textContent = 'Conduite automatique : destination';
    const items = dests.map(d => {
      const nearest = City.pois.filter(p => p.type === d.type).map(p => ({ ...p, dist: UTIL.dist(p, this) })).sort((a, b) => a.dist - b.dist)[0];
      return { id: d.type, title: nearest ? `${d.label} — ${nearest.name}` : d.label, desc: nearest ? `${Math.round(nearest.dist * CONFIG.METERS_PER_TILE)} m.` : 'Aucun trouvé dans la ville.' };
    });
    if (this.ownedHouses.length) items.push({ id: 'maison', title: '🏠 Ma maison', desc: 'Direction votre maison possédée la plus proche.' });
    items.push({ id: 'custom', title: '🔍 Autre lieu (rechercher par nom)', desc: 'Saisir le nom d\'un lieu, d\'une boutique ou d\'un quartier.' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'custom') {
        AccessibleTextPrompt.open('Destination', 'Nom du lieu, de la boutique ou du quartier.', '', (name) => { if (name) this.setAutoDrive(null, name); });
      } else if (sel.id === 'maison') {
        const h = this.ownedHouses.map(hid => City.houses.find(hh => hh.id === hid)).filter(Boolean).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
        if (!h) return announce('Aucune maison possédée trouvée.', 'assertive');
        this.vehicle.auto = true; this.vehicle.autoDest = { x: h.x, y: h.y, name: h.name };
        announce(`Conduite automatique vers ${h.name}.`, 'polite');
      } else this.setAutoDrive(sel.id, null);
    });
  },
  help() {
    announce('Commandes : flèches pour se déplacer, E interagir, T tirer, R recharger, A arme, P téléphone, K ordinateur, B lecture rapide de l\'inventaire, N ouvrir le menu d\'inventaire (utiliser, porter, donner, vendre, déposer), L position, C boussole, F radar de balayage, D balise sonore de la porte la plus proche, Maj+E monter d\'un étage, Alt+E descendre d\'un étage, V micro de proximité, S maintenue pour parler au talkie, Maj+C visite guidée, Maj+B balises sonores, Maj+F retrouver mon véhicule (guidage GPS vers sa dernière position connue), Maj+V faire sonner mon véhicule pour le repérer à l\'oreille (utile si deux véhicules identiques sont côte à côte), Alt+H se planquer ou sortir de la planque près d\'une couverture (rend bien plus difficile à repérer et permet de semer une poursuite), Maj+G arrêter le guidage, boîte manuelle des motos et voitures sport : les deux touches à droite du clavier juste avant Entrée (crochet fermant pour monter d\'un rapport, celle juste avant pour redescendre), Maj+N basculer le guidage GPS entre voix et bips sonores directionnels, Maj+P fouiller sa poche, Maj+U faire suivre une cible menottée, X coup de poing, Y porter, Shift+Z installer dans véhicule, Shift+T testament au commissariat, Ctrl+J menu véhicule, Ctrl+F fouille cible, Alt+F fouille soi, Ctrl+L verrouiller son véhicule, Ctrl+S sirène, Ctrl+M acheter une machine d\'extraction minière, Ctrl+O ma tenue, Ctrl+Z marcher vers la cible verrouillée, Ctrl+A mode staff, F6 bilan santé/faim/soif/énergie/argent/essence, F7 joueurs connectés et type de connexion (Wi-Fi ou données mobiles), F8 mission active et son identifiant, Alt+V infos du véhicule, F9-F12 raccourcis, Ctrl+1-9 ciblage rapide. Chien guide (Maj+Alt+chiffre) : 0 prendre ou lâcher la laisse, 1 menu du chien, 2 guider vers la destination, 3 nourrir, 4 abreuver, 5 état, 6 rappeler, 7 rester sur place, 8 envoyer au véhicule, 9 désactiver ou réactiver, Maj+Alt+F7 repos. Achat du chien et de sa nourriture à l\'animalerie, soins chez le vétérinaire. Dans les menus et pour choisir une quantité à donner ou déposer : flèches Haut/Bas pour ±1 ou se déplacer, Gauche/Droite pour ±5, Entrée pour valider, Échap pour annuler. Sur mobile, le même geste de glissement sert à naviguer et à ajuster une quantité, et le double-tap valide.', 'polite');
  },

  // Save / load
  // silent=true pour les sauvegardes automatiques en arrière-plan (toutes les
  // 60 s, et à la fermeture de l'onglet) : avant, l'annonce vocale « Partie
  // sauvegardée » se répétait sans arrêt même sans action du joueur, ce qui
  // devenait vite pénible. Une sauvegarde manuelle (menu) reste annoncée.
  save(silent) {
    // Personnage mort définitivement (permanentDeath) : ne JAMAIS réécrire la
    // sauvegarde locale. Sans ce garde-fou, l'autosave périodique ou celui
    // déclenché par 'beforeunload' juste avant le location.reload() de
    // permanentDeath() ressuscitait le personnage mort dans le localStorage,
    // et la création d'un nouveau compte juste après retombait dessus.
    if (this._permanentlyDead) return;
    const payload = {
      x: this.x, y: this.y, altitude: this.altitude, heading: this.heading, health: this.health, money: this.money,
      bank: this.bank, dirtyMoney: this.dirtyMoney, hunger: this.hunger, thirst: this.thirst, energy: this.energy,
      inventory: this.inventory, weapons: this.weapons, ammo: this.ammo, ammoReserve: this.ammoReserve, ownedVehicles: this.ownedVehicles,
      // Les véhicules achetés sont créés dynamiquement (pas générés par la
      // ville) : il faut sauvegarder leurs données complètes, sinon ils
      // n'existeraient simplement plus après un rechargement.
      ownedVehicleData: this.ownedVehicles.map(id => City.vehicles.find(v => v.id === id)).filter(Boolean),
      ownedHouses: this.ownedHouses, ownedWarehouses: this.ownedWarehouses, wanted: this.wanted,
      // Terrain agricole : basé sur de vraies dates (plantedAt), donc la
      // pousse continue même hors ligne — doit impérativement survivre à la
      // déconnexion, d'où la présence ici comme le reste des biens possédés.
      plantations: this.plantations,
      completedMissions: this.completedMissions, activeMissionId: this.activeMission?.id || null,
      role: this.role, policeRank: this.policeRank, licenses: this.licenses, skills: this.skills,
      will: this.will, tickets: this.tickets, invoices: this.invoices, finesHistory: this.finesHistory,
      criminalRecord: this.criminalRecord, jailedAt: this.jailedAt,
      player: this.player, outfit: this.outfit, miningMachine: this.miningMachine, talkie: this.talkie, portableRadio: this.portableRadio,
      rolesCurrent: Roles.current, rolesRecruiters: Roles.recruiters, savedPlaces: this.savedPlaces, ownsTablet: this.ownsTablet,
      phones: this.phones, activePhoneIndex: this.activePhoneIndex, lastParkedVehicle: this.lastParkedVehicle, theoryPassed: this.theoryPassed, flightTheoryPassed: this.flightTheoryPassed, myContacts: this.myContacts,
      hasHelmet: this.hasHelmet, hasVest: this.hasVest, pendingBills: this.pendingBills,
      guideDog: this.guideDog, // chien guide (position, état, équipement) — coûteux, doit persister
      guideDogEverOwned: this.guideDogEverOwned, // empêche d'en redonner un gratuit après la mort du premier
      // Mobilier acheté et placé dans les maisons (personnalisation) : la ville
      // est régénérée à chaque session, il faut donc le sauvegarder à part.
      houseFurniture: Object.fromEntries((City.houses || []).filter(h => h.furniture && h.furniture.length).map(h => [h.id, h.furniture])),
      // Rangement de base de chaque maison (le "coffre-fort" accessible via
      // Rangement de la maison) : même raison, sans quoi tout ce qu'on y range
      // disparaît à la reconnexion puisque la ville régénérée repart à vide.
      houseStorage: Object.fromEntries((City.houses || []).filter(h => h.storage && h.storage.length).map(h => [h.id, h.storage])),
      unconscious: this.unconscious, unconsciousSince: this.unconsciousSince, // pour reprendre le décompte de réveil au bon endroit
    };
    localStorage.setItem('blind_city_v18', JSON.stringify(payload));
    // Si un compte joueur est connecté, pousse aussi la sauvegarde côté
    // serveur : c'est ce qui permet de la retrouver depuis un autre appareil.
    if (Net.connected && Net.accountUsername) Net.saveProgressToServer(payload);
    if (!silent) announce('Partie sauvegardée.', 'polite');
  },
  load() {
    const s = localStorage.getItem('blind_city_v18') || localStorage.getItem('blind_city_v17') || localStorage.getItem('city_blind_v16') || localStorage.getItem('city_blind_v15') || localStorage.getItem('city_blind_v12') || localStorage.getItem('city_blind_v10'); if (!s) return;
    try { this.applySaveData(JSON.parse(s)); } catch(e) { console.error(e); }
  },
  // Applique un objet de sauvegarde (venant du stockage local OU d'un compte
  // serveur) — doit être appelé APRÈS City.generate(), puisque la
  // resynchronisation des missions/véhicules a besoin que la ville existe déjà.
  // fromAccount=true : la sauvegarde vient d'une RECONNEXION à un compte
  // serveur, dont la ville est régénérée avec une graine différente à chaque
  // redémarrage du serveur (voir WORLD_SEED côté server.js) — contrairement
  // au solo, où la graine est mémorisée sur l'appareil et la ville reste
  // identique d'une session à l'autre.
  applySaveData(d, fromAccount) {
    try {
      Object.assign(this, d);
      // Une sauvegarde (locale ou de compte) vient d'être restaurée : ce joueur
      // n'est pas un nouveau venu, on garde sa position enregistrée plutôt que
      // de le faire réapparaître à l'aéroport.
      this._loadedFromSave = true;
      // Anti-blocage : à l'ouverture d'un compte / au chargement d'une
      // sauvegarde, on ne reste JAMAIS inconscient. On repart conscient (santé
      // minimale s'il le fallait) — ça débloque immédiatement tout joueur resté
      // coincé, et supprime toute annonce « vous perdez connaissance » en boucle.
      if (this.unconscious) {
        this.unconscious = false; this.unconsciousSince = null;
        if (!(this.health > 0)) this.health = 30;
        // On laisse une marge pour aller manger/boire sans retomber aussitôt.
        this.hunger = Math.min(this.hunger || 0, 70);
        this.thirst = Math.min(this.thirst || 0, 70);
      }
      if (!this.player) this.player = { firstName: 'Joueur', lastName: 'Anonyme', gender: 'homme', registered: false };
      if (!this.outfit) this.outfit = { haut: null, bas: null, chaussures: null, couleurHaut: null, couleurBas: null, couleurChaussures: null, coiffure: null, lunettes: null, accessoires: [] };
      else for (const k of ['couleurHaut', 'couleurBas', 'couleurChaussures', 'coiffure', 'lunettes']) if (!(k in this.outfit)) this.outfit[k] = null;
      if (!('isPolice' in this.outfit)) this.outfit.isPolice = false;
      if (!('masque' in this.outfit)) this.outfit.masque = false;
      if (!Array.isArray(this.outfit.accessoires)) this.outfit.accessoires = [];
      if (!this.talkie) this.talkie = { owned: false, battery: 1, on: false, frequency: 151.5 };
      if (!this.portableRadio) this.portableRadio = { owned: false };
      // Chien guide : resynchronise le module GuideDog avec l'état restauré.
      if (typeof GuideDog !== 'undefined') GuideDog.data = (this.guideDog && this.guideDog.alive) ? this.guideDog : null;
      if (!Array.isArray(this.savedPlaces)) this.savedPlaces = [];
      if (!Array.isArray(this.myContacts)) this.myContacts = [];
      if (!Array.isArray(this.pendingBills)) this.pendingBills = [];
      if (!Array.isArray(this.finesHistory)) this.finesHistory = [];
      if (!Array.isArray(this.criminalRecord)) this.criminalRecord = [];
      if (!this.ammoReserve || typeof this.ammoReserve !== 'object') this.ammoReserve = {};
      if (!Array.isArray(this.completedMissions)) this.completedMissions = [];
      // Réinjecte les véhicules possédés (créés dynamiquement, donc absents
      // de la ville fraîchement régénérée) sans dupliquer s'ils y sont déjà.
      (d.ownedVehicleData || []).forEach(v => {
        // openDoors est un Set : non sérialisable en JSON (devient {} après
        // sauvegarde/rechargement), donc v.openDoors.add(...) plantait ensuite.
        // On repart portes fermées, ce qui est de toute façon cohérent après un rechargement.
        v.openDoors = new Set();
        if (!City.vehicles.some(existing => existing.id === v.id)) City.vehicles.push(v);
      });
      // Réattache le mobilier des maisons à la ville régénérée.
      if (d.houseFurniture) (City.houses || []).forEach(h => { if (d.houseFurniture[h.id]) h.furniture = d.houseFurniture[h.id]; });
      if (d.houseStorage) (City.houses || []).forEach(h => { if (d.houseStorage[h.id]) h.storage = d.houseStorage[h.id]; });
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
      // Reconnexion à un compte serveur : la ville a pu être régénérée entre
      // temps (redémarrage du serveur = nouvelle graine), donc la mission
      // active pointerait peut-être vers un lieu qui n'a plus rien à voir
      // (un site minier ailleurs, une banque devenue une maison...). On
      // l'annule proprement plutôt que de risquer d'envoyer le joueur vers un
      // lieu fictif. En solo, la graine est stable sur l'appareil : la ville
      // est identique d'une session à l'autre, la mission reste donc valable.
      if (d.activeMissionId && fromAccount) {
        this.activeMission = null;
        announce('La mission que vous aviez en cours a été annulée suite à votre reconnexion (la ville a pu changer entre-temps). Vous pouvez en reprendre une nouvelle.', 'polite');
      } else if (d.activeMissionId) {
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
  // Petite radio portable : débloque Ctrl+R pour lire/mettre en pause la
  // musique perso à tout instant, sans ouvrir le téléphone.
  buyPortableRadio() {
    if (this.portableRadio.owned) return announce('Vous possédez déjà une radio portable.', 'polite');
    const price = 20000;
    if (this.money < price) return announce(`Radio portable : ${UTIL.formatMoney(price)}.`, 'assertive');
    this.money -= price; this.portableRadio.owned = true;
    Audio.cash();
    announce('Radio portable achetée. Ctrl+R pour lire ou mettre en pause votre musique, à tout instant.', 'assertive');
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
    const gangSurcharge = City.getGangMarketSurcharge('protection');
    const holder = gangSurcharge ? City.getMarketHolder('protection') : null;
    const price = Math.round(120000 * (1 + gangSurcharge));
    if (this.money < price) return announce(`Casque de protection : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.hasHelmet = true;
    Audio.cash();
    announce(`Casque de protection porté${holder ? ` (marché tenu par ${holder.leaderName || 'quelqu\'un'}, président des ${holder.name})` : ''}. Il vous protège d'un tir ou d'un coup à la tête qui serait autrement mortel.`, 'assertive');
    updateHud();
  },
  hasVest: false,
  buyVest() {
    if (this.hasVest) return announce('Vous portez déjà un gilet pare-balles.', 'polite');
    const gangSurcharge = City.getGangMarketSurcharge('protection');
    const holder = gangSurcharge ? City.getMarketHolder('protection') : null;
    const price = Math.round(150000 * (1 + gangSurcharge));
    if (this.money < price) return announce(`Gilet pare-balles : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.hasVest = true;
    Audio.cash();
    announce(`Gilet pare-balles porté${holder ? ` (marché tenu par ${holder.leaderName || 'quelqu\'un'}, président des ${holder.name})` : ''}. Il réduit les dégâts d'un tir au corps.`, 'assertive');
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
  // Envoyer l'un de ses numéros à la cible verrouillée (un joueur réel) : elle le
  // reçoit, l'enregistre et peut rappeler. Sans index, envoie le numéro actif.
  sendMyNumberToTarget(index) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    const target = this.getLiveTarget();
    if (!target || !target.isPlayer) return announce('Verrouillez d\'abord un joueur réel comme cible (scan avec W, puis un chiffre) pour lui envoyer votre numéro.', 'assertive');
    const phone = this.phones[index != null ? index : this.activePhoneIndex];
    if (!phone) return announce('Vous n\'avez aucun numéro. Achetez un téléphone prépayé.', 'assertive');
    Net.sendNumber(target.id, phone.number, phone.label || `${this.player.firstName} ${this.player.lastName}`);
    announce(`Envoi de votre numéro ${phone.number} à ${target.name}...`, 'polite');
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
        { id: 'send', title: '📤 Envoyer à ma cible verrouillée', desc: 'Donner ce numéro au joueur réel que vous avez verrouillé comme cible, pour qu\'il puisse vous rappeler.' },
        { id: 'back', title: '↩️ Retour', desc: '' },
      ];
      renderMenu(subItems, (sub) => {
        if (sub.id === 'activate') { closeMenu(); this.setActivePhone(idx); }
        else if (sub.id === 'rename') { closeMenu(); this.renamePhoneLabel(idx); }
        else if (sub.id === 'send') { closeMenu(); this.sendMyNumberToTarget(idx); }
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
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'phone') Phone.openAs('phone');
      else if (sel.id === 'tablet') {
        if (!this.ownsTablet) {
          AccessibleConfirm.open('Vous ne possédez pas de tablette', 'L\'acheter maintenant pour 60 000 FCFA ?', (bought) => {
            if (bought) { this.buyTablet(); if (this.ownsTablet) Phone.openAs('tablet'); }
            else announce('Achetez une tablette pour l\'avoir sur vous.', 'assertive');
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
    // Autonomie augmentée drastiquement : avant, une batterie pleine ne
    // tenait qu'environ 8 minutes allumée (0.01 toutes les 5 s) — beaucoup
    // trop court pour un talkie-walkie. Décharge divisée par 10.
    if (this.talkie.owned && this.talkie.on) {
      this.talkie.battery = Math.max(0, this.talkie.battery - 0.001);
      if (this.talkie.battery <= 0) { this.talkie.on = false; announce('Batterie du talkie-walkie épuisée. Il s\'éteint.', 'assertive'); }
    }
  },
  talkiePTT(message) {
    if (!this.talkie.owned || !this.talkie.on) return announce('Allumez d\'abord votre talkie-walkie.', 'assertive');
    if (this.talkie.battery <= 0.02) return announce('Batterie trop faible pour émettre.', 'assertive');
    this.talkie.battery = Math.max(0, this.talkie.battery - 0.002);
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
