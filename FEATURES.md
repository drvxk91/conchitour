# Conchitour — Liste complète des fonctionnalités

> Document de référence pour construire le contenu du site web (conchitour.com). Chaque fonctionnalité est décrite avec **ce qu'elle fait** et **pourquoi elle compte pour l'utilisateur** (photographe, agence, hôtel, agent immobilier...). À utiliser comme base pour rédiger les pages du site (accueil, fonctionnalités, pricing).

**Positionnement produit** : Conchitour est un logiciel de bureau (Windows + macOS) pour créer des visites virtuelles 360° professionnelles. Licence unique, paiement unique de $149 (pas d'abonnement), export 100% statique — le résultat s'héberge n'importe où (OVH, Netlify, GitHub Pages, S3...) sans dépendre d'un serveur ou d'un compte cloud.

**Baseline** : *Architect your virtual tours.*

---

## 1. Import — glisser-déposer et détection automatique

Importez vos photos 360° par simple glisser-déposer. Le logiciel lit automatiquement les métadonnées EXIF de chaque photo (position GPS, direction de la caméra) — y compris les formats spécifiques Insta360 (XMP Heading, Yaw). Résultat : la plupart des scènes sont pré-positionnées sur la carte sans saisie manuelle.

**Pourquoi ça compte** : gain de temps énorme pour les tournages avec plusieurs dizaines de scènes — pas de ressaisie manuelle des coordonnées GPS.

## 2. Éditeur de scènes — le cœur de l'application

L'écran où l'utilisateur passe l'essentiel de son temps. Visionneuse krpano intégrée, création et édition de hotspots (liens entre scènes, points d'information, vidéos), panneau d'inspection par onglets. Inclut un outil de **calage du Nord** : on tourne l'image jusqu'à aligner le Nord réel sur un repère visuel, ce qui sert d'axe de référence pour le calcul automatique des hotspots GPS.

**Pourquoi ça compte** : sans calage précis du Nord, les liens entre scènes générés automatiquement à partir du GPS seraient décalés — c'est la fonctionnalité qui rend la triangulation automatique fiable.

## 3. Carte interactive

Carte basée sur OpenStreetMap (aucune clé API requise). Placez ou ajustez la position GPS de chaque scène par glisser-déposer sur la carte ; les hotspots de navigation entre scènes proches sont recalculés automatiquement selon la distance et l'orientation.

**Pourquoi ça compte** : pour les grands sites (hôtels, domaines, sites touristiques), positionner visuellement les scènes sur une carte est bien plus rapide et intuitif que de saisir des coordonnées à la main.

## 4. Catégories

Organisez les scènes par catégories personnalisées (avec icônes emoji), en plus des catégories intégrées. Import/export Excel pour la gestion en masse.

**Pourquoi ça compte** : indispensable pour les visites avec beaucoup de scènes (hôtels multi-espaces, campus, centres commerciaux) — permet de filtrer et structurer la navigation.

## 5. Informations projet

Métadonnées du projet : nom, créateur, copyright, informations client.

## 6. SEO — référencement multilingue

Génération des balises meta (titre, description), du balisage Schema.org, du texte alternatif par scène, et d'un sitemap image — le tout par langue. Un assistant IA génère automatiquement titre, description et mots-clés optimisés à partir du contexte du projet. Panneau de score SEO façon Yoast (problèmes détectés / points positifs) et aperçu en direct du résultat dans les résultats Google.

**Pourquoi ça compte** : une visite virtuelle 360° n'a de valeur commerciale que si elle est trouvée sur Google — ce module transforme une simple visite en véritable atout de référencement, sans compétence SEO préalable.

## 7. Langues

Ajoutez autant de langues que nécessaire pour la visite. Traduction automatique intégrée via l'API DeepL (clé personnelle requise).

**Pourquoi ça compte** : ouvre la visite à une clientèle internationale sans avoir à faire traduire manuellement chaque scène.

## 8. Pages statiques

