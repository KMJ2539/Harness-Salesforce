# sfdx-demo — harness-sf end-to-end fixture

A minimal SFDX project (one custom object, two fields, one handler) wired up
to demonstrate the full `harness-sf` flow.

→ **Start with [WALKTHROUGH.md](./WALKTHROUGH.md)** — it walks you step by
step through `/sf-apex` modifying `OrderHandler.cls` with all gates active
(design-first, 5-persona review, resolution gate, modify approval, deploy
gate, profile deny).

## Layout

```
sfdx-demo/
├── sfdx-project.json
├── force-app/main/default/
│   ├── classes/OrderHandler.cls               # the handler /sf-apex modifies
│   └── objects/Order__c/
│       ├── Order__c.object-meta.xml           # Private sharing
│       └── fields/{Amount__c,Status__c}.field-meta.xml
├── .harness-sf/
│   ├── PROJECT.md                              # team conventions
│   └── designs/20260429-order-fls.md           # pre-baked design with reviews
└── WALKTHROUGH.md                              # the actual tutorial
```

## Run it

```bash
cd examples/sfdx-demo
npx --prefix ../.. harness-sf init
# restart Claude Code, then open this directory and follow WALKTHROUGH.md
```

## What this demonstrates

- Design-first flow (Step 03–04 in the walkthrough)
- Modify-approval sentinel (Step 05)
- Test author + self-verify (Step 06)
- Deploy gate with coverage threshold (Step 07–08)
- Negative-path triggers for every gate (end of walkthrough)

The pre-baked design.md already has `## Reviews` and `## Review Resolution`
filled in so you can step into the gate flow without doing the full intent
battery yourself.
