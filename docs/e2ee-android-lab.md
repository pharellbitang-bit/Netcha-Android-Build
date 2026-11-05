# Laboratoire E2EE Android — Netcha

## Périmètre

Ce laboratoire appartient au dépôt public `Netcha-Android-Build`. Il est volontairement isolé dans `e2ee-lab/` et ne fait pas partie de `www/`, du bundle Capacitor, ni de l'APK distribuée. Le workflow APK existant et les sources Android de production ne sont pas modifiés.

Le laboratoire utilise Matrix avec `matrix-js-sdk@45.0.0` et le moteur cryptographique Rust/WASM fourni par le SDK. Il se connecte uniquement à un homeserver Matrix de test et utilise des identifiants fictifs.

**Ne jamais entrer les identifiants Netcha dans ce laboratoire.** Aucun secret privé du dépôt source, jeton Railway, compte utilisateur Netcha ou donnée de production n'est nécessaire.

## Vérifications automatisées

Le workflow `E2EE Android isolated lab` construit le client web isolé, puis démarre un homeserver Synapse jetable avec inscription de comptes synthétiques. Il vérifie :
- déchiffrement d'un message A vers B ;
- déchiffrement d'un message B vers A ;
- présence d'événements `m.room.encrypted` côté homeserver et absence des textes sentinelles dans les événements consultés ;
- retrait d'un troisième membre et accès du membre restant aux messages envoyés après le retrait ;
- comparaison du `session_id` Megolm avant/après le retrait pour vérifier qu'une nouvelle session est utilisée.

## Limites explicites

La comparaison du `session_id` confirme le renouvellement de session après le retrait dans ce scénario de laboratoire. Elle ne prouve pas encore, à elle seule, l'impossibilité pour l'ancien membre de déchiffrer un ciphertext post-retrait récupéré séparément. Les vérifications humaines, le cross-signing, la sauvegarde et récupération des clés, la révocation d'appareil, les médias chiffrés, la confidentialité des notifications et la compatibilité réelle avec Android System WebView restent à tester.

La page de laboratoire peut être exécutée dans un navigateur Android pour un premier essai manuel, mais cela ne constitue pas une validation sur l'APK ni une intégration à la messagerie Netcha.

## Sept chantiers de sécurité

1. Cartographier les comptes Netcha vers des identités cryptographiques et appareils.
2. Persister les clés de manière sûre, vérifier et révoquer les appareils.
3. Gérer les clés de groupe et leur renouvellement après retrait.
4. Chiffrer les pièces jointes localement avant téléversement.
5. Faire du backend un relais de ciphertext sans fuite dans les aperçus ou journaux, tout en préservant l'historique existant.
6. Valider séparément Web, Android WebView et iOS WKWebView.
7. N'activer progressivement qu'après revue indépendante et validation de toutes les portes de sécurité.

Ces sept chantiers ne sont pas déclarés terminés par la seule existence du laboratoire. Aucun E2EE n'est activé dans l'application de production. Les anciens messages restent inchangés et lisibles.
