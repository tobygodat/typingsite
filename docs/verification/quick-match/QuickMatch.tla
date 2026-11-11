---- MODULE QuickMatch ----
\* Quick match as supabase/migrations/20261110120000_quick_match.sql runs it: the queue, the countdown, the
\* race, and how a started race is settled (docs/adr/0014-quick-match-and-race-rating.md). Each browser tab
\* sends its requests one at a time and the service handles each atomically, as the one transaction it is.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Players, MaxPresses, MaxRooms, MaxChain,
  \* The pair's rated results before the next stands unrated (three in 24 hours in the service; the model lowers
  \* it so two rooms reach it). The model has no day: every room is inside one.
  Cap

VARIABLES phase, ticket, presses, mayEnter, room, chain, queue, rooms, badEnter,
  \* Whether the last step was a quick match request being handled.
  lastQuick

vars == <<phase, ticket, presses, mayEnter, room, chain, queue, rooms, badEnter, lastQuick>>

RoomIds == 1..MaxRooms
Live(r) == rooms[r].status \in {"countdown", "racing"}
Seated(p) == {r \in DOMAIN rooms : Live(r) /\ p \in rooms[r].seats}
Other(rm, p) == CHOOSE q \in rm.seats : q # p

\* A seat's row, once written: "none" until then. "traces" is a result two checked runs decided (a win, a loss or a
\* tie); "won" and "lost" are decided by one checked run; "nowinner" is a race no checked run decided.
Written(rm, s) == rm.row[s] # "none"

