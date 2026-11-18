#!/usr/bin/env bash
set -euo pipefail

SERVER_NAME="orbit-proposals.unwhelm.net"
SOURCE_ROOT="/home/administrator/node-sites/OrbitProposals"
WEBROOT="/var/www/${SERVER_NAME}"
CONF_AVAIL="/etc/nginx/sites-available/${SERVER_NAME}"
CONF_ENABLED="/etc/nginx/sites-enabled/${SERVER_NAME}"
EXPECTED_IP="204.12.245.235"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash ${SOURCE_ROOT}/deploy/install-orbit-proposals.sh" >&2
  exit 1
fi

if [[ ! -d "${SOURCE_ROOT}/.git" ]]; then
  echo "Missing Git checkout at ${SOURCE_ROOT}" >&2
  exit 1
fi

echo "==> Updating source checkout"
runuser -u administrator -- git -C "${SOURCE_ROOT}" pull --ff-only origin main

echo "==> Installing static site into ${WEBROOT}"
mkdir -p "${WEBROOT}"
rsync -a --delete --exclude='.git' --exclude='deploy' "${SOURCE_ROOT}/" "${WEBROOT}/"
chown -R administrator:www-data "${WEBROOT}"
find "${WEBROOT}" -type d -exec chmod 775 {} +
find "${WEBROOT}" -type f -exec chmod 644 {} +

echo "==> Installing Nginx server block"
install -m 0644 "${SOURCE_ROOT}/deploy/nginx/${SERVER_NAME}.conf" "${CONF_AVAIL}"
ln -sfn "${CONF_AVAIL}" "${CONF_ENABLED}"
nginx -t
systemctl reload nginx

echo "==> Checking DNS"
if ! dig +short A "${SERVER_NAME}" | grep -Fxq "${EXPECTED_IP}"; then
  echo "${SERVER_NAME} does not resolve to ${EXPECTED_IP}; certificate step aborted." >&2
  exit 1
fi

echo "==> Issuing or renewing certificate"
certbot --nginx -d "${SERVER_NAME}" --non-interactive --agree-tos --redirect --keep-until-expiring

echo "==> Final checks"
curl -sS -o /dev/null -w "HTTP local: %{http_code}\n" -H "Host: ${SERVER_NAME}" http://127.0.0.1/
curl -sS -o /dev/null -w "HTTPS public: %{http_code}\n" "https://${SERVER_NAME}/"
echo "Orbit Proposal is live at https://${SERVER_NAME}/"
