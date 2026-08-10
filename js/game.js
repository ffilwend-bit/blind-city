/* ============================================================
   GAME.JS — objet Game principal (état du joueur + actions).
   Ce fichier était un unique bloc de ~6700 lignes, devenu trop
   volumineux pour rester facilement modifiable sans risquer de
   casser autre chose au passage. Il est maintenant scindé en
   plusieurs fichiers, tous chargés à la suite dans le HTML et
   fusionnés sur le MÊME objet Game via Object.assign (donc
   strictement équivalent à avant, juste réparti physiquement) :
     - game.js                    (ce fichier) : état de base,
       déplacement, véhicules, combat de base.
     - game-navigation.js         : outils de navigation piétonne,
       combat (suite).
     - game-interiors-economy.js  : intérieurs parcourables, mode
       vendeur.
     - game-missions-story.js     : braquage de banque, raid de
       repaire de gang, missions faciles/moyennes/solo.
     - game-missions-extreme.js   : missions extrêmes, équipe
       d'intervention, course-poursuite, convoyage de véhicule.
   L'ORDRE de chargement dans le HTML compte peu ici (chaque
   fichier ne fait qu'ajouter des propriétés à Game, jamais en
   lire au moment du chargement), mais garder cet ordre-là évite
   toute confusion pour s'y retrouver.
============================================================ */
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
        if (this.fragileState) {
          this.fragileState.condition = Math.max(0, this.fragileState.condition - UTIL.randInt(15, 35));
          this.announceShock('Colis', this.fragileState.condition);
        }
        if (this.taxiState) this.taxiRoughEvent(UTIL.randInt(15, 30));
        if (this.medicalState) {
          const victim = City.npcs.find(n => n.id === this.medicalState.victimId);
          if (victim) { victim.health = Math.max(0, victim.health - UTIL.randInt(8, 18)); this.announceShock('État du blessé', victim.health); }
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
      // court. Deux réductions précédentes (~27 km puis ~100 km/plein)
      // restaient encore trop courtes en usage réel : constante divisée par
      // 500 par rapport à la dernière valeur, pour ~50 000 km par plein —
      // le carburant cesse d'être une vraie contrainte de jeu.
      if (!noFuelNeeded) v.fuel = Math.max(0, v.fuel - 0.00000008);
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
    // Dans un bâtiment : les bribes de PNJ (tickPassersby) et le bruit
    // ambiant de la ville sont déjà coupés, mais PAS les moteurs des
    // véhicules d'autres joueurs/PNJ — incohérent, une maison isole aussi du
    // bruit de la circulation. On arrête toute boucle déjà lancée (sinon elle
    // continue de jouer au dernier volume connu, plus jamais mise à jour tant
    // qu'on ne quitte pas ce `return` anticipé) puis on coupe le reste de la
    // fonction ; la sortie du bâtiment relance normalement au tick suivant.
    // this.interior ET this.indoors : DEUX flags différents et pas toujours
    // ensemble — this.interior seulement pour un lieu avec un vrai plan de
    // pièces à parcourir (maison, banque, commissariat...), this.indoors
    // pour TOUT lieu où l'on entre, y compris ceux sans plan interne
    // (station-service, garage, aéroport, port...). Ne tester que
    // this.interior laissait ces derniers sans aucune coupure du bruit
    // ambiant — corrigé en testant les deux.
    if (this.interior || this.indoors) {
      (this._ambientVehicleIds || []).forEach(id => AudioLib.stopLoopInstance(id));
      this._ambientVehicleIds = new Set();
      return;
    }
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
  // case franchie et avertit en sortant de la route (info de sécurité). Le
  // changement de quartier et le rappel périodique de cap/vitesse ont été
  // retirés (le véhicule "parlait trop" en conduite normale) — ces infos
  // restent consultables à tout moment SUR DEMANDE (I/L pour la position et
  // la vitesse, C pour le cap). Vaut en manuel ET en auto.
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
      // Changement de quartier : n'est PLUS annoncé automatiquement à
      // chaque franchissement (le véhicule "parlait trop") — consultable à
      // tout moment à la demande via announceLocation (touches I ou L), qui
      // l'indique déjà. p.district n'a donc plus d'usage réel ici, gardé
      // pour ne pas casser la structure de _vehProg sans raison.
      const dName = City.getDistrictAt(tx, ty).name;
      if (dName !== p.district) p.district = dName;
      // Passage route / hors-route : ne s'applique qu'au sol — un aéronef EN
      // VOL (altitude > 0) survole tout, la notion de route au sol ne le
      // concerne plus (sinon « vous quittez la route » sonnait à tort en
      // plein ciel, dès que le sol survolé n'était pas une route).
      const cls = VEHICLE_CATALOG[v.type];
      const onRoad = City.isRoad(tx, ty);
      if (!(cls.flies && v.altitude > 0) && onRoad !== p.road) { p.road = onRoad; announce(onRoad ? 'Vous êtes sur la route.' : 'Attention, vous quittez la route.', 'polite'); }
      else if (cls.flies && v.altitude > 0) p.road = onRoad; // garde l'état à jour sans l'annoncer, pour ne pas annoncer faussement au posé
    }
    // Rappel périodique de cap/vitesse/quartier : supprimé (le véhicule
    // "parlait trop" en conduite normale) — cap consultable à la demande
    // via C (boussole), vitesse et quartier via I ou L (announceLocation,
    // qui inclut maintenant la vitesse en véhicule). p.lastMsg n'est plus
    // utilisé mais reste initialisé plus haut, sans effet.
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
    // Vitesse : vérifiable ici À LA DEMANDE plutôt qu'annoncée toute seule
    // toutes les 7 secondes en conduite (voir updateVehicleProgress) — le
    // véhicule "parlait trop" pour une info qu'on peut très bien demander
    // seulement quand on en a besoin.
    const vitesse = (this.inVehicle && this.vehicle) ? `, ${Math.round(Math.abs(this.vehicle.speed) * 60)} kilomètres heure` : '';
    announce(`Vous êtes dans ${d.name}, ${street}, cap vers le ${bearing}${vitesse}${etage}${alt}.`, 'polite');
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

};
