// Libellés lisibles des types de délits (utilisés pour les alertes police en
// direct ET pour le casier judiciaire — un type non listé ici garde son nom
// brut, ex. un type de mission illégale).
const CRIME_LABELS = { vol_vehicule: 'Vol de véhicule', braquage_banque: 'Braquage de banque', coups_de_feu: 'Coups de feu', explosion: 'Explosion / grenade', conduite_dangereuse: 'Conduite dangereuse', intrusion: 'Intrusion détectée', vol_main_armee: 'Vol à main armée' };

const VEHICLE_CATALOG = {
  velo: { name: 'Vélo', label: 'vélo', type: '2 roues', baseFreq: 28, mult: 12, wave: 'sine', maxSpeed: 0.55, accel: 0.09, brake: 0.06, turn: 1.0, offroad: 0.3, flies: false, wheels: 2, price: 300000, trunk: 8, seats: 1, doors: 0, noLicense: true, human: true },
  tricycle: { name: 'Tricycle', label: 'tricycle 3 roues', type: '3 roues', baseFreq: 50, mult: 30, wave: 'sawtooth', maxSpeed: 0.75, accel: 0.05, brake: 0.07, turn: 0.9, offroad: 0.4, flies: false, wheels: 3, price: 600000, trunk: 14, seats: 1, doors: 0 },
  quad: { name: 'Quad', label: 'quad 4 roues', type: '4 roues', baseFreq: 60, mult: 38, wave: 'sawtooth', maxSpeed: 0.95, accel: 0.07, brake: 0.08, turn: 1.1, offroad: 0.95, flies: false, wheels: 4, price: 1000000, trunk: 18, seats: 1, doors: 0 },
  moto_125: { name: 'Moto 125cc', label: 'moto 125cc', type: 'moto', baseFreq: 70, mult: 50, wave: 'square', maxSpeed: 1.05, accel: 0.09, brake: 0.1, turn: 1.2, offroad: 0.55, flies: false, wheels: 2, price: 350000, trunk: 10, seats: 2, doors: 0 },
  moto_600: { name: 'Moto 600cc', label: 'moto 600cc', type: 'moto', baseFreq: 85, mult: 62, wave: 'square', maxSpeed: 1.45, accel: 0.11, brake: 0.12, turn: 1.15, offroad: 0.5, flies: false, wheels: 2, price: 1200000, trunk: 10, seats: 2, doors: 0, sport: true, manualGearbox: true },
  moto_1000: { name: 'Moto 1000cc', label: 'moto 1000cc', type: 'moto', baseFreq: 100, mult: 72, wave: 'square', maxSpeed: 1.85, accel: 0.13, brake: 0.13, turn: 1.1, offroad: 0.45, flies: false, wheels: 2, price: 3500000, trunk: 10, seats: 2, doors: 0, sport: true, manualGearbox: true },
  scooter: { name: 'Scooter', label: 'scooter', type: '2 roues', baseFreq: 45, mult: 28, wave: 'sawtooth', maxSpeed: 0.8, accel: 0.06, brake: 0.08, turn: 1.0, offroad: 0.25, flies: false, wheels: 2, price: 250000, trunk: 8, seats: 2, doors: 0 },
  berline: { name: 'Berline', label: 'berline', type: 'voiture', baseFreq: 48, mult: 38, wave: 'sawtooth', maxSpeed: 1.05, accel: 0.07, brake: 0.1, turn: 0.95, offroad: 0.4, flies: false, wheels: 4, price: 6000000, trunk: 30, seats: 4, doors: 4 },
  suv: { name: 'SUV', label: 'SUV', type: 'voiture', baseFreq: 50, mult: 40, wave: 'sawtooth', maxSpeed: 1.1, accel: 0.08, brake: 0.1, turn: 0.9, offroad: 0.75, flies: false, wheels: 4, price: 9000000, trunk: 36, seats: 5, doors: 4 },
  sahel_bf: { name: 'Sahel BF', label: 'Sahel BF', type: 'voiture', baseFreq: 46, mult: 36, wave: 'sawtooth', maxSpeed: 1.0, accel: 0.075, brake: 0.1, turn: 0.9, offroad: 0.92, flies: false, wheels: 4, price: 7500000, trunk: 45, seats: 5, doors: 4, electric: true },
  electrique: { name: 'Voiture électrique', label: 'voiture électrique', type: 'voiture', baseFreq: 42, mult: 26, wave: 'sine', maxSpeed: 1.15, accel: 0.1, brake: 0.12, turn: 0.95, offroad: 0.35, flies: false, wheels: 4, price: 14000000, trunk: 28, seats: 4, doors: 4, electric: true },
  // Voitures de sport : vitesse et accélération élevées, tenue de route nerveuse,
  // mais peu de coffre et chères. Vendues au concessionnaire.
  sport_gt: { name: 'Sport GT', label: 'sport GT', type: 'voiture', baseFreq: 60, mult: 55, wave: 'sawtooth', maxSpeed: 1.7, accel: 0.14, brake: 0.15, turn: 1.05, offroad: 0.25, flies: false, wheels: 4, price: 55000000, trunk: 18, seats: 2, doors: 2, sport: true, manualGearbox: true },
  hypercar: { name: 'Hypercar', label: 'hypercar', type: 'voiture', baseFreq: 72, mult: 68, wave: 'sawtooth', maxSpeed: 2.05, accel: 0.17, brake: 0.16, turn: 1.0, offroad: 0.2, flies: false, wheels: 4, price: 130000000, trunk: 12, seats: 2, doors: 2, sport: true, manualGearbox: true },
  taxi: { name: 'Taxi', label: 'taxi', type: 'voiture', baseFreq: 48, mult: 38, wave: 'sawtooth', maxSpeed: 1.0, accel: 0.07, brake: 0.1, turn: 0.95, offroad: 0.4, flies: false, wheels: 4, price: 5000000, trunk: 30, seats: 4, doors: 4 },
  police: { name: 'Voiture de police', label: 'voiture de police', type: 'voiture', baseFreq: 50, mult: 42, wave: 'sawtooth', maxSpeed: 1.35, accel: 0.1, brake: 0.13, turn: 0.95, offroad: 0.45, flies: false, wheels: 4, price: 11000000, trunk: 32, seats: 4, doors: 4 },
  moto_police: { name: 'Moto de police', label: 'moto de police', type: 'moto', baseFreq: 85, mult: 62, wave: 'square', maxSpeed: 1.55, accel: 0.12, brake: 0.13, turn: 1.15, offroad: 0.55, flies: false, wheels: 2, price: 1800000, trunk: 10, seats: 1, doors: 0, gouvernemental: true },
  ambulance: { name: 'Ambulance', label: 'ambulance', type: 'voiture', baseFreq: 48, mult: 40, wave: 'sawtooth', maxSpeed: 1.25, accel: 0.09, brake: 0.12, turn: 0.9, offroad: 0.4, flies: false, wheels: 4, price: 10000000, trunk: 40, seats: 3, doors: 4, gouvernemental: true },
  camion: { name: 'Camion', label: 'camion', type: 'poids lourd', baseFreq: 38, mult: 24, wave: 'sawtooth', maxSpeed: 0.85, accel: 0.04, brake: 0.08, turn: 0.65, offroad: 0.4, flies: false, wheels: 6, price: 18000000, trunk: 120, seats: 2, doors: 2 },
  // Véhicules blindés civils : vendus normalement au concessionnaire (non
  // restreints). L'armure réduit fortement les dégâts de collision — plus lents
  // et plus chers en échange. Utiles pour transporter de l'argent ou se protéger.
  blinde_leger: { name: '4x4 blindé', label: '4x4 blindé', type: 'voiture', baseFreq: 44, mult: 34, wave: 'sawtooth', maxSpeed: 1.0, accel: 0.06, brake: 0.12, turn: 0.8, offroad: 0.85, flies: false, wheels: 4, price: 90000000, trunk: 34, seats: 5, doors: 4, armor: 0.45 },
  blinde_lourd: { name: 'Fourgon blindé', label: 'fourgon blindé', type: 'poids lourd', baseFreq: 36, mult: 22, wave: 'sawtooth', maxSpeed: 0.8, accel: 0.04, brake: 0.13, turn: 0.6, offroad: 0.55, flies: false, wheels: 4, price: 180000000, trunk: 60, seats: 4, doors: 4, armor: 0.65 },
  // Char d'assaut : jamais vendu au concessionnaire normal. Deux voies
  // d'acquisition seulement : réquisition policière (menu police, très cher)
  // ou marché noir (offre rare, encore plus cher). Très résistant (armure),
  // lent, capable de tirer au canon.
  char: { name: 'Char d\'assaut', label: 'char d\'assaut', type: 'poids lourd', baseFreq: 26, mult: 16, wave: 'sawtooth', maxSpeed: 0.45, accel: 0.025, brake: 0.15, turn: 0.35, offroad: 1, flies: false, wheels: 0, price: 800000000, trunk: 15, seats: 3, doors: 1, armor: 0.85, restricted: true, gouvernemental: true },
  // vtol (hélicoptère) : décollage et vol stationnaire à la verticale, sans
  // vitesse minimale. Un avion (sans vtol) a besoin d'une vraie vitesse de
  // piste avant de pouvoir prendre de l'altitude — voir driveVehicle().
  // Puissance nettement différente : l'hélico monte plus vite (climbRate) et
  // encaisse mieux à basse vitesse (accel), l'avion est bien plus rapide et
  // monte plus lentement, comme un vrai avion léger face à un hélicoptère.
  helico: { name: 'Hélicoptère', label: 'hélicoptère', type: 'air', baseFreq: 88, mult: 68, wave: 'square', maxSpeed: 2.2, accel: 0.06, brake: 0.05, turn: 0.7, offroad: 1, flies: true, vtol: true, climbRate: 2.6, wheels: 0, price: 65000000, trunk: 24, seats: 4, doors: 2 },
  avion: { name: 'Avion léger', label: 'avion', type: 'air', baseFreq: 115, mult: 85, wave: 'square', maxSpeed: 3.0, accel: 0.05, brake: 0.04, turn: 0.55, offroad: 1, flies: true, climbRate: 1.4, minTakeoffSpeedRatio: 0.35, wheels: 3, price: 130000000, trunk: 30, seats: 2, doors: 2 },
};

