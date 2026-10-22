#!/usr/bin/env bash
# F02 sandbox smoke test: token -> create order -> buyer approval (browser) -> capture -> partial refund,
# plus the idempotency and error-path experiments the F03 state-mapping ADR needs.
#
# Usage, from the repository root:
#   bash scripts/paypal_smoke.sh
# Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (and optionally PAYPAL_BASE_URL) from .env.
# Saves every response under docs/adr/paypal-samples/ and a summary in SUMMARY.md there.
# Requires curl and jq. Sandbox only: refuses any base URL that is not the sandbox.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
ENV_FILE=${ENV_FILE:-"$ROOT/.env"}
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
# Strip CRs: a .env saved on Windows would otherwise leave "\r" on every value.
set -a; . <(tr -d '\r' < "$ENV_FILE"); set +a
: "${PAYPAL_CLIENT_ID:?PAYPAL_CLIENT_ID not set in .env}"
: "${PAYPAL_CLIENT_SECRET:?PAYPAL_CLIENT_SECRET not set in .env}"
BASE=${PAYPAL_BASE_URL:-https://api-m.sandbox.paypal.com}
case "$BASE" in
  https://api-m.sandbox.paypal.com*) ;;
  *) echo "refusing to run: $BASE is not the PayPal sandbox"; exit 1 ;;
esac
command -v jq >/dev/null || { echo "install jq first"; exit 1; }
# Native jq.exe on Windows writes CRLF unless -b; elsewhere -b is a no-op or unknown.
if jq -b -n 1 >/dev/null 2>&1; then jq() { command jq -b "$@"; }; fi

OUT="$ROOT/docs/adr/paypal-samples"
mkdir -p "$OUT"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
RUN=$(date +%Y%m%d%H%M%S)
SUMMARY=()

note() { SUMMARY+=("| $1 | $2 | $3 |"); echo "  -> $1: HTTP $2, $3"; }

