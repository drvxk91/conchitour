import type { StaticPage } from '@/types';

// ── Built-in page default content ─────────────────────────────────────────────
// {{PLACEHOLDER}} tokens are visible reminders that the user must fill in
// real values before publishing. Built-in pages are disabled by default so a
// tour is never published with placeholder text.

export const DEFAULT_BUILTIN_PAGES: StaticPage[] = [
  // ── Privacy & Cookies ──────────────────────────────────────────────────────
  {
    id: 'page-privacy',
    slug: 'privacy',
    builtIn: 'privacy',
    enabled: false,
    showInFooter: true,
    order: 0,
    title: {
      en: 'Privacy & Cookies Policy',
      fr: 'Politique de confidentialité et cookies',
    },
    content: {
      en: `# Privacy & Cookies Policy

*Last updated: {{DATE}}*

This policy explains how **{{SITE_NAME}}** (operated by {{OPERATOR_NAME}}) collects, uses, and protects your personal data when you visit this virtual tour.

## 1. Data Controller

The data controller is:

**{{OPERATOR_NAME}}**
{{OPERATOR_ADDRESS}}
Email: {{OPERATOR_EMAIL}}

## 2. Data We Collect

When you visit this virtual tour we may collect the following data:

- **Technical data**: IP address, browser type and version, operating system, device identifier, pages viewed, time spent, referring URL.
- **Cookies**: small files stored on your device to improve your experience (see section 4 below).
- **Contact form submissions**: if you use a contact or feedback form embedded in the tour, we receive your message and the email address you provide.

We do **not** collect sensitive personal data (health, religion, political views, etc.).

## 3. Legal Basis for Processing

We process your data on the following legal bases (GDPR Art. 6):

| Purpose | Legal basis |
|---|---|
| Analytics & performance measurement | Legitimate interest (Art. 6.1.f) |
| Contact form submissions | Performance of a contract / consent (Art. 6.1.b / 6.1.a) |
| Cookie consent | Consent (Art. 6.1.a) |

## 4. Cookies

This site uses the following cookies:

| Cookie | Purpose | Duration |
|---|---|---|
| \`cc_ok\` | Records that you accepted our cookie policy | 1 year |
| Analytics cookies | Measure audience and improve our content | {{ANALYTICS_DURATION}} |

You can refuse cookies by not clicking "Accept" on the cookie banner, or by clearing your browser cookies at any time.

## 5. Data Sharing

We do **not** sell your personal data. We may share it with:

- **Hosting providers**: {{HOST_NAME}} — stores and serves the site files.
- **Analytics providers**: {{ANALYTICS_PROVIDER}} — receives anonymised usage statistics.

All processors are bound by data processing agreements and GDPR-compliant safeguards.

## 6. Data Retention

- Technical logs: {{LOG_RETENTION}} days.
- Contact form messages: {{CONTACT_RETENTION}} months after last communication.

## 7. Your Rights

Under GDPR you have the right to:

- **Access** the personal data we hold about you.
- **Rectify** inaccurate data.
- **Erase** your data ("right to be forgotten").
- **Restrict** processing.
- **Object** to processing based on legitimate interest.
- **Data portability** — receive your data in a structured format.

To exercise these rights, contact us at **{{OPERATOR_EMAIL}}**. We will respond within 30 days.

You also have the right to lodge a complaint with your national supervisory authority (in France: [CNIL](https://www.cnil.fr)).

## 8. Security

We implement appropriate technical and organisational measures to protect your data against unauthorised access, loss, or disclosure.

## 9. Changes to This Policy

We may update this policy periodically. The date at the top of this page indicates when it was last revised. Continued use of the tour after a change constitutes acceptance.

## 10. Contact

Questions about this policy? Contact us at **{{OPERATOR_EMAIL}}**.
`,
      fr: `# Politique de confidentialité et cookies

*Dernière mise à jour : {{DATE}}*

Cette politique explique comment **{{SITE_NAME}}** (exploité par {{OPERATOR_NAME}}) collecte, utilise et protège vos données personnelles lors de votre visite de ce tour virtuel.

## 1. Responsable du traitement

Le responsable du traitement est :

**{{OPERATOR_NAME}}**
{{OPERATOR_ADDRESS}}
Email : {{OPERATOR_EMAIL}}

## 2. Données collectées

Lors de votre visite de ce tour virtuel, nous pouvons collecter les données suivantes :

- **Données techniques** : adresse IP, type et version de navigateur, système d'exploitation, identifiant d'appareil, pages consultées, temps de visite, URL de provenance.
- **Cookies** : petits fichiers déposés sur votre appareil pour améliorer votre expérience (voir section 4 ci-dessous).
- **Soumissions de formulaires de contact** : si vous utilisez un formulaire de contact ou de retour intégré dans le tour, nous recevons votre message et l'adresse e-mail que vous indiquez.

Nous ne collectons **pas** de données sensibles (santé, religion, opinions politiques, etc.).

## 3. Bases légales du traitement

Nous traitons vos données sur les bases légales suivantes (RGPD Art. 6) :

| Finalité | Base légale |
|---|---|
| Mesure d'audience et amélioration du contenu | Intérêt légitime (Art. 6.1.f) |
| Soumissions de formulaires de contact | Exécution d'un contrat / consentement (Art. 6.1.b / 6.1.a) |
| Consentement aux cookies | Consentement (Art. 6.1.a) |

## 4. Cookies

Ce site utilise les cookies suivants :

| Cookie | Finalité | Durée |
|---|---|---|
| \`cc_ok\` | Enregistre votre acceptation de la politique de cookies | 1 an |
| Cookies analytiques | Mesure de l'audience et amélioration du contenu | {{ANALYTICS_DURATION}} |

Vous pouvez refuser les cookies en ne cliquant pas sur « Accepter » dans la bannière, ou en supprimant vos cookies à tout moment dans votre navigateur.

## 5. Partage des données

Nous ne **vendons pas** vos données personnelles. Nous pouvons les partager avec :

- **Hébergeur** : {{HOST_NAME}} — stocke et diffuse les fichiers du site.
- **Fournisseur d'analytique** : {{ANALYTICS_PROVIDER}} — reçoit des statistiques d'usage anonymisées.

Tous les sous-traitants sont liés par des accords de traitement conformes au RGPD.

## 6. Durée de conservation

- Journaux techniques : {{LOG_RETENTION}} jours.
- Messages de formulaires de contact : {{CONTACT_RETENTION}} mois après la dernière communication.

## 7. Vos droits

En vertu du RGPD, vous disposez des droits suivants :

- **Accès** aux données personnelles que nous détenons vous concernant.
- **Rectification** des données inexactes.
- **Effacement** de vos données (« droit à l'oubli »).
- **Limitation** du traitement.
- **Opposition** au traitement fondé sur l'intérêt légitime.
- **Portabilité** des données — recevoir vos données dans un format structuré.

Pour exercer ces droits, contactez-nous à **{{OPERATOR_EMAIL}}**. Nous répondrons dans un délai de 30 jours.

Vous disposez également du droit d'introduire une réclamation auprès de la [CNIL](https://www.cnil.fr).

## 8. Sécurité

Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données contre tout accès non autorisé, perte ou divulgation.

## 9. Modifications de cette politique

Nous pouvons mettre à jour cette politique périodiquement. La date en haut de cette page indique la dernière révision. L'utilisation continue du tour après une modification vaut acceptation.

## 10. Contact

Des questions sur cette politique ? Contactez-nous à **{{OPERATOR_EMAIL}}**.
`,
    },
  },

  // ── Legal Notice (Mentions légales) ────────────────────────────────────────
  {
    id: 'page-legal',
    slug: 'legal',
    builtIn: 'legal',
    enabled: false,
    showInFooter: true,
    order: 1,
    title: {
      en: 'Legal Notice',
      fr: 'Mentions légales',
    },
    content: {
      en: `# Legal Notice

*(Required by French law — Loi pour la Confiance dans l'Économie Numérique, Art. 6)*

## Site Editor

**{{EDITOR_NAME}}**
{{EDITOR_TYPE}} — {{EDITOR_REGISTRATION}}
{{EDITOR_ADDRESS}}
Tel: {{EDITOR_PHONE}}
Email: {{EDITOR_EMAIL}}

## Director of Publication

{{DIRECTOR_NAME}}
Email: {{DIRECTOR_EMAIL}}

## Hosting

This virtual tour is hosted by:

**{{HOST_NAME}}**
{{HOST_ADDRESS}}
{{HOST_PHONE}}

## Intellectual Property

All content on this virtual tour (panoramic photographs, texts, logos, graphics) is the exclusive property of **{{EDITOR_NAME}}** or their licensors and is protected by French and international intellectual property law.

Any reproduction, representation, modification, or distribution of any element of this tour, whether total or partial, without the prior written consent of **{{EDITOR_NAME}}**, is strictly prohibited.

## Liability

{{EDITOR_NAME}} makes every effort to ensure the accuracy and currency of the information published on this tour. However, {{EDITOR_NAME}} cannot be held liable for:

- Errors or omissions in the content.
- Temporary unavailability of the tour.
- Any damage resulting from fraudulent intrusion by a third party.

## Personal Data

For information on how we handle personal data, please refer to our [Privacy & Cookies Policy](/page/privacy/).

## Applicable Law

This legal notice is governed by French law. Any dispute arising from the use of this tour shall be subject to the exclusive jurisdiction of the courts of **{{JURISDICTION}}**.
`,
      fr: `# Mentions légales

*(Conformément à la loi n° 2004-575 du 21 juin 2004 pour la Confiance dans l'Économie Numérique)*

## Éditeur du site

**{{EDITOR_NAME}}**
{{EDITOR_TYPE}} — {{EDITOR_REGISTRATION}}
{{EDITOR_ADDRESS}}
Tél. : {{EDITOR_PHONE}}
Email : {{EDITOR_EMAIL}}

## Directeur de la publication

{{DIRECTOR_NAME}}
Email : {{DIRECTOR_EMAIL}}

## Hébergement

Ce tour virtuel est hébergé par :

**{{HOST_NAME}}**
{{HOST_ADDRESS}}
{{HOST_PHONE}}

## Propriété intellectuelle

L'ensemble des contenus présents sur ce tour virtuel (photographies panoramiques, textes, logos, éléments graphiques) est la propriété exclusive de **{{EDITOR_NAME}}** ou de ses concédants de licence et est protégé par les lois françaises et internationales relatives à la propriété intellectuelle.

Toute reproduction, représentation, modification ou diffusion de tout ou partie des éléments de ce tour, sans l'autorisation écrite préalable de **{{EDITOR_NAME}}**, est strictement interdite.

## Responsabilité

{{EDITOR_NAME}} met tout en œuvre pour assurer l'exactitude et la mise à jour des informations diffusées sur ce tour. Cependant, {{EDITOR_NAME}} ne peut être tenu responsable :

- Des erreurs ou omissions dans le contenu.
- De l'indisponibilité temporaire du tour.
- De tout dommage résultant d'une intrusion frauduleuse d'un tiers.

## Données personnelles

Pour toute information sur la gestion de vos données personnelles, veuillez consulter notre [Politique de confidentialité](/page/privacy/).

## Droit applicable

Les présentes mentions légales sont régies par le droit français. Tout litige relatif à l'utilisation de ce tour sera soumis à la compétence exclusive des tribunaux de **{{JURISDICTION}}**.
`,
    },
  },

  // ── Terms of Use ──────────────────────────────────────────────────────────
  {
    id: 'page-terms',
    slug: 'terms',
    builtIn: 'terms',
    enabled: false,
    showInFooter: true,
    order: 2,
    title: {
      en: 'Terms of Use',
      fr: "Conditions générales d'utilisation",
    },
    content: {
      en: `# Terms of Use

*Last updated: {{DATE}}*

By accessing this virtual tour you agree to the following terms. If you do not agree, please stop using the tour.

## 1. Access to the Tour

**{{SITE_NAME}}** is provided free of charge. {{EDITOR_NAME}} reserves the right to suspend, modify, or withdraw access to the tour at any time without notice.

## 2. Acceptable Use

You agree to use this tour only for lawful purposes. You must not:

- Copy, reproduce, or redistribute the panoramic images or content without written permission.
- Use automated tools (scrapers, bots) to mass-download content.
- Attempt to bypass any technical restrictions in place.
- Use the tour in a way that could damage the reputation of {{EDITOR_NAME}}.

## 3. Intellectual Property

All content — photographs, graphics, text, and software — is the property of **{{EDITOR_NAME}}** or third-party licensors. No licence to use this content is granted by accessing this tour.

## 4. Links to Third Parties

This tour may contain links to third-party websites. {{EDITOR_NAME}} has no control over those sites and accepts no responsibility for their content or practices.

## 5. Disclaimer of Warranties

This tour is provided **"as is"** without warranties of any kind, express or implied. {{EDITOR_NAME}} does not warrant that the tour will be error-free, uninterrupted, or free of viruses.

## 6. Limitation of Liability

To the maximum extent permitted by applicable law, {{EDITOR_NAME}} shall not be liable for any indirect, incidental, or consequential damages arising from the use of this tour.

## 7. Governing Law

These terms are governed by the laws of **{{JURISDICTION}}**. Any dispute shall be submitted to the exclusive jurisdiction of the courts of {{JURISDICTION}}.

## 8. Contact

Questions? Contact us at **{{EDITOR_EMAIL}}**.
`,
      fr: `# Conditions générales d'utilisation

*Dernière mise à jour : {{DATE}}*

En accédant à ce tour virtuel, vous acceptez les présentes conditions. Si vous ne les acceptez pas, veuillez cesser d'utiliser le tour.

## 1. Accès au tour

**{{SITE_NAME}}** est mis à disposition gratuitement. {{EDITOR_NAME}} se réserve le droit de suspendre, modifier ou retirer l'accès au tour à tout moment et sans préavis.

## 2. Utilisation acceptable

Vous vous engagez à n'utiliser ce tour qu'à des fins licites. Il vous est interdit de :

- Copier, reproduire ou redistribuer les images panoramiques ou tout autre contenu sans autorisation écrite.
- Utiliser des outils automatisés (scrapers, robots) pour télécharger massivement le contenu.
- Tenter de contourner toute restriction technique en place.
- Utiliser le tour d'une manière susceptible de nuire à la réputation de {{EDITOR_NAME}}.

## 3. Propriété intellectuelle

L'ensemble des contenus — photographies, graphiques, textes et logiciels — est la propriété de **{{EDITOR_NAME}}** ou de tiers concédants de licence. L'accès au tour ne confère aucune licence d'utilisation de ces contenus.

## 4. Liens vers des tiers

Ce tour peut contenir des liens vers des sites tiers. {{EDITOR_NAME}} n'exerce aucun contrôle sur ces sites et décline toute responsabilité quant à leur contenu ou leurs pratiques.

## 5. Absence de garantie

Ce tour est fourni **« en l'état »**, sans garantie d'aucune sorte, expresse ou implicite. {{EDITOR_NAME}} ne garantit pas que le tour sera exempt d'erreurs, disponible en permanence ou exempt de virus.

## 6. Limitation de responsabilité

Dans toute la mesure permise par le droit applicable, {{EDITOR_NAME}} ne saurait être tenu responsable des dommages indirects, accessoires ou consécutifs résultant de l'utilisation de ce tour.

## 7. Droit applicable

Les présentes conditions sont régies par le droit applicable à **{{JURISDICTION}}**. Tout litige sera soumis à la compétence exclusive des tribunaux de {{JURISDICTION}}.

## 8. Contact

Des questions ? Contactez-nous à **{{EDITOR_EMAIL}}**.
`,
    },
  },

  // ── About ─────────────────────────────────────────────────────────────────
  {
    id: 'page-about',
    slug: 'about',
    builtIn: 'about',
    enabled: false,
    showInFooter: true,
    order: 3,
    title: {
      en: 'About',
      fr: 'À propos',
    },
    content: {
      en: `# About this Virtual Tour

**{{SITE_NAME}}** is an immersive 360° virtual tour produced by **{{EDITOR_NAME}}**.

{{SHORT_DESCRIPTION}}

## Credits

- **Photography & production**: {{EDITOR_NAME}}
- **Virtual tour platform**: [Conchitour](https://Conchitour.com)
- **Viewer technology**: krpano

## Contact

For any enquiry about this tour, contact us at **{{EDITOR_EMAIL}}**.
`,
      fr: `# À propos de ce tour virtuel

**{{SITE_NAME}}** est un tour virtuel immersif à 360° produit par **{{EDITOR_NAME}}**.

{{SHORT_DESCRIPTION}}

## Crédits

- **Photographie & production** : {{EDITOR_NAME}}
- **Plateforme de visite virtuelle** : [Conchitour](https://Conchitour.com)
- **Technologie de visualisation** : krpano

## Contact

Pour toute demande concernant ce tour, contactez-nous à **{{EDITOR_EMAIL}}**.
`,
    },
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  {
    id: 'page-contact',
    slug: 'contact',
    builtIn: 'contact',
    enabled: false,
    showInFooter: true,
    order: 4,
    title: {
      en: 'Contact',
      fr: 'Contact',
    },
    content: {
      en: `# Contact

Have a question or request? We'd love to hear from you.

## Get in Touch

**{{EDITOR_NAME}}**
{{EDITOR_ADDRESS}}

**Email**: {{EDITOR_EMAIL}}
**Phone**: {{EDITOR_PHONE}}

## Business Hours

{{BUSINESS_HOURS}}

---

*We aim to respond within 2 business days.*
`,
      fr: `# Contact

Une question ou une demande ? Nous serions ravis de vous entendre.

## Nous contacter

**{{EDITOR_NAME}}**
{{EDITOR_ADDRESS}}

**Email** : {{EDITOR_EMAIL}}
**Téléphone** : {{EDITOR_PHONE}}

## Horaires d'ouverture

{{BUSINESS_HOURS}}

---

*Nous nous engageons à répondre sous 2 jours ouvrés.*
`,
    },
  },
];

/** Stable set of built-in page IDs (used for migration checks). */
export const BUILTIN_PAGE_IDS = new Set(DEFAULT_BUILTIN_PAGES.map((p) => p.id));

/** Built-in slugs that cannot be used by custom user pages. */
export const BUILTIN_PAGE_SLUGS = new Set(DEFAULT_BUILTIN_PAGES.map((p) => p.slug));