const WEAPON_CATALOG = {
  // armes légales, petit calibre
  taser: { name: 'Taser', label: 'taser', legal: true, slot: 'poche', caliber: 'électrique', dmg: 5, range: 8, accuracy: 0.92, fireRate: 0.6, magazine: 1, ammoType: 'taser_cart', price: 25000, size: 1, police: true },
  matraque: { name: 'Matraque', label: 'matraque', legal: true, slot: 'poche', caliber: 'contondant', dmg: 8, range: 2, accuracy: 0.95, fireRate: 0.8, magazine: 0, ammoType: null, price: 12000, size: 1, police: true },
  poivre: { name: 'Spray au poivre', label: 'spray au poivre', legal: true, slot: 'poche', caliber: 'gaz', dmg: 3, range: 4, accuracy: 0.85, fireRate: 0.4, magazine: 5, ammoType: 'gaz', price: 8000, size: 1 },
  pistolet_22: { name: 'Pistolet .22 LR', label: 'pistolet 22', legal: true, slot: 'arme', caliber: 'petit', dmg: 14, range: 22, accuracy: 0.78, fireRate: 0.35, magazine: 10, ammoType: '22lr', price: 95000, size: 1.5 },
  revolver_38: { name: 'Revolver .38', label: 'revolver 38', legal: true, slot: 'arme', caliber: 'petit', dmg: 18, range: 18, accuracy: 0.75, fireRate: 0.5, magazine: 6, ammoType: '38sp', price: 110000, size: 1.5 },
  // armes non légales, gros calibre
  pistolet_9: { name: 'Pistolet 9 mm', label: 'pistolet 9mm', legal: false, slot: 'arme', caliber: 'moyen', dmg: 22, range: 25, accuracy: 0.8, fireRate: 0.3, magazine: 15, ammoType: '9mm', price: 180000, size: 1.5 },
  uzi: { name: 'UZI', label: 'uzi', legal: false, slot: 'arme', caliber: 'moyen', dmg: 18, range: 20, accuracy: 0.65, fireRate: 0.08, magazine: 25, ammoType: '9mm', price: 320000, size: 2, auto: true },
  ak47: { name: 'AK-47', label: 'AK-47', legal: false, slot: 'arme', caliber: 'gros', dmg: 32, range: 45, accuracy: 0.7, fireRate: 0.12, magazine: 30, ammoType: '762', price: 450000, size: 3, auto: true },
  m4: { name: 'M4', label: 'M4', legal: false, slot: 'arme', caliber: 'gros', dmg: 30, range: 50, accuracy: 0.78, fireRate: 0.11, magazine: 30, ammoType: '556', price: 520000, size: 3, auto: true },
  sniper: { name: 'Sniper .338', label: 'sniper', legal: false, slot: 'arme', caliber: 'gros', dmg: 75, range: 90, accuracy: 0.92, fireRate: 1.2, magazine: 5, ammoType: '338', price: 950000, size: 4 },
  pompe: { name: 'Fusil à pompe', label: 'fusil à pompe', legal: false, slot: 'arme', caliber: 'gros', dmg: 40, range: 16, accuracy: 0.55, fireRate: 0.8, magazine: 6, ammoType: '12cal', price: 280000, size: 3 },
};

