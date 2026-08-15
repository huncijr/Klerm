# PLAN.md — A2A Routing rendszer a saját coding agent harnessbe

## 1. Cél

Egy olyan coding agent harness, ahol:

- Egy **kicsi, lokális modell** (router/orchestrator) futtatja a kis taskokat
  (fájl olvasás, kis edit, grep, egyszerű refactor).
- Ha a task **nagy vagy komplex**, a router **magától delegál** egy erősebb
  modellnek: **Qwen**, **Codex** (OpenAI), vagy **Claude**.
- A router **tudja, milyen modellek vannak bekötve** és azok képességeit
  (context window, erősségek, ár, auth típus) — ebből dönt.
- A rendszer **cloud-cloud között is működik**: pl. Claude API plan mint
  fő worker + Codex OAuth mint másodlagos worker (vagy fordítva).

## 2. Alapelvek

1. **Router first**: minden task először a lokális modellhez megy. Ő dönt:
   `SELF` / `DELEGATE(model_id, reason)`.
2. **Capability registry**: minden bekötött modell egy deklarativ profil
   (név, provider, auth, context limit, tool support, költség, mikor jó).
   A router promptja ezt a registry-t kapja meg.
3. **Task handoff protokoll**: a delegációhoz strukturált csomag kell
   (cél, kontextus fájlok, elfogadási kritériumok, budget/token limit,
   visszajelzés formátuma). A worker eredményt ad vissza, nem "veszi át" a
   sessiont.
4. **Költség- és token-kontroll**: minden delegációnak van max token /
   max lépés limitje; a router összegez és validál.

## 3. Architektúra

```
            ┌──────────────────────────────┐
 user ───▶  │  Router (kicsi lokális modell)│
            │  - task triage                │
            │  - capability registry        │
            └───────┬──────────────┬───────┘
                    │ SELF         │ DELEGATE
                    ▼              ▼
             lokális toolok   Provider Adapterek
             (read/edit/sh)    ├─ Anthropic API (Claude plan / API key)
                               ├─ Codex OAuth (OpenAI)
                               ├─ Qwen (API vagy lokális)
                               └─ Ollama / llama.cpp (lokális)
```

Komponensek:
- `router/` — triage logika, döntési prompt, naplózás.
- `registry/` — modell profilok (YAML/JSON), auth-konfiguráció.
- `adapters/` — providerenként 1 adapter, közös interface:
  `run_task(task_pkg) -> TaskResult`.
- `protocol/` — TaskPackage / TaskResult sémák (pydantic).
- `tools/` — read/edit/bash/search toolok, amiket a router és a workerek
  is használhatnak.
- `harness_cli/` — a TUI/CLI réteg.

## 4. Út döntése: fork vs. routerccode vs. zöldmezős

Részletes elemzés: **`FORK_REVIEW.md`**. Röviden:

- **A) Forkolni** (opencode / cline / aider / goose) → erős alap, de nehéz
  "saját harnessbe" konvertálni és az A2A réteget így is mi építjük.
- **B) routerccode javítása** → kicsi (~4k LOC), van subagent modulja,
  de sok javítás kell (lásd FORK_REVIEW.md).
- **C) Saját minimál harness** → csak a fenti 5 komponens, provider adapter
  mintával. A routerccode-ból a `subagent.py` fan-out/worktree logika
  átvehető.

**Javaslat:** B+C hibrid — routerccode-ot referencia-alapként használjuk,
a saját harnessünk saját protokollal épül, és ami ott jó (session, tools,
context compression) azt átemeljük. Végső döntés a 0. fázis végén.

## 5. Fázisok

### 0. fázis — setup és döntés (most)
- [x] Repo, agent .md fájlok, .gitignore.
- [x] Terv (ez a fájl) + fork/repo review (`FORK_REVIEW.md`).
- [ ] Spike: routerccode futtatása lokálisan Termuxon, hiányosságok listája
      konkrétan.
- [ ] Döntés: B vs. C (a spike alapján).

### 1. fázis — Router core + registry
- [ ] Capability registry séma (YAML), 2 példa profil (Claude, Codex).
- [ ] Router döntési prompt + teszt szett (kis/nagy task példák).
- [ ] Döntési napló (JSONL): task → döntés → indok.

### 2. fázis — Provider adapterek
- [ ] Közös `Adapter` interface: auth, run_task, token accounting.
- [ ] Anthropic adapter (API kulcs / Claude plan).
- [ ] Codex adapter (OAuth token flow; Codex CLI reuse ha van).
- [ ] Lokális adapter (Ollama / llama.cpp) a Qwen-kicsi és a router miatt.

### 3. fázis — Delegációs protokoll
- [ ] TaskPackage/TaskResult pydantic sémák.
- [ ] Kontextus csomagolás: releváns fájlok kiválasztása a router által.
- [ ] Budget enforcement (max token, max iteráció, circuit breaker).
- [ ] Eredmény validáció: a router ellenőrzi a worker outputját
      (diff review, tesztfuttatás).

### 4. fázis — Cloud-cloud mód
- [ ] Claude API plan + Codex OAuth párhuzamos bekötése.
- [ ] Fallback lánc: ha az egyik worker auth-ja lejárt/rate limited,
      megy a másiknak.
- [ ] Költség dashboard (sessionnkénti token/ár riport).

### 5. fázis — Hardening
- [ ] Tool sandbox (bash engedélylista), secret-szivárgás elleni védelem.
- [ ] Session continue/rewind, párhuzamos subagent fan-out (worktree-kkel).
- [ ] CI: pytest + ruff; e2e tesztek mock providerrel.

## 6. Nyitott kérdések
- Qwen melyik formában: OpenRouter-en át, saját API, vagy lokális GGUF?
- Codex OAuth token refresh: a hivatalos Codex CLI-t használjuk token
  forrásként, vagy saját OAuth flow?
- A router modell mérete: 3B–8B elég-e a triage-hoz? (benchmark a
  döntési teszt szetten)
- Licenc kompatibilitás, ha forkolunk (opencode: MIT, cline: Apache-2.0).
