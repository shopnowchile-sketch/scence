#!/usr/bin/env bash
# Ejecuta el arnés de concurrencia REAL contra la rama de pruebas, SIN que la clave pase por el chat ni por la pantalla.
#
# Uso (una sola vez, en SU terminal; el archivo queda solo para su usuario):
#   umask 077
#   cat > ~/.scence-crm-it.env <<'ENV'
#   CRM_IT_SUPABASE_URL=https://dexpvoubiklgotuukrml.supabase.co
#   CRM_IT_SERVICE_KEY=<service_role de LA RAMA campaign-locations-test — Supabase > Settings > API de la rama>
#   ENV
# Luego:  bash tests/integration/run-crm-integration.sh
set -euo pipefail
ENV_FILE="${CRM_IT_ENV_FILE:-$HOME/.scence-crm-it.env}"
PROD_REF="xzzbishzfyovrladcaeb"
BRANCH_REF="dexpvoubiklgotuukrml"
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE (ver instrucciones al inicio de este script)"; exit 2; }
perm=$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")
[ "$perm" = "600" ] || { echo "El archivo debe tener permisos 600 (ahora $perm): chmod 600 $ENV_FILE"; exit 2; }
set +x
set -a; . "$ENV_FILE"; set +a
case "${CRM_IT_SUPABASE_URL:-}" in *"$PROD_REF"*) echo "RECHAZADO: la URL es la de PRODUCCIÓN"; exit 3;; esac
case "${CRM_IT_SUPABASE_URL:-}" in *"$BRANCH_REF"*) ;; *) echo "RECHAZADO: la URL no es la de la rama de pruebas ($BRANCH_REF)"; exit 3;; esac
[ -n "${CRM_IT_SERVICE_KEY:-}" ] || { echo "Falta CRM_IT_SERVICE_KEY en $ENV_FILE"; exit 2; }
export CRM_IT_ALLOW=yes
echo "Ejecutando contra la rama $BRANCH_REF (clave no se imprime)…"
cd "$(dirname "$0")/../.."
node --test tests/integration/crm-concurrency.integration.ts
