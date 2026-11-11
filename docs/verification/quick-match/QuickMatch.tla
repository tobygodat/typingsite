---- MODULE QuickMatch ----
\* Quick match as supabase/migrations/20261110120000_quick_match.sql runs it: the queue, the countdown, the
\* race, and how a started race is settled (docs/adr/0014-quick-match-and-race-rating.md). Each browser tab
\* sends its requests one at a time and the service handles each atomically, as the one transaction it is.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Players, MaxPresses, MaxRooms, MaxChain

VARIABLES phase, ticket, presses, mayEnter, room, chain, queue, rooms, badEnter,
  \* Whether the last step was a quick match request being handled.
  lastQuick

vars == <<phase, ticket, presses, mayEnter, room, chain, queue, rooms, badEnter, lastQuick>>

RoomIds == 1..MaxRooms
Live(r) == rooms[r].status \in {"countdown", "racing"}
Seated(p) == {r \in DOMAIN rooms : Live(r) /\ p \in rooms[r].seats}
Other(r, p) == CHOOSE q \in rooms[r].seats : q # p

\* A started race is due once both seats have finished, or once its clock and grace have run out.
Due(rm) == rm.status = "racing" /\ (rm.ended \/ \A s \in rm.seats : rm.run[s] # "none")

\* race_private.rate for a race the clock ends: a seat counts only with a run that passed the check.
Settled(rm) ==
  LET passed == {s \in rm.seats : rm.run[s] = "pass"} IN
  [rm EXCEPT !.status = "finished",
             !.result = IF passed = {} THEN "unrated" ELSE "rated",
             !.winner = IF Cardinality(passed) = 1 THEN CHOOSE s \in passed : TRUE
                        ELSE IF passed = {} THEN "none" ELSE "traces"]

\* race_private.advance on one room, and race_private.settle_due on all of them.
SettleOne(rs, r) == IF Due(rs[r]) THEN [rs EXCEPT ![r] = Settled(rs[r])] ELSE rs
SweepAll(rs) == [r \in DOMAIN rs |-> IF Due(rs[r]) THEN Settled(rs[r]) ELSE rs[r]]

NewRoom(p, q) == [seats |-> {p, q}, status |-> "countdown", arrived |-> {}, ended |-> FALSE,
                  run |-> [s \in {p, q} |-> "none"], result |-> "none", winner |-> "none", forfeit |-> "none"]

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
  /\ phase[p] = "searching" /\ Len(chain[p]) < MaxChain
  /\ \A i \in 1..Len(chain[p]) : chain[p][i].kind # "queue"
  /\ Send(p, Req("queue", ticket[p], 0, "none"))
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, queue, rooms, badEnter>> /\ lastQuick' = FALSE

\* The racing tab's clock ends and it sends its finish: a run that passes the trace check, or one that doesn't
\* (no trace after a reload, keys all at once). It may land after the race has closed.
YouFinish(p, v) ==
  /\ phase[p] = "racing" /\ Len(chain[p]) < MaxChain
  /\ rooms[room[p]].status = "racing" /\ rooms[room[p]].run[p] = "none"
  /\ \A i \in 1..Len(chain[p]) : chain[p][i].kind # "finish"
  /\ Send(p, Req("finish", 0, room[p], v))
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, queue, rooms, badEnter>> /\ lastQuick' = FALSE

Done(p, reply) == chain' = [chain EXCEPT ![p][1].done = TRUE, ![p][1].reply = reply]

\* The service handles the oldest request of a tab. A quick match request settles every due race first; a race
\* request settles its own room first.
ServiceHandles(p) ==
  /\ Len(chain[p]) > 0 /\ ~chain[p][1].done
  /\ LET req == chain[p][1] IN
     CASE req.kind = "queue" ->
            LET rs == SweepAll(rooms)
                seated == {r \in DOMAIN rs : rs[r].status \in {"countdown", "racing"} /\ p \in rs[r].seats} IN
            IF seated # {} THEN
              /\ Done(p, CHOOSE r \in seated : TRUE) /\ queue' = queue \ {p} /\ rooms' = rs
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
       [] req.kind = "finish" ->
            \* A finish counts while the race is on; after its grace, or once settled, it changes nothing.
            LET rs == SettleOne(rooms, req.room) IN
            /\ rooms' = IF rs[req.room].status = "racing" /\ ~rs[req.room].ended /\ rs[req.room].run[p] = "none"
                          THEN SettleOne([rs EXCEPT ![req.room].run[p] = req.verdict], req.room) ELSE rs
            /\ Done(p, req.room) /\ UNCHANGED queue
       [] req.kind = "leave" ->
            \* Before the start the race is off; after it, a seat that hasn't finished forfeits; a seat that has
            \* just goes, and the clock settles the race.
            LET rs == SettleOne(rooms, req.room)
                rm == rs[req.room] IN
            /\ rooms' = IF rm.status = "countdown" THEN [rs EXCEPT ![req.room].status = "cancelled"]
                        ELSE IF rm.status = "racing" /\ rm.run[p] = "none"
                          THEN [rs EXCEPT ![req.room].status = "cancelled", ![req.room].result = "rated",
                                          ![req.room].winner = Other(req.room, p), ![req.room].forfeit = p]
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
     ELSE IF req.kind \in {"get", "finish"} /\ room[p] = req.room /\ ~Live(req.room) THEN
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

\* The race clock and its ten-second grace run out. Nothing settles until a request comes.
GraceEnds(r) ==
  /\ r \in DOMAIN rooms /\ rooms[r].status = "racing" /\ ~rooms[r].ended
  /\ rooms' = [rooms EXCEPT ![r].ended = TRUE]
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, queue, badEnter>> /\ lastQuick' = FALSE

\* Anyone else's quick match request, such as a stranger opening the Online tab.
SomeoneElseAsks ==
  /\ \E r \in DOMAIN rooms : Due(rooms[r])
  /\ rooms' = SweepAll(rooms) /\ lastQuick' = TRUE
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, queue, badEnter>>

\* A player not heard from for ten seconds leaves the queue (a tab that isn't polling).
GoesStale(p) ==
  /\ p \in queue /\ \A i \in 1..Len(chain[p]) : chain[p][i].kind # "queue"
  /\ queue' = queue \ {p}
  /\ UNCHANGED <<phase, ticket, presses, mayEnter, room, chain, rooms, badEnter>> /\ lastQuick' = FALSE

Finished == (\A p \in Players : presses[p] = MaxPresses /\ chain[p] = <<>>) /\ UNCHANGED vars

Next == \/ \E p \in Players : YouPress(p) \/ TabPolls(p) \/ ServiceHandles(p) \/ ReplyLands(p) \/ YouLeaveRace(p)
                              \/ YouCloseThePage(p) \/ GoesStale(p) \/ \E v \in {"pass", "fail"} : YouFinish(p, v)
        \/ \E r \in 1..MaxRooms : CountdownEnds(r) \/ GraceEnds(r)
        \/ SomeoneElseAsks
        \/ Finished

Spec == Init /\ [][Next]_vars
\* Liveness: the clock always runs out, and someone eventually asks.
FairSpec == Spec /\ \A r \in RoomIds : WF_vars(CountdownEnds(r)) /\ WF_vars(GraceEnds(r)) /\ WF_vars(SomeoneElseAsks)

\* The queue (unchanged from the first model).
NobodyInTwoMatches == \A p \in Players : Cardinality(Seated(p)) <= 1
NobodyPairedWithThemselves == \A r \in DOMAIN rooms : Cardinality(rooms[r].seats) = 2
NobodyQueuedWhileSeated == \A p \in queue : Seated(p) = {}
NobodyRacesAlone == \A r \in DOMAIN rooms : rooms[r].status = "racing" => rooms[r].arrived = rooms[r].seats
StopMeansNoRace == ~badEnter

\* Settling.
\* A started race that ends unrated had no run that passed.
UnratedOnlyWithoutAPass == \A r \in DOMAIN rooms : rooms[r].result = "unrated" => \A s \in rooms[r].seats : rooms[r].run[s] # "pass"
\* A run that passed beats a seat with none, whatever that seat did, unless the passing seat forfeited first.
APassBeatsNoPass == \A r \in DOMAIN rooms : \A s \in rooms[r].seats :
  (rooms[r].result = "rated" /\ rooms[r].run[s] = "pass" /\ rooms[r].run[Other(r, s)] # "pass" /\ rooms[r].forfeit = "none")
    => rooms[r].winner = s
\* A forfeit is a loss for the seat that left, which can only be a seat that hadn't finished.
ForfeitLoses == \A r \in DOMAIN rooms : rooms[r].forfeit # "none" =>
  (rooms[r].winner = Other(r, rooms[r].forfeit) /\ rooms[r].run[rooms[r].forfeit] = "none")
\* A finished race always has a result.
FinishedHasResult == \A r \in DOMAIN rooms : rooms[r].status = "finished" => rooms[r].result # "none"
\* Nothing that started ends without a result: only the countdown calls a race off unrated.
StartedEndsWithResult == \A r \in DOMAIN rooms : (rooms[r].status = "cancelled" /\ rooms[r].arrived = rooms[r].seats /\ rooms[r].ended)
  => rooms[r].result # "none"
\* Right after any quick match request, no due race is left unsettled.
QuickRequestSettlesAll == lastQuick => \A r \in DOMAIN rooms : ~Due(rooms[r])

\* Settled is settled: no later request, finish or replay changes a result.
ResultsStay == [][\A r \in DOMAIN rooms : rooms[r].result # "none" =>
  (rooms'[r].result = rooms[r].result /\ rooms'[r].winner = rooms[r].winner /\ rooms'[r].run = rooms[r].run)]_vars
\* Every race that starts is settled, once the clock runs out and someone asks.
EveryStartedRaceSettles == \A r \in RoomIds :
  [](r \in DOMAIN rooms /\ rooms[r].status = "racing" => <>(r \in DOMAIN rooms /\ rooms[r].status # "racing"))
====
