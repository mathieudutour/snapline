import { useEffect, useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import type { PlanComment, Vec2 } from '../model/types'

const when = (t: number) => {
  const d = new Date(t)
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString()
}

function placeStyle(screen: Vec2): React.CSSProperties {
  // to the right of the pin, kept inside the canvas
  return { left: Math.max(8, screen.x + 18), top: Math.max(8, screen.y - 20) }
}

/** the popover for a new comment at a spot on the plan */
export function CommentComposer({ screen, onSubmit, onCancel }: { screen: Vec2; onSubmit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 0) // after the click that opened us has settled
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="comment-thread" style={placeStyle(screen)} onPointerDown={(e) => e.stopPropagation()}>
      <div className="thread-head">
        <strong className="grow">New comment</strong>
        <button className="x" onClick={onCancel} title="Cancel">
          ×
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onSubmit(text)
        }}
      >
        <textarea
          ref={ref}
          value={text}
          placeholder="Write a comment… (Enter to post, Shift+Enter for a new line)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (text.trim()) onSubmit(text)
            }
          }}
        />
        <button className="button primary" type="submit" disabled={!text.trim()}>
          Post
        </button>
      </form>
    </div>
  )
}

/** an open thread: the comment, its replies, and actions */
export function CommentThread({ comment, screen, onClose }: { comment: PlanComment; screen: Vec2; onClose: () => void }) {
  const replyComment = useEditor((s) => s.replyComment)
  const setCommentResolved = useEditor((s) => s.setCommentResolved)
  const deleteComment = useEditor((s) => s.deleteComment)
  const readOnly = useEditor(isReadOnly)
  const user = useEditor((s) => s.user)
  const [text, setText] = useState('')
  const mine = (email: string) => (user ? user.email === email : email === '')
  const post = () => {
    if (!text.trim()) return
    replyComment(comment.id, text)
    setText('')
  }
  return (
    <div className="comment-thread" style={placeStyle(screen)} onPointerDown={(e) => e.stopPropagation()}>
      <div className="thread-head">
        {comment.resolved ? <span className="resolved-tag">✓ Resolved</span> : <strong>Comment</strong>}
        <span className="grow" />
        {!readOnly && (
          <button className="small" onClick={() => setCommentResolved(comment.id, !comment.resolved)} title={comment.resolved ? 'Reopen' : 'Mark as resolved'}>
            {comment.resolved ? 'Reopen' : 'Resolve'}
          </button>
        )}
        {!readOnly && mine(comment.author.email) && (
          <button className="x" title="Delete comment" onClick={() => confirm('Delete this comment and its replies?') && deleteComment(comment.id)}>
            🗑
          </button>
        )}
        <button className="x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="thread-body">
        <Message author={comment.author.name} at={comment.createdAt} text={comment.text} />
        {comment.replies.map((r) => (
          <Message key={r.id} author={r.author.name} at={r.createdAt} text={r.text} />
        ))}
      </div>
      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            post()
          }}
        >
          <textarea
            value={text}
            placeholder="Reply…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                post()
              }
            }}
          />
          <button className="button primary" type="submit" disabled={!text.trim()}>
            Reply
          </button>
        </form>
      )}
    </div>
  )
}

function Message({ author, at, text }: { author: string; at: number; text: string }) {
  return (
    <div className="comment-msg">
      <div className="who">
        <b>{author}</b>
        <span>{when(at)}</span>
      </div>
      <div className="text">{text}</div>
    </div>
  )
}

/** pin drawn on the plan (SVG, sized in pixels) */
export function CommentPin({ comment, px, open, onOpen }: { comment: PlanComment; px: number; open: boolean; onOpen: () => void }) {
  const initial = (comment.author.name || '?').slice(0, 1).toUpperCase()
  const fill = comment.resolved ? '#9aa0a6' : open ? '#1b4fc0' : '#2f6fed'
  return (
    <g
      data-kind="comment"
      data-id={comment.id}
      transform={`translate(${comment.x} ${comment.y}) scale(${px})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      <path d="M0 0 L-9 -12 A12 12 0 1 1 9 -12 Z" fill={fill} stroke="white" strokeWidth={1.5} />
      <text y={-15} fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {initial}
      </text>
      {comment.replies.length > 0 && (
        <g transform="translate(9 -24)">
          <circle r={6.5} fill="white" stroke={fill} strokeWidth={1.2} />
          <text fontSize={8} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill={fill} fontFamily="ui-sans-serif, system-ui, sans-serif">
            {comment.replies.length}
          </text>
        </g>
      )}
    </g>
  )
}
