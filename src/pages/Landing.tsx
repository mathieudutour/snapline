import { useEditor } from '../model/store'
import { signInUrl } from '../sync/api'
import { onLinkClick } from '../router'
import { Lockup, Mark } from '../brand/Brand'
import { LockIcon } from '../brand/Icons'

const base = import.meta.env.BASE_URL.replace(/\/$/, '')

/**
 * The landing page sells the idea, not the feature list.
 *
 * It used to open with a 40 px headline, a 45-word paragraph, two CTAs of equal weight,
 * six identical feature cards and three captioned screenshots — with the one thing nobody
 * else does, measurements that stay true, buried in sentence three. Now the claim is the
 * headline, there is one primary action, the plan on the right shows a locked dimension
 * holding, and there are three features rather than six.
 */
/** the landing page scrolls inside itself, so "how it works" scrolls to the features rather than trusting a fragment */
function scrollToFeatures(e: React.MouseEvent<HTMLAnchorElement>) {
  const target = document.getElementById('features')
  if (!target) return
  e.preventDefault()
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function Landing() {
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  const canEdit = !!user || apiAvailable === false
  const primary = canEdit ? { href: '/', label: 'Open the editor' } : { href: signInUrl('/'), label: 'Start a plan — free' }
  return (
    <div className="landing">
      <header className="landing-nav">
        <a href="/home" onClick={onLinkClick} aria-label="Cordeau">
          <Lockup size={26} />
        </a>
        <nav>
          <a href="#features" onClick={scrollToFeatures}>
            How it works
          </a>
          <a href={`${base}/furniture/CREDITS.md`} target="_blank" rel="noreferrer">
            Furniture
          </a>
          <a href="https://github.com/mathieudutour/snapline" target="_blank" rel="noreferrer">
            Source
          </a>
          <a className="button" href={canEdit ? '/' : '/login'} onClick={onLinkClick}>
            {canEdit ? 'Open the editor' : 'Sign in'}
          </a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-text">
          <div className="eyebrow">Set out, not sketched</div>
          <h1>
            Type a wall once.
            <br />
            It stays true.
          </h1>
          <p>Every measurement you type becomes a rule the plan has to keep. Move a corner and the rest holds — or tells you exactly which two rules disagree.</p>
          <div className="hero-actions">
            <a className="button primary large" href={primary.href} onClick={primary.href === '/' ? onLinkClick : undefined}>
              {primary.label}
            </a>
            <a className="button large" href="#features" onClick={scrollToFeatures}>
              See how it works
            </a>
          </div>
          <p className="fine">Free. Sign in with Google to keep projects on your account and open them on any device.</p>
        </div>
        <figure className="hero-figure">
          <div className="hero-plan">
            <img src={`${base}/landing/plan.webp`} alt="A furnished two-bedroom floor plan drawn in Cordeau, with locked wall lengths and a list of rules" />
            {/* the claim, made on the drawing rather than in a paragraph */}
            <div className="locked-callout">
              <LockIcon size={12} strokeWidth={2.4} />
              Locked: 5.00 m front wall
            </div>
          </div>
          <div className="hero-thumbs">
            <img src={`${base}/landing/house-3d.webp`} alt="The same plan rendered in 3D with furniture, doors and windows" loading="lazy" />
            <img src={`${base}/landing/walk.webp`} alt="First-person view standing in an upstairs bedroom" loading="lazy" />
          </div>
        </figure>
      </section>

      <section id="features" className="features">
        <article>
          <div className="num">01</div>
          <h3>Rules, not one-off numbers</h3>
          <p>Lock a length, a gap, an angle. The solver keeps them true, and when two of them disagree it names both rather than quietly breaking one.</p>
        </article>
        <article>
          <div className="num">02</div>
          <h3>Draws like Figma</h3>
          <p>Single-key tools, scroll to pan, ⌘-scroll to zoom, ⌥-click any measurement to type a value. Walls snap to corners, walls and the grid.</p>
        </article>
        <article>
          <div className="num">03</div>
          <h3>Ends as a real drawing</h3>
          <p>A to-scale PDF with a title block, a glTF model for Blender or SketchUp, or a walkthrough of the house at eye level.</p>
        </article>
      </section>

      <section className="gallery">
        <figure>
          <img src={`${base}/landing/cutaway.webp`} alt="Cut-away view of the ground floor of a two-storey house" loading="lazy" />
          <figcaption>Cut above any floor to look inside — every plan is already a 3D model.</figcaption>
        </figure>
      </section>

      <footer className="landing-footer">
        <span className="lockup" style={{ gap: 7 }}>
          <Mark size={18} cut="icon" />
          <span style={{ color: 'inherit' }}>Cordeau</span>
        </span>
        <a href={`${base}/furniture/CREDITS.md`} target="_blank" rel="noreferrer">
          Furniture credits
        </a>
        <a href="https://github.com/mathieudutour/snapline" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  )
}
