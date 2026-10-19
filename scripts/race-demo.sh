#!/usr/bin/env bash
#
# Demonstrates B2 — the check-then-write race in takeOrder — by running the same
# test against the commit before the fix and the commit after it.
#
#   ./scripts/race-demo.sh
#
# Requires docker compose to be up (PostgreSQL + Redis) and npm ci to have run.
# Checks out two commits in detached HEAD and always returns to where it started,
# including on failure or Ctrl-C.

set -uo pipefail

RED_COMMIT=7ae792d      # E2: the reproduction, committed while it still failed
GREEN_COMMIT=52cf3ae    # B2: the conditional UPDATE that makes it pass

bold=$(tput bold 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "${red}Working tree is dirty. Commit or stash first — this script moves HEAD.${reset}"
  exit 1
fi

ORIGINAL_REF=$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)
restore() {
  echo
  echo "${dim}Returning to ${ORIGINAL_REF}${reset}"
  git checkout --quiet "$ORIGINAL_REF"
}
trap restore EXIT INT TERM

# Each commit knows a different set of migrations, so the schema has to be
# rebuilt from whatever that checkout carries rather than left as it is.
reset_test_schema() {
  docker compose exec -T database \
    psql -U adminer -d food_delivery_test \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1
}

run_at() {
  local commit=$1 label=$2 colour=$3
  echo
  echo "${bold}──────────────────────────────────────────────────────────────${reset}"
  echo "${bold}${colour}${label}${reset}  ${dim}$(git log -1 --format='%h %s' "$commit")${reset}"
  echo "${bold}──────────────────────────────────────────────────────────────${reset}"
  echo

  git checkout --quiet "$commit"
  reset_test_schema
  # grep -E, not sed: BSD sed on macOS does not treat \| as alternation, so the
  # obvious sed filter silently matches nothing.
  npm run test:e2e -- take-order-concurrency 2>&1 \
    | grep -E '(✓|✕) |"winners":|^Tests:|Expected length|Received length' \
    | sed 's/^ *//'
}

cat <<BANNER

${bold}takeOrder under concurrency${reset}

  Twenty drivers claim the same order at once, across five independent orders.
  Exactly one of them should win each time.

BANNER

run_at "$RED_COMMIT"   "BEFORE — check-then-write" "$red"
run_at "$GREEN_COMMIT" "AFTER  — conditional UPDATE" "$green"

cat <<SUMMARY

${bold}What changed between the two${reset}

  ${red}-${reset} const order = await this.orders.findOne({where: {id}});
  ${red}-${reset} if (order.driver) return {ok: false, ...};
  ${red}-${reset} await this.orders.save([{id, driver}]);

  ${green}+${reset} UPDATE "order" SET "driverId" = \$1
  ${green}+${reset}  WHERE id = \$2 AND "driverId" IS NULL AND status = 'Cooked'
  ${green}+${reset} -- winner decided by rows affected

SUMMARY
