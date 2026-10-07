#!/bin/sh
# Založí (nebo aktualizuje) labely pro workflow agentů. Spusť jednou z kořene repozitáře:
#   sh scripts/setup-labels.sh
set -e

label() { gh label create "$1" --color "$2" --description "$3" --force; }

label idea              c5def5 "Surový nápad, ještě nerozpracovaný"
label spec-ready        fbca04 "Zadání hotové, čeká na schválení"
label approved          0e8a16 "Schváleno, vývojový agent může začít (jen vlastník)"
label in-progress       1d76db "Vývojový agent na issue pracuje"
label review-ok         0e8a16 "Review agent nemá blokující nálezy"
label changes-requested d93f0b "Review agent požaduje změny"
label needs-human       b60205 "Agent potřebuje rozhodnutí člověka"
