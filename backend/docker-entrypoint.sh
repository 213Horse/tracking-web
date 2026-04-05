#!/bin/sh
set -e
echo "[entrypoint] Prisma sync schema → database…"
npx prisma db push
exec node dist/index.js
