import { describe, expect, it } from 'vitest'
import { RoomCore, type RoomPersistence, type RoomTransport } from './room'
import type { Peer, ServerMessage } from '../src/model/collab'
import { newProject } from '../src/model/project'

type Conn = { id: string; inbox: ServerMessage[] }

function makeRoom(project = newProject('Shared')) {
  const conns: { conn: Conn; peer: Peer }[] = []
  let flushIn: number | null = null
  let saved = 0
  const transport: RoomTransport<Conn> = {
    peers: () => conns,
    send: (c, m) => c.inbox.push(m),
    scheduleFlush: (ms) => (flushIn = ms),
  }
  const persistence: RoomPersistence = {
    load: async () => ({ project, version: 3 }),
    save: async () => ({ version: 3 + ++saved, updatedAt: 1 }),
  }
  const room = new RoomCore<Conn>(project.id, transport, persistence)
  const join = async (id: string, userId = 'u1') => {
    const conn: Conn = { id, inbox: [] }
    const peer: Peer = { id, userId, name: id, email: `${id}@x`, color: room.colorFor(conns.map((c) => c.peer)), role: userId === 'viewer' ? 'viewer' : 'editor' }
    conns.push({ conn, peer })
    await room.join(conn, peer)
    return { conn, peer }
  }
  return { room, join, conns, getFlush: () => flushIn, getSaved: () => saved }
}

describe('live room', () => {
  it('welcomes peers with the current project, relays operations and presence, and flushes later', async () => {
    const { room, join, getFlush, getSaved } = makeRoom()
    const a = await join('a')
    const b = await join('b', 'u2')
    expect(a.conn.inbox[0].t).toBe('welcome')
    expect(a.conn.inbox[1]).toEqual({ t: 'join', peer: b.peer })
    expect(b.conn.inbox[0]).toMatchObject({ t: 'welcome', version: 3, peers: [a.peer] })
    expect(a.peer.color).not.toBe(b.peer.color)
    const floorId = room.state!.project.floors[0].id
    await room.message(a.peer, JSON.stringify({ t: 'ops', ops: [{ k: 'entity', floorId, coll: 'points', id: 'p1', v: { id: 'p1', x: 1, y: 2 } }] }))
    expect(room.state!.project.floors[0].plan.points.p1).toEqual({ id: 'p1', x: 1, y: 2 })
    expect(b.conn.inbox.at(-1)).toMatchObject({ t: 'ops', from: 'a' })
    expect(a.conn.inbox.some((m) => m.t === 'ops')).toBe(false) // not echoed to the sender
    expect(getFlush()).toBe(2000)
    await room.message(b.peer, JSON.stringify({ t: 'presence', p: { floorId, cursor: { x: 0, y: 0 }, selection: [] } }))
    expect(a.conn.inbox.at(-1)).toMatchObject({ t: 'presence', from: 'b' })
    await room.flush()
    expect(getSaved()).toBe(1)
    expect(a.conn.inbox.at(-1)).toMatchObject({ t: 'saved', version: 4 })
    expect(room.state!.dirty).toBe(false)
    expect(room.state!.lastEditor).toBe('u1')
    // a late joiner gets the presence of the others and the new version
    const c = await join('c')
    expect(c.conn.inbox[0]).toMatchObject({ t: 'welcome', version: 4, presence: { b: { floorId } } })
    room.leave('b')
    expect(a.conn.inbox.at(-1)).toEqual({ t: 'leave', id: 'b' })
    // oversized messages are dropped
    await room.message(a.peer, JSON.stringify({ t: 'ops', ops: [{ k: 'project', v: { name: 'x'.repeat(2 * 1024 * 1024) } }] }))
    expect(room.state!.project.name.length).toBeLessThan(100)
    // a viewer's operations are ignored, its presence is relayed
    const v = await join('v', 'viewer')
    await room.message(v.peer, JSON.stringify({ t: 'ops', ops: [{ k: 'project', v: { name: 'Hacked' } }] }))
    expect(room.state!.project.name).not.toBe('Hacked')
    await room.message(v.peer, JSON.stringify({ t: 'presence', p: { floorId, cursor: { x: 1, y: 1 }, selection: [] } }))
    expect(a.conn.inbox.at(-1)).toMatchObject({ t: 'presence', from: 'v' })
  })

  it('refuses to join a project that does not exist and resets peers after an outside save', async () => {
    const { room, join } = makeRoom()
    const a = await join('a')
    const replaced = newProject('Replaced')
    room.externalSave(replaced, 9)
    expect(a.conn.inbox.at(-1)).toMatchObject({ t: 'reset', version: 9 })
    expect(room.state!.project.name).toBe('Replaced')
    const gone = new RoomCore<Conn>('missing', { peers: () => [], send: () => {}, scheduleFlush: () => {} }, { load: async () => null, save: async () => ({ version: 1, updatedAt: 1 }) })
    expect(await gone.join({ id: 'x', inbox: [] }, a.peer)).toBe(false)
  })
})
