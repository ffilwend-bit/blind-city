# blind-city
Blind City est un jeu de simulation urbaine accessible aux non-voyants, basé sur un système audio immersif. Le joueur explore une ville vivante, interagit, travaille et se déplace grâce au son. Chaque action est guidée par un design sonore réaliste pour une expérience unique.

## Codes administrateur (staff)

Les codes du mode staff (`principal` / `modérateur`) doivent être définis via
les variables d'environnement `STAFF_CODE_PRINCIPAL` et
`STAFF_CODE_MODERATEUR` sur le serveur qui héberge le jeu (Render : onglet
Environment). Ils ont toujours priorité sur `staff-data.json`, qui n'est
qu'un stockage local (jamais publié — voir `.gitignore`).

En cas de doute sur une fuite (fichier resté dans un ancien commit, code
partagé par erreur...), changez ces deux variables d'environnement : le
serveur reprend les nouveaux codes au prochain redémarrage, sans toucher au
compte propriétaire (qui obtient l'accès admin automatiquement, sans code).
