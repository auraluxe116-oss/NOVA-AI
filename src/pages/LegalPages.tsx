import { ArrowLeft, FileCheck2, Lock, Scale, ShieldCheck } from 'lucide-react';
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
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            ) : (
              <Scale className="h-5 w-5 text-[#A78BFA]" />
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
              Conformité &amp; Transparence · NOVA AI (0 €)
            </p>
            <h1 className="font-display text-2xl font-bold text-[#FAFAFA] sm:text-3xl">
              {isPrivacy
                ? 'Politique de confidentialité (RGPD)'
                : isCgv
                ? "Conditions d'utilisation — Service 100 % Gratuit (0 €)"
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
            Conditions (0 €)
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
          <section className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-6 space-y-2.5">
            <div className="flex items-center gap-2 text-white font-display font-semibold text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h2>1. Engagement strict « Budget 0 € »</h2>
            </div>
            <p className="text-emerald-100/95">
              NOVA AI est exploitée exclusivement comme plateforme gratuite à 0 €. Aucun abonnement,
              aucune carte bancaire et aucune passerelle de paiement ne sont activés dans
              l&apos;application.
            </p>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              2. Quotas gratuits et comportement en cas de limite atteinte
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Visiteurs (sans compte) :</strong> 25 messages
                Assistant IA par jour et 10 générations Studio Business par jour.
              </li>
              <li>
                <strong className="text-white">Comptes gratuits enregistrés :</strong> 100 messages
                Assistant IA par jour, 40 générations Studio Business par jour et jusqu&apos;à 10
                sites HTML publiés.
              </li>
              <li>
                <strong className="text-white">Aucune facturation de dépassement :</strong> si une
                limite journalière ou un quota technique gratuit du moteur Google Gemini est atteint,
                un message explicatif s&apos;affiche sans déclencher de coût ni de prélèvement.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              3. Modèles et traitements locaux gratuits
            </h2>
            <p className="text-[#B2B2C6]">
              Les générations IA reposent uniquement sur les modèles gratuits Google Gemini (
              <code className="font-mono text-xs text-[#93C5FD]">gemini-4-hydrogen</code> et{' '}
              <code className="font-mono text-xs text-[#93C5FD]">gemini-3.1-flash-lite</code>). La
              conversion logo PNG, le studio vidéo <code className="font-mono text-xs">.webm</code>{' '}
              et l&apos;export PDF s&apos;exécutent directement dans votre navigateur sans serveur
              payant.
            </p>
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
              NOVA AI collecte uniquement les informations strictement nécessaires au
              fonctionnement gratuit du service :
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
                <strong className="text-white">Zéro donnée bancaire :</strong> aucune carte
                bancaire, adresse de facturation ni donnée de paiement n&apos;est collectée ou
                stockée.
              </li>
              <li>
                <strong className="text-white">Sécurité anti-abus &amp; quotas 0 € :</strong>{' '}
                hachage cryptographique HMAC de l&apos;adresse IP pour appliquer les limites
                journalières gratuites et la protection brute-force.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              2. Finalités, conservation et cookies
            </h2>
            <p>
              Vos données servent exclusivement à exécuter le service (authentification, isolation
              stricte de votre espace de travail, exécution de vos requêtes IA) et à protéger la
              sécurité de la plateforme.
            </p>
            <p>
              <strong className="text-white">Conservation :</strong> vos données de compte et de
              travail sont conservées tant que votre compte est actif, puis intégralement effacées
              dès suppression du compte depuis votre Profil.
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
              3. Sous-traitants techniques gratuits
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-[#B2B2C6]">
              <li>
                <strong className="text-white">Moteur d&apos;IA :</strong> Google Gemini API (niveau
                gratuit Google AI Studio) pour le traitement de vos requêtes envoyées dans
                l&apos;Assistant et le Studio Business.
              </li>
              <li>
                <strong className="text-white">Hébergement :</strong> infrastructure configurée par
                l&apos;exploitant (niveau gratuit).
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
            </ul>
          </section>
        </article>
      ) : (
        <article className="space-y-6 text-sm leading-relaxed text-[#C6C6DA]">
          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              1. Plateforme NOVA AI (Service gratuit 0 €)
            </h2>
            <p className="text-[#B2B2C6]">
              NOVA AI est une plateforme d&apos;intelligence artificielle et d&apos;accompagnement
              entrepreneurial configurée pour fonctionner avec un budget strict de 0 €, sans service
              payant ni facturation.
            </p>
          </section>

          <section className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-2.5">
            <h2 className="text-white font-display font-semibold text-base">
              2. Nature des contenus générés &amp; Responsabilité
            </h2>
            <p>
              NOVA AI fournit des outils d&apos;assistance rédactionnelle, technique, marketing et
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
