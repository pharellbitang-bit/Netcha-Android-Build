# Checklist de préparation Google Play — Netcha

## Déjà disponible
- [x] Dépôt Android wrapper séparé : Netcha-Android-Build
- [x] APK de test généré par GitHub Actions
- [x] Application de test installée et testée par le propriétaire sur plusieurs comptes ou téléphones, selon sa confirmation
- [x] Application de test connectée au service Netcha en ligne
- [x] Le dépôt wrapper ne contient pas le backend privé ni une copie de la base de données

## Avant une publication publique
- [ ] Vérifier les fonctionnalités et les flux de compte sur la version candidate
- [ ] Vérifier création, connexion, déconnexion et suppression de compte
- [ ] Vérifier suppression des messages, conversations et contenus, selon les fonctionnalités annoncées
- [ ] Vérifier permissions Android, notamment caméra, microphone, fichiers et notifications si utilisés
- [ ] Vérifier le comportement hors connexion, les erreurs réseau et les liens externes
- [ ] Finaliser l'icône et les captures d'écran réelles
- [ ] Compléter le nom du responsable et l'e-mail d'assistance
- [ ] Publier une politique de confidentialité accessible publiquement
- [ ] Remplir la déclaration « Sécurité des données » selon un audit du code et des prestataires
- [ ] Remplir la classification du contenu et les informations sur le public cible
- [ ] Préparer les instructions de test et les identifiants de démonstration si nécessaires
- [ ] Construire et tester un Android App Bundle (.aab) de publication signé
- [ ] Conserver la clé de signature en lieu sûr ; ne jamais la déposer dans ce dépôt public
- [ ] Créer le compte développeur Google Play et régler les frais applicables
- [ ] Effectuer le test fermé requis si Google l'impose au type de compte
- [ ] Soumettre la version à l'examen Google Play

## Avertissements
- L'APK debug n'est pas un livrable de production Google Play.
- La version Android actuelle est une enveloppe qui charge le site Netcha en ligne ; elle ne constitue pas une réécriture native complète.
- Ne pas modifier la base de données de production pour préparer la fiche Play Store.
- Ne pas publier de promesse non vérifiée concernant le chiffrement, la confidentialité, la suppression ou la disponibilité.
