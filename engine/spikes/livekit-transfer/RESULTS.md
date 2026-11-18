# Spike results: screened transfer on self-hosted LiveKit (12 Nov 2026)

**Answer: yes, with one change to the plan.** The runtime can prove a human took the call (INV-09) and fall back
cleanly in every other case, on real SIP signalling and real RTP, with no carrier, number or cloud account. But the
plan's first design — screen staff in a separate room, then move them into the caller's room — does not exist on
self-hosted LiveKit: `MoveParticipant` answers **"not implemented"** on livekit-server v1.13 (a real participant, two
real rooms; it is a LiveKit Cloud feature). Screening therefore happens **in the caller's own room, gated**, and the
gate that works is a server-side mute of the caller's track (below).

All seven cases pass, three full runs in a row (S1–S6 twice, then S1–S7), with media proof of who heard whom.
Machine-readable: `RESULTS.json` (chosen gate), `RESULTS-gate-subscribe.json` and `RESULTS-gate-publish.json` (the two
rejected gates).

## What ran

| Part | Version | Where |
|---|---|---|
| livekit-server, livekit/sip, redis | v1.13, v1.23, 7.4-alpine | Docker in the colima VM, host networking (`up.sh`) |
| Caller and staff phone | SIPp 3.8.0 | this Mac (`scenarios/*.xml`) |
| Each phone's audio | `media.mjs` (Node 26) | started by SIPp once a call is up |
| Runtime | Node 26, livekit-server-sdk 2.19.3, @livekit/rtc-node 1.2.2 | `spike.mjs`, `lk.mjs` |

Each phone sends a tone and records what it hears, 100 ms at a time (Goertzel): **caller 700 Hz, staff or voicemail
1000 Hz, whisper 440 Hz**. "Heard" means an amplitude above 500 (of about 6000 sent) in two or more windows. The staff
phone sends its digit as RFC 4733 telephone-event (payload 101) 4 s after answering; the whisper is a 3 s tone the
runtime publishes (no speech provider at Gate A).

## The gate: three tried, one kept

Before dialling staff, the caller is set to hear nothing (`canSubscribe: false`). The question is how to stop staff — or
a voicemail — hearing the caller until they press 1.

| Gate | Voicemail hears the caller while screening | Staff hears the caller after the bridge | Verdict |
|---|---|---|---|
| **subscribe**: unsubscribe the staff leg from the caller's track the moment it joins | **yes**, at full level from its first 100 ms: the SIP leg subscribes when it answers, after the unsubscribe | yes | rejected — a privacy leak |
| **publish**: the caller loses `canPublish` while screening | no | **no**: livekit/sip never publishes its track again (waited 5 s) | rejected — no bridge audio |
| **mute**: the caller's track muted at the server (`MutePublishedTrack`), unmuted on DTMF 1 | no | yes | **kept** — needs `room.enable_remote_unmute: true` |

## Cases (final run, gate = mute)

| Case | Staff phone | Outcome | Pass | Timing | Media checks |
|---|---|---|---|---|---|
| S1 human accepts | answers, presses 1 | `bridged` | yes | digit → bridged **68 ms**; answer → bridged 4.15 s (3 s whisper + the press) | 6/6: caller heard no whisper or staff; staff heard the whisper, not the caller; after the bridge each hears the other |
| S2 voicemail | answers, plays audio, no digit | `returning:no_dtmf` | yes | screening timeout 10.01 s after answer | 5/5: the voicemail never heard the caller |
| S3 declines | presses 2 | `returning:declined` | yes | 4.04 s after answer | 5/5 |
| S4 no answer | rings only | `returning:no_answer` | yes | 20.08 s (ringing timeout 20 s; LiveKit: "sip request timed out") | 1/1; the caller heard silence throughout |
| S5 busy | 486 | `returning:busy` | yes | 82 ms ("SIP call failed: 486 Busy Here") | 1/1 |
| S6 caller hangs up while staff is screened | answers, would press 1 at 8 s | `abandoned_during_transfer` | yes | staff leg removed 24 ms after LiveKit reported the caller gone | 5/5; no staff leg left behind |
| S7 caller presses 1 while staff is screened | voicemail | `returning:no_dtmf` | yes | the caller's "1" arrived and was ignored | 6/6 |

Staff answered 1.03–1.06 s after dialling in every answered case (SIPp rings for 1 s). Across the three full runs the
bridge took 4.12–4.16 s after answer and every case passed every time.

## What this changes in the design (SM-9, INV-09)

1. **Self-hosted screening is in the caller's room.** Before dialling: mute the caller's track at the server and set
   the caller to hear nothing. On DTMF 1 from the staff leg: unmute, let the caller hear, unpublish the whisper —
   bridged. Anything else: remove the staff leg, unmute, give the caller back to the AI. The server must run with
   `room.enable_remote_unmute: true`.
2. **Only the staff leg's digits count.** DTMF is not audio: the caller's keypad reaches the same room even while the
   caller's track is muted (S7). The runtime reads a digit only when its participant identity is the staff leg.
3. **Unsubscribing is not a privacy control** (subscribe gate), and **never take publish permission from a SIP
   participant** (publish gate: it does not come back).
4. **The caller hears silence while staff is screened** — up to the 20 s ring plus the 10 s screen. The AI must say so
   before it dials ("I'm calling the team now; you may hear silence for up to half a minute"). Hold audio on
   self-hosted would need the staff track muted the moment it is published (it is published at dial time, before
   answer) — not tested. On LiveKit Cloud the plan's screening room plus `MoveParticipant` allows hold audio; not
   tested, no account by design.
5. **Error mapping** from `CreateSIPParticipant`: "sip request timed out" = no answer, "486 Busy Here" = busy; anything
   else is `returning:error` and the caller returns to the AI the same way.

## Limits

One Mac, through colima's port forwarder: no carrier, real phone, PSTN timing, or NAT across the internet. SIPp stands
in for staff phones; tones stand in for speech. Not tested: early media (183 with audio), a carrier's voicemail that
answers in under the time it takes to apply the gate (the mute is applied before dialling, so it should not matter),
mobile voicemail behaviour, LiveKit Cloud.

## Rig problems met on the way (so the next run doesn't repeat them)

- Colima's default SSH port forwarder carries no UDP: colima was restarted with `--port-forwarder grpc` (back with
  `colima start --port-forwarder ssh`).
- LiveKit SIP holds an inbound call ("Waiting for track subscription(s)") until someone in the room subscribes to the
  caller: the runtime joins the call room first.
- SIPp's `play_dtmf` needs a raw socket, which macOS gives only to root: `media.mjs` sends RFC 4733 itself.
- A leftover room from a caller killed without a BYE was joined by mistake: every case starts and ends with no rooms.
- SIPp's `<exec>` forks, so the media tap holds SIPp's sockets for a few seconds after a call: each case waits until
  its ports are free, and every SIPp the run started is killed even when a case throws.

## Run it again

```bash
colima start --port-forwarder grpc
./up.sh
node spike.mjs            # or: node spike.mjs S1 S7
GATE=subscribe RESULTS=RESULTS-gate-subscribe.json node spike.mjs S1
./down.sh && colima stop
```
