# EVE Tools

Calculators for EVE Online in one web app.

- **Ore prices** — ISK per hour for your mining fleet by ore and grade, compressed vs raw, priced from Fuzzwork.
- **Incursions** — ISK/h and LP from your pasted wallet journal (based on the TLA Incursion calculator).

## Run locally

```
python -m http.server 8000
```

Then open http://localhost:8000. No build step.

See `CLAUDE.md` for structure and how to add a tool.
