#!/usr/bin/env bash
set -euo pipefail

# Optional overrides:
# export VERSION="0.2.0"
# export BUILD_NUMBER="5"

WRANGLER_VERSION="4.68.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${SCRIPT_DIR}/../coselig_staff_portal_frontend"
PUBSPEC="${FRONTEND_DIR}/pubspec.yaml"
BACKEND_DIR="${SCRIPT_DIR}"
ASSETS_PATH="${BACKEND_DIR}/assets.json"

VERSION="${VERSION:-}"
BUILD_NUMBER="${BUILD_NUMBER:-}"

if [[ -z "${VERSION}" ]]; then
  FULL_VER="$(sed -nE 's/^version:[[:space:]]*([^[:space:]]+).*/\1/p' "${PUBSPEC}" | head -n1)"
  if [[ -z "${FULL_VER}" ]]; then
    echo "Failed to read version from ${PUBSPEC}"
    exit 1
  fi

  VERSION="${FULL_VER%%+*}"
  if [[ "${FULL_VER}" == *"+"* ]]; then
    BUILD_NUMBER="${FULL_VER#*+}"
  else
    BUILD_NUMBER="1"
  fi
fi

echo "======================================"
echo "Coselig Staff System Auto Deployment"
echo "Version: ${VERSION} (Build #${BUILD_NUMBER})"
echo "======================================"
echo

echo "[1/4] Building Flutter Frontend..."
cd "${FRONTEND_DIR}"
CMD="flutter build web --release --build-name=${VERSION} --build-number=${BUILD_NUMBER}"
echo "Running: ${CMD}"
flutter build web --release --build-name="${VERSION}" --build-number="${BUILD_NUMBER}"
echo "Step 1 completed"
echo

echo "[2/4] Generating asset list..."
cd "${BACKEND_DIR}"
node upload.js
echo "Step 2 completed"
echo

echo "[3/4] Uploading static files to KV..."
echo "assetsPath: ${ASSETS_PATH}"
echo "Running: npm exec --package=wrangler@${WRANGLER_VERSION} -- wrangler kv bulk put ${ASSETS_PATH} --namespace-id e7ff4caa1f96456aadc4c1c5bf71b584 --remote"
npm exec --package="wrangler@${WRANGLER_VERSION}" -- wrangler kv bulk put "${ASSETS_PATH}" --namespace-id e7ff4caa1f96456aadc4c1c5bf71b584 --remote
echo "Step 3 completed"
echo

echo "[4/4] Deploying Workers..."
echo "Running: npm exec --package=wrangler@${WRANGLER_VERSION} -- wrangler deploy"
npm exec --package="wrangler@${WRANGLER_VERSION}" -- wrangler deploy
echo "Step 4 completed"
echo

echo "======================================"
echo "Deployment successful! Version: ${VERSION} (Build #${BUILD_NUMBER})"
echo "Access: https://employeeservice.coseligtest.workers.dev"
echo "======================================"
echo

echo "Updating version number..."
NEXT_BUILD_NUMBER=$((BUILD_NUMBER + 1))
NEXT_VERSION="${VERSION}+${NEXT_BUILD_NUMBER}"

TMP_FILE="$(mktemp)"
awk -v next_version="${NEXT_VERSION}" '
  BEGIN { replaced = 0 }
  {
    if (!replaced && $0 ~ /^version:[[:space:]]*[^[:space:]]+/) {
      print "version: " next_version
      replaced = 1
    } else {
      print
    }
  }
  END {
    if (!replaced) {
      print "version: " next_version
    }
  }
' "${PUBSPEC}" > "${TMP_FILE}"
mv "${TMP_FILE}" "${PUBSPEC}"

echo "Next deployment version will be: ${NEXT_VERSION}"
echo
read -r -p "Press Enter to exit" _
