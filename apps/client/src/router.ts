import { useEffect, useState } from 'react'

export type Route = { view: 'lobby' } | { view: 'admin' } | { view: 'table'; tableId: string }

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/')
  if (parts[0] === 'table' && parts[1]) return { view: 'table', tableId: parts[1] }
  if (parts[0] === 'admin') return { view: 'admin' }
  return { view: 'lobby' }
}

/** Tiny hash router — three views don't need a routing library. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(hash: string) {
  window.location.hash = hash
}
