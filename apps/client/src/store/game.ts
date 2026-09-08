import { create } from 'zustand'
import type { Bet, Phase, PlayerPublic, RecentResult, ServerEvent } from '@rondo/protocol'

export interface LastResult {
  number: number
  color: 'red' | 'black' | 'green'
  returned: number | null
}

interface GameState {
  connection: 'connecting' | 'open' | 'closed'
  phase: Phase
  roundId: string | null
  bettingEndsAt: string | null
  playerId: string | null
  nickname: string
  balance: number
  myBets: Bet[]
  betTotals: Record<string, number>
  players: PlayerPublic[]
  recentResults: RecentResult[]
  /** Number the wheel should ease into; null while the target is unknown. */
  spinTarget: number | null
  lastResult: LastResult | null
  toast: string | null
  selectedChip: number
  setConnection: (connection: GameState['connection']) => void
  setSelectedChip: (chip: number) => void
  dismissToast: () => void
  apply: (event: ServerEvent) => void
}

/**
 * The single reducer for the wire: every server event lands here and is
 * narrowed by one switch on `type` — components only ever read plain state.
 */
export const useGame = create<GameState>((set) => ({
  connection: 'connecting',
  phase: 'betting',
  roundId: null,
  bettingEndsAt: null,
  playerId: null,
  nickname: '',
  balance: 0,
  myBets: [],
  betTotals: {},
  players: [],
  recentResults: [],
  spinTarget: null,
  lastResult: null,
  toast: null,
  selectedChip: 5,
  setConnection: (connection) => set({ connection }),
  setSelectedChip: (selectedChip) => set({ selectedChip }),
  dismissToast: () => set({ toast: null }),
  apply: (event) => {
    switch (event.type) {
      case 'table_snapshot': {
        const p = event.payload
        set({
          phase: p.phase,
          roundId: p.roundId,
          bettingEndsAt: p.bettingEndsAt,
          playerId: p.you.id,
          nickname: p.you.nickname,
          balance: p.you.balance,
          myBets: p.myBets,
          betTotals: p.betTotals,
          players: p.players,
          recentResults: p.recentResults,
          spinTarget: p.phase === 'spinning' || p.phase === 'result' ? p.lastNumber : null,
        })
        return
      }
      case 'phase_changed': {
        const { phase, roundId, bettingEndsAt } = event.payload
        set((state) => ({
          phase,
          roundId,
          bettingEndsAt,
          ...(phase === 'betting'
            ? { myBets: [], betTotals: {}, spinTarget: null, lastResult: null }
            : {}),
        }))
        return
      }
      case 'bet_accepted':
        set((state) => ({
          myBets: [...state.myBets, event.payload.bet],
          balance: event.payload.balance,
        }))
        return
      case 'bet_rejected':
        set({ toast: event.payload.reason })
        return
      case 'bets_cleared':
        set({ balance: event.payload.balance, myBets: event.payload.myBets })
        return
      case 'bet_totals':
        set({ betTotals: event.payload.betTotals })
        return
      case 'player_joined':
        set((state) => ({
          players: state.players.some((p) => p.id === event.payload.player.id)
            ? state.players
            : [...state.players, event.payload.player],
        }))
        return
      case 'player_left':
        set((state) => ({
          players: state.players.filter((p) => p.id !== event.payload.playerId),
        }))
        return
      case 'spin_result':
        set({ spinTarget: event.payload.number })
        return
      case 'round_settled': {
        const p = event.payload
        set({
          balance: p.balance,
          recentResults: p.recentResults,
          lastResult: { number: p.number, color: p.color, returned: p.returned },
        })
        return
      }
      case 'error':
        set({ toast: event.payload.message })
        return
    }
  },
}))
