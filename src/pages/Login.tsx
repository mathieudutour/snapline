import { signInUrl } from '../sync/api'
import { onLinkClick } from '../router'

export function Login({ reason }: { reason?: string }) {
  return (
    <div className="login">
      <a className="brand" href="/home" onClick={onLinkClick}>
        <span className="brand-mark">◫</span> Cordeau
      </a>
      <div className="login-card">
        <h1>Sign in</h1>
        <p className="muted">{reason ?? 'Sign in to open the editor. Your projects are saved to your account and available on any device.'}</p>
        <a className="button primary large google" href={signInUrl('/')}>
          <GoogleMark /> Continue with Google
        </a>
        <p className="fine">We only store the name and email address of your Google account, to show who is signed in. No passwords, no emails sent.</p>
      </div>
      <a className="back" href="/home" onClick={onLinkClick}>
        ← About Cordeau
      </a>
    </div>
  )
}

export function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.8 38 46.5 31.8 46.5 24.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}