\* A started race is due once every seat has finished or left, or once its clock and grace have run out.
Due(rm) == rm.status = "racing" /\ (rm.ended \/ \A s \in rm.seats : rm.run[s] # "none" \/ rm.left[s])

\* The pair's other rooms with a rated row, and whether this room is past the cap, decided once per room.
PairRated(rs, r) == Cardinality({x \in DOMAIN rs : x # r /\ rs[x].seats = rs[r].seats /\ \E s \in rs[x].seats : rs[x].rated[s]})
Repeat(rs, r) == IF rs[r].repeat # "unset" THEN rs[r].repeat ELSE IF PairRated(rs, r) >= Cap THEN "yes" ELSE "no"

\* race_private.rate when the race settles: every seat without a row. A seat counts only with a run that passed.
Outcome(rm, s) ==
  LET o == Other(rm, s) IN
  IF rm.run[s] = "pass" /\ rm.run[o] = "pass" THEN "traces"
  ELSE IF rm.run[s] = "pass" THEN "won"
  ELSE IF rm.run[o] = "pass" THEN "lost"
  ELSE "nowinner"

Rate(rs, r) ==
  LET rep == Repeat(rs, r)
      rm == rs[r] IN
  [rs EXCEPT ![r].repeat = rep,
             ![r].row = [s \in rm.seats |-> IF Written(rm, s) THEN rm.row[s] ELSE Outcome(rm, s)],
             ![r].rated = [s \in rm.seats |-> IF Written(rm, s) THEN rm.rated[s] ELSE Outcome(rm, s) # "nowinner" /\ rep = "no"]]

\* race_private.rate with a forfeit: the seat that left after the start, before finishing, while the other was
\* still in the race, gets its rated loss now.
Forfeit(rs, r, p) ==
  LET rep == Repeat(rs, r) IN
  [rs EXCEPT ![r].repeat = rep, ![r].row[p] = "lost", ![r].rated[p] = (rep = "no"), ![r].forfeit[p] = TRUE]

Settle(rs, r) == [Rate(rs, r) EXCEPT ![r].status = "finished"]

\* race_private.advance on one room, and race_private.settle_due on all of them, oldest first.
SettleOne(rs, r) == IF Due(rs[r]) THEN Settle(rs, r) ELSE rs
RECURSIVE SweepFrom(_, _)
SweepFrom(rs, i) == IF i > Len(rs) THEN rs ELSE SweepFrom(SettleOne(rs, i), i + 1)
SweepAll(rs) == SweepFrom(rs, 1)

NewRoom(p, q) == [seats |-> {p, q}, status |-> "countdown", arrived |-> {}, clock |-> FALSE, ended |-> FALSE,
                  run |-> [s \in {p, q} |-> "none"], finish |-> [s \in {p, q} |-> "none"],
                  left |-> [s \in {p, q} |-> FALSE], forfeit |-> [s \in {p, q} |-> FALSE],
                  row |-> [s \in {p, q} |-> "none"], rated |-> [s \in {p, q} |-> FALSE], repeat |-> "unset"]

Init ==
  /\ phase = [p \in Players |-> "idle"]
  /\ ticket = [p \in Players |-> 0]
  /\ presses = [p \in Players |-> 0]
  /\ mayEnter = [p \in Players |-> FALSE]
  /\ room = [p \in Players |-> 0]
  /\ chain = [p \in Players |-> <<>>]
  /\ queue = {}
  /\ rooms = <<>>
  /\ badEnter = FALSE
  /\ lastQuick = FALSE

Send(p, req) == chain' = [chain EXCEPT ![p] = Append(@, req)]
Req(kind, t, r, v) == [kind |-> kind, ticket |-> t, room |-> r, verdict |-> v, done |-> FALSE, reply |-> 0]
InChain(p, kind) == \E i \in 1..Len(chain[p]) : chain[p][i].kind = kind

\* You press Quick match, or Stop looking while searching.
YouPress(p) ==
  /\ phase[p] \in {"idle", "searching"} /\ presses[p] < MaxPresses /\ Len(chain[p]) < MaxChain
  /\ presses' = [presses EXCEPT ![p] = @ + 1]
  /\ ticket' = [ticket EXCEPT ![p] = @ + 1]
  /\ IF phase[p] = "idle"
       THEN /\ phase' = [phase EXCEPT ![p] = "searching"] /\ mayEnter' = [mayEnter EXCEPT ![p] = TRUE]
            /\ Send(p, Req("queue", ticket[p] + 1, 0, "none"))
       ELSE /\ phase' = [phase EXCEPT ![p] = "idle"] /\ mayEnter' = [mayEnter EXCEPT ![p] = FALSE]
            /\ Send(p, Req("unqueue", ticket[p] + 1, 0, "none"))
  /\ UNCHANGED <<room, queue, rooms, badEnter>> /\ lastQuick' = FALSE

\* The searching tab asks again.
TabPolls(p) ==
  /\ phase[p] = "searching" /\ Len(chain[p]) < MaxChain /\ ~InChain(p, "queue")
  /\ Send(p, Req("queue", ticket[p], 0, "none"))
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, queue, rooms, badEnter>> /\ lastQuick' = FALSE

\* The racing tab sends progress while typing. It carries no keystroke record, and on a slow link it lands after
\* the race clock.
YouSendProgress(p) ==
  /\ phase[p] = "racing" /\ Len(chain[p]) < MaxChain
  /\ rooms[room[p]].status = "racing" /\ rooms[room[p]].run[p] = "none"
  /\ ~InChain(p, "progress") /\ ~InChain(p, "finish")
  /\ Send(p, Req("progress", 0, room[p], "none"))
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, queue, rooms, badEnter>> /\ lastQuick' = FALSE

\* The racing tab's clock ends and it sends its finish with its keystroke record: a run that passes the trace
\* check, or one that doesn't (no record after a reload, keys all at once). It may land after the race closed.
YouFinish(p, v) ==
  /\ phase[p] = "racing" /\ Len(chain[p]) < MaxChain
  /\ rooms[room[p]].status = "racing" /\ rooms[room[p]].run[p] = "none"
  /\ ~InChain(p, "finish")
  /\ Send(p, Req("finish", 0, room[p], v))
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, queue, rooms, badEnter>> /\ lastQuick' = FALSE

Done(p, reply) == chain' = [chain EXCEPT ![p][1].done = TRUE, ![p][1].reply = reply]

\* A race request reaches a room still open to this seat: racing, before the grace runs out, the seat unsettled.
Open(rm, p) == rm.status = "racing" /\ ~rm.ended /\ ~Written(rm, p)

\* The service handles the oldest request of a tab. A quick match request settles every due race first; a race
\* request settles its own room first.
ServiceHandles(p) ==
  /\ Len(chain[p]) > 0 /\ ~chain[p][1].done
  /\ LET req == chain[p][1] IN
     CASE req.kind = "queue" ->
            LET rs == SweepAll(rooms)
                seated == {r \in DOMAIN rs : rs[r].status \in {"countdown", "racing"} /\ p \in rs[r].seats} IN
            IF seated # {} THEN
              \* A race this seat left goes on until it settles: the seat waits, unqueued, rather than pair again.
              LET r == CHOOSE x \in seated : TRUE IN
              /\ Done(p, IF rs[r].left[p] THEN 0 ELSE r) /\ queue' = queue \ {p} /\ rooms' = rs
            ELSE IF queue \ {p} # {} /\ Len(rs) < MaxRooms THEN
              LET q == CHOOSE x \in queue \ {p} : TRUE IN
              /\ rooms' = Append(rs, NewRoom(p, q))
              /\ queue' = queue \ {p, q}
              /\ Done(p, Len(rs) + 1)
            ELSE /\ queue' = queue \cup {p} /\ Done(p, 0) /\ rooms' = rs
       [] req.kind = "unqueue" ->
            LET rs == SweepAll(rooms) IN
            /\ queue' = queue \ {p}
            /\ rooms' = [r \in DOMAIN rs |-> IF rs[r].status \in {"countdown", "racing"} /\ p \in rs[r].seats /\ p \notin rs[r].arrived
                           THEN [rs[r] EXCEPT !.status = "cancelled"] ELSE rs[r]]
            /\ Done(p, 0)
       [] req.kind = "get" ->
            LET rs == SettleOne(rooms, req.room) IN
            /\ rooms' = IF rs[req.room].status \in {"countdown", "racing"} THEN [rs EXCEPT ![req.room].arrived = @ \cup {p}] ELSE rs
            /\ Done(p, req.room) /\ UNCHANGED queue
       [] req.kind = "progress" ->
            \* Progress is only progress, whenever it lands: it never finishes a seat or decides its verdict.
            /\ rooms' = SettleOne(rooms, req.room)
            /\ Done(p, req.room) /\ UNCHANGED queue
       [] req.kind = "finish" ->
            \* The seat's own finish decides its verdict while the race is open to it; after that it changes nothing.
            LET rs == SettleOne(rooms, req.room)
                rm == rs[req.room] IN
            /\ rooms' = IF Open(rm, p) /\ rm.finish[p] = "none"
                          THEN SettleOne([rs EXCEPT ![req.room].finish[p] = req.verdict,
                                                    ![req.room].run[p] = IF rm.run[p] = "none" THEN req.verdict ELSE @], req.room)
                          ELSE rs
            /\ Done(p, req.room) /\ UNCHANGED queue
       [] req.kind = "leave" ->
            \* Before the start the race is off. After it, a seat that hasn't finished, while the other is still in
            \* the race, forfeits: its rated loss now, and the race goes on. Any other seat just goes. Once every
            \* seat has finished or left, the race settles.
            LET rs == SettleOne(rooms, req.room)
                rm == rs[req.room]
                o == Other(rm, p)
                gone == IF rm.run[p] = "none" /\ ~rm.left[o] /\ ~Written(rm, p) THEN Forfeit(rs, req.room, p) ELSE rs IN
            /\ rooms' = IF rm.status = "countdown" THEN [rs EXCEPT ![req.room].status = "cancelled"]
                        ELSE IF rm.status = "racing" THEN SettleOne([gone EXCEPT ![req.room].left[p] = TRUE], req.room)
                        ELSE rs
            /\ Done(p, 0) /\ UNCHANGED queue
  /\ lastQuick' = (chain[p][1].kind \in {"queue", "unqueue"})
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, badEnter>>

\* A reply reaches the tab. Only a reply to the current ticket while searching acts.
ReplyLands(p) ==
  /\ Len(chain[p]) > 0 /\ chain[p][1].done
  /\ LET req == chain[p][1] IN
     IF req.kind = "queue" /\ req.ticket = ticket[p] /\ phase[p] = "searching" /\ req.reply # 0 THEN
       /\ phase' = [phase EXCEPT ![p] = "racing"] /\ room' = [room EXCEPT ![p] = req.reply]
       /\ badEnter' = (badEnter \/ ~mayEnter[p])
       /\ chain' = [chain EXCEPT ![p] = Append(Tail(@), Req("get", 0, req.reply, "none"))]
       /\ UNCHANGED <<ticket, presses, mayEnter, queue, rooms>>
     ELSE IF req.kind \in {"get", "progress", "finish"} /\ room[p] = req.room /\ ~Live(req.room) THEN
       /\ phase' = [phase EXCEPT ![p] = "idle"] /\ room' = [room EXCEPT ![p] = 0]
       /\ chain' = [chain EXCEPT ![p] = Tail(@)]
       /\ UNCHANGED <<ticket, presses, mayEnter, queue, rooms, badEnter>>
     ELSE /\ chain' = [chain EXCEPT ![p] = Tail(@)] /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, queue, rooms, badEnter>>
  /\ lastQuick' = FALSE

\* A racer presses Leave race.
YouLeaveRace(p) ==
  /\ phase[p] = "racing" /\ Len(chain[p]) < MaxChain
  /\ Send(p, Req("leave", 0, room[p], "none"))
  /\ phase' = [phase EXCEPT ![p] = "idle"] /\ room' = [room EXCEPT ![p] = 0]
  /\ UNCHANGED <<ticket, presses, mayEnter, queue, rooms, badEnter>> /\ lastQuick' = FALSE

\* A racer closes the page: what it already sent may still arrive, and nothing else comes from it for that race.
YouCloseThePage(p) ==
  /\ phase[p] = "racing"
  /\ phase' = [phase EXCEPT ![p] = "idle"] /\ room' = [room EXCEPT ![p] = 0]
  /\ UNCHANGED <<ticket, presses, mayEnter, chain, queue, rooms, badEnter>> /\ lastQuick' = FALSE

\* The countdown ends: a room with a seat that never came is called off; otherwise the race is on.
CountdownEnds(r) ==
  /\ r \in DOMAIN rooms /\ rooms[r].status = "countdown"
  /\ rooms' = [rooms EXCEPT ![r].status = IF rooms[r].arrived = rooms[r].seats THEN "racing" ELSE "cancelled"]
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, queue, badEnter>> /\ lastQuick' = FALSE

\* The 30-second race clock runs out. Progress already on its way still lands after it.
ClockEnds(r) ==
  /\ r \in DOMAIN rooms /\ rooms[r].status = "racing" /\ ~rooms[r].clock
  /\ rooms' = [rooms EXCEPT ![r].clock = TRUE]
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, queue, badEnter>> /\ lastQuick' = FALSE

\* The ten-second grace after the clock runs out. Nothing settles until a request comes.
GraceEnds(r) ==
  /\ r \in DOMAIN rooms /\ rooms[r].status = "racing" /\ rooms[r].clock /\ ~rooms[r].ended
  /\ rooms' = [rooms EXCEPT ![r].ended = TRUE]
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, queue, badEnter>> /\ lastQuick' = FALSE

\* Anyone else's quick match request, such as a stranger opening the Online tab.
SomeoneElseAsks ==
  /\ \E r \in DOMAIN rooms : Due(rooms[r])
  /\ rooms' = SweepAll(rooms) /\ lastQuick' = TRUE
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, queue, badEnter>>

\* A player not heard from for ten seconds leaves the queue (a tab that isn't polling).
GoesStale(p) ==
  /\ p \in queue /\ ~InChain(p, "queue")
  /\ queue' = queue \ {p}
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, rooms, badEnter>> /\ lastQuick' = FALSE

Finished == (\A p \in Players : presses[p] = MaxPresses /\ chain[p] = <<>>) /\ UNCHANGED vars

Next == \/ \E p \in Players : YouPress(p) \/ TabPolls(p) \/ ServiceHandles(p) \/ ReplyLands(p) \/ YouLeaveRace(p)
                              \/ YouCloseThePage(p) \/ GoesStale(p) \/ YouSendProgress(p) \/ \E v \in {"pass", "fail"} : YouFinish(p, v)
        \/ \E r \in 1..MaxRooms : CountdownEnds(r) \/ ClockEnds(r) \/ GraceEnds(r)
        \/ SomeoneElseAsks
        \/ Finished

Spec == Init /\ [][Next]_vars
\* Liveness: the clock always runs out, and someone eventually asks.
FairSpec == Spec /\ \A r \in RoomIds : WF_vars(CountdownEnds(r)) /\ WF_vars(ClockEnds(r)) /\ WF_vars(GraceEnds(r)) /\ WF_vars(SomeoneElseAsks)

\* The queue.
NobodyInTwoMatches == \A p \in Players : Cardinality(Seated(p)) <= 1
NobodyPairedWithThemselves == \A r \in DOMAIN rooms : Cardinality(rooms[r].seats) = 2
NobodyQueuedWhileSeated == \A p \in queue : Seated(p) = {}
NobodyRacesAlone == \A r \in DOMAIN rooms : rooms[r].status = "racing" => rooms[r].arrived = rooms[r].seats
StopMeansNoRace == ~badEnter

\* Settling. Each invariant is over every room and seat.
\* A seat's verdict is the verdict of its own finish: progress, however late, never decides it, so an honest run
\* whose finish reached the open race counts as one.
VerdictIsItsFinish == \A r \in DOMAIN rooms : \A s \in rooms[r].seats : rooms[r].run[s] = rooms[r].finish[s]
\* A win needs the seat's own checked run.
WinNeedsOwnPass == \A r \in DOMAIN rooms : \A s \in rooms[r].seats : rooms[r].row[s] \in {"won", "traces"} => rooms[r].run[s] = "pass"
\* A run that passed beats a seat with none, whatever that seat did or didn't send.
APassBeatsNoPass == \A r \in DOMAIN rooms : \A s \in rooms[r].seats :
  (rooms[r].status = "finished" /\ rooms[r].run[s] = "pass" /\ rooms[r].run[Other(rooms[r], s)] # "pass") => rooms[r].row[s] = "won"
\* A race no checked run decided has no winner.
NoPassNoWinner == \A r \in DOMAIN rooms : \A s \in rooms[r].seats :
  (Written(rooms[r], s) /\ \A x \in rooms[r].seats : rooms[r].run[x] # "pass") => rooms[r].row[s] \in {"nowinner", "lost"}
\* A forfeit is a rated loss (unless the pair is past its cap) for a seat that hadn't finished.
ForfeitLoses == \A r \in DOMAIN rooms : \A s \in rooms[r].seats : rooms[r].forfeit[s] =>
  (rooms[r].row[s] = "lost" /\ rooms[r].run[s] = "none" /\ rooms[r].rated[s] = (rooms[r].repeat = "no"))
\* One seat rated and the other not is a forfeit's loss alone.
OneSidedIsAForfeit == \A r \in DOMAIN rooms : \A s \in rooms[r].seats :
  (rooms[r].status = "finished" /\ rooms[r].rated[s] /\ ~rooms[r].rated[Other(rooms[r], s)]) => rooms[r].forfeit[s]
\* A decided result goes unrated only past the pair's cap.
UnratedOnlyPastTheCap == \A r \in DOMAIN rooms : \A s \in rooms[r].seats :
  (Written(rooms[r], s) /\ rooms[r].row[s] # "nowinner" /\ ~rooms[r].rated[s]) => rooms[r].repeat = "yes"
\* No pair moves ratings in more rooms than its cap.
PairWithinCap == \A r \in DOMAIN rooms : Cardinality({x \in DOMAIN rooms : rooms[x].seats = rooms[r].seats /\ \E s \in rooms[x].seats : rooms[x].rated[s]}) <= Cap
\* A finished race has both rows; nothing that started is called off.
FinishedHasResult == \A r \in DOMAIN rooms : rooms[r].status = "finished" => \A s \in rooms[r].seats : Written(rooms[r], s)
StartedIsNeverCalledOff == \A r \in DOMAIN rooms : rooms[r].status = "cancelled" => ~rooms[r].clock
\* Right after any quick match request, no due race is left unsettled.
QuickRequestSettlesAll == lastQuick => \A r \in DOMAIN rooms : ~Due(rooms[r])

\* Written is written: no later request, finish or replay changes a seat's row or the run it was decided on.
ResultsStay == [][\A r \in DOMAIN rooms : \A s \in rooms[r].seats : Written(rooms[r], s) =>
  (rooms'[r].row[s] = rooms[r].row[s] /\ rooms'[r].rated[s] = rooms[r].rated[s] /\ rooms'[r].run[s] = rooms[r].run[s])]_vars
\* Every race that starts is settled, once the clock runs out and someone asks.
EveryStartedRaceSettles == \A r \in RoomIds :
  [](r \in DOMAIN rooms /\ rooms[r].status = "racing" => <>(r \in DOMAIN rooms /\ rooms[r].status # "racing"))
====
