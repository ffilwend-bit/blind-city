/* ============================================================
   ACCÈS PROPRIÉTAIRE — priorités totales sans code
   ------------------------------------------------------------
   Le/les propriétaire(s) du jeu reçoivent automatiquement l'accès
   administrateur PRINCIPAL (priorités totales du staff), sans avoir
   à saisir le moindre code.

   Reconnaissance par IDENTITÉ, de deux façons :
     • l'identifiant de compte (le pseudo tapé à l'écran de connexion,
       comparé en minuscules) ;
     • OU le nom de personnage « prénom nom » (utile en solo, hors ligne,
       quand il n'y a pas de compte serveur).

   En multijoueur, c'est le SERVEUR qui accorde l'accès (voir
   grantOwnerStaffIfEligible et OWNER_ACCOUNTS dans server.js) — c'est lui
   qui détient les vrais pouvoirs (bannir, valider des comptes...). Ce
   fichier assure surtout l'accès en SOLO et l'accueil vocal.

   Pour ajouter/changer un propriétaire : complétez `identities` ci-dessous
   (identifiant de compte en minuscules, et/ou « prénom nom » du personnage).
   Côté serveur, la variable d'environnement OWNER_ACCOUNTS fait la même chose.
   ============================================================ */

const OwnerAccess = {
  // Identités reconnues comme propriétaires (accès principal automatique).
  // Ajoutez ici l'identifiant de compte (minuscules) ET/OU le « prénom nom »
  // exact du personnage. Les deux formes sont acceptées.
  // L'utilisateur s'identifie par son email « ffilwend@gmail.com ». Le jeu
  // retire les caractères spéciaux à l'inscription (@ et . disparaissent), donc
  // l'identifiant de compte réel devient « ffilwendgmailcom ». On reconnaît
  // toutes les formes possibles pour être certain que l'accès s'active.
  identities: [
    'ffilwend@gmail.com',  // email complet (tel que saisi)
    'ffilwendgmailcom',    // email sans caractères spéciaux (forme stockée par le jeu)
    'ffilwend',            // forme courte
    // 'prénom nom',       // ← nom de personnage exact (à compléter au besoin)
  ],
  emails: ['ffilwend@gmail.com'],

  _granted: false,
  _norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); },
  // Forme réduite aux lettres/chiffres : « ffilwend@gmail.com » -> « ffilwendgmailcom ».
  _strip(s) { return this._norm(s).replace(/[^a-z0-9]/g, ''); },

  isOwner(username, firstName, lastName) {
    const list = this.identities.map(i => this._norm(i));
    const stripped = this.identities.map(i => this._strip(i));
    const u = this._norm(username), us = this._strip(username);
    if (u && (list.includes(u) || stripped.includes(us))) return true;
    const full = this._norm(`${firstName || ''} ${lastName || ''}`);
    const fulls = this._strip(`${firstName || ''} ${lastName || ''}`);
    if (full && (list.includes(full) || stripped.includes(fulls))) return true;
    return false;
  },

  // Active l'accès administrateur principal localement (cas solo / hors ligne :
  // il n'y a pas de serveur pour l'accorder). En multijoueur, le serveur l'a
  // déjà fait via staff_auth_result.
  grantLocalPrincipal() {
    if (typeof StaffMode === 'undefined') return;
    if (StaffMode.active && StaffMode.role === 'principal') { this._granted = true; return; }
    StaffMode.active = true;
    StaffMode.role = 'principal';
    this._granted = true;
    if (typeof updateHud === 'function') try { updateHud(); } catch (e) {}
    if (typeof announce === 'function') {
      announce('Bienvenue. Accès administrateur principal accordé automatiquement : aucun code à saisir. Ouvrez le panneau staff avec Ctrl+Alt+Maj+P.', 'assertive');
    }
  },

  // À appeler dès que l'identité du joueur est connue (démarrage / connexion).
  check() {
    if (this._granted) return true;
    const username = (typeof Net !== 'undefined' && Net.accountUsername) || null;
    const p = (typeof Game !== 'undefined' && Game.player) || {};
    if (!this.isOwner(username, p.firstName, p.lastName)) return false;
    // Connecté : le serveur accorde l'accès de son côté (source de vérité pour
    // les pouvoirs réseau). Hors ligne : on l'accorde localement ici.
    if (!(typeof Net !== 'undefined' && Net.connected)) this.grantLocalPrincipal();
    else this._granted = true;
    return true;
  },

  // Vérifie plusieurs fois après le démarrage : la connexion au compte peut
  // n'aboutir qu'après le lancement de la partie.
  watch() {
    this.check();
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (this.check() || tries > 20) clearInterval(id);
    }, 1500);
  },
};
window.OwnerAccess = OwnerAccess;
