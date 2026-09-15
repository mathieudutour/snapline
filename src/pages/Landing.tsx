import { useEditor } from '../model/store'
import { signInUrl } from '../sync/api'
import { onLinkClick } from '../router'

const base = import.meta.env.BASE_URL.replace(/\/$/, '')

export function Landing() {
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  const primary = user || apiAvailable === false ? { href: '/', label: 'Open the editor' } : { href: signInUrl('/'), label: 'Sign in with Google' }
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="brand" href="/home" onClick={onLinkClick}>
          <span className="brand-mark">◫</span> Cordeau
        </a>
        <nav>
          <a href="#features">Features</a>
          <a href="https://github.com/mathieudutour/snapline" target="_blank" rel="noreferrer">
            Source
          </a>
          {user ? (
            <a className="button primary" href="/" onClick={onLinkClick}>
              Open the editor
            </a>
          ) : (
            <a className="button primary" href="/login" onClick={onLinkClick}>
              Sign in
            </a>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-text">
          <h1>Floor plans that remember your measurements.</h1>
          <p>
            Draw walls, doors, windows and furniture in the browser. Every length you type stays true as a constraint, so moving one wall never quietly breaks the rest of the
            plan. Then walk through the result in 3D.
          </p>
          <div className="hero-actions">
            <a className="button primary large" href={primary.href} onClick={primary.href === '/' ? onLinkClick : undefined}>
              {primary.label}
            </a>
            <a className="button large" href="#features">
              See how it works
            </a>
          </div>
          <p className="fine">Free. Sign in with Google to keep projects on your account and open them on any device.</p>
        </div>
        <figure className="hero-figure">
          <img src={`${base}/landing/plan.webp`} alt="A furnished two-bedroom floor plan drawn in Cordeau, with locked wall lengths and a list of constraints" />
        </figure>
      </section>

      <section id="features" className="features">
        <article>
          <h3>Measurements become rules</h3>
          <p>Type a length in the inspector, or ⌥-click any dimension. It is locked from then on. Conflicting rules are highlighted, never silently broken.</p>
        </article>
        <article>
          <h3>Snapping that thinks</h3>
          <p>Walls align to corners, walls and the grid. Furniture dropped against a wall stays glued to it when the wall moves.</p>
        </article>
        <article>
          <h3>Rooms, floors and a roof</h3>
          <p>Closed walls become rooms with their area. Stack floors, trace over the floor below, and cap it with a gable, hip or flat roof.</p>
        </article>
        <article>
          <h3>Real furniture</h3>
          <p>A catalogue of more than a hundred beds, sofas, kitchen units and bathroom fixtures, with true sizes, from free Sweet Home 3D libraries.</p>
        </article>
        <article>
          <h3>3D and walkthrough</h3>
          <p>Orbit the house, cut it open floor by floor, or walk through it at eye level with the mouse and keyboard.</p>
        </article>
        <article>
          <h3>Yours, anywhere</h3>
          <p>Projects are saved in your browser and, when you are signed in, on your account. Export and import them as JSON at any time.</p>
        </article>
      </section>

      <section className="gallery">
        <figure>
          <img src={`${base}/landing/house-3d.webp`} alt="The same plan rendered in 3D with furniture, doors and windows" loading="lazy" />
          <figcaption>Every plan is a 3D model.</figcaption>
        </figure>
        <figure>
          <img src={`${base}/landing/cutaway.webp`} alt="Cut-away view of the ground floor of a two-storey house" loading="lazy" />
          <figcaption>Cut above any floor to look inside.</figcaption>
        </figure>
        <figure>
          <img src={`${base}/landing/walk.webp`} alt="First-person view standing in an upstairs bedroom" loading="lazy" />
          <figcaption>Walk through it before you build it.</figcaption>
        </figure>
      </section>

      <footer className="landing-footer">
        <span>Cordeau</span>
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
