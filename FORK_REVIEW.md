# FORK_REVIEW.md — fork jelöltek + `greedfinanace/routerccode` elemzés

Ez a második terv-fájl: milyen forkok jöhetnek szóba, és ha a
`routerccode`-ot használjuk, **mit kell rajta javítani**.

---

## A) Fork jelöltek (saját harnessbe konvertáláshoz)

| Repo | Nyelv | Licenc | Előny | Hátrány |
|---|---|---|---|---|
| **sst/opencode** | TS | MIT | modern CLI/TUI, plugin rendszer, modell-független provider réteg | TS; a plugin API gyorsan változik |
| **cline/cline** | TS | Apache-2.0 | érett tool use, MCP támogatás | VS Code extension — CLI harnessbe nehéz átemelni |
| **AiderX/aider** | Python | Apache-2.0 | nagyon jó edit-formátumok, repo-map | single-model szemlélet, nincs orchestráció |
| **block/goose** | Rust | Apache-2.0 | extension rendszer, multi-provider | Rust; nehéz gyorsan módosítani Termuxon |
| **All-Hands-AI/OpenHands** | Python | MIT | multi-agent alapból | hatalmas, nehéz belőni mint "saját harness" |

**Következtetés:** ha fork, akkor **opencode** (TS, provider réteg
kicserélhető) vagy **aider** (Python, mi építjük rá a routert). De egyikben
sincs kész A2A routing — azt mindenképp mi írjuk. Ezért a fő csapásirány a
`PLAN.md` szerinti **B+C hibrid**: routerccode referencia + saját minimál
harness.

---

## B) `greedfinanace/routerccode` állapota (repo review)

Átnézve: ~4000 sor Python (`src/openrouter_agent/`), 4 tesztfájl (26
teszteset), Node wrapper (`bin/routercode.js`).

### Ami JOUL használható
- `subagent.py`: fan-out orchestrátor, szerep-alapú subagent konfiguráció
  (`test_writer`, `security_auditor`, `doc_writer`, `debugger`), git
  worktree integráció, `model_override` olcsóbb modellhez — **ez majdnem
  pont a mi router koncepciónk magja**.
- `context.py`: többrétegű context compression.
- `tools.py` + `lazy_tools.py`: tool implementációk (read/write/search/run).
- `session.py`: continue/fork/rewind.
- `security.py`: alap védelmek.

### Ami ROSSZ állapotú / javítandó

**Architektúra**
1. **OpenRouter hard dependency**: `api_client.py` egyetlen endpoint
   (`openrouter.ai/api/v1`). Nincs provider-absztrakció — a Claude API
   plan és a Codex OAuth bekötéséhez kell egy közös `Adapter` interface
   és 3 új adapter. Ez a legnagyobb munka.
2. **Nincs router/triage logika**: a subagent rendszer szerep-alapú, de
   nem dönt *méret* alapján (kis task → lokális modell, nagy task →
   cloud). Kell egy `router/` modul + capability registry.
3. **`model_override` csak "olcsóbb modell"** egy providerein belül —
   nincs cross-provider delegáció (Codex OAuth ↔ Claude API).
4. **`main.py` 871 soros monolit**: REPL, parancsok, loop egyben.
   Szét kell bontani (cli / loop / commands).

**Minőség / megbízhatóság**
5. **Gyenge tesztlefedettség**: 26 teszt, és egyik sem fedi a
   `main.py`-t, `api_client`-et, `subagent.py`-t (a számunkra
   legfontosabb részt!). Kell: subagent fan-out tesztek mock clienttel,
   provider adapter tesztek.
6. **Node wrapper törékeny**: `bin/routercode.js` a PATH-on keresi a
   `routercode` binárist, fallback `python -m ...` — de `python` helyett
   sok rendszeren `python3` van; Termuxon is. Fix: explicit
   `python3` + `sys.executable` logika, vagy a wrapper elhagyása.
7. **`postinstall: pip install .`** npm-ből — fragile és security-szempontból
   is gyanús pattern; kivezetni.
8. **Nincs CI** (GitHub Actions: pytest + ruff + típusellenőrzés).
9. `pyproject.toml`-ban `requires-python >= 3.11` rendben, de a
   függőségek nincsenek felső korláttal; lock file (uv) kell.

**Hiányzó funkciók a célunkhoz**
10. Capability registry (modell profilok YAML-ben).
11. TaskPackage/TaskResult protokoll (pydantic sémák).
12. OAuth flow (Codex) — jelenleg csak API kulcs / keyring van
    (`key_manager.py`).
13. Budget/circuit breaker a delegációkra (részben van self-heal breaker,
    de a subagent timeout csak 120 s fix érték).
14. Döntési napló (JSONL): melyik task miért melyik modellhez ment.

### Javítási terv routerccode használata esetén (prioritási sorrend)
1. Provider-absztrakció: `Adapter` interface + OpenRouter/Claude/Codex/
   Ollama adapterek (1–2. hiba).
2. Router modul + capability registry (2–3. hiba).
3. `subagent.py` kibővítése cross-provider delegációra, `model_override`
   → `provider_profile_id`.
4. `main.py` darabolás (4. hiba).
5. Tesztek + CI (5., 8. hiba).
6. Node wrapper fix vagy törlés (6–7. hiba).

---

## C) Javaslat (összefoglaló)

- **Nem forkolunk** első körben: egyik forkban sincs A2A routing, és a
  konvertálás több munka, mint a saját minimál harness.
- **routerccode**: referencia + kódlopás forrás (`subagent.py`,
  `context.py`, `tools.py`), de a fenti 6 pontos javítási terv nélkül
  nem használható élesben.
- A 0. fázis spike-ja dönti el, hogy a routerccode-ot ténylegesen
  forkoljuk (B), vagy csak ihletet merítünk és zöldmezősen építkezünk (C).
