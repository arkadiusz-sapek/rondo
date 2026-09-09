import { create } from 'zustand'
import type {
  Bet,
  BjDealer,
  BjPhase,
  BjSeat,
  ChatMessage,
  Phase,
  PlayerPublic,
  RecentResult,
  ServerEvent,
  SkatState,
  TableMeta,
} from '@rondo/protocol'

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
  chat: ChatMessage[]
  chatUnread: number
  table: TableMeta | null
  bj: {
    phase: BjPhase
    bettingEndsAt: string | null
    seats: BjSeat[]
    dealer: BjDealer
    turn: { playerId: string; endsAt: string } | null
    myBet: number
    lastReturned: number | null
  }
  skat: SkatState | null
  setConnection: (connection: GameState['connection']) => void
  setSelectedChip: (chip: number) => void
  dismissToast: () => void
  markChatRead: () => void
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
  chat: [],
  chatUnread: 0,
  table: null,
  bj: {
    phase: 'betting',
    bettingEndsAt: null,
    seats: [],
    dealer: { cards: [], total: 0, hiding: true },
    turn: null,
    myBet: 0,
    lastReturned: null,
  },
  skat: null,
  setConnection: (connection) => set({ connection }),
  setSelectedChip: (selectedChip) => set({ selectedChip }),
  dismissToast: () => set({ toast: null }),
  markChatRead: () => set({ chatUnread: 0 }),
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
          chat: p.chatHistory,
          table: p.table,
        })
        return
      }
      case 'bj_snapshot': {
        const p = event.payload
        set({
          playerId: p.you.id,
          nickname: p.you.nickname,
          balance: p.you.balance,
          players: p.players,
          chat: p.chatHistory,
          table: p.table,
          bj: {
            phase: p.phase,
            bettingEndsAt: p.bettingEndsAt,
            seats: p.seats,
            dealer: p.dealer,
            turn: p.turn,
            myBet: p.seats.find((seat) => seat.playerId === p.you.id)?.bet ?? 0,
            lastReturned: null,
          },
        })
        return
      }
      case 'bj_phase':
        set((state) => ({
          bj: {
            ...state.bj,
            phase: event.payload.phase,
            bettingEndsAt: event.payload.bettingEndsAt,
            ...(event.payload.phase === 'betting'
              ? {
                  seats: [],
                  dealer: { cards: [], total: 0, hiding: true },
                  turn: null,
                  myBet: 0,
                  lastReturned: null,
                }
              : {}),
          },
        }))
        return
      case 'bj_bet_accepted':
        set((state) => ({
          balance: event.payload.balance,
          bj: { ...state.bj, myBet: event.payload.bet },
        }))
        return
      case 'bj_deal':
        set((state) => ({
          bj: { ...state.bj, seats: event.payload.seats, dealer: event.payload.dealer },
        }))
        return
      case 'bj_card': {
        const { to, card, total, busted } = event.payload
        set((state) => {
          if (to === 'dealer') {
            const dealer = { ...state.bj.dealer, cards: [...state.bj.dealer.cards, card], total }
            return { bj: { ...state.bj, dealer } }
          }
          const seats = state.bj.seats.map((seat) =>
            seat.playerId === to ? { ...seat, cards: [...seat.cards, card], total, busted } : seat,
          )
          return { bj: { ...state.bj, seats } }
        })
        return
      }
      case 'bj_turn':
        set((state) => ({ bj: { ...state.bj, turn: event.payload } }))
        return
      case 'bj_settled':
        set((state) => ({
          balance: event.payload.balance,
          bj: {
            ...state.bj,
            seats: event.payload.seats,
            dealer: event.payload.dealer,
            turn: null,
            lastReturned: event.payload.returned,
          },
        }))
        return
      case 'chat_message':
        set((state) => ({
          chat: [...state.chat, event.payload].slice(-100),
          chatUnread: state.chatUnread + 1,
        }))
        return
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
      case 'skat_state': {
        const { you, players, chatHistory, table, ...skat } = event.payload
        set((state) => ({
          skat,
          ...(you ? { playerId: you.id, nickname: you.nickname, balance: you.balance } : {}),
          ...(players ? { players } : {}),
          ...(chatHistory ? { chat: chatHistory } : {}),
          ...(table ? { table } : {}),
          connection: state.connection,
        }))
        return
      }
    }
  },
}))