const AMMO_CATALOG = {
  '22lr': { name: 'Munitions .22 LR', price: 250, legal: true, size: 0.02 },
  '38sp': { name: 'Munitions .38 Special', price: 350, legal: true, size: 0.02 },
  '9mm': { name: 'Munitions 9 mm', price: 600, legal: false, size: 0.02 },
  '762': { name: 'Munitions 7.62x39', price: 900, legal: false, size: 0.03 },
  '556': { name: 'Munitions 5.56x45', price: 850, legal: false, size: 0.03 },
  '338': { name: 'Munitions .338', price: 2500, legal: false, size: 0.04 },
  '12cal': { name: 'Cartouches 12', price: 700, legal: false, size: 0.05 },
  'taser_cart': { name: 'Cartouche taser', price: 5000, legal: true, size: 0.03 },
  'gaz': { name: 'Recharge gaz', price: 3000, legal: true, size: 0.05 },
};

/* ============================================================
   APPARENCE — description réelle des tenues (couleurs, coiffure, lunettes)
============================================================ */
const APPEARANCE = {
  colors: ['noir','blanc','gris','bleu marine','bleu clair','rouge','vert olive','marron','beige','jaune','orange','violet','rose','bordeaux'],
  hauts: ['t-shirt','chemise','polo','pull','sweat à capuche','veste','blouson','manteau','gilet','cardigan'],
  bas: ['jean','pantalon de costume','short','jupe','survêtement','pantalon cargo'],
  chaussures: ['baskets','chaussures de ville','bottes','sandales','mocassins'],
  coiffures: ['cheveux courts','cheveux longs attachés','crâne rasé','dreadlocks','tresses','coiffure afro','chignon','cheveux en brosse'],
  lunettes: ['aucune','lunettes de vue à monture noire','lunettes de soleil','lunettes rondes fines'],
};
function generateNPCAppearance(job) {
  const costumeJobs = ['avocat', 'agent_immo', 'concessionnaire', 'employe', 'douanier'];
  const isCostume = costumeJobs.includes(job) || UTIL.chance(0.08);
  const isVeste = !isCostume && UTIL.chance(0.2);
  const haut = isCostume ? 'costume' : (isVeste ? 'veste' : UTIL.pick(APPEARANCE.hauts));
  return {
    haut, couleurHaut: UTIL.pick(APPEARANCE.colors),
    bas: UTIL.pick(APPEARANCE.bas), couleurBas: UTIL.pick(APPEARANCE.colors),
    chaussures: UTIL.pick(APPEARANCE.chaussures), couleurChaussures: UTIL.pick(APPEARANCE.colors),
    coiffure: UTIL.pick(APPEARANCE.coiffures),
    lunettes: UTIL.pick(APPEARANCE.lunettes),
  };
}

