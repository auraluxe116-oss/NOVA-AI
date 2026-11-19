import { ArrowLeft, FileCheck2, Lock, Scale, ShieldCheck } from 'lucide-react';
import type { PageView, PublicUser } from '../types/nova';

interface LegalPagesProps {
  mode: 'confidentialite' | 'mentions-legales';
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
}

export function LegalPages({ mode, user, onNavigate }: LegalPagesProps) {
  const isPrivacy = mode === 'confidentialite';

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1F1F2D] pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2C2C40] bg-[#111117]">
            {isPrivacy ? (
              <ShieldCheck className="h-5 w-5 text-[#3B82F6]" />
            ) : (
              <Scale className="h-5 w-5 text-[#A78BFA]" />
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
              Conformité &amp; Transparence · NOVA AI PRO
            </p>
            <h1 className="font-display text-2xl font-bold text-[#FAFAFA] sm:text-3xl">
              {isPrivacy ? 'Politique de confidentialité (RGPD)' : 'Mentions légales'}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate(isPrivacy ? 'mentions-legales' : 'confidentialite')}
            className="rounded-lg border border-[#2B2B3D] bg-[#111117] px-3.5 py-2 text-xs font-medium text-[#D6D6E8] hover:border-[#7C3AED] hover:text-white"
          >
            {isPrivacy ? 'Voir les Mentions légales' : 'Voir la Confidentialité'}
          </button>
          <button
            type="button"
            onClick={() => onNavigate(user ? 'profil' : 'accueil')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#171722] border border-[#2C2C40] px-3.5 py-2 text-xs font-medium text-white hover:border-[#3B82F6]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {user ? 'Retour au Profil' : "Retour à l'accueil"}
          </button>
        </div>
      </div>

      {isPrivacy ? (
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
              2. Finalités, isolation et cookies
            </h2>
            <p>
              Vos données servent exclusivement à vous authentifier, isoler votre espace de travail
              (aucun autre utilisateur ne peut consulter vos conversations ou projets), exécuter vos
              requêtes IA et gérer votre abonnement.
            </p>
            <p>
              L&apos;application utilise un cookie de session technique strictement nécessaire (
              <code className="font-mono text-xs text-[#93C5FD]">nova_session</code>, attributs{' '}
              <code className="font-mono text-xs text-[#93C5FD]">HttpOnly</code> et{' '}
              <code className="font-mono text-xs text-[#93C5FD]">SameSite=Lax</code>). Aucun
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
                [À COMPLÉTER : nom et localisation de l&apos;hébergeur final avant mise en ligne].
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-3">
            <div className="flex items-center gap-2 text-white font-display font-semibold text-base">
              <FileCheck2 className="h-4 w-4 text-emerald-400" />
              <h2>4. Vos droits (Accès, Portabilité, Suppression)</h2>
            </div>
            <p>
              Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification,
              de portabilité et d&apos;effacement de vos données :
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
              Note de pré-lancement : complétez les champs entre crochets ci-dessous avec vos
              coordonnées légales exactes avant toute ouverture commerciale au public.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Raison sociale / Éditeur :</strong> [À COMPLÉTER —
                Nom ou Société]
              </li>
              <li>
                <strong className="text-white">Forme juridique &amp; Immatriculation :</strong> [À
                COMPLÉTER — SIREN / SIRET / RCS]
              </li>
              <li>
                <strong className="text-white">Adresse du siège / domiciliation :</strong> [À
                COMPLÉTER]
              </li>
              <li>
                <strong className="text-white">Directeur de publication &amp; Contact :</strong> [À
                COMPLÉTER — Nom &amp; e-mail]
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">2. Hébergement</h2>
            <p>
              L&apos;application et sa base de données sont hébergées sur l&apos;infrastructure
              configurée par l&apos;exploitant : [À COMPLÉTER — Nom, adresse et contact de
              l&apos;hébergeur de production].
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
