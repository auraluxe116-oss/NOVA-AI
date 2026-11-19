import { ArrowLeft, CreditCard, FileCheck2, Lock, ReceiptText, Scale, ShieldCheck } from 'lucide-react';
import type { PageView, PublicUser } from '../types/nova';

interface LegalPagesProps {
  mode: 'confidentialite' | 'mentions-legales' | 'cgv';
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
}

export function LegalPages({ mode, user, onNavigate }: LegalPagesProps) {
  const isPrivacy = mode === 'confidentialite';
  const isCgv = mode === 'cgv';

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1F1F2D] pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2C2C40] bg-[#111117]">
            {isPrivacy ? (
              <ShieldCheck className="h-5 w-5 text-[#3B82F6]" />
            ) : isCgv ? (
              <ReceiptText className="h-5 w-5 text-emerald-400" />
            ) : (
              <Scale className="h-5 w-5 text-[#A78BFA]" />
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
              Conformité &amp; Transparence · NOVA AI PRO
            </p>
            <h1 className="font-display text-2xl font-bold text-[#FAFAFA] sm:text-3xl">
              {isPrivacy
                ? 'Politique de confidentialité (RGPD)'
                : isCgv
                ? 'Conditions Générales de Vente (CGV), Résiliation & TVA'
                : 'Mentions légales'}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('mentions-legales')}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              mode === 'mentions-legales'
                ? 'border-[#7C3AED] bg-[#17132A] text-white'
                : 'border-[#2B2B3D] bg-[#111117] text-[#D6D6E8] hover:border-[#7C3AED] hover:text-white'
            }`}
          >
            Mentions légales
          </button>
          <button
            type="button"
            onClick={() => onNavigate('confidentialite')}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              mode === 'confidentialite'
                ? 'border-[#7C3AED] bg-[#17132A] text-white'
                : 'border-[#2B2B3D] bg-[#111117] text-[#D6D6E8] hover:border-[#7C3AED] hover:text-white'
            }`}
          >
            Confidentialité (RGPD)
          </button>
          <button
            type="button"
            onClick={() => onNavigate('cgv')}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              mode === 'cgv'
                ? 'border-[#7C3AED] bg-[#17132A] text-white'
                : 'border-[#2B2B3D] bg-[#111117] text-[#D6D6E8] hover:border-[#7C3AED] hover:text-white'
            }`}
          >
            CGV &amp; Remboursement
          </button>
          <button
            type="button"
            onClick={() => onNavigate(user ? 'profil' : 'accueil')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#171722] border border-[#2C2C40] px-3.5 py-2 text-xs font-medium text-white hover:border-[#3B82F6]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {user ? 'Profil' : 'Accueil'}
          </button>
        </div>
      </div>

      {isCgv ? (
        <article className="space-y-6 text-sm leading-relaxed text-[#C6C6DA]">
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            Modèle juridique préparé pour le pré-lancement commercial : complétez les mentions
            entre crochets <code className="font-mono">[À COMPLÉTER]</code> (statut TVA exact,
            coordonnées éditeur et médiateur de la consommation si B2C) et faites valider vos CGV
            définitives avant le passage en mode Stripe LIVE.
          </div>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <div className="flex items-center gap-2 text-white font-display font-semibold text-base">
              <CreditCard className="h-4 w-4 text-[#A78BFA]" />
              <h2>1. Formules, prix et transparence tarifaire</h2>
            </div>
            <p>
              NOVA AI PRO propose une formule <strong className="text-white">GRATUIT</strong> (0 €)
              et des abonnements payants <strong className="text-white">PRO</strong> et{' '}
              <strong className="text-white">BUSINESS</strong>. Les tarifs exacts applicables à
              chaque formule sont affichés en temps réel depuis la configuration Stripe officielle
              sur la page{' '}
              <button
                type="button"
                onClick={() => onNavigate('tarifs')}
                className="text-[#93C5FD] underline hover:text-white"
              >
                Tarifs
              </button>{' '}
              et récapitulés avant validation sur la page sécurisée Stripe Checkout.
            </p>
            <p className="text-[#B2B2C6]">
              Les paiements sont traités exclusivement par{' '}
              <strong className="text-white">Stripe</strong>. Aucun abonnement payant n&apos;est
              activé sans confirmation serveur du statut payé et validation cryptographique du
              webhook Stripe.
            </p>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              2. Renouvellement automatique et résiliation
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Reconduction tacite :</strong> les abonnements PRO et
                BUSINESS sont souscrits par période mensuelle ou annuelle selon le tarif choisi, avec
                renouvellement automatique à chaque échéance.
              </li>
              <li>
                <strong className="text-white">Résiliation en 1 clic :</strong> vous pouvez résilier
                à tout moment, sans frais ni préavis imposé, depuis votre{' '}
                <button
                  type="button"
                  onClick={() => onNavigate(user ? 'profil' : 'connexion')}
                  className="text-[#93C5FD] underline hover:text-white"
                >
                  Profil &gt; Abonnement &amp; Gestion Stripe
                </button>{' '}
                ou via le Portail client Stripe.
              </li>
              <li>
                <strong className="text-white">Effet de la résiliation :</strong> la résiliation
                stoppe le renouvellement suivant. Vous conservez vos avantages PRO/BUSINESS
                jusqu&apos;à la fin de la période déjà payée (date affichée dans votre Profil), puis
                votre compte repasse automatiquement en formule GRATUIT sans perte de données.
              </li>
              <li>
                <strong className="text-white">Défaut de paiement :</strong> en cas d&apos;échec
                de prélèvement au renouvellement (<code className="font-mono text-xs">past_due</code>
                ), les capacités payantes sont temporairement suspendues jusqu&apos;à mise à jour du
                moyen de paiement via le Portail Stripe.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              3. Droit de rétractation et politique de remboursement
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Clients consommateurs (UE / France) :</strong>{' '}
                conformément aux articles L221-18 et L221-28 du Code de la consommation, le client
                dispose en principe d&apos;un délai légal de 14 jours calendaires, sauf accord exprès
                d&apos;exécution immédiate du service numérique avant la fin du délai de rétractation.
              </li>
              <li>
                <strong className="text-white">Politique commerciale de remboursement :</strong>{' '}
                [À COMPLÉTER — Ex. remboursement sur demande justifiée sous X jours en cas de
                dysfonctionnement technique majeur non résolu, via e-mail support@votredomaine.fr].
              </li>
              <li>
                <strong className="text-white">Synchronisation automatique :</strong> tout
                remboursement intégral ou litige perdu dans Stripe entraîne automatiquement la
                révocation des droits payants associés et le retour en formule GRATUIT.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              4. TVA, devises et factures Stripe
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Régime de TVA :</strong> [À COMPLÉTER — Ex. Prix
                exprimés en euros TTC avec TVA française applicable (20 %) OU « TVA non applicable,
                article 293 B du CGI » si micro-entreprise en franchise].
              </li>
              <li>
                <strong className="text-white">Factures officielles :</strong> une facture est émise
                automatiquement par Stripe après chaque paiement confirmé. Vos factures sont
                consultables et téléchargeables en format PDF à tout moment depuis votre{' '}
                <button
                  type="button"
                  onClick={() => onNavigate(user ? 'profil' : 'connexion')}
                  className="text-[#93C5FD] underline hover:text-white"
                >
                  Profil &gt; Factures Stripe
                </button>{' '}
                et depuis le Portail client Stripe.
              </li>
              <li>
                <strong className="text-white">Clients professionnels (B2B) :</strong> l&apos;adresse
                de facturation complète est collectée lors du passage en caisse Stripe et modifiable
                depuis le Portail client Stripe.
              </li>
              <li>
                <strong className="text-white">Service client &amp; médiation :</strong> [À
                COMPLÉTER — E-mail de support facturation &amp; coordonnées du médiateur de la
                consommation si vente aux particuliers].
              </li>
            </ul>
          </section>
        </article>
      ) : isPrivacy ? (
        <article className="space-y-6 text-sm leading-relaxed text-[#C6C6DA]">
          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <div className="flex items-center gap-2 text-white font-display font-semibold text-base">
              <Lock className="h-4 w-4 text-[#3B82F6]" />
              <h2>1. Données personnelles collectées</h2>
            </div>
            <p>
              NOVA AI PRO collecte uniquement les informations strictement nécessaires au
              fonctionnement du service :
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Compte utilisateur :</strong> adresse e-mail, nom
                complet, nom d&apos;entreprise optionnel, empreinte chiffrée du mot de passe (scrypt)
                et empreinte du code de récupération.
              </li>
              <li>
                <strong className="text-white">Espace de travail :</strong> conversations,
                analyses business, créations d&apos;entreprise (logos SVG, sites HTML publiés),
                documents enregistrés et préférences d&apos;utilisation.
              </li>
              <li>
                <strong className="text-white">Facturation :</strong> identifiants techniques
                Stripe (client, abonnement, statut) lorsque vous souscrivez une formule payante.
                Aucune donnée de carte bancaire ne transite ni n&apos;est stockée sur nos serveurs.
              </li>
              <li>
                <strong className="text-white">Sécurité anti-abus :</strong> hachage
                cryptographique HMAC de l&apos;adresse IP pour la protection contre le brute-force
                et les requêtes automatisées abusives.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              2. Finalités, base légale, durée et cookies
            </h2>
            <p>
              Vos données servent exclusivement à exécuter le contrat de service (authentification,
              isolation stricte de votre espace de travail, exécution de vos requêtes IA, gestion
              Stripe de votre abonnement) et à protéger la sécurité de la plateforme (intérêt
              légitime).
            </p>
            <p>
              <strong className="text-white">Conservation :</strong> vos données de compte et de
              travail sont conservées tant que votre compte est actif, puis effacées dès suppression
              du compte. Les journaux comptables Stripe restent archivés selon les obligations
              légales applicables.
            </p>
            <p>
              L&apos;application utilise uniquement un cookie de session technique strictement
              nécessaire (<code className="font-mono text-xs text-[#93C5FD]">nova_session</code>,
              attributs <code className="font-mono text-xs text-[#93C5FD]">HttpOnly</code>,{' '}
              <code className="font-mono text-xs text-[#93C5FD]">SameSite=Lax</code> et{' '}
              <code className="font-mono text-xs text-[#93C5FD]">Secure</code> en HTTPS). Aucun
              traceur publicitaire tiers n&apos;est déposé.
            </p>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              3. Sous-traitants techniques
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Fournisseurs d&apos;IA :</strong> Google Gemini API
                (et fournisseurs optionnels configurés sur le serveur) pour le traitement de vos
                requêtes envoyées dans l&apos;Assistant et le Studio Business.
              </li>
              <li>
                <strong className="text-white">Paiements :</strong> Stripe, Inc. pour le paiement
                sécurisé, la gestion des abonnements et la génération des factures.
              </li>
              <li>
                <strong className="text-white">Hébergement :</strong>{' '}
                [À COMPLÉTER : nom, pays/région et coordonnées de l&apos;hébergeur final (ex. Vercel
                Inc. / région EU) avant mise en ligne].
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-3">
            <div className="flex items-center gap-2 text-white font-display font-semibold text-base">
              <FileCheck2 className="h-4 w-4 text-emerald-400" />
              <h2>4. Vos droits RGPD (Accès, Portabilité, Suppression)</h2>
            </div>
            <p>
              Conformément au RGPD (Règlement UE 2016/679), vous disposez d&apos;un droit
              d&apos;accès, de rectification, de portabilité, d&apos;opposition et d&apos;effacement
              de vos données, ainsi que du droit d&apos;introduire une réclamation auprès de la
              CNIL (<span className="font-mono text-xs">cnil.fr</span>) :
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Modifier ou exporter :</strong> mettez à jour vos
                informations ou téléchargez une archive JSON complète de vos données depuis votre{' '}
                <button
                  type="button"
                  onClick={() => onNavigate(user ? 'profil' : 'connexion')}
                  className="text-[#93C5FD] underline hover:text-white"
                >
                  Profil utilisateur
                </button>
                .
              </li>
              <li>
                <strong className="text-white">Suppression immédiate :</strong> supprimez
                définitivement votre compte, vos conversations, vos projets, vos sites publiés et
                vos journaux associés en un clic depuis votre Profil après confirmation du mot de
                passe.
              </li>
              <li>
                <strong className="text-white">Contact DPO / Éditeur :</strong>{' '}
                [À COMPLÉTER : e-mail de contact RGPD avant lancement public].
              </li>
            </ul>
          </section>
        </article>
      ) : (
        <article className="space-y-6 text-sm leading-relaxed text-[#C6C6DA]">
          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              1. Éditeur de la plateforme NOVA AI PRO
            </h2>
            <p className="text-xs text-amber-200/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              Note de pré-lancement : complétez obligatoirement les champs entre crochets ci-dessous
              avec vos coordonnées légales et fiscales exactes avant toute ouverture commerciale au
              public (obligation légale LCEN).
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Raison sociale / Éditeur :</strong> [À COMPLÉTER —
                Nom ou Société]
              </li>
              <li>
                <strong className="text-white">Forme juridique &amp; Immatriculation :</strong> [À
                COMPLÉTER — SASU / EURL / EI — SIREN / SIRET / RCS]
              </li>
              <li>
                <strong className="text-white">Numéro de TVA intracommunautaire :</strong> [À
                COMPLÉTER — FR... ou Mention franchise art. 293 B du CGI]
              </li>
              <li>
                <strong className="text-white">Adresse du siège / domiciliation :</strong> [À
                COMPLÉTER]
              </li>
              <li>
                <strong className="text-white">Directeur de publication &amp; Contact :</strong> [À
                COMPLÉTER — Nom &amp; e-mail de contact]
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">2. Hébergement</h2>
            <p>
              L&apos;application et sa base de données sont hébergées sur l&apos;infrastructure
              configurée par l&apos;exploitant : [À COMPLÉTER — Raison sociale, adresse postale et
              contact de l&apos;hébergeur de production, ex. Vercel Inc., 440 N Barranca Ave #4133,
              Covina, CA 91723, USA].
            </p>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              3. Nature des contenus générés &amp; Responsabilité
            </h2>
            <p>
              NOVA AI PRO fournit des outils d&apos;assistance rédactionnelle, technique, marketing et
              d&apos;aide à la structuration de projets d&apos;entreprise. Les plans financiers,
              contenus juridiques ou propositions commerciales générés par l&apos;intelligence
              artificielle sont des supports d&apos;aide à la décision : ils ne constituent pas un
              conseil juridique, comptable ou fiscal réglementé et ne comportent aucune garantie de
              résultat financier.
            </p>
            <p>
              Chaque utilisateur demeure seul responsable de la vérification des informations, de la
              conformité réglementaire de ses activités et des sites web qu&apos;il publie via
              l&apos;outil.
            </p>
          </section>
        </article>
      )}
    </main>
  );
}

