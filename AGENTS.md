# AGENTS.md — utasítások a coding agenteknek ehhez a repóhoz

## Projekt célja
Egy **A2A (Agent-to-Agent) routing rendszer** építése a saját coding agent harnessünkbe:
- Egy **kisebb/lokális modell** (router) kezeli a kis taskokat.
- Nagyobb taskoknál a router **magától meghív egy erősebb modellt** (Qwen, Codex, Claude).
- A router **ismeri a bekötött modellek képességeit** (capability registry), és ez alapján dönt.
- Működhet két cloud között is: pl. **Claude API plan** + **Codex OAuth**.

## Repó struktúra
- `PLAN.md` — a teljes projekt terv (fázisok, döntések).
- `FORK_REVIEW.md` — fork jelöltek + a `greedfinanace/routerccode` repo elemzése és javítási lista.
- Később: `harness/` (saját kód), `docs/`.

## Szabályok az agenteknek
1. Olvasd el a `PLAN.md`-t és a `FORK_REVIEW.md`-t, mielőtt bármit módosítasz.
2. Kis, review-zható commitok; commit üzenet angolul, imperatívuszban.
3. Ne commitolj titkokat (API kulcsok, OAuth tokenek) — lásd `.gitignore`.
4. Python kód: `>=3.11`, type hintek, `ruff` + `black` formázás.
5. Új funkcióhoz tesztek (pytest). Nincs merge zöld tesztek nélkül.
6. A router döntési logikája mindig legyen determinisztikusan naplózható (miért melyik modell kapta a taskot).

## Környezet
- Termux (Android). Nincs garantiert Docker; inkább lokális Python/Node toolchain.
- Git remote: `https://github.com/huncijr/tset` (privát).
