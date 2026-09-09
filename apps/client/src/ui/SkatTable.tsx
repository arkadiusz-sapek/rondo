import { Fragment, useMemo, useState } from 'react'
import {
  GRAND_BASE,
  SUIT_BASE,
  cardKey,
  legalPlays,
  matadors,
  nullValue,
  sortSkatHand,
  type SkatCard,
  type SkatState,
  type SkatSuit,
} from '@rondo/protocol'
import { SkatStage } from '../pixi/SkatStage'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'
import { TableName, Toast, TopBar } from './Hud'

const PHASE_LABEL: Record<SkatState['phase'], string> = {
  waiting: 'WAITING FOR PLAYERS',
  dealing: 'DEALING…',
  bidding: 'BIDDING',
  skat_decision: 'SKAT OR HAND?',
  discarding: 'PUT TWO AWAY',
  declaring: 'DECLARE YOUR GAME',
  playing: 'PLAYING',
  settled: 'RESULT',
  series_end: 'LIST COMPLETE',
}

const red = (suit: SkatSuit) => suit === '♥' || suit === '♦'

function MiniCard({ card }: { card: SkatCard }) {
  return (
    <span className={`mini-card ${red(card.suit) ? 'red' : ''}`}>
      {card.rank}
      {card.suit}
    </span>
  )
}

/* --------------------------------- the hand --------------------------------- */