function generateShopCatalog() {
  const catalog = [];
  const id = (base, i) => base + '_' + i;

  // Vêtements et accessoires (600+ articles)
  const couleurs = ['noir','blanc','bleu','rouge','vert','jaune','gris','beige','marron','rose','violet','orange','kaki','bleu marine','bordeaux','turquoise','argenté','doré','camouflage','jean'];
  const tailles = ['XS','S','M','L','XL','XXL','3XL'];
  const habits = ['t-shirt','chemise','polo','débardeur','pull','sweat à capuche','veste','blouson','manteau','costume','robe','jupe','salopette','combinaison','poncho','kimono','gilet','cardigan'];
  for (let c of couleurs) {
    for (let h of habits) {
      for (let t of tailles) {
        catalog.push({ id: id('vet', catalog.length), name: `${UTIL.capitalize(h)} ${c} taille ${t}`, category: 'vetement', price: UTIL.randInt(2500, 85000), size: 1.2, legal: true, desc: `Un ${h} de couleur ${c}, taille ${t}.` });
      }
    }
  }
  const pantalons = ['jean','pantalon','short','bermuda','jogging','cargo','chino','salopette','legging','kaki'];
  for (let c of couleurs) {
    for (let p of pantalons) {
      for (let t of tailles) {
        catalog.push({ id: id('pant', catalog.length), name: `${UTIL.capitalize(p)} ${c} taille ${t}`, category: 'pantalon', price: UTIL.randInt(3500, 65000), size: 1.3, legal: true, desc: `${p} ${c}, taille ${t}.` });
      }
    }
  }
  const sousVetements = ['boxer','slip','caleçon','tanga','culotte','shorty','maillot de corps','soutien-gorge','pyjama','peignoir'];
  for (let c of couleurs) {
    for (let s of sousVetements) {
      for (let t of tailles) {
        catalog.push({ id: id('sous', catalog.length), name: `${UTIL.capitalize(s)} ${c} taille ${t}`, category: 'sous-vetement', price: UTIL.randInt(1500, 18000), size: 0.5, legal: true, desc: `${s} ${c}, taille ${t}.` });
      }
    }
  }
  const chaussures = ['baskets','sandales','bottes','mocassins','escarpins','talons','chaussons','bottines','sabots','derbies'];
  const pt = ['35','36','37','38','39','40','41','42','43','44','45','46','47'];
  for (let c of couleurs) {
    for (let ch of chaussures) {
      for (let t of pt) {
        catalog.push({ id: id('chauss', catalog.length), name: `${UTIL.capitalize(ch)} ${c} pointure ${t}`, category: 'chaussure', price: UTIL.randInt(4000, 120000), size: 1.5, legal: true, desc: `Paire de ${ch} ${c}, pointure ${t}.` });
      }
    }
  }
  const lunettes = ['lunettes de soleil','lunettes de vue','lunettes de sport','masque de ski','lunettes de protection','monocle','loupe'];
  for (let c of couleurs) {
    for (let l of lunettes) {
      catalog.push({ id: id('lun', catalog.length), name: `${l} ${c}`, category: 'accessoire', price: UTIL.randInt(5000, 95000), size: 0.4, legal: true, desc: `${l} de couleur ${c}.` });
    }
  }
  const bijoux = ['bague','collier','bracelet','montre','boucles d\'oreilles','pendentif','chaîne','gourmette'];
  const matiere = ['argent','or','acier','cuivre','plastique','bois','tissu','céramique'];
  for (let b of bijoux) {
    for (let m of matiere) {
      catalog.push({ id: id('bij', catalog.length), name: `${UTIL.capitalize(b)} en ${m}`, category: 'accessoire', price: UTIL.randInt(8000, 250000), size: 0.2, legal: true, desc: `Un ${b} fini en ${m}.` });
    }
  }

  // Nourriture et boissons (800+ articles)
  const viandes = ['boeuf','poulet','mouton','porc','chevre','lapin','gibier','sanglier','biche'];
  const prep = ['steak','côtelette','escalope','saucisse','brochettes','rôti','tajine','gigot','poulet rôti','hachis','filet','aile'];
  for (let v of viandes) {
    for (let p of prep) {
      catalog.push({ id: id('viande', catalog.length), name: `${p} de ${v} 500g`, category: 'viande', price: UTIL.randInt(1500, 12000), size: 1, legal: true, consumable: true, hunger: 35, desc: `Barquette de ${p} de ${v}, 500 grammes.` });
    }
  }
  const poissons = ['tilapia','maquereau','sardine','sole','thon','bar','dorade','carpaccio','calamar','crevette','moule','crabe','homard'];
  for (let p of poissons) {
    catalog.push({ id: id('poisson', catalog.length), name: `${UTIL.capitalize(p)} frais 1kg`, category: 'poisson', price: UTIL.randInt(2000, 18000), size: 1, legal: true, consumable: true, hunger: 30, desc: `Poisson frais : ${p}.` });
    catalog.push({ id: id('poisson', catalog.length), name: `${UTIL.capitalize(p)} fumé 500g`, category: 'poisson', price: UTIL.randInt(3500, 22000), size: 1, legal: true, consumable: true, hunger: 25, desc: `Poisson fumé : ${p}.` });
  }
  const fruits = ['pomme','banane','orange','mangue','ananas','papaye','citron','avocat','pasteque','raisin','fraise','framboise','pêche','poire','grenade','kiwi','mandarine'];
  for (let f of fruits) {
    catalog.push({ id: id('fruit', catalog.length), name: `Sac de ${f}s 1kg`, category: 'fruit', price: UTIL.randInt(800, 4500), size: 1, legal: true, consumable: true, hunger: 15, desc: `Un kilo de ${f}s.` });
  }
  const legumes = ['tomate','oignon','carotte','pomme de terre','aubergine','courgette','poivron','chou','haricot','lentille','riz','maïs','igname','manioc','banane plantain','salade','épinard','betterave'];
  for (let l of legumes) {
    catalog.push({ id: id('leg', catalog.length), name: `Sac de ${l}s 2kg`, category: 'legume', price: UTIL.randInt(700, 3500), size: 1, legal: true, consumable: true, hunger: 12, desc: `Deux kilos de ${l}s.` });
  }
  const pains = ['baguette','pain de mie','croissant','pain au chocolat','brioche','galette','pain complet','pain de campagne','baguette tradition'];
  for (let p of pains) {
    catalog.push({ id: id('pain', catalog.length), name: p, category: 'pain', price: UTIL.randInt(150, 1200), size: 0.6, legal: true, consumable: true, hunger: 10, desc: `Un ${p} frais.` });
  }
  const plats = ['riz au poisson','yassa poulet','maafe','tchep','alloco','attiéké','poulet DG','saka saka','choukouya','mafe','couscous','hamburger','pizza','tacos','sandwich'];
  for (let p of plats) {
    catalog.push({ id: id('plat', catalog.length), name: `Plat : ${p}`, category: 'plat', price: UTIL.randInt(1500, 6500), size: 1, legal: true, consumable: true, hunger: 50, desc: `Plat chaud : ${p}.` });
  }
  const boissons = ['eau minérale 50cl','eau minérale 1.5L','eau gazeuse','jus d\'orange','jus de mangue','jus de pomme','jus de bissap','jus de gingembre','jus de bouye','soda cola','soda orange','soda citron','bière','vin rouge','vin blanc','whisky','café','thé','lait','lait caillé','yaourt','boisson énergisante'];
  for (let b of boissons) {
    catalog.push({ id: id('boiss', catalog.length), name: b, category: 'boisson', price: UTIL.randInt(300, 8500), size: 1, legal: true, consumable: true, thirst: 25, desc: `Bouteille ou cannette de ${b}.` });
  }

  // Matériel général et utilitaire (300+ articles)
  const outils = ['marteau','tournevis','clé à molette','scie','perceuse','pince','mètre','niveau','boîte à outils','échelle','corde','lampe torche','batterie','câble électrique','rallonge','sac à dos','valise','cartable','sac de couchage','tente'];
  for (let o of outils) {
    catalog.push({ id: id('outil', catalog.length), name: o, category: 'outil', price: UTIL.randInt(2000, 120000), size: UTIL.rand(1, 3), legal: true, desc: `Un ${o} standard.` });
  }
  const elec = ['téléphone','tablette','ordinateur portable','clé USB','casque audio','enceinte','chargeur','batterie externe','câble HDMI','souris','clavier','écran','appareil photo','montre connectée'];
  for (let e of elec) {
    catalog.push({ id: id('elec', catalog.length), name: e, category: 'electronique', price: UTIL.randInt(15000, 850000), size: UTIL.rand(0.5, 2), legal: true, desc: `Un ${e}.` });
  }
  const medocs = ['paracetamol','ibuprofène','aspirine','sirop','antibiotique','pansement','desinfectant','vitamines','crème','seringue','thermomètre','antiseptique'];
  for (let m of medocs) {
    catalog.push({ id: id('med', catalog.length), name: `Boîte de ${m}`, category: 'medicament', price: UTIL.randInt(500, 12000), size: 0.4, legal: true, consumable: true, health: 10, desc: `Boîte de ${m}.` });
  }
  const divers = ['bouteille de gaz','charbon','bois de chauffe','allumettes','bougie','savon','shampoing','dentifrice','brosse à dents','papier toilette','lessive','désodorisant','crème solaire','moustiquaire','moustique'];
  for (let d of divers) {
    catalog.push({ id: id('div', catalog.length), name: d, category: 'divers', price: UTIL.randInt(300, 15000), size: UTIL.rand(0.5, 2), legal: true, desc: `Produit du quotidien : ${d}.` });
  }
  return catalog;
}

