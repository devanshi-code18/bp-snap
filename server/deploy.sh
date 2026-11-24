#!/bin/sh
# Deploy the BP Snap backup server to Netlify. Needs `npx netlify-cli login` once.
#   sh server/deploy.sh            (site name defaults to bp-snap-sync)
# Then set SYNC_API in js/config.js to https://<site>.netlify.app/api and push.
set -e
cd "$(dirname "$0")"
SITE=${SITE:-bp-snap-sync}
npm install --omit=dev --no-audit --no-fund
npx -y netlify-cli@latest sites:create --name "$SITE" --disable-linking || echo "(site may already exist)"
npx -y netlify-cli@latest deploy --prod --dir public --functions netlify/functions --site "$SITE"
curl -fsS "https://$SITE.netlify.app/api/health" && echo