function Hand() {
  const skat = useGame((state) => state.skat)!
  const [picked, setPicked] = useState<string[]>([])

  const contract = skat.contract
  const hand = useMemo(() => sortSkatHand(skat.yourHand, contract), [skat.yourHand, contract])
  const myTurn = skat.yourSeat !== null && skat.turnSeat === skat.yourSeat
  const discarding = skat.phase === 'discarding' && skat.declarerSeat === skat.yourSeat
  const playing = skat.phase === 'playing' && myTurn && contract !== null
  const legal = useMemo(() => {
    if (!playing || !contract) return new Set<string>()
    return new Set(legalPlays(skat.yourHand, skat.trick.map((play) => play.card), contract).map(cardKey))
  }, [playing, skat.yourHand, skat.trick, contract])

  if (hand.length === 0) return null

  const toggle = (key: string) =>
    setPicked((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : current.length < 2 ? [...current, key] : current,
    )

  const onCard = (card: SkatCard) => {
    const key = cardKey(card)
    if (discarding) return toggle(key)
    if (playing && legal.has(key)) {
      sendCommand({ type: 'skat_play', payload: { card } })
    }
  }

  const confirmDiscard = () => {
    const cards = hand.filter((card) => picked.includes(cardKey(card)))
    if (cards.length !== 2) return
    sendCommand({ type: 'skat_discard', payload: { cards: [cards[0], cards[1]] } })
    setPicked([])
  }

  return (
    <>
      <div className={`skat-hand count-${hand.length}`}>
        {hand.map((card, index) => {
          const key = cardKey(card)
          const active = discarding || (playing && legal.has(key))
          const mid = (hand.length - 1) / 2
          const angle = (index - mid) * 3.2
          const lift = Math.abs(index - mid) * 5
          return (
            <button
              key={key}
              type="button"
              className={[
                'skat-card',
                red(card.suit) ? 'red' : '',
                active ? 'active' : '',
                playing && !legal.has(key) ? 'dimmed' : '',
                picked.includes(key) ? 'picked' : '',
              ].join(' ')}
              style={{ transform: `rotate(${angle}deg) translateY(${lift}px)` }}
              onClick={() => onCard(card)}
            >
              <span className="corner">
                {card.rank}
                <br />
                {card.suit}
              </span>
              <span className="pip">{card.suit}</span>
            </button>
          )
        })}
      </div>
      {discarding && (
        <div className="skat-panel low">
          <span>Pick two cards for the skat ({picked.length}/2)</span>
          <button type="button" className="primary" disabled={picked.length !== 2} onClick={confirmDiscard}>
            Put them away
          </button>
        </div>
      )}
    </>
  )
}

/* -------------------------------- nameplates -------------------------------- */

function Nameplates() {
  const skat = useGame((state) => state.skat)!
  const yourSeat = skat.yourSeat ?? 0
  return (
    <>
      {skat.seats.map((seat) => {
        const rel = (seat.seat - yourSeat + 3) % 3
        const isTurn = skat.turnSeat === seat.seat
        const isDeclarer = skat.declarerSeat === seat.seat
        const bubble =
          skat.phase === 'bidding' && skat.bidding?.lastAction?.seat === seat.seat
            ? skat.bidding.lastAction.action === 'bid'
              ? `${skat.bidding.lastAction.value}!`
              : skat.bidding.lastAction.action === 'hold'
                ? `Yes, ${skat.bidding.lastAction.value}`
                : 'Pass'
            : null
        return (
          <div key={seat.seat} className={`skat-plate rel-${rel} ${isTurn ? 'turn' : ''}`}>
            {bubble && <span className="bid-bubble">{bubble}</span>}
            <span className="plate-name">{seat.nickname}</span>
            <span className="plate-tags">
              {skat.dealerSeat === seat.seat && <i title="dealer">G</i>}
              {skat.forehandSeat === seat.seat && <i title="forehand">V</i>}
              {isDeclarer && (
                <b>
                  {skat.contract ? `${skat.contract.type === 'suit' ? skat.contract.trump : skat.contract.type === 'grand' ? 'Grand' : 'Null'}` : '♟'}
                  {skat.bid ? ` ${skat.bid}` : ''}
                </b>
              )}
              {seat.tricksTaken > 0 && (
                <em>
                  {seat.tricksTaken} {seat.tricksTaken === 1 ? 'trick' : 'tricks'}
                </em>
              )}
            </span>
          </div>
        )
      })}
    </>
  )
}

/* ------------------------------ decision panels ------------------------------ */

function BiddingPanel() {
  const skat = useGame((state) => state.skat)!
  const bidding = skat.bidding
  if (skat.phase !== 'bidding' || !bidding || skat.yourSeat === null) return null
  const myTurn = skat.turnSeat === skat.yourSeat
  const nextValue = [18, 20, 22, 23, 24, 27, 30, 33, 35, 36, 40, 44, 45, 46, 48, 50, 54, 55, 59, 60, 63, 66, 70, 72, 77, 80, 81, 84, 88, 90, 96, 99, 100].find(
    (value) => value > (bidding.level ?? 0),
  )
  const speakerName = skat.seats[bidding.speakerSeat]?.nickname
  const listenerName = skat.seats[bidding.listenerSeat]?.nickname
  if (!myTurn) {
    return (
      <div className="skat-panel info">
        {bidding.awaiting === 'speak'
          ? `${speakerName} is thinking…`
          : `${listenerName} decides over ${bidding.level}…`}
      </div>
    )
  }
  const alone = bidding.speakerSeat === bidding.listenerSeat
  return (
    <div className="skat-panel">
      {bidding.awaiting === 'speak' ? (
        <>
          <span>{alone ? 'Both passed — take 18 or throw the cards in.' : `Say a value to ${listenerName}`}</span>
          <button type="button" className="primary" onClick={() => sendCommand({ type: 'skat_bid', payload: { action: 'bid' } })}>
            Bid {nextValue}
          </button>
          <button type="button" onClick={() => sendCommand({ type: 'skat_bid', payload: { action: 'pass' } })}>
            Pass
          </button>
        </>
      ) : (
        <>
          <span>
            {speakerName} says {bidding.level}
          </span>
          <button type="button" className="primary" onClick={() => sendCommand({ type: 'skat_bid', payload: { action: 'hold' } })}>
            Yes ({bidding.level})
          </button>
          <button type="button" onClick={() => sendCommand({ type: 'skat_bid', payload: { action: 'pass' } })}>
            Pass
          </button>
        </>
      )}
    </div>
  )
}

function SkatDecisionPanel() {
  const skat = useGame((state) => state.skat)!
  if (skat.phase !== 'skat_decision' || skat.declarerSeat !== skat.yourSeat) return null
  return (
    <div className="skat-panel">
      <span>You play for {skat.bid}.</span>
      <button type="button" className="primary" onClick={() => sendCommand({ type: 'skat_skat', payload: { take: true } })}>
        Take the skat
      </button>
      <button type="button" onClick={() => sendCommand({ type: 'skat_skat', payload: { take: false } })}>
        Play hand
      </button>
    </div>
  )
}

function DeclarePanel() {
  const skat = useGame((state) => state.skat)!
  const [ouvert, setOuvert] = useState(false)
  const [schneider, setSchneider] = useState(false)
  const [schwarz, setSchwarz] = useState(false)
  if (skat.phase !== 'declaring' || skat.declarerSeat !== skat.yourSeat) return null
  const bid = skat.bid ?? 18
  const handGame = skat.handGame

  const preview = (type: 'suit' | 'grand', trump: SkatSuit | null) => {
    const spitzen = matadors(skat.yourHand, { type, trump })
    const base = type === 'grand' ? GRAND_BASE : SUIT_BASE[trump!]
    return base * (spitzen.count + 1 + (handGame ? 1 : 0))
  }
  const declare = (type: 'suit' | 'grand' | 'null', trump: SkatSuit | null) =>
    sendCommand({
      type: 'skat_declare',
      payload: { type, trump, ouvert, schneider, schwarz },
    })
  const nullPlain = nullValue({ hand: handGame, ouvert: false })
  const nullOuvert = nullValue({ hand: handGame, ouvert: true })

  return (
    <div className="skat-panel declare">
      <span>
        Declare (bid {bid}
        {handGame ? ' · hand' : ''})
      </span>
      <div className="declare-games">
        {(['♦', '♥', '♠', '♣'] as const).map((suit) => (
          <button key={suit} type="button" className={red(suit) ? 'red' : ''} onClick={() => declare('suit', suit)}>
            {suit} <small>~{preview('suit', suit)}</small>
          </button>
        ))}
        <button type="button" onClick={() => declare('grand', null)}>
          Grand <small>~{preview('grand', null)}</small>
        </button>
        <button
          type="button"
          disabled={(ouvert ? nullOuvert : nullPlain) < bid}
          onClick={() => declare('null', null)}
        >
          Null <small>{ouvert ? nullOuvert : nullPlain}</small>
        </button>
      </div>
      <div className="declare-flags">
        <label>
          <input type="checkbox" checked={ouvert} onChange={(event) => setOuvert(event.target.checked)} />
          ouvert
        </label>
        {handGame && (
          <>
            <label>
              <input type="checkbox" checked={schneider} onChange={(event) => setSchneider(event.target.checked)} />
              schneider
            </label>
            <label>
              <input type="checkbox" checked={schwarz} onChange={(event) => setSchwarz(event.target.checked)} />
              schwarz
            </label>
          </>
        )}
      </div>
      {skat.skatForYou && (
        <div className="skat-reveal">
          skat was: {skat.skatForYou.map((card) => <MiniCard key={cardKey(card)} card={card} />)}
        </div>
      )}
    </div>
  )
}

/* --------------------------------- results ---------------------------------- */

function ResultOverlay() {
  const skat = useGame((state) => state.skat)!
  if (skat.phase !== 'settled') return null
  const result = skat.result
  if (!result) {
    return (
      <div className="skat-result">
        <h2>Thrown in</h2>
        <p className="muted">Nobody wanted this one — next dealer.</p>
      </div>
    )
  }
  const declarer = skat.seats[result.declarerSeat]
  const mine = skat.yourSeat === result.declarerSeat
  const delta = result.won ? result.value + 50 : -(2 * result.value + 50)
  return (
    <div className={`skat-result ${result.won ? 'won' : 'lost'}`}>
      <h2>
        {declarer?.nickname} {result.won ? 'wins' : 'loses'} {result.contractLabel} · {result.value}
      </h2>
      <p>
        {result.matadorsWith ? 'With' : 'Without'} {result.matadorsCount}
        {result.overbid ? ' · OVERBID!' : ''} · bid {result.bid}
      </p>
      <p className="points">
        {result.declarerPoints} : {120 - result.declarerPoints} card points
      </p>
      <p className="skat-was">
        skat: {result.skat.map((card) => <MiniCard key={cardKey(card)} card={card} />)}
      </p>
      <p className={`delta ${delta > 0 ? 'plus' : 'minus'}`}>
        {declarer?.nickname}: {delta > 0 ? '+' : ''}
        {delta}
        {!result.won && <span className="muted"> · defenders +40</span>}
      </p>
      {mine && !result.won && result.overbid && <p className="muted">The skat broke your matador run.</p>}
      <button type="button" className="primary" onClick={() => sendCommand({ type: 'skat_next', payload: {} })}>
        Next deal →
      </button>
    </div>
  )
}

function SeriesOverlay() {
  const skat = useGame((state) => state.skat)!
  if (skat.phase !== 'series_end') return null
  const standings = skat.seats
    .map((seat) => ({ seat, totals: skat.list.totals[seat.seat] }))
    .sort((a, b) => b.totals.final - a.totals.final)
  return (
    <div className="skat-result won">
      <h2>List complete — {skat.seriesLength} games</h2>
      {standings.map(({ seat, totals }, index) => (
        <p key={seat.seat} className={index === 0 ? 'delta plus' : ''}>
          {index + 1}. {seat.nickname} — {totals.final} pts ({totals.won}W/{totals.lost}L)
        </p>
      ))}
      <button type="button" className="primary" onClick={() => sendCommand({ type: 'skat_next', payload: {} })}>
        Start a new list
      </button>
    </div>
  )
}

/* ---------------------------------- the list --------------------------------- */

/**
 * The Wettspielliste, laid out like the official DSkV sheet: Grundwert,
 * Buben/Spitzen (mit/ohne), the six Gewinnstufen tick columns, Spielwerte
 * +/−, one pure-cumulative column per player with gew./verl. tallies (the
 * dealer's cell shaded, as on the print), the eingepasst column, and the
 * A/B/C footer (points · ±50 per game · 40 per opponents' loss).
 */
function ScoreList({ onClose }: { onClose: () => void }) {
  const skat = useGame((state) => state.skat)!
  const rows = skat.list.rows
  const totals = skat.list.totals
  const tick = '✗'
  const stufenCols = [
    { key: 'hand', label: 'Hand' },
    { key: 'schneider', label: 'Schneider' },
    { key: 'schneiderAnn', label: 'angesagt' },
    { key: 'schwarz', label: 'Schwarz' },
    { key: 'schwarzAnn', label: 'angesagt' },
    { key: 'ouvert', label: 'offen' },
  ] as const

  return (
    <div className="skat-list">
      <header>
        <h3>
          Wettspielliste <small>Serie {Math.min(skat.gameNo, skat.seriesLength)}/{skat.seriesLength} · 3er-Tisch</small>
        </h3>
        <button type="button" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="list-scroll">
        <table>
          <thead>
            <tr className="names-row">
              <th className="num" rowSpan={2}>
                Nr
              </th>
              <th className="v" rowSpan={2}>
                <span>Grundwert</span>
              </th>
              <th colSpan={2}>
                Buben/
                <br />
                Spitzen
              </th>
              <th colSpan={6}>Gewinnstufen</th>
              <th colSpan={2}>
                Spiel-
                <br />
                werte
              </th>
              {skat.seats.map((seat) => (
                <th key={seat.seat} colSpan={3} className="player-head">
                  {seat.nickname.replace(' 🤖', '')}
                </th>
              ))}
              <th className="v" rowSpan={2}>
                <span>eingepasst</span>
              </th>
            </tr>
            <tr className="subhead">
              <th className="v">
                <span>mit</span>
              </th>
              <th className="v">
                <span>ohne</span>
              </th>
              {stufenCols.map((col, index) => (
                <th key={index} className="v">
                  <span>{col.label}</span>
                </th>
              ))}
              <th>+</th>
              <th>−</th>
              {skat.seats.map((seat) => (
                <th key={seat.seat} colSpan={3} className="startnr">
                  Platz {seat.seat + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: skat.seriesLength }, (_, index) => {
              const row = rows[index]
              const dealer = row ? row.dealerSeat : (index % 3 + 2) % 3
              return (
                <tr key={index} className={row ? '' : 'empty'}>
                  <td className="num">{index + 1}</td>
                  <td>{row?.base ?? ''}</td>
                  <td>{row && row.matWith === true ? row.matCount : ''}</td>
                  <td>{row && row.matWith === false ? row.matCount : ''}</td>
                  {stufenCols.map((col, colIndex) => (
                    <td key={colIndex}>{row?.stufen?.[col.key] ? tick : ''}</td>
                  ))}
                  <td className="won">{row && row.plus > 0 ? row.plus : ''}</td>
                  <td className="lost">{row && row.minus > 0 ? row.minus : ''}</td>
                  {skat.seats.map((seat) => {
                    const isDeclarer = row && row.declarerSeat === seat.seat
                    return (
                      <Fragment key={seat.seat}>
                        <td className={`pcol ${seat.seat === dealer ? 'dealer' : ''} ${isDeclarer ? (row.won ? 'won' : 'lost') : ''}`}>
                          {isDeclarer ? row.cumAfter : ''}
                        </td>
                        <td className="gv">{isDeclarer && row.won === true ? '❙' : ''}</td>
                        <td className="gv">{isDeclarer && row.won === false ? '❙' : ''}</td>
                      </Fragment>
                    )
                  })}
                  <td>{row && row.declarerSeat === null ? tick : ''}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label" colSpan={12}>
                A&ensp;Summe der Punkte und Spiele
              </td>
              {totals.map((total, index) => (
                <Fragment key={index}>
                  <td className="pcol">{total.cum}</td>
                  <td className="gv">{total.won}</td>
                  <td className="gv">{total.lost}</td>
                </Fragment>
              ))}
              <td />
            </tr>
            <tr>
              <td className="foot-label" colSpan={12}>
                B&ensp;+ (gewonnene − verlorene) × 50
              </td>
              {totals.map((total, index) => (
                <Fragment key={index}>
                  <td className="pcol">{total.seegerBonus}</td>
                  <td className="gv" colSpan={2} />
                </Fragment>
              ))}
              <td />
            </tr>
            <tr>
              <td className="foot-label" colSpan={12}>
                C&ensp;+ verlorene Gegenspiele × 40
              </td>
              {totals.map((total, index) => (
                <Fragment key={index}>
                  <td className="pcol">{total.defenderBonus}</td>
                  <td className="gv" colSpan={2} />
                </Fragment>
              ))}
              <td />
            </tr>
            <tr className="final">
              <td className="foot-label" colSpan={12}>
                Endergebnis (A + B + C)
              </td>
              {totals.map((total, index) => (
                <Fragment key={index}>
                  <td className="pcol">{total.final}</td>
                  <td className="gv" colSpan={2} />
                </Fragment>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/** Always-on tournament glance: live Endergebnis per player. */
function Standings() {
  const skat = useGame((state) => state.skat)!
  const ordered = skat.seats
    .map((seat) => ({ seat, total: skat.list.totals[seat.seat] }))
    .sort((a, b) => b.total.final - a.total.final)
  return (
    <div className="skat-standings">
      {ordered.map(({ seat, total }, index) => (
        <div key={seat.seat} className={seat.seat === skat.yourSeat ? 'me' : ''}>
          <span className="pos">{index + 1}.</span>
          <span className="nick">{seat.nickname.replace(' 🤖', '')}</span>
          <span className="pts">{total.final}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------- the table -------------------------------- */

export function SkatTable() {
  const skat = useGame((state) => state.skat)
  const [listOpen, setListOpen] = useState(false)
  if (!skat) return <div className="center-note">joining the table…</div>

  const tricksPlayed = skat.seats.reduce((sum, seat) => sum + seat.tricksTaken, 0)
  const label =
    skat.phase === 'playing' ? `TRICK ${Math.min(10, tricksPlayed + 1)}/10` : PHASE_LABEL[skat.phase]

  return (
    <div className="table-layout skat-layout">
      <SkatStage />
      <TableName />
      <TopBar
        phaseLabel={`${label} · GAME ${Math.min(skat.gameNo, skat.seriesLength)}/${skat.seriesLength}`}
        phaseClass={skat.phase === 'playing' ? 'spinning' : 'betting'}
        endsAt={null}
      />
      <Nameplates />
      {skat.contract && skat.phase === 'playing' && (
        <div className="skat-contract-tag">
          {skat.seats[skat.declarerSeat ?? 0]?.nickname.replace(' 🤖', '')} plays{' '}
          {skat.contract.type === 'suit' ? skat.contract.trump : skat.contract.type} · {skat.bid}
        </div>
      )}
      {skat.ouvertCards && (
        <div className="skat-ouvert">
          ouvert: {skat.ouvertCards.map((card) => <MiniCard key={cardKey(card)} card={card} />)}
        </div>
      )}
      <BiddingPanel />
      <SkatDecisionPanel />
      <DeclarePanel />
      <ResultOverlay />
      <SeriesOverlay />
      <Hand />
      <button type="button" className="skat-list-toggle" onClick={() => setListOpen((open) => !open)}>
        ≣ Liste
      </button>
      <Standings />
      {listOpen && <ScoreList onClose={() => setListOpen(false)} />}
      <Toast />
    </div>
  )
}