const SHOP_CATALOG = generateShopCatalog();

// Stupéfiants vendus au marché noir : illégaux, revendables (voir la revente
// aux passants) et consommables avec un effet passager. Détenir ou vendre
// attire l'attention de la police.
const DRUG_CATALOG = [
  { id: 'herbe', name: 'Herbe', category: 'stupefiant', price: 15000, size: 0.5, legal: false, consumable: true, effect: 'calme', desc: 'Stupéfiant. Illégal. Se revend bien dans les quartiers animés.' },
  { id: 'hashish', name: 'Haschich', category: 'stupefiant', price: 22000, size: 0.5, legal: false, consumable: true, effect: 'calme', desc: 'Stupéfiant. Illégal.' },
  { id: 'ecstasy', name: 'Ecstasy', category: 'stupefiant', price: 28000, size: 0.3, legal: false, consumable: true, effect: 'euphorie', desc: 'Cachets. Stupéfiant illégal.' },
  { id: 'amphetamine', name: 'Amphétamines', category: 'stupefiant', price: 42000, size: 0.4, legal: false, consumable: true, effect: 'energie', desc: 'Stupéfiant illégal, très recherché.' },
  { id: 'cocaine', name: 'Cocaïne', category: 'stupefiant', price: 65000, size: 0.4, legal: false, consumable: true, effect: 'euphorie', desc: 'Stupéfiant illégal, cher et surveillé.' },
  { id: 'heroine', name: 'Héroïne', category: 'stupefiant', price: 85000, size: 0.4, legal: false, consumable: true, effect: 'calme', desc: 'Stupéfiant illégal, très dangereux.' },
];