# api METHOD PATH REQUEST_ID BODY NAME ; prints the HTTP status, saves the body to $OUT/NAME.json
api() {
  local method=$1 path=$2 rid=$3 body=$4 name=$5 args=()
  args=(-sS -o "$TMP" -w '%{http_code}' -X "$method" "$BASE$path"
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  [ -n "$rid" ] && args+=(-H "PayPal-Request-Id: $rid")
  [ -n "$body" ] && args+=(-d "$body")
  local code
  code=$(curl "${args[@]}")
  jq . "$TMP" > "$OUT/$name.json" 2>/dev/null || cp "$TMP" "$OUT/$name.json"
  echo "$code"
}

echo "1. access token"
TOKEN=$(curl -sS -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials \
  "$BASE/v1/oauth2/token" | jq -r '.access_token // empty')
[ -n "$TOKEN" ] || { echo "token request failed: check client id/secret and network"; exit 1; }
echo "  -> token ok (not saved)"

ORDER_BODY=$(jq -n --arg ref "smoke-$RUN" '{
  intent: "CAPTURE",
  purchase_units: [{reference_id: $ref, amount: {currency_code: "USD", value: "12.50"}}],
  payment_source: {paypal: {experience_context: {
    return_url: "https://example.com/return", cancel_url: "https://example.com/cancel",
    user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING"}}}
}')

echo "2. create order"
RID_CREATE="create-$RUN"
code=$(api POST /v2/checkout/orders "$RID_CREATE" "$ORDER_BODY" 01-create-order)
ORDER_ID=$(jq -r '.id // empty' "$OUT/01-create-order.json")
[ -n "$ORDER_ID" ] || { echo "create failed, see $OUT/01-create-order.json"; exit 1; }
note "create order" "$code" "id $ORDER_ID, status $(jq -r .status "$OUT/01-create-order.json")"

echo "3. experiment: same PayPal-Request-Id again"
code=$(api POST /v2/checkout/orders "$RID_CREATE" "$ORDER_BODY" 02-create-order-same-request-id)
SECOND=$(jq -r '.id // "none"' "$OUT/02-create-order-same-request-id.json")
note "create again, same request id" "$code" "id $SECOND ($( [ "$SECOND" = "$ORDER_ID" ] && echo same order || echo DIFFERENT order))"

echo "4. experiment: capture before buyer approval"
code=$(api POST "/v2/checkout/orders/$ORDER_ID/capture" "early-capture-$RUN" "" 03-capture-before-approval)
note "capture before approval" "$code" "$(jq -r '.details[0].issue // .name // "no error name"' "$OUT/03-capture-before-approval.json")"

APPROVE=$(jq -r '.links[] | select(.rel=="payer-action" or .rel=="approve") | .href' "$OUT/01-create-order.json" | head -1)
echo
echo "5. open this link, log in with the SANDBOX PERSONAL account, and approve:"
echo "   $APPROVE"
echo "   (you will land on example.com afterwards; that is expected)"
read -r -p "   press Enter after approving... "

code=$(api GET "/v2/checkout/orders/$ORDER_ID" "" "" 04-order-after-approval)
note "order after approval" "$code" "status $(jq -r .status "$OUT/04-order-after-approval.json")"

echo "6. capture"
RID_CAPTURE="capture-$RUN"
code=$(api POST "/v2/checkout/orders/$ORDER_ID/capture" "$RID_CAPTURE" "" 05-capture)
CAPTURE_ID=$(jq -r '.purchase_units[0].payments.captures[0].id // empty' "$OUT/05-capture.json")
note "capture" "$code" "order $(jq -r .status "$OUT/05-capture.json"), capture ${CAPTURE_ID:-missing} $(jq -r '.purchase_units[0].payments.captures[0].status // ""' "$OUT/05-capture.json")"
[ -n "$CAPTURE_ID" ] || { echo "capture failed, see $OUT/05-capture.json"; exit 1; }

echo "7. experiment: capture again with the SAME request id (retry after a timeout)"
code=$(api POST "/v2/checkout/orders/$ORDER_ID/capture" "$RID_CAPTURE" "" 06-capture-retry-same-request-id)
note "capture retry, same request id" "$code" "capture $(jq -r '.purchase_units[0].payments.captures[0].id // .details[0].issue // "?"' "$OUT/06-capture-retry-same-request-id.json")"

echo "8. experiment: capture again with a NEW request id (a blind resend)"
code=$(api POST "/v2/checkout/orders/$ORDER_ID/capture" "capture-again-$RUN" "" 07-capture-again-new-request-id)
note "capture again, new request id" "$code" "$(jq -r '.details[0].issue // .name // .status // "?"' "$OUT/07-capture-again-new-request-id.json")"

echo "9. partial refund of 3.00"
RID_REFUND="refund-$RUN"
REFUND_BODY='{"amount":{"currency_code":"USD","value":"3.00"},"note_to_payer":"FairSettle smoke test"}'
code=$(api POST "/v2/payments/captures/$CAPTURE_ID/refund" "$RID_REFUND" "$REFUND_BODY" 08-refund)
REFUND_ID=$(jq -r '.id // empty' "$OUT/08-refund.json")
note "partial refund" "$code" "refund ${REFUND_ID:-missing} $(jq -r '.status // .details[0].issue // ""' "$OUT/08-refund.json")"

echo "10. experiment: same refund request id again"
code=$(api POST "/v2/payments/captures/$CAPTURE_ID/refund" "$RID_REFUND" "$REFUND_BODY" 09-refund-same-request-id)
R2=$(jq -r '.id // "none"' "$OUT/09-refund-same-request-id.json")
note "refund again, same request id" "$code" "refund $R2 ($( [ "$R2" = "$REFUND_ID" ] && echo same refund || echo DIFFERENT or error))"

echo "11. experiment: refund more than what is left"
code=$(api POST "/v2/payments/captures/$CAPTURE_ID/refund" "over-refund-$RUN" '{"amount":{"currency_code":"USD","value":"20.00"}}' 10-over-refund)
note "over-refund" "$code" "$(jq -r '.details[0].issue // .name // .status // "?"' "$OUT/10-over-refund.json")"

{
  echo "# PayPal sandbox smoke run $RUN"
  echo
  echo "Order $ORDER_ID · capture $CAPTURE_ID · refund ${REFUND_ID:-none}"
  echo
  echo "| Step | HTTP | Result |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${SUMMARY[@]}"
  echo
  echo "Raw responses are the numbered JSON files in this folder."
} > "$OUT/SUMMARY.md"

echo
echo "done. summary: docs/adr/paypal-samples/SUMMARY.md"
