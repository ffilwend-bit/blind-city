// ============================================================
//  PLANS D'INTÉRIEURS — grille de pièces à parcourir à pied (façon GTA RP,
//  mais tout se « voit » à l'oreille : nom de la pièce en y entrant, mur
//  signalé quand on bute). Les pièces sont contiguës (elles se touchent) pour
//  former une zone marchable connectée, sans porte explicite. Les MEUBLES ne
//  sont PAS pré-placés : ils s'achètent pour personnaliser sa maison.
//  entrance = case de départ ; rooms = { name, x, y, w, h } en coordonnées
//  intérieures (y vers le bas).
// ============================================================
const INTERIOR_TYPES = {
  maison: {
    entrance: { x: 1, y: 1 },
    rooms: [
      { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
      { name: 'salon', x: 0, y: 2, w: 4, h: 3 },
      { name: 'cuisine', x: 4, y: 2, w: 3, h: 3 },
      { name: 'chambre', x: 3, y: 0, w: 4, h: 2 },
    ],
  },
  maison_luxe: {
    entrance: { x: 1, y: 1 },
    rooms: [
      { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
      { name: 'grand salon', x: 0, y: 2, w: 5, h: 4 },
      { name: 'cuisine', x: 5, y: 2, w: 3, h: 3 },
      { name: 'chambre principale', x: 3, y: 0, w: 5, h: 2 },
      { name: 'bureau', x: 5, y: 5, w: 3, h: 3 },
      { name: 'piscine', x: 8, y: 2, w: 3, h: 3 }, // maison de standing : bassin où l'on peut se baigner (Game.diveInWater)
    ],
  },
};

// Plans d'intérieurs des LIEUX PUBLICS (boutiques, banque, commissariat,
// hôpital…), à parcourir comme les maisons. Chacun a un « point de service »
// (comptoir/guichet/accueil) : c'est là qu'on appuie sur E pour être servi
// (le service existant du lieu, via Game.enterPOI). Pièces contiguës.
const POI_INTERIORS = {
  commerce: { entrance: { x: 1, y: 1 }, service: { x: 4, y: 0, label: 'comptoir' }, rooms: [
    { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
    { name: 'rayons', x: 0, y: 2, w: 5, h: 3 },
    { name: 'comptoir', x: 3, y: 0, w: 3, h: 2 },
  ] },
  banque: { entrance: { x: 1, y: 1 }, service: { x: 5, y: 0, label: 'guichet' }, rooms: [
    { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
    { name: 'hall', x: 0, y: 2, w: 5, h: 3 },
    { name: 'guichets', x: 3, y: 0, w: 4, h: 2 },
  ] },
  commissariat: { entrance: { x: 1, y: 1 }, service: { x: 1, y: 3, label: 'accueil' }, rooms: [
    { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
    { name: 'accueil', x: 0, y: 2, w: 3, h: 3 },
    { name: 'bureau', x: 4, y: 2, w: 3, h: 3 },
    { name: 'cellules', x: 3, y: 0, w: 4, h: 2 },
  ] },
  hopital: { entrance: { x: 1, y: 1 }, service: { x: 1, y: 3, label: 'accueil' }, rooms: [
    { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
    { name: 'accueil', x: 0, y: 2, w: 4, h: 3 },
    { name: 'salle de soins', x: 4, y: 2, w: 3, h: 3 },
  ] },
  service: { entrance: { x: 1, y: 1 }, service: { x: 1, y: 3, label: 'comptoir' }, rooms: [
    { name: 'entrée', x: 0, y: 0, w: 3, h: 2 },
    { name: 'salle', x: 0, y: 2, w: 4, h: 3 },
  ] },
};

const City = {
  W: CONFIG.W, H: CONFIG.H,
  grid: new Map(), // "x,y" -> tile type
  pois: [],
  npcs: [],
  vehicles: [],
  roadAxes: [],
  districts: [],
  houses: [],
  missions: [],
  gangs: [],
  miningSites: [],
  morgue: [], // défunts en attente d'enterrement : { name, cause, time }
  graves: [], // défunts enterrés au cimetière : { name, cause, time }
  solidTypes: new Set(['maison','immeuble','mur','usine','entrepot','garage','atelier','police','hopital','banque','prison','mine','tour','barriere','magasin','restaurant','qg_extreme','auto_ecole','ecole_pilotage','tribunal','monument','gouvernorat','cimetiere','morgue']),

  generate() {
    this.grid.clear(); this.pois = []; this.npcs = []; this.vehicles = []; this.roadAxes = []; this.districts = []; this.houses = []; this.missions = []; this.gangs = []; this.miningSites = []; this.groundItems = [];
    // Districts
    // La capitale de Blind City reprend les noms de quartiers de Ouagadougou.
    this.districts = [
      { name: 'Koulouba', x1: 90, y1: 90, x2: 150, y2: 150, type: 'centre', density: 0.6 },              // quartier administratif et stratégique
      { name: 'Tampouy', x1: 20, y1: 20, x2: 110, y2: 80, type: 'residentiel', density: 0.4 },           // quartier populaire et très vivant
      { name: 'Ouaga 2000', x1: 160, y1: 30, x2: 230, y2: 100, type: 'residentiel', density: 0.35 },     // quartier moderne et prestigieux
      { name: 'Zone industrielle de Kossodo', x1: 10, y1: 160, x2: 90, y2: 230, type: 'industriel', density: 0.3 },
      { name: 'Zone du barrage', x1: 100, y1: 170, x2: 180, y2: 230, type: 'port', density: 0.25 },      // plan d'eau (les barrages de Ouaga)
      { name: 'Aéroport', x1: 190, y1: 170, x2: 235, y2: 235, type: 'aeroport', density: 0.1 },
      { name: 'Parc urbain Bangr-Weoogo', x1: 20, y1: 100, x2: 80, y2: 150, type: 'parc', density: 0.1 },
      { name: 'Gounghin', x1: 120, y1: 160, x2: 230, y2: 230, type: 'commercial', density: 0.45 },       // quartier très animé et commercial
      { name: 'Karpala', x1: 10, y1: 80, x2: 70, y2: 130, type: 'residentiel', density: 0.35 },          // quartier en pleine expansion
      { name: 'Dassasgho', x1: 170, y1: 60, x2: 235, y2: 110, type: 'residentiel', density: 0.35 },
      { name: 'Nongr-Massom', x1: 60, y1: 10, x2: 130, y2: 50, type: 'residentiel', density: 0.35 },
      // type 'zone_miniere' et non 'mine' : ce type de quartier remplit TOUT son
      // terrain (fillDistrict) avec ce nom de tuile — s'il valait 'mine', qui
      // est aussi le type des tuiles solides des puits (voir solidTypes et
      // generateMines), tout le quartier de 50x50 cases devenait un seul bloc
      // solide infranchissable (c'était « le mur de la mine » qui bloquait tout
      // itinéraire GPS passant par là).
      { name: 'Zone minière', x1: 5, y1: 5, x2: 55, y2: 55, type: 'zone_miniere', density: 0.15 },
      { name: 'Cissin', x1: 170, y1: 120, x2: 230, y2: 160, type: 'ghetto', density: 0.4 },              // quartier populaire, plus rude
      // Deuxième grande ville : Bobo-Dioulasso, loin au sud-est, isolée par du
      // terrain sauvage — on s'y rend surtout par la voie des airs.
      { name: 'Bobo-Dioulasso', x1: 445, y1: 445, x2: 510, y2: 510, type: 'commercial', density: 0.3 },
      // Troisième ville : Kongoussi, encore bien plus loin au nord-est, ambiance
      // plus rurale et stratégique.
      { name: 'Kongoussi', x1: 490, y1: 25, x2: 550, y2: 85, type: 'residentiel', density: 0.2 },
    ];
    // Major road axes
    this.roadAxes = [
      { axis: 'x', pos: 60, density: 0.4 }, { axis: 'x', pos: 120, density: 0.6 }, { axis: 'x', pos: 180, density: 0.4 },
      { axis: 'y', pos: 60, density: 0.4 }, { axis: 'y', pos: 120, density: 0.6 }, { axis: 'y', pos: 180, density: 0.4 },
    ];
    // Base roads
    for (let x = 0; x < this.W; x++) {
      for (const ax of this.roadAxes) {
        if (ax.axis === 'y' && Math.abs(x - ax.pos) <= 2) this.setTile(x, ax.pos, 'route');
        if (ax.axis === 'x' && Math.abs(x - ax.pos) <= 2) this.setTile(ax.pos, x, 'route');
      }
    }
    // District tiles
    for (const d of this.districts) this.fillDistrict(d);
    // Plan d'eau (la mer, au sud du quartier portuaire) : la baignade, la
    // nage et le fait de boire de l'eau en ont besoin pour exister quelque part.
    this.generateWater();
    // Nouveaux quartiers dans l'espace ajouté par l'agrandissement de la ville
    this.generateExpansionDistricts();
    // Les villes lointaines (Bobo-Dioulasso, Kongoussi) sont au-delà de la
    // banlieue développée : on les (re)pose proprement, avec deux axes internes
    // pour pouvoir y circuler, en s'assurant qu'aucune extension ne les a écrasées.
    ['Bobo-Dioulasso', 'Kongoussi'].forEach(nm => {
      const d = this.districts.find(x => x.name === nm);
      if (!d) return;
      this.fillDistrict(d);
      const mx = Math.floor((d.x1 + d.x2) / 2), my = Math.floor((d.y1 + d.y2) / 2);
      for (let x = d.x1; x <= d.x2; x++) this.setTile(x, my, 'route');
      for (let y = d.y1; y <= d.y2; y++) this.setTile(mx, y, 'route');
    });
    // Generate houses
    this.generateHouses();
    // Generate POIs
    this.generatePOIs();
    // Generate mining sites
    this.generateMines();
    // Generate gangs
    this.generateGangs();
    // Generate NPCs
    this.generateNPCs();
    // Generate parked vehicles
    this.generateParkedVehicles();
    // Véhicules de police devant les commissariats et la prison
    City.pois.filter(p => p.type === 'police' || p.type === 'prison').forEach((p, i) => {
      const id = 'police_veh_' + i;
      if (!City.vehicles.find(v => v.id === id)) {
        City.vehicles.push({ id, type: 'police', name: VEHICLE_CATALOG.police.name, x: p.x + 2, y: p.y + 2, fuel: 1, hp: 100, locked: false, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: VEHICLE_CATALOG.police.price, trunk: VEHICLE_CATALOG.police.trunk, passengers: [], openDoors: new Set(), siren: false });
      }
    });

    // Generate missions
    this.generateMissions();

    // Point d'arrivée : c'est là qu'atterrit tout nouveau joueur, près de
    // l'aéroport (il « débarque » en ville). Case libre à côté de l'aérogare.
    const airport = this.pois.find(p => p.type === 'aeroport' && p.name === 'Aéroport') || this.pois.find(p => p.type === 'aeroport');
    const airportD = this.districts.find(d => d.name === 'Aéroport');
    if (airport) this.spawnPoint = this.findFree(airport.x - 3, airport.y - 3, airport.x + 3, airport.y + 3);
    else if (airportD) this.spawnPoint = this.findFree(airportD.x1 + 2, airportD.y1 + 2, airportD.x2 - 2, airportD.y2 - 2);
    else this.spawnPoint = { x: 120, y: 120 };
  },

  setTile(x, y, t) { if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.grid.set(UTIL.gridKey(x, y), t); },
  // La mer : une large bande d'eau au sud du quartier portuaire.
  generateWater() {
    const port = this.districts.find(d => d.type === 'port');
    if (!port) return;
    for (let x = port.x1 - 8; x <= port.x2 + 8; x++) {
      for (let y = port.y2 + 1; y <= port.y2 + 22; y++) {
        this.setTile(x, y, 'eau');
      }
    }
  },
  getTile(x, y) { return this.grid.get(UTIL.gridKey(x, y)) || 'vide'; },
  isRoad(x, y) { const t = this.getTile(x, y); return t === 'route' || t === 'autoroute'; },
  isSolid(x, y) { return this.solidTypes.has(this.getTile(x, y)); },
  isFree(x, y) { return !this.isSolid(x, y) && this.getTile(x, y) !== 'eau'; },
  findFree(x1, y1, x2, y2) {
    for (let i = 0; i < 200; i++) {
      const x = UTIL.randInt(x1, x2), y = UTIL.randInt(y1, y2);
      if (this.isFree(x, y) && !this.isRoad(x, y)) return { x, y };
    }
    return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
  },

  fillDistrict(d) {
    for (let x = d.x1; x <= d.x2; x++) {
      for (let y = d.y1; y <= d.y2; y++) {
        if (this.getTile(x, y) !== 'route') this.setTile(x, y, d.type);
      }
    }
  },
  // Peuple l'espace ajouté par un agrandissement de la ville (voir CONFIG.W/H)
  // avec de nouveaux quartiers variés, connectés par une route principale.
  generateExpansionDistricts() {
    const OLD_W = 240, OLD_H = 240; // taille d'origine, avant agrandissement
    // On ne développe la banlieue que jusqu'ici : au-delà, on laisse du terrain
    // sauvage qui ISOLE les villes lointaines (Bobo-Dioulasso, Kongoussi), pour
    // qu'on ne s'y rende de façon réaliste que par la voie des airs.
    const DEV = 420;
    const devW = Math.min(this.W, DEV), devH = Math.min(this.H, DEV);
    if (devW <= OLD_W && devH <= OLD_H) return; // rien à ajouter
    // Route principale de jonction entre l'ancienne et la nouvelle zone
    for (let x = 0; x < devW; x++) this.setTile(x, Math.min(OLD_H + 5, devH - 1), 'route');
    for (let y = 0; y < devH; y++) this.setTile(Math.min(OLD_W + 5, devW - 1), y, 'route');
    // Bande est (à droite de l'ancienne ville)
    if (devW > OLD_W) {
      const types = ['residentiel', 'commercial', 'industriel', 'parc'];
      const step = Math.floor(devH / types.length);
      types.forEach((type, i) => {
        this.addDistrict(`Extension Est ${i + 1}`, type, OLD_W + 10, i * step + 5, devW - 5, Math.min(devH - 5, (i + 1) * step - 5));
      });
    }
    // Bande sud (en dessous de l'ancienne ville)
    if (devH > OLD_H) {
      const types = ['residentiel', 'commercial', 'port'];
      const step = Math.floor(OLD_W / types.length);
      types.forEach((type, i) => {
        this.addDistrict(`Extension Sud ${i + 1}`, type, i * step + 5, OLD_H + 10, Math.min(OLD_W - 5, (i + 1) * step - 5), devH - 5);
      });
    }
  },

  // --- Agrandissement de la ville (réservé au mode staff) ---
  // Étend la carte sur un côté (est = plus de largeur, sud = plus de hauteur)
  // pour libérer de l'espace neuf où placer un quartier. N'efface jamais
  // l'existant : uniquement additif.
  growCity(extra, direction) {
    if (direction === 'sud') { this.H += extra; CONFIG.H = this.H; }
    else { this.W += extra; CONFIG.W = this.W; }
    return { W: this.W, H: this.H };
  },
  // Ajoute un nouveau quartier dans l'espace neuf (ou tout espace libre donné),
  // avec une route de desserte simple au centre pour la connectivité.
  addDistrict(name, type, x1, y1, x2, y2) {
    const d = { name, x1, y1, x2, y2, type, density: 0.35 };
    this.districts.push(d);
    this.fillDistrict(d);
    const midX = Math.floor((x1 + x2) / 2), midY = Math.floor((y1 + y2) / 2);
    for (let x = x1; x <= x2; x++) this.setTile(x, midY, 'route');
    for (let y = y1; y <= y2; y++) this.setTile(midX, y, 'route');
    return d;
  },
  // Ajoute un service (boutique, restaurant, garage, banque, hôpital...) dans
  // un quartier existant (nouveau ou ancien), à un endroit libre.
  addPOI(name, type, districtName, floors) {
    const d = this.districts.find(x => x.name === districtName) || this.districts[0];
    const pos = this.findFree(d.x1 + 2, d.y1 + 2, d.x2 - 2, d.y2 - 2);
    this.setTile(pos.x, pos.y, type);
    const poi = { id: type + '_custom_' + Date.now(), name, type, x: pos.x, y: pos.y, floors: floors || 1, stock: [] };
    this.assignPOIStock(poi); // stock selon le type (sinon boutique vide, rien à acheter)
    this.pois.push(poi);
    return poi;
  },

  generateHouses() {
    for (let i = 0; i < CONFIG.HOUSE_COUNT; i++) {
      const d = UTIL.pick(this.districts.filter(d => d.type === 'residentiel')) || this.districts[1];
      const pos = this.findFree(d.x1 + 2, d.y1 + 2, d.x2 - 2, d.y2 - 2);
      if (!this.isRoad(pos.x + 1, pos.y) && !this.isRoad(pos.x - 1, pos.y) && !this.isRoad(pos.x, pos.y + 1) && !this.isRoad(pos.x, pos.y - 1)) {
        // place a small road nearby
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.random() < 0.08) this.setTile(pos.x + dx, pos.y + dy, 'rue');
      }
      this.setTile(pos.x, pos.y, 'maison');
      const floors = UTIL.randInt(1, 3);
      // Prix immobilier réaliste : une maison est un gros investissement (des
      // millions), variable selon le nombre d'étages et le standing du quartier,
      // avec un peu d'aléa. (Avant : 450 000 à 750 000 FCFA, dérisoire.)
      const dn = (d && d.name) || '';
      const districtMult = /Gounghin/i.test(dn) ? 1.6 : /Cissin/i.test(dn) ? 1.3 : /Koulouba/i.test(dn) ? 1.15 : /A[ée]roport/i.test(dn) ? 0.9 : 1.0;
      const base = 6000000 + floors * 4000000; // 10 M / 14 M / 18 M avant quartier et aléa
      const price = Math.round(base * districtMult * UTIL.rand(0.85, 1.2) / 100000) * 100000;
      this.houses.push({ id: 'maison_' + i, x: pos.x, y: pos.y, floors, owner: null, price, capacity: 40 + floors * 20, name: `Maison ${i + 1}`, storage: [], authorizedUsers: [] });
    }
  },

  generatePOIs() {
    const add = (name, type, dName, count, extra) => {
      for (let i = 0; i < count; i++) {
        const d = this.districts.find(x => x.name === dName) || this.districts[0];
        const pos = this.findFree(d.x1 + 2, d.y1 + 2, d.x2 - 2, d.y2 - 2);
        this.setTile(pos.x, pos.y, type);
        this.pois.push({ id: type + '_' + i, name, type, x: pos.x, y: pos.y, floors: type === 'immeuble' ? UTIL.randInt(2, CONFIG.MAX_HEIGHT) : 1, stock: [], ...(extra || {}) });
      }
    };
    add('Commissariat central', 'police', 'Koulouba', CONFIG.POLICE_STATIONS);
    add('Prison centrale', 'prison', 'Zone industrielle de Kossodo', 1);
    add('Hôpital central', 'hopital', 'Koulouba', CONFIG.HOSPITALS);
    add('Banque', 'banque', 'Koulouba', 2);
    add('QG des missions extrêmes', 'qg_extreme', 'Zone industrielle de Kossodo', 1);
    add('Auto-école', 'auto_ecole', 'Koulouba', 1);
    add('École de pilotage', 'ecole_pilotage', 'Aéroport', 1);
    // Lieux emblématiques de la cité.
    add('Cour Pénale', 'tribunal', 'Koulouba', 1);
    add('Monument de la Musique', 'monument', 'Koulouba', 1);
    add('Gouvernorat', 'gouvernorat', 'Koulouba', 1);
    add('Morgue', 'morgue', 'Koulouba', 1);
    add('Cimetière', 'cimetiere', 'Gounghin', 1);
    // Profil de sécurité propre à chaque banque : ce n'est jamais la même
    // routine d'un braquage à l'autre. Révélé au joueur via le repérage.
    this.pois.filter(p => p.type === 'banque').forEach(p => {
      p.vaultType = UTIL.pick(['mecanique', 'electronique', 'renforce']);
      p.guards = UTIL.randInt(0, 3);
      p.cameras = Math.random() < 0.6;
    });
    add('Armurerie', 'armurerie', 'Koulouba', 2);
    add('Armurerie de Gounghin', 'armurerie', 'Gounghin', 1);
    add('Supermarché', 'magasin', 'Koulouba', 3);
    add('Marché de Gounghin', 'magasin', 'Gounghin', 2);
    add('Restaurant', 'restaurant', 'Koulouba', 4);
    add('Restaurant de Gounghin', 'restaurant', 'Gounghin', 3);
    add('Boutique de vêtements', 'vetements', 'Koulouba', 3);
    add('Boutique de vêtements de Gounghin', 'vetements', 'Gounghin', 2);
    add('Boutique de vêtements de Tampouy', 'vetements', 'Tampouy', 1);
    add('Pharmacie', 'pharmacie', 'Koulouba', 3);
    add('Pharmacie de Tampouy', 'pharmacie', 'Tampouy', 1);
    add('Concessionnaire', 'concessionnaire', 'Gounghin', 2);
    add('Aéroport', 'aeroport', 'Aéroport', 1);
    add('Héliport', 'heliport', 'Aéroport', 1);
    add('Héliport de Koulouba', 'heliport', 'Koulouba', 1);
    add('Port du barrage', 'port', 'Zone du barrage', 2);
    add('Station-service', 'station_essence', 'Gounghin', 3);
    add('Station-service de Koulouba', 'station_essence', 'Koulouba', 2);
    // Parkings principaux : les 3 seuls parkings-relais de la ville où un
    // véhicule possédé peut être livré par un chauffeur PNJ via le téléphone
    // (voir Game.requestVehicleDelivery). Les autres "Parking de X" restent de
    // simples emplacements de stationnement, sans service de livraison.
    add('Parking principal 1', 'garage', 'Zone industrielle de Kossodo', 1, { principal: true });
    add('Parking de Kossodo', 'garage', 'Zone industrielle de Kossodo', 1);
    add('Parking principal 2', 'garage', 'Koulouba', 1, { principal: true });
    add('Parking de Koulouba', 'garage', 'Koulouba', 1);
    add('Parking principal 3', 'garage', 'Gounghin', 1, { principal: true });
    // Atelier de réparation : lieu de travail des garagistes, et service de
    // réparation fiable pour tous. Un seul pour l'instant — facile d'en
    // ajouter d'autres plus tard en dupliquant cette ligne avec un autre nom
    // et un autre quartier.
    add('Atelier de réparation 1', 'atelier', 'Zone industrielle de Kossodo', 1);
    add('Entrepôt', 'entrepot', 'Zone industrielle de Kossodo', 4);
    add('Usine', 'usine', 'Zone industrielle de Kossodo', 3);
    add('Bar', 'bar', 'Gounghin', 2);
    add('Bar de Koulouba', 'bar', 'Koulouba', 2);
    // Chien guide : où l'acheter/l'équiper (animalerie) et le soigner (vétérinaire).
    add('Animalerie', 'animalerie', 'Gounghin', 1);
    add('Animalerie de Koulouba', 'animalerie', 'Koulouba', 1);
    add('Vétérinaire', 'veterinaire', 'Koulouba', 1);
    add('Vétérinaire de Gounghin', 'veterinaire', 'Gounghin', 1);
    add('Marché noir', 'marche_noir', 'Cissin', 1);
    add('Marché noir international', 'marche_noir_lointain', 'Bobo-Dioulasso', 1);
    add('Immeuble', 'immeuble', 'Koulouba', 6);
    add('Immeuble de Tampouy', 'immeuble', 'Tampouy', 4);
    add('Immeuble de Ouaga 2000', 'immeuble', 'Ouaga 2000', 3);
    add('Tour de guet', 'tour', 'Zone minière', 2);
    add('Tour de guet de Cissin', 'tour', 'Cissin', 2);
    // --- Bobo-Dioulasso (2e ville) : commerce, transport, un peu de tout ---
    add('Aéroport de Bobo-Dioulasso', 'aeroport', 'Bobo-Dioulasso', 1);
    add('Héliport de Bobo-Dioulasso', 'heliport', 'Bobo-Dioulasso', 1);
    add('Grand marché de Bobo', 'magasin', 'Bobo-Dioulasso', 2);
    add('Restaurant de Bobo', 'restaurant', 'Bobo-Dioulasso', 2);
    add('Station-service de Bobo', 'station_essence', 'Bobo-Dioulasso', 1);
    add('Parking de Bobo', 'garage', 'Bobo-Dioulasso', 1);
    add('Boutique de vêtements de Bobo', 'vetements', 'Bobo-Dioulasso', 1);
    add('Pharmacie de Bobo', 'pharmacie', 'Bobo-Dioulasso', 1);
    add('Banque de Bobo', 'banque', 'Bobo-Dioulasso', 1);
    add('Concessionnaire de Bobo', 'concessionnaire', 'Bobo-Dioulasso', 1);
    // --- Kongoussi (3e ville, plus rurale et stratégique) ---
    add('Héliport de Kongoussi', 'heliport', 'Kongoussi', 1);
    add('Marché de Kongoussi', 'magasin', 'Kongoussi', 1);
    add('Station-service de Kongoussi', 'station_essence', 'Kongoussi', 1);
    add('Parking de Kongoussi', 'garage', 'Kongoussi', 1);
    add('Restaurant de Kongoussi', 'restaurant', 'Kongoussi', 1);
    add('Pharmacie de Kongoussi', 'pharmacie', 'Kongoussi', 1);
    // Terrain agricole : là où l'on prépare une parcelle et sème des graines
    // (achetées au marché noir) pour cultiver de la drogue — zone rurale,
    // volontairement pas chez soi.
    add('Terrain agricole de Kongoussi', 'terrain_agricole', 'Kongoussi', 2);
    // Populate shop stocks
    for (const p of this.pois) this.assignPOIStock(p);
  },
  // Remplit le stock d'un POI selon son type. Réutilisé pour les commerces
  // ajoutés via le panneau administrateur (sinon leur stock restait vide et
  // l'on ne pouvait rien y acheter).
  assignPOIStock(p) {
    if (p.type === 'magasin') p.stock = this.generateStock('food+general', 40);
    else if (p.type === 'armurerie') p.stock = this.generateStock('legal_weapons', 15);
    else if (p.type === 'marche_noir') p.stock = [...this.generateStock('illegal_weapons', 25),
      { id: 'cagoule', name: 'Cagoule', category: 'masque', price: 8000, q: 99, legal: false, desc: 'Cache votre visage : plus personne ne peut vous identifier ni deviner votre métier, même un uniforme de policier caché dessous.' },
      { id: 'graines_herbe', name: 'Graines de chanvre', category: 'graine', price: 20000, q: 99, legal: false, desc: 'À semer sur un terrain agricole (zones rurales) pour cultiver de l\'herbe. Illégal : la récolte attire parfois l\'attention de la police.' },
      { id: 'menottes', name: 'Menottes', category: 'outil', price: 9000, q: 99, legal: false, desc: 'Pour immobiliser une cible (menotter/démenotter, touche U). Les forces de l\'ordre en sont déjà équipées d\'office ; les civils doivent se les procurer ici.' },
      // Casque/gilet blindé : retirés du menu principal, uniquement disponibles
      // ici (protection lourde = marché noir, pas une simple boutique légale).
      { id: 'casque_protection', name: 'Casque de protection', category: 'protection', price: 120000, q: 1, legal: false, special: 'helmet', desc: 'Protège d\'un tir ou d\'un coup à la tête, sinon mortel.' },
      { id: 'gilet_pareballes', name: 'Gilet pare-balles', category: 'protection', price: 150000, q: 1, legal: false, special: 'vest', desc: 'Réduit les dégâts d\'un tir au corps.' },
    ];
    else if (p.type === 'marche_noir_lointain') p.stock = [...this.generateStock('illegal_weapons', 35),
      { id: 'cagoule', name: 'Cagoule', category: 'masque', price: 8000, q: 99, legal: false, desc: 'Cache votre visage : plus personne ne peut vous identifier ni deviner votre métier.' },
      { id: 'graines_herbe', name: 'Graines de chanvre', category: 'graine', price: 20000, q: 99, legal: false, desc: 'À semer sur un terrain agricole (zones rurales) pour cultiver de l\'herbe. Illégal : la récolte attire parfois l\'attention de la police.' },
      { id: 'menottes', name: 'Menottes', category: 'outil', price: 9000, q: 99, legal: false, desc: 'Pour immobiliser une cible (menotter/démenotter, touche U). Les forces de l\'ordre en sont déjà équipées d\'office ; les civils doivent se les procurer ici.' },
      { id: 'casque_protection', name: 'Casque de protection', category: 'protection', price: 120000, q: 1, legal: false, special: 'helmet', desc: 'Protège d\'un tir ou d\'un coup à la tête, sinon mortel.' },
      { id: 'gilet_pareballes', name: 'Gilet pare-balles', category: 'protection', price: 150000, q: 1, legal: false, special: 'vest', desc: 'Réduit les dégâts d\'un tir au corps.' },
    ];
    else if (p.type === 'pharmacie') p.stock = this.generateStock('medical', 20);
    else if (p.type === 'restaurant') p.stock = this.generateStock('food', 25);
    else if (p.type === 'vetements') p.stock = this.generateStock('clothes', 30);
    else if (p.type === 'concessionnaire') p.stock = [];
    else if (p.type === 'police') p.stock = [{ id: 'uniforme_police', name: 'Uniforme de police', category: 'vetement_police', price: 15000, q: 99, legal: true, desc: 'Tenue officielle, réservée aux policiers en service. Reconnaissable par tous, décrite comme telle.' }];
  },

  generateStock(kind, count) {
    const stock = [];
    if (kind.includes('food') || kind === 'general') {
      const items = SHOP_CATALOG.filter(i => i.category === 'viande' || i.category === 'poisson' || i.category === 'fruit' || i.category === 'legume' || i.category === 'boisson' || i.category === 'pain' || i.category === 'plat' || i.category === 'divers');
      for (let i = 0; i < count; i++) { const it = UTIL.pick(items); stock.push({ ...it, q: UTIL.randInt(1, 20), price: Math.floor(it.price * UTIL.rand(0.7, 1.3)) }); }
    }
    if (kind.includes('clothes') || kind === 'general') {
      const items = SHOP_CATALOG.filter(i => ['vetement','pantalon','sous-vetement','chaussure','accessoire'].includes(i.category));
      for (let i = 0; i < count; i++) { const it = UTIL.pick(items); stock.push({ ...it, q: UTIL.randInt(1, 8), price: Math.floor(it.price * UTIL.rand(0.6, 1.2)) }); }
    }
    if (kind === 'legal_weapons') {
      for (const [k, w] of Object.entries(WEAPON_CATALOG)) if (w.legal) stock.push({ ...w, id: k, category: 'arme', q: UTIL.randInt(1, 3), price: w.price });
      for (const [k, a] of Object.entries(AMMO_CATALOG)) if (a.legal) stock.push({ ...a, id: 'ammo_' + k, q: UTIL.randInt(10, 100), price: a.price, category: 'munition' });
    }
    if (kind === 'illegal_weapons') {
      for (const [k, w] of Object.entries(WEAPON_CATALOG)) if (!w.legal) stock.push({ ...w, id: k, category: 'arme', q: UTIL.randInt(1, 2), price: Math.floor(w.price * 1.4) });
      for (const [k, a] of Object.entries(AMMO_CATALOG)) if (!a.legal) stock.push({ ...a, id: 'ammo_' + k, q: UTIL.randInt(5, 80), price: Math.floor(a.price * 1.5), category: 'munition' });
      // black market goods
      const items = SHOP_CATALOG.filter(i => i.category === 'outil' || i.category === 'electronique');
      for (let i = 0; i < 10; i++) { const it = UTIL.pick(items); stock.push({ ...it, q: 1, price: Math.floor(it.price * 0.5) }); }
      stock.push({ id: 'grenade', name: 'Grenade', category: 'explosif', price: 180000, q: UTIL.randInt(1, 3), size: 1, legal: false });
      // Stupéfiants : illégaux, revendables (voir la revente aux passants) et
      // consommables (effet passager). À manier avec prudence : détenir ou
      // vendre attire la police.
      for (const drug of DRUG_CATALOG) stock.push({ ...drug, q: UTIL.randInt(2, 12), price: Math.floor(drug.price * UTIL.rand(0.8, 1.3)) });
    }
    if (kind === 'medical') {
      const items = SHOP_CATALOG.filter(i => i.category === 'medicament');
      for (let i = 0; i < count; i++) { const it = UTIL.pick(items); stock.push({ ...it, q: UTIL.randInt(1, 10), price: Math.floor(it.price * 0.9) }); }
    }
    return stock;
  },

  generateMines() {
    for (let i = 0; i < CONFIG.MINING_SITES; i++) {
      const d = this.districts.find(x => x.type === 'zone_miniere') || this.districts[0];
      const pos = this.findFree(d.x1 + 5, d.y1 + 5, d.x2 - 5, d.y2 - 5);
      this.setTile(pos.x, pos.y, 'mine');
      for (let r = 0; r < 3; r++) this.setTile(pos.x + r, pos.y + r, 'mine');
      const resources = ['or', 'diamant', 'fer', 'charbon', 'pierre précieuse'];
      this.miningSites.push({ id: 'mine_' + i, name: `Site minier ${i + 1}`, x: pos.x, y: pos.y, resource: UTIL.pick(resources), yield: UTIL.randInt(50, 300), risk: UTIL.randInt(10, 60), guards: UTIL.randInt(0, 3) });
    }
  },

  generateGangs() {
    const names = ['Les Loups Rouges', 'Mains Noires', 'Cartel du Sud', 'Vipères Bleues', 'Requins de la Nuit'];
    for (let i = 0; i < CONFIG.GANG_COUNT; i++) {
      const d = this.districts.find(x => x.type === 'ghetto') || this.districts[0];
      const pos = this.findFree(d.x1 + 3, d.y1 + 3, d.x2 - 3, d.y2 - 3);
      this.setTile(pos.x, pos.y, 'gang_hideout');
      this.gangs.push({ id: 'gang_' + i, name: names[i % names.length], x: pos.x, y: pos.y, power: UTIL.randInt(20, 80), relation: -20, members: UTIL.randInt(3, 8) });
    }
  },

  generateNPCs() {
    const jobs = ['medecin','civil','mecanicien','commercant','vendeur','chauffeur','livreur','etudiant','employe','retraite','sans_abri','ganger','mineur','douanier','pilote','marin','garde','journaliste','artiste'];
    const first = ['Amadou','Fatou','Koffi','Awa','Issa','Mariam','Blaise','Yasmine','Seydou','Rose','Emile','Aminata','Jean','Aïcha','Modibo','Grace','Paul','Esther','Karim','Nadia'];
    const last = ['Koné','Bamba','Diallo','Ouattara','Kouassi','Touré','Fofana','Coulibaly','Kaba','Sylla','Mendy','Sow','Fall','Ndiaye','Bah','Traoré'];
    for (let i = 0; i < CONFIG.NPC_COUNT; i++) {
      const job = UTIL.pick(jobs);
      const d = UTIL.pick(this.districts);
      const pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
      const npc = {
        id: 'npc_' + i, name: `${UTIL.pick(first)} ${UTIL.pick(last)}`, job, x: pos.x, y: pos.y,
        health: 100, relation: UTIL.randInt(-20, 30), money: UTIL.randInt(500, 30000), inCar: false,
        dialogue: this.generateDialogue(job), home: pos, hostile: job === 'ganger' || job === 'garde',
        weapon: job === 'ganger' ? UTIL.pick(['pistolet_9','ak47','pompe']) : null,
        gender: UTIL.pick(['homme', 'femme']), outfit: generateNPCAppearance(job),
      };
      this.npcs.push(npc);
    }
  },

  generateDialogue(job) {
    const map = {
      medecin: ['Bonne santé !','Je soigne les blessés.','Passez à l\'hôpital.'],
      civil: ['Belle journée.','Je vais au travail.','Pardon.'],
      mecanicien: ['Votre moteur couine ?','J\'ai des pièces.','Garage ouvert.'],
      commercant: ['Bon prix pour vous.','Achetez deux, payez un.','Bienvenue.'],
      vendeur: ['Promotion aujourd\'hui.','C\'est du bon.','Voulez-vous voir ?'],
      chauffeur: ['Besoin d\'une course ?','Taxi !','Où aller ?'],
      livreur: ['Livraison en cours.','Colis fragile.','Attendez un instant.'],
      etudiant: ['J\'ai un examen.','La bibliothèque est là-bas.','Tu connais la réponse ?'],
      employe: ['Le patron veut tout.','Pause café.','Encore des heures sup.'],
      retraite: ['Le temps passe.','Autrefois c\'était mieux.','Bonne journée.'],
      sans_abri: ['Une pièce s\'il vous plaît.','J\'ai faim.','Merci.'],
      ganger: ['C\'est mon territoire.','Tu cherches les problèmes ?','File ou je tire.'],
      mineur: ['La mine est dangereuse.','J\'ai trouvé de l\'or.','Besoin de renfort.'],
      douanier: ['Passeports.','Rien à déclarer ?','Contrôle douanier.'],
      pilote: ['Voulez-vous voler ?','L\'avion est prêt.','Destination ?'],
      marin: ['Le port est actif.','La mer est calme.','Bienvenue à bord.'],
      garde: ['Halte.','Zone interdite.','Reculez.'],
      journaliste: ['Une info ?','Je cherche un scoop.','Parlez-moi.'],
      artiste: ['L\'art sauve.','J\'expose demain.','La ville est belle.'],
    };
    return map[job] || ['Bonjour.'];
  },

  generateParkedVehicles() {
    const types = Object.keys(VEHICLE_CATALOG);
    for (let i = 0; i < 60; i++) {
      const d = UTIL.pick(this.districts);
      const pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
      const type = UTIL.pick(types);
      const cls = VEHICLE_CATALOG[type];
      this.vehicles.push({ id: 'veh_' + i, type, name: cls.name, x: pos.x, y: pos.y, fuel: UTIL.rand(0.3, 1.0), hp: 100, locked: true, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: cls.price, trunk: cls.trunk, passengers: [], openDoors: new Set(), siren: false });
    }
  },

  generateMissions() {
    const templates = [
      { title: 'Livraison express', desc: 'Transporte un colis à l\'adresse indiquée sans te faire arrêter.', reward: 35000, type: 'transport', danger: 10 },
      { title: 'Convoyage sous tension', desc: 'Récupère le véhicule signalé et livre-le intact à l\'entrepôt indiqué, sans te faire remarquer.', reward: 90000, type: 'convoyage', danger: 65 },
      { title: 'Colis fragile', desc: 'Livre ce colis fragile avant la fin du temps imparti, à pied ou en véhicule léger. Chaque choc risque de l\'abîmer.', reward: 20000, type: 'colis_fragile', danger: 5 },
      { title: 'Course VIP soignée', desc: 'Conduis ce client à destination sans le secouer : chaque choc ou freinage brutal réduit sa satisfaction, et votre pourboire.', reward: 30000, type: 'taxi_soigne', danger: 5 },
      { title: 'Objet perdu', desc: 'Un habitant a perdu un objet quelque part dans le quartier. Utilisez le radar de balayage (F) pour le repérer au son.', reward: 15000, type: 'objet_perdu', danger: 0 },
      { title: 'Filature discrète', desc: 'Suivez ce suspect sans vous faire repérer : ni trop près, ni trop loin, jusqu\'à découvrir sa destination.', reward: 45000, type: 'filature', danger: 25 },
      { title: 'Escorte sous menace', desc: 'Escortez ce client menacé jusqu\'à destination. Une embuscade armée peut survenir : protégez-le, s\'il meurt la mission échoue.', reward: 130000, type: 'escorte', danger: 70 },
      { title: 'Contrebande', desc: 'Transportez cette cargaison illégale sans vous faire arrêter à un contrôle de police.', reward: 100000, type: 'contrebande', danger: 60 },
      { title: 'Urgence médicale', desc: 'Localisez ce blessé au radar et conduisez-le à l\'hôpital avant qu\'il ne soit trop tard. Chaque choc aggrave son état.', reward: 55000, type: 'urgence_medicale', danger: 30 },
      { title: 'Course clandestine', desc: 'Affrontez un vrai rival jusqu\'à l\'arrivée. Premier arrivé gagne. Rouler dangereusement près des piétons attire la police.', reward: 70000, type: 'course_clandestine', danger: 40 },
      { title: 'Sabotage industriel', desc: 'Infiltrez ce site gardé par des patrouilles réelles et atteignez l\'objectif sans vous faire repérer.', reward: 110000, type: 'sabotage', danger: 65 },
      { title: 'Chasse aux primes', desc: 'Ramenez ce fugitif vivant au commissariat. Affaiblissez-le sans le tuer, menottez-le, et surveillez-le pendant le transport.', reward: 95000, type: 'chasse_primes', danger: 55 },
      { title: 'Défense de territoire', desc: 'Un repaire va être attaqué par vagues, depuis 3 entrées à la fois. Il faut un joueur réel posté à chacune en même temps : impossible seul.', reward: 250000, type: 'defense_territoire', danger: 90, extreme: true },
      { title: 'Casse à deux rôles', desc: 'La banque a un verrou électronique et un verrou mécanique, à deux endroits séparés. Il faut un joueur réel à chaque poste en même temps, sinon tout se réinitialise.', reward: 350000, type: 'casse_extreme', danger: 95, extreme: true },
      { title: 'Attaque de convoi blindé', desc: 'Un convoi a un garde avant et un garde arrière. Il faut engager les deux extrémités en même temps : le camp laissé seul reçoit du renfort.', reward: 300000, type: 'convoi_blinde', danger: 95, extreme: true },
      { title: 'Dépôt d\'armes de gang', desc: 'Un entrepôt gardé avec caméras, patrouille et coffre à gérer. Jouable seul en jonglant entre les trois, bien plus risqué.', reward: 320000, type: 'depot_armes_gang', danger: 95, extreme: true },
      { title: 'Extraction VIP', desc: 'Escortez une personne à exfiltrer à travers un quartier hostile jusqu\'au point d\'extraction. Jouable seul, très exposé.', reward: 290000, type: 'extraction_vip', danger: 90, extreme: true },
      { title: 'Braquage de supérette', desc: 'Videz la caisse d\'un magasin ou d\'une station-service. Rapide, mais très risqué si quelqu\'un vous voit.', reward: 60000, type: 'braquage_superette', danger: 55, extreme: true },
      { title: 'Go-fast', desc: 'Livrez une cargaison de stupéfiants à plusieurs points de dépose, vite et sans vous faire contrôler.', reward: 220000, type: 'gofast', danger: 70, extreme: true },
      { title: 'Planque gardée', desc: 'Un point précis où traîne du butin (argent, munitions, armes), gardé par des vigiles lourdement armés. Repérez-vous, ils attaquent : éliminez-les tous pour prendre le butin.', reward: 240000, type: 'planque_gardee', danger: 80, extreme: true },
      { title: 'Recel de véhicule', desc: 'Volez le véhicule précis demandé et livrez-le intact à un garage clandestin pour être payé.', reward: 150000, type: 'recel_vehicule', danger: 60, extreme: true },
      { title: 'Course de rue', desc: 'Gagne une course illégale contre un autre conducteur.', reward: 60000, type: 'race', danger: 30 },
      { title: 'Patrouille de police', desc: 'Aide la police à arrêter un suspect armé.', reward: 45000, type: 'police', danger: 50 },
      { title: 'Extraction minière', desc: 'Récupère des minerais rares dans un site gardé.', reward: 90000, type: 'mine', danger: 60 },
      { title: 'Gang démantelé', desc: 'Infiltre un repaire de gang et neutralise le chef.', reward: 150000, type: 'combat', danger: 80 },
      { title: 'Marché noir', desc: 'Achète ou vends une arme illégale sans te faire prendre.', reward: 70000, type: 'trade', danger: 45 },
      { title: 'Sauvetage médical', desc: 'Emmène un blessé à l\'hôpital avant qu\'il ne meure.', reward: 40000, type: 'medical', danger: 20 },
      { title: 'Transport aérien', desc: 'Vole un avion ou hélicoptère vers une zone isolée.', reward: 120000, type: 'air', danger: 55 },
      { title: 'Casse de banque', desc: 'Vole la banque centrale et fuis avec le butin.', reward: 300000, type: 'heist', danger: 95 },
      { title: 'Traque nocturne', desc: 'Trouve et élimine un repaire de criminels la nuit.', reward: 110000, type: 'hunt', danger: 70 },
      { title: 'Chauffeur VIP', desc: 'Conduis un client important jusqu\'à sa destination.', reward: 50000, type: 'taxi', danger: 15 },
      { title: 'Pêche au port', desc: 'Rapporte une cargaison de poisson au marché.', reward: 25000, type: 'fishing', danger: 5 },
      { title: 'Réparation urgente', desc: 'Répare un véhicule en panne sur la route.', reward: 20000, type: 'repair', danger: 10 },
      { title: 'Course de moto', desc: 'Gagne une course de moto contre un gang local.', reward: 80000, type: 'race', danger: 40 },
      { title: 'Surveillance aérienne', desc: 'Repère un objectif depuis un hélicoptère.', reward: 65000, type: 'air', danger: 35 },
      { title: 'Saisie de drogue', desc: 'Saisis un colis illégal avant qu\'il ne soit vendu.', reward: 85000, type: 'police', danger: 60 },
      { title: 'Escorte convoi', desc: 'Escorte un camion blindé avec la police.', reward: 100000, type: 'transport', danger: 50 },
      { title: 'Exploration minière', desc: 'Cartographie un nouveau site minier dangereux.', reward: 75000, type: 'mine', danger: 55 },
    ];
    for (let i = 0; i < Math.min(templates.length, CONFIG.MISSION_COUNT); i++) {
      const t = templates[i];
      let pos, extra = {};
      if (t.type === 'combat' && this.gangs.length) { pos = UTIL.pick(this.gangs); }
      else if (t.type === 'heist' && this.pois.some(p => p.type === 'banque')) { pos = UTIL.pick(this.pois.filter(p => p.type === 'banque')); }
      else if (t.type === 'convoyage') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const dropCandidates = this.pois.filter(p => p.type === 'entrepot' || p.type === 'garage');
        const drop = dropCandidates.length ? UTIL.pick(dropCandidates) : this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const vehicleTypes = ['berline', 'suv', 'electrique', 'camion'];
        const vType = UTIL.pick(vehicleTypes);
        const vid = 'mission_vehicle_' + i;
        this.vehicles.push({ id: vid, type: vType, name: VEHICLE_CATALOG[vType].name, x: pos.x, y: pos.y, fuel: 1, hp: 100, locked: true, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG[vType].trunk });
        extra = { vehicleId: vid, dropX: drop.x, dropY: drop.y, dropName: drop.name || 'Entrepôt indiqué' };
      }
      else if (t.type === 'colis_fragile' || t.type === 'objet_perdu') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        if (t.type === 'colis_fragile') {
          const d2 = UTIL.pick(this.districts);
          const drop = this.findFree(d2.x1 + 1, d2.y1 + 1, d2.x2 - 1, d2.y2 - 1);
          extra = { dropX: drop.x, dropY: drop.y, dropName: this.getDistrictAt(drop.x, drop.y).name };
        }
      }
      else if (t.type === 'taxi_soigne') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const d2 = UTIL.pick(this.districts);
        const drop = this.findFree(d2.x1 + 1, d2.y1 + 1, d2.x2 - 1, d2.y2 - 1);
        const clientId = 'mission_client_' + i;
        const gender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: clientId, name: `${UTIL.pick(['Rasmané', 'Alizèta', 'Sibiri', 'Poko', 'Wendkuni', 'Fanta'])} ${UTIL.pick(['Sawadogo', 'Yaméogo', 'Kafando', 'Tapsoba'])}`, job: 'client_vip', x: pos.x, y: pos.y, health: 100, relation: 20, money: 0, inCar: false, dialogue: ['Je suis pressé, mais roulez prudemment.'], home: pos, hostile: false, gender, outfit: generateNPCAppearance('civil') });
        extra = { clientId, dropX: drop.x, dropY: drop.y, dropName: this.getDistrictAt(drop.x, drop.y).name };
      }
      else if (t.type === 'filature') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const suspectId = 'mission_suspect_' + i;
        const gender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: suspectId, name: `${UTIL.pick(['Inconnu', 'Individu'])} suspect`, job: 'suspect', x: pos.x, y: pos.y, health: 100, relation: 0, money: 0, inCar: false, dialogue: [], home: pos, hostile: false, gender, outfit: generateNPCAppearance('civil') });
        extra = { suspectId };
      }
      else if (t.type === 'escorte') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const d2 = UTIL.pick(this.districts);
        const drop = this.findFree(d2.x1 + 1, d2.y1 + 1, d2.x2 - 1, d2.y2 - 1);
        const clientId = 'mission_escorte_' + i;
        const gender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: clientId, name: `${UTIL.pick(['Salifou', 'Delphine', 'Bassirou', 'Clarisse'])} ${UTIL.pick(['Kagambèga', 'Nana', 'Ouili'])}`, job: 'client_menace', x: pos.x, y: pos.y, health: 100, relation: 20, money: 0, inCar: false, dialogue: ['On me menace, protégez-moi.'], home: pos, hostile: false, gender, outfit: generateNPCAppearance('civil') });
        extra = { clientId, dropX: drop.x, dropY: drop.y, dropName: this.getDistrictAt(drop.x, drop.y).name };
      }
      else if (t.type === 'contrebande') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const d2 = UTIL.pick(this.districts);
        const drop = this.findFree(d2.x1 + 1, d2.y1 + 1, d2.x2 - 1, d2.y2 - 1);
        extra = { dropX: drop.x, dropY: drop.y, dropName: this.getDistrictAt(drop.x, drop.y).name, cargo: UTIL.pick(['armes', 'drogue']) };
      }
      else if (t.type === 'urgence_medicale') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const victimId = 'mission_victime_' + i;
        const gender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: victimId, name: `${UTIL.pick(['Un blessé', 'Une blessée'])}`, job: 'victime', x: pos.x, y: pos.y, health: 60, relation: 0, money: 0, inCar: false, dialogue: [], home: pos, hostile: false, gender, outfit: generateNPCAppearance('civil') });
        extra = { victimId };
      }
      else if (t.type === 'course_clandestine') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const d2 = UTIL.pick(this.districts);
        const drop = this.findFree(d2.x1 + 1, d2.y1 + 1, d2.x2 - 1, d2.y2 - 1);
        extra = { dropX: drop.x, dropY: drop.y, dropName: this.getDistrictAt(drop.x, drop.y).name, rivalName: `${UTIL.pick(['Karim', 'Zeynab', 'Lassina', 'Odette'])} "Le Fou du volant"` };
      }
      else if (t.type === 'sabotage') {
        const d = this.districts.find(x => x.type === 'industriel') || UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const objective = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const guardIds = [];
        const guardCount = UTIL.randInt(2, 3);
        for (let g = 0; g < guardCount; g++) {
          const wp1 = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
          const wp2 = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
          const guardId = `mission_guard_${i}_${g}`;
          const gender = UTIL.pick(['homme', 'femme']);
          this.npcs.push({ id: guardId, name: `${UTIL.pick(['Garde', 'Vigile'])} ${g + 1}`, job: 'garde', x: wp1.x, y: wp1.y, health: 100, relation: -30, money: 0, inCar: false, dialogue: [], home: wp1, hostile: true, weapon: 'pistolet_9', gender, outfit: generateNPCAppearance('garde'), patrol: [wp1, wp2], patrolIdx: 0 });
          guardIds.push(guardId);
        }
        extra = { objectiveX: objective.x, objectiveY: objective.y, guardIds };
      }
      else if (t.type === 'chasse_primes') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const fugitiveId = 'mission_fugitif_' + i;
        const gender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: fugitiveId, name: `${UTIL.pick(['Le Renard', 'Le Vipère', 'La Panthère'])}`, job: 'fugitif', x: pos.x, y: pos.y, health: 100, relation: -50, money: 0, inCar: false, dialogue: ['Vous ne m\'aurez pas !'], home: pos, hostile: true, weapon: 'revolver_38', gender, outfit: generateNPCAppearance('civil') });
        extra = { fugitiveId };
      }
      else if (t.type === 'defense_territoire') {
        const gang = UTIL.pick(this.gangs);
        pos = { x: gang.x, y: gang.y };
        const angles = [0, 2.4, 4.8]; // trois directions bien réparties autour du repaire
        const entrances = angles.map(a => ({
          x: UTIL.clamp(Math.round(gang.x + Math.cos(a) * 10), 0, this.W - 1),
          y: UTIL.clamp(Math.round(gang.y + Math.sin(a) * 10), 0, this.H - 1),
        }));
        extra = { entrances, gangName: gang.name };
      }
      else if (t.type === 'casse_extreme') {
        const bank = this.pois.find(p => p.type === 'banque') || { x: 120, y: 120 };
        pos = { x: bank.x, y: bank.y };
        const serverPoint = { x: UTIL.clamp(bank.x + 9, 0, this.W - 1), y: bank.y };
        const vaultPoint = { x: UTIL.clamp(bank.x - 9, 0, this.W - 1), y: bank.y };
        extra = { serverPoint, vaultPoint };
      }
      else if (t.type === 'convoi_blinde') {
        const d = UTIL.pick(this.districts);
        const base = this.findFree(d.x1 + 6, d.y1 + 6, d.x2 - 6, d.y2 - 6);
        pos = base;
        const frontPoint = { x: UTIL.clamp(base.x + 6, 0, this.W - 1), y: base.y };
        const rearPoint = { x: UTIL.clamp(base.x - 6, 0, this.W - 1), y: base.y };
        const frontIds = [], rearIds = [];
        for (let g = 0; g < 2; g++) {
          const gender1 = UTIL.pick(['homme', 'femme']);
          const fnpc = { id: `convoy_front_${i}_${g}`, name: `Garde avant ${g + 1}`, job: 'garde', gender: gender1, x: frontPoint.x, y: frontPoint.y, health: 100, relation: -80, money: 0, inCar: false, dialogue: [], home: frontPoint, hostile: true, weapon: UTIL.pick(['pistolet_9', 'pompe']), outfit: generateNPCAppearance('garde') };
          this.npcs.push(fnpc); frontIds.push(fnpc.id);
          const gender2 = UTIL.pick(['homme', 'femme']);
          const rnpc = { id: `convoy_rear_${i}_${g}`, name: `Garde arrière ${g + 1}`, job: 'garde', gender: gender2, x: rearPoint.x, y: rearPoint.y, health: 100, relation: -80, money: 0, inCar: false, dialogue: [], home: rearPoint, hostile: true, weapon: UTIL.pick(['uzi', 'ak47']), outfit: generateNPCAppearance('garde') };
          this.npcs.push(rnpc); rearIds.push(rnpc.id);
        }
        extra = { frontPoint, rearPoint, frontIds, rearIds };
      }
      else if (t.type === 'depot_armes_gang') {
        const d = this.districts.find(x => x.type === 'industriel') || UTIL.pick(this.districts);
        const base = this.findFree(d.x1 + 3, d.y1 + 3, d.x2 - 3, d.y2 - 3);
        pos = base;
        const camPoint = { x: UTIL.clamp(base.x + 7, 0, this.W - 1), y: base.y };
        const patrolPoint = { x: base.x, y: UTIL.clamp(base.y + 7, 0, this.H - 1) };
        const vaultPoint = { x: UTIL.clamp(base.x - 7, 0, this.W - 1), y: base.y };
        const guardId = 'depot_guard_' + i;
        const gender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: guardId, name: 'Garde de patrouille', job: 'garde', gender, x: patrolPoint.x, y: patrolPoint.y, health: 100, relation: -80, money: 0, inCar: false, dialogue: [], home: patrolPoint, hostile: true, weapon: 'pompe', outfit: generateNPCAppearance('garde') });
        extra = { camPoint, patrolPoint, vaultPoint, guardId };
      }
      else if (t.type === 'extraction_vip') {
        const d = this.districts.find(x => x.type === 'ghetto') || UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const d2 = UTIL.pick(this.districts);
        const extractPoint = this.findFree(d2.x1 + 1, d2.y1 + 1, d2.x2 - 1, d2.y2 - 1);
        const vipId = 'vip_' + i;
        const vipGender = UTIL.pick(['homme', 'femme']);
        this.npcs.push({ id: vipId, name: 'VIP à exfiltrer', job: 'civil', gender: vipGender, x: pos.x, y: pos.y, health: 100, relation: 30, money: 0, inCar: false, dialogue: ['Sortez-moi de là !'], home: pos, hostile: false, outfit: generateNPCAppearance('civil') });
        extra = { vipId, extractX: extractPoint.x, extractY: extractPoint.y, extractName: this.getDistrictAt(extractPoint.x, extractPoint.y).name };
      }
      else if (t.type === 'braquage_superette') {
        const targets = this.pois.filter(p => p.type === 'magasin' || p.type === 'station_essence');
        const target = targets.length ? UTIL.pick(targets) : this.findFree(90, 90, 150, 150);
        pos = { x: target.x, y: target.y };
        extra = { shopName: target.name || 'la boutique' };
      }
      else if (t.type === 'gofast') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const drops = [0, 1, 2].map(() => {
          const dd = UTIL.pick(this.districts);
          const p = this.findFree(dd.x1 + 1, dd.y1 + 1, dd.x2 - 1, dd.y2 - 1);
          return { x: p.x, y: p.y, name: this.getDistrictAt(p.x, p.y).name };
        });
        extra = { drops };
      }
      else if (t.type === 'planque_gardee') {
        const d = UTIL.pick(this.districts);
        const base = this.findFree(d.x1 + 2, d.y1 + 2, d.x2 - 2, d.y2 - 2);
        pos = base;
        const guardIds = [];
        const count = UTIL.randInt(2, 4);
        for (let g = 0; g < count; g++) {
          const gender = UTIL.pick(['homme', 'femme']);
          const npc = { id: `stash_guard_${i}_${g}`, name: `Vigile ${g + 1}`, job: 'garde', gender, x: UTIL.clamp(base.x + UTIL.randInt(-2, 2), 0, this.W - 1), y: UTIL.clamp(base.y + UTIL.randInt(-2, 2), 0, this.H - 1), health: 100, relation: -90, money: 0, inCar: false, dialogue: [], home: base, hostile: true, weapon: UTIL.pick(['uzi', 'ak47', 'pompe']), outfit: generateNPCAppearance('garde') };
          this.npcs.push(npc); guardIds.push(npc.id);
        }
        extra = { guardIds };
      }
      else if (t.type === 'recel_vehicule') {
        const d = UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
        const garages = this.pois.filter(p => p.type === 'garage');
        const drop = garages.length ? UTIL.pick(garages) : (() => { const dd = UTIL.pick(this.districts); return this.findFree(dd.x1 + 1, dd.y1 + 1, dd.x2 - 1, dd.y2 - 1); })();
        const vTypes = ['berline', 'suv', 'electrique', 'taxi'];
        const vType = UTIL.pick(vTypes);
        const vid = 'chop_vehicle_' + i;
        this.vehicles.push({ id: vid, type: vType, name: VEHICLE_CATALOG[vType].name, x: pos.x, y: pos.y, fuel: 1, hp: 100, locked: true, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG[vType].trunk });
        extra = { vehicleId: vid, vehicleTypeName: VEHICLE_CATALOG[vType].name, dropX: drop.x, dropY: drop.y, dropName: drop.name || 'le garage clandestin' };
      }
      // Une mission "mine" (Extraction/Exploration minière) DOIT pointer vers
      // un vrai site minier généré (this.miningSites, voir generateMines) —
      // sinon elle envoyait le joueur sur un point totalement quelconque
      // (souvent en pleine zone résidentielle), un lieu fictif où il n'y a
      // jamais eu la moindre mine.
      else if (t.type === 'mine' && this.miningSites.length) {
        const site = UTIL.pick(this.miningSites);
        pos = { x: site.x, y: site.y };
        extra = { miningSiteId: site.id };
      }
      // "Pêche au port" doit se dérouler près du VRAI quartier portuaire, pas
      // n'importe où en ville (même raison : un lieu fictif, sans eau ni port).
      else if (t.type === 'fishing') {
        const d = this.districts.find(x => x.type === 'port') || UTIL.pick(this.districts);
        pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1);
      }
      else { const d = UTIL.pick(this.districts); pos = this.findFree(d.x1 + 1, d.y1 + 1, d.x2 - 1, d.y2 - 1); }
      this.missions.push({ id: 'mission_' + i, ...t, x: pos.x, y: pos.y, ...extra, active: false, completed: false, giver: UTIL.pick(this.npcs).name });
    }
  },

  getDistrictAt(x, y) {
    for (const d of this.districts) if (x >= d.x1 && x <= d.x2 && y >= d.y1 && y <= d.y2) return d;
    return { name: 'Périphérie', type: 'peripherie' };
  },

  // ===== Économie de quartier réactive aux actions du joueur =====
  // "heat" monte avec les délits commis dans le quartier (les gens se
  // méfient, les commerces se couvrent) ; "saturation" monte quand on y
  // vend trop souvent au même endroit (le marché s'inonde). Les deux
  // redescendent lentement avec le temps réel — un effet durable, mais pas
  // permanent. Ce n'était auparavant qu'une table fixe par quartier, sans
  // aucun lien avec ce que le joueur y fait vraiment.
  districtEconomy: {},
  getDistrictEconomy(name) {
    this.districtEconomy[name] = this.districtEconomy[name] || { heat: 0, saturation: 0, lastDecay: Date.now() };
    const e = this.districtEconomy[name];
    const elapsedMin = (Date.now() - e.lastDecay) / 60000;
    if (elapsedMin > 0.01) {
      e.heat = Math.max(0, e.heat - elapsedMin);
      e.saturation = Math.max(0, e.saturation - elapsedMin * 2); // la saturation se résorbe plus vite qu'une réputation criminelle
      e.lastDecay = Date.now();
    }
    return e;
  },
  recordCrimeInDistrict(name) {
    const e = this.getDistrictEconomy(name);
    e.heat = Math.min(50, e.heat + 8);
  },
  recordSaleInDistrict(name) {
    const e = this.getDistrictEconomy(name);
    e.saturation = Math.min(50, e.saturation + 6);
  },
};

/* ============================================================
   ÉTAT DU JEU ET LOGIQUE CENTRALE
============================================================ */