Éditeur Markdown avec aperçu en direct pour les pages annexes de la visite (mentions légales, politique de confidentialité, conditions d'utilisation, à propos, contact). Génération assistée par IA, calibrée pour respecter les obligations légales françaises/européennes (RGPD, LCEN).

**Pourquoi ça compte** : évite à l'utilisateur de rédiger ou payer un juriste pour des pages légales obligatoires basiques.

## 9. Branding

Logo, écran de chargement, scène d'ouverture, couleurs de marque — personnalisables manuellement ou extraites automatiquement d'un logo importé ou de l'URL du site du client. Génération IA d'un texte d'accroche/tagline pour l'écran de démarrage.

**Pourquoi ça compte** : chaque visite peut être livrée aux couleurs exactes du client final — un vrai argument pour les agences qui revendent la prestation.

## 10. Partage

Boutons de partage réseaux sociaux et génération d'une capture d'écran de la visite en direct pour les aperçus (Open Graph, etc.).

## 11. Modules complémentaires

Activation/désactivation : mode VR, support gyroscope (mobile), widget de retour utilisateur, bouton plein écran, configuration de la clé DeepL.

## 12. Analytics

Configuration des événements de suivi Google Analytics 4 (GA4) — savoir quelles scènes sont vues, combien de temps, quels hotspots sont cliqués.

**Pourquoi ça compte** : donne à l'utilisateur final des données concrètes sur l'engagement de ses visiteurs, un argument de vente pour justifier le prix d'une visite virtuelle auprès de ses propres clients.

## 13. Audit qualité

Contrôles automatiques (structure, liens cassés, champs vides) **et** audit IA avancé : l'IA analyse l'ensemble du projet et remonte les problèmes de qualité de contenu, de cohérence des traductions, de cohérence narrative entre scènes, et d'opportunités SEO manquées — avec suggestions concrètes de correction.

**Pourquoi ça compte** : une relecture qualité automatisée avant publication, comme avoir un correcteur/consultant SEO qui relit tout le projet en quelques secondes.

## 14. Édition de contenu par IA

Grille d'édition inline pour tous les titres/descriptions de toutes les scènes, dans toutes les langues, en un seul écran. Génération IA en lot (batch) ou scène par scène, avec analyse de l'image (vision) pour des descriptions réellement pertinentes par rapport à ce qui est visible. Les résultats générés sont présentés dans un écran de comparaison (avant/après) avant validation — rien n'est appliqué sans confirmation.

**Pourquoi ça compte** : rédiger manuellement titres et descriptions pour des dizaines de scènes en plusieurs langues prendrait des heures ; l'IA le fait en quelques minutes, avec contrôle humain avant publication.

## 15. Compilation / Export

Génère le dossier de site statique final. Aucune dépendance serveur — le résultat s'héberge sur n'importe quel hébergeur simple (OVH, Netlify, GitHub Pages, Amazon S3...). Option de publication directe en un clic vers un dépôt Git configuré (ex. GitHub Pages).

**Pourquoi ça compte** : pas d'abonnement d'hébergement imposé, pas de dépendance à une plateforme tierce — l'utilisateur garde une maîtrise totale et un coût d'hébergement minimal (souvent gratuit).

---

## Fonctionnalités transversales

### Assistant de création de projet (IA)
Un assistant configure un nouveau projet en posant des questions contextuelles générées dynamiquement à partir d'une simple description du lieu (type de site, audience, ton éditorial, espaces à photographier...). Comprend un mode dictée vocale et un flux de bascule mobile par QR code (répondre aux questions depuis son téléphone pendant qu'on photographie sur place).

**Pourquoi ça compte** : réduit la barrière à l'entrée — même un utilisateur non technique est guidé pas à pas dès la création du projet.

### Système IA multi-fournisseurs
Compatible avec les clés API personnelles Anthropic (Claude) et OpenAI (GPT). Suivi de la consommation et du coût des appels IA, multi-devises.

**Pourquoi ça compte** : transparence totale — l'utilisateur paie directement son fournisseur IA au coût réel, sans marge cachée de Conchitour sur l'usage IA.

### Import/Export Excel
L'intégralité des données du projet (scènes, catégories, hotspots, pages, paramètres analytics) est exportable vers un classeur Excel stylé (onglets colorés, en-têtes figés) et ré-importable après modification.

**Pourquoi ça compte** : permet l'édition en masse dans un outil que tout le monde maîtrise déjà, ou la délégation de la rédaction à un collaborateur non technique.

### Licence et essai gratuit
Version d'essai de 14 jours (scènes, langues et appels IA limités). Licence définitive à vie pour $149, activable sur 2 machines, incluant 1 an de mises à jour gratuites — sans abonnement.

**Pourquoi ça compte** : argument de vente clé face aux concurrents SaaS par abonnement — un seul paiement, propriété définitive du logiciel.

### Application native multiplateforme
Disponible en installateur natif Windows (.exe) et macOS (.dmg). Aucune installation de serveur, aucun compte cloud requis pour utiliser le logiciel.
