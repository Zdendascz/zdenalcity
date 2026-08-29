# Sem patří vygenerované obrázky budov

Pojmenování: `<id>__<varianta>.png`, varianta je `a`, `b` nebo `c`.

```
hospital__a.png
hospital__b.png
coal_power_plant__c.png
```

Zadání i prompty jsou v `docs/06-SPRITY-SLUZEB.md`.

Naladění:

```
python tools/fit-sprites.py
```

Tyhle syrové obrázky se **necommitují** — jsou velké a dají se vygenerovat
znovu z promptů. Do repa jde až to, co z nich udělá skript, tedy
`content/vanilla/sprites/`.
