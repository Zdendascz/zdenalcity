# Sem patří vygenerované obrázky budov

Pracuje se **po jedné budově**: nahrň sem tři varianty tak, jak je vrátil
generátor, a pusť

```
python tools/name-sprites.py hospital
python tools/fit-sprites.py
```

První je pojmenuje podle času vzniku na `hospital__a/b/c.png`, druhý naladí na
rozměry, které renderer čeká.

Zadání i prompty jsou v `docs/06-SPRITY-SLUZEB.md`.

Tyhle syrové obrázky se **necommitují** — jsou velké a dají se vygenerovat
znovu z promptů. Do repa jde až to, co z nich udělá skript, tedy
`content/vanilla/sprites/`.