/* ============================================================
   MOBILIER — objets à acheter pour personnaliser sa maison. Certains sont
   fonctionnels (rangement, ordinateur, lit), d'autres décoratifs. On les
   place dans la pièce où l'on se trouve (voir Game.buyFurniture).
   type : 'storage' (rangement), 'ordi' (ordinateur), 'lit' (repos), 'deco'.
============================================================ */
const FURNITURE_CATALOG = {
  coffre: { name: 'Coffre de rangement', type: 'storage', capacity: 30, price: 90000, desc: 'Rangez-y des objets. Capacité 30.' },
  coffre_fort_maison: { name: 'Coffre-fort', type: 'storage', capacity: 60, price: 300000, desc: 'Rangement sécurisé. Capacité 60.' },
  armoire: { name: 'Armoire', type: 'storage', capacity: 25, price: 55000, desc: 'Rangement. Capacité 25.' },
  refrigerateur: { name: 'Réfrigérateur', type: 'storage', capacity: 20, price: 70000, desc: 'Conservez vos provisions. Capacité 20.' },
  ordinateur: { name: 'Ordinateur de bureau', type: 'ordi', price: 250000, desc: 'Accès à l\'ordinateur (banque, annonces, etc.).' },
  lit: { name: 'Lit', type: 'lit', price: 90000, desc: 'Reposez-vous pour récupérer de l\'énergie.' },
  television: { name: 'Télévision', type: 'audio', price: 80000, desc: 'Jouez votre propre musique dans la pièce (fichier local).' },
  enceinte: { name: 'Enceinte', type: 'audio', price: 45000, desc: 'Jouez votre propre musique dans la pièce (fichier local).' },
  canape: { name: 'Canapé', type: 'deco', price: 60000, desc: 'Élément de confort.' },
  table: { name: 'Table à manger', type: 'deco', price: 40000, desc: 'Élément de décoration.' },
  plante: { name: 'Plante verte', type: 'deco', price: 15000, desc: 'Un peu de verdure.' },
};

/* ============================================================
   VILLE / MAP — génération procédurale, districts, POI, routes
============================================================ */
// Missions recommandées aux nouveaux joueurs : pas de système d'IDs à saisir pour celles-ci.
const BEGINNER_MISSION_TYPES = ['taxi_soigne', 'colis_fragile', 'objet_perdu', 'urgence_medicale', 'filature'];
