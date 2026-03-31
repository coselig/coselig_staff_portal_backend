#!/usr/bin/env bash
set -euo pipefail

# Optional overrides:
# export VERSION="0.4.0"
# export VERSION_BUMP="auto"   # auto|major|minor|patch|none
# export WRANGLER_VERSION="latest"
# export FRONTEND_DIR="../coselig_staff_portal_frontend"
# export DEPLOY_BASE_URL="https://employeeservice.coseligtest.workers.dev"
# export KV_NAMESPACE_ID="..."

WRANGLER_VERSION="${WRANGLER_VERSION:-latest}"
VERSION_BUMP="${VERSION_BUMP:-auto}"
DEFAULT_DEPLOY_BASE_URL="https://employeeservice.coseligtest.workers.dev"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}"
RULES_FILE="${SCRIPT_DIR}/conventional_commit_rules.sh"
WRANGLER_CONFIG="${BACKEND_DIR}/wrangler.jsonc"
UPLOAD_SCRIPT="${BACKEND_DIR}/upload.js"
ASSETS_PATH="${BACKEND_DIR}/assets.json"

CC_MINOR_TYPES=(feat)
CC_PATCH_TYPES=(fix perf refactor)
CC_NONE_TYPES=(docs test build ci chore style revert)
CC_VERSION_IGNORED_PATHS=(assets.json pubspec.lock package-lock.json)
CC_VERSION_MINOR_PATHS=(migrations/*)
CC_VERSION_PATCH_PATHS=(deploy.sh conventional_commit_rules.sh upload.js tool/* wrangler.jsonc src/* test/* lib/* pubspec.yaml package.json)

if [[ -f "${RULES_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${RULES_FILE}"
fi

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

version_bump_rank() {
  case "$1" in
    none) echo 0 ;;
    patch) echo 1 ;;
    minor) echo 2 ;;
    major) echo 3 ;;
    manual) echo 4 ;;
    *) echo 0 ;;
  esac
}

max_version_bump() {
  local left_rank right_rank
  left_rank="$(version_bump_rank "$1")"
  right_rank="$(version_bump_rank "$2")"
  if (( right_rank > left_rank )); then
    printf '%s\n' "$2"
  else
    printf '%s\n' "$1"
  fi
}

normalize_version_bump() {
  case "$1" in
    auto|major|minor|patch|none) printf '%s\n' "$1" ;;
    *)
      echo "Unsupported VERSION_BUMP: $1" >&2
      echo "Expected one of: auto, major, minor, patch, none" >&2
      exit 1
      ;;
  esac
}

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "${item}" == "${needle}" ]]; then
      return 0
    fi
  done
  return 1
}

path_matches_patterns() {
  local path="$1"
  shift
  local pattern
  for pattern in "$@"; do
    case "${path}" in
      ${pattern}) return 0 ;;
    esac
  done
  return 1
}

validate_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

bump_semver() {
  local version="$1"
  local bump="$2"
  local major minor patch

  if ! validate_semver "${version}"; then
    echo "Invalid semver version: ${version}" >&2
    exit 1
  fi

  IFS='.' read -r major minor patch <<< "${version}"

  case "${bump}" in
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    patch)
      patch=$((patch + 1))
      ;;
    none)
      ;;
    *)
      echo "Unsupported semver bump: ${bump}" >&2
      exit 1
      ;;
  esac

  printf '%s.%s.%s\n' "${major}" "${minor}" "${patch}"
}

resolve_git_root() {
  local directory="$1"
  git -C "${directory}" rev-parse --show-toplevel 2>/dev/null || true
}

resolve_frontend_dir() {
  local explicit_dir="${FRONTEND_DIR:-}"
  local parent_dir backend_name sibling candidate
  local candidates=()

  if [[ -n "${explicit_dir}" ]]; then
    if [[ -f "${explicit_dir}/pubspec.yaml" ]]; then
      printf '%s\n' "${explicit_dir}"
      return 0
    fi
    echo "FRONTEND_DIR does not contain pubspec.yaml: ${explicit_dir}" >&2
    exit 1
  fi

  parent_dir="$(cd "${SCRIPT_DIR}/.." && pwd)"
  backend_name="$(basename "${SCRIPT_DIR}")"

  candidates+=("${parent_dir}/front")

  if [[ "${backend_name}" == *_backend ]]; then
    candidates+=("${parent_dir}/${backend_name%_backend}_frontend")
  fi
  if [[ "${backend_name}" == *-backend ]]; then
    candidates+=("${parent_dir}/${backend_name%-backend}-frontend")
  fi
  if [[ "${backend_name}" == *_back ]]; then
    candidates+=("${parent_dir}/${backend_name%_back}_front")
  fi

  for sibling in "${parent_dir}"/*; do
    [[ -d "${sibling}" ]] || continue
    [[ "${sibling}" == "${SCRIPT_DIR}" ]] && continue
    candidate="$(basename "${sibling}")"
    case "${candidate}" in
      *front*|*frontend*)
        candidates+=("${sibling}")
        ;;
    esac
  done

  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}/pubspec.yaml" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  echo "Unable to locate Flutter frontend directory." >&2
  echo "Set FRONTEND_DIR or place the app in a sibling frontend repo / ../front." >&2
  exit 1
}

read_pubspec_version() {
  local pubspec="$1"
  sed -nE 's/^version:[[:space:]]*([^[:space:]]+).*/\1/p' "${pubspec}" | head -n1
}

resolve_version_anchor_epoch() {
  local git_root
  git_root="$(resolve_git_root "${FRONTEND_DIR}")"
  if [[ -z "${git_root}" ]]; then
    return 0
  fi

  git -C "${git_root}" log -n1 --format=%ct -- pubspec.yaml 2>/dev/null || true
}

commit_message_version_bump() {
  local subject="$1"
  local body="$2"
  local type breaking=""
  local conventional_regex='^([A-Za-z]+)(\([^)]+\))?(!)?:[[:space:]]'

  if [[ "${subject}" =~ ${conventional_regex} ]]; then
    type="$(to_lower "${BASH_REMATCH[1]}")"
    breaking="${BASH_REMATCH[3]:-}"
  else
    printf 'none\n'
    return 0
  fi

  if [[ -n "${breaking}" || "${body}" == *"BREAKING CHANGE:"* || "${body}" == *"BREAKING-CHANGE:"* ]]; then
    printf 'major\n'
    return 0
  fi

  if array_contains "${type}" "${CC_MINOR_TYPES[@]}"; then
    printf 'minor\n'
  elif array_contains "${type}" "${CC_PATCH_TYPES[@]}"; then
    printf 'patch\n'
  elif array_contains "${type}" "${CC_NONE_TYPES[@]}"; then
    printf 'none\n'
  else
    printf 'none\n'
  fi
}

detect_repo_commit_version_bump() {
  local repo_dir="$1"
  local since_epoch="$2"
  local git_root
  local detected_bump="none"
  local record subject body commit_bump

  git_root="$(resolve_git_root "${repo_dir}")"
  if [[ -z "${git_root}" || -z "${since_epoch}" ]]; then
    printf 'none\n'
    return 0
  fi

  while IFS= read -r -d $'\x1e' record; do
    [[ -z "${record}" ]] && continue
    subject="${record%%$'\x1f'*}"
    body="${record#*$'\x1f'}"
    if [[ "${body}" == "${record}" ]]; then
      body=""
    fi
    commit_bump="$(commit_message_version_bump "${subject}" "${body}")"
    detected_bump="$(max_version_bump "${detected_bump}" "${commit_bump}")"
  done < <(git -C "${git_root}" log --format='%s%x1f%b%x1e' --since="@${since_epoch}" && printf '\x1e')

  printf '%s\n' "${detected_bump}"
}

is_ignored_version_path() {
  path_matches_patterns "$1" "${CC_VERSION_IGNORED_PATHS[@]}"
}

is_minor_change_path() {
  path_matches_patterns "$1" "${CC_VERSION_MINOR_PATHS[@]}"
}

is_patch_change_path() {
  path_matches_patterns "$1" "${CC_VERSION_PATCH_PATHS[@]}"
}

detect_repo_path_version_bump() {
  local repo_dir="$1"
  local git_root
  local line status path trimmed_path detected_bump="none"

  git_root="$(resolve_git_root "${repo_dir}")"
  if [[ -z "${git_root}" ]]; then
    printf 'none\n'
    return 0
  fi

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    status="${line:0:2}"
    path="${line:3}"
    trimmed_path="${path##* -> }"

    if is_ignored_version_path "${trimmed_path}"; then
      continue
    fi

    if is_minor_change_path "${trimmed_path}"; then
      detected_bump="$(max_version_bump "${detected_bump}" "minor")"
      continue
    fi

    if [[ "${status}" == "??" || "${status}" == *"A"* || "${status}" == *"D"* ]]; then
      detected_bump="$(max_version_bump "${detected_bump}" "minor")"
      continue
    fi

    if is_patch_change_path "${trimmed_path}"; then
      detected_bump="$(max_version_bump "${detected_bump}" "patch")"
    fi
  done < <(git -C "${git_root}" status --short --untracked-files=all)

  printf '%s\n' "${detected_bump}"
}

detect_auto_version_bump() {
  local anchor_epoch
  local commit_backend_bump commit_frontend_bump commit_bump
  local path_backend_bump path_frontend_bump path_bump

  anchor_epoch="$(resolve_version_anchor_epoch)"
  commit_backend_bump="$(detect_repo_commit_version_bump "${BACKEND_DIR}" "${anchor_epoch}")"
  commit_frontend_bump="$(detect_repo_commit_version_bump "${FRONTEND_DIR}" "${anchor_epoch}")"
  commit_bump="$(max_version_bump "${commit_backend_bump}" "${commit_frontend_bump}")"

  if [[ "${commit_bump}" != "none" ]]; then
    printf '%s|%s\n' "${commit_bump}" "conventional-commits"
    return 0
  fi

  path_backend_bump="$(detect_repo_path_version_bump "${BACKEND_DIR}")"
  path_frontend_bump="$(detect_repo_path_version_bump "${FRONTEND_DIR}")"
  path_bump="$(max_version_bump "${path_backend_bump}" "${path_frontend_bump}")"
  printf '%s|%s\n' "${path_bump}" "path-rules"
}

resolve_version_bump_with_source() {
  local requested_bump normalized_bump
  requested_bump="$1"
  normalized_bump="$(normalize_version_bump "${requested_bump}")"

  case "${normalized_bump}" in
    auto)
      detect_auto_version_bump
      ;;
    *)
      printf '%s|%s\n' "${normalized_bump}" "manual"
      ;;
  esac
}

resolve_wrangler_package() {
  if [[ "${WRANGLER_VERSION}" != "latest" ]]; then
    printf 'wrangler@%s\n' "${WRANGLER_VERSION}"
    return 0
  fi

  local resolved_version
  resolved_version="$(npm view wrangler version 2>/dev/null || true)"
  if [[ -n "${resolved_version}" ]]; then
    printf 'wrangler@%s\n' "${resolved_version}"
  else
    printf 'wrangler@latest\n'
  fi
}

read_wrangler_config_value() {
  local mode="$1"

  if [[ ! -f "${WRANGLER_CONFIG}" ]]; then
    return 0
  fi

  node - "${WRANGLER_CONFIG}" "${mode}" <<'NODE'
const fs = require('node:fs');

const file = process.argv[2];
const mode = process.argv[3];

try {
  const raw = fs.readFileSync(file, 'utf8');
  const config = Function('"use strict"; return (' + raw + ');')();

  if (mode === 'worker-name') {
    process.stdout.write(config?.name || '');
    process.exit(0);
  }

  if (mode === 'kv-namespace-id') {
    const binding = process.env.KV_NAMESPACE_BINDING || 'STATIC_ASSETS';
    const namespace = Array.isArray(config?.kv_namespaces)
      ? config.kv_namespaces.find((item) => item && item.binding === binding)
      : null;
    process.stdout.write(namespace?.id || '');
    process.exit(0);
  }

  if (mode === 'route-base-url') {
    const routes = Array.isArray(config?.routes) ? config.routes : [];
    const firstRoute = routes[0];
    const pattern =
      typeof firstRoute === 'string'
        ? firstRoute
        : firstRoute && typeof firstRoute.pattern === 'string'
          ? firstRoute.pattern
          : '';

    if (!pattern) {
      process.stdout.write('');
      process.exit(0);
    }

    const normalized = pattern.replace(/\/\*$/, '');
    process.stdout.write(/^https?:\/\//.test(normalized) ? normalized : `https://${normalized}`);
    process.exit(0);
  }

  process.stdout.write('');
} catch (error) {
  process.stdout.write('');
}
NODE
}

detect_utils_workers_dev_url() {
  local worker_name="$1"
  local utils_file="${BACKEND_DIR}/src/utils.js"
  local matching_url=""
  local fallback_url=""

  if [[ ! -f "${utils_file}" ]]; then
    return 0
  fi

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    if [[ -n "${worker_name}" && "${line}" == *"://${worker_name}."* ]]; then
      matching_url="${line}"
      break
    fi
    if [[ -z "${fallback_url}" ]]; then
      fallback_url="${line}"
    fi
  done < <(grep -oE 'https://[^"]+' "${utils_file}" | grep 'workers\.dev' || true)

  if [[ -n "${matching_url}" ]]; then
    printf '%s\n' "${matching_url}"
  elif [[ -n "${fallback_url}" ]]; then
    printf '%s\n' "${fallback_url}"
  fi
}

resolve_deploy_base_url() {
  local worker_name route_base utils_base

  if [[ -n "${DEPLOY_BASE_URL:-}" ]]; then
    printf '%s\n' "${DEPLOY_BASE_URL}"
    return 0
  fi

  route_base="$(read_wrangler_config_value 'route-base-url')"
  if [[ -n "${route_base}" ]]; then
    printf '%s\n' "${route_base}"
    return 0
  fi

  worker_name="$(read_wrangler_config_value 'worker-name')"
  utils_base="$(detect_utils_workers_dev_url "${worker_name}")"
  if [[ -n "${utils_base}" ]]; then
    printf '%s\n' "${utils_base}"
    return 0
  fi

  printf '%s\n' "${DEFAULT_DEPLOY_BASE_URL}"
}

update_pubspec_version() {
  local pubspec="$1"
  local new_version="$2"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v new_version="${new_version}" '
    BEGIN { replaced = 0 }
    {
      if (!replaced && $0 ~ /^version:[[:space:]]*[^[:space:]]+/) {
        print "version: " new_version
        replaced = 1
      } else {
        print
      }
    }
    END {
      if (!replaced) {
        print "version: " new_version
      }
    }
  ' "${pubspec}" > "${tmp_file}"
  mv "${tmp_file}" "${pubspec}"
}

run_smoke_tests() {
  local base_url="$1"
  local root_status login_status health_json

  echo "[6/6] Running smoke tests..."
  echo "Testing base URL: ${base_url}"

  root_status="$(curl -sS -L -o /dev/null -w "%{http_code}" "${base_url}/")"
  login_status="$(curl -sS -L -o /dev/null -w "%{http_code}" "${base_url}/login")"
  health_json="$(curl -sS -L "${base_url}/api/health")"

  if [[ "${root_status}" != "200" ]]; then
    echo "Smoke test failed: / returned ${root_status}"
    exit 1
  fi

  if [[ "${login_status}" != "200" ]]; then
    echo "Smoke test failed: /login returned ${login_status}"
    exit 1
  fi

  if ! printf '%s' "${health_json}" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "Smoke test failed: /api/health returned unexpected payload"
    echo "Response: ${health_json}"
    exit 1
  fi

  echo "Smoke tests passed"
  echo
}

FRONTEND_DIR="$(resolve_frontend_dir)"
PUBSPEC="${FRONTEND_DIR}/pubspec.yaml"
LOCALE_GENERATOR="${FRONTEND_DIR}/tool/generate_locale_catalog.dart"
WRANGLER_PACKAGE="$(resolve_wrangler_package)"
FULL_VERSION="$(read_pubspec_version "${PUBSPEC}")"
if [[ -z "${FULL_VERSION}" ]]; then
  echo "Failed to read version from ${PUBSPEC}" >&2
  exit 1
fi

BASE_VERSION="${FULL_VERSION%%+*}"
if ! validate_semver "${BASE_VERSION}"; then
  echo "pubspec.yaml version must resolve to pure semver. Found: ${FULL_VERSION}" >&2
  exit 1
fi

VERSION="${VERSION:-}"
if [[ -n "${VERSION}" ]]; then
  if ! validate_semver "${VERSION}"; then
    echo "VERSION must be pure semver, for example 0.4.0" >&2
    exit 1
  fi
  RESOLVED_VERSION_BUMP="manual"
  VERSION_SOURCE="VERSION override"
else
  IFS='|' read -r RESOLVED_VERSION_BUMP VERSION_SOURCE <<< "$(resolve_version_bump_with_source "${VERSION_BUMP}")"
  VERSION="$(bump_semver "${BASE_VERSION}" "${RESOLVED_VERSION_BUMP}")"
fi

KV_TARGET_NAMESPACE_ID="${KV_NAMESPACE_ID:-$(read_wrangler_config_value 'kv-namespace-id')}"
DEPLOY_BASE_URL_RESOLVED="$(resolve_deploy_base_url)"

echo "======================================"
echo "Coselig Staff Portal Deployment"
echo "Version: ${VERSION}"
echo "Base version: ${BASE_VERSION}"
echo "Version bump: ${RESOLVED_VERSION_BUMP} (${VERSION_SOURCE})"
echo "Frontend: ${FRONTEND_DIR}"
echo "Wrangler: ${WRANGLER_PACKAGE}"
echo "Smoke URL: ${DEPLOY_BASE_URL_RESOLVED}"
echo "======================================"
echo

echo "[1/6] Generating locale catalog..."
cd "${FRONTEND_DIR}"
if [[ -f "${LOCALE_GENERATOR}" ]]; then
  echo "Running: dart run tool/generate_locale_catalog.dart"
  dart run tool/generate_locale_catalog.dart
  echo "Step 1 completed"
else
  echo "Locale generator not found, skipping catalog generation"
fi
echo

echo "[2/6] Building Flutter frontend..."
echo "Running: flutter build web --release --build-name=${VERSION}"
flutter build web --release --build-name="${VERSION}"
echo "Step 2 completed"
echo

echo "[3/6] Generating asset list..."
cd "${BACKEND_DIR}"
if [[ -f "${UPLOAD_SCRIPT}" ]]; then
  echo "Running: FRONTEND_DIR=${FRONTEND_DIR} node ${UPLOAD_SCRIPT}"
  FRONTEND_DIR="${FRONTEND_DIR}" node "${UPLOAD_SCRIPT}"
  echo "Step 3 completed"
else
  echo "upload.js not found, skipping asset generation"
fi
echo

echo "[4/6] Uploading static files to KV..."
if [[ -f "${ASSETS_PATH}" ]]; then
  if [[ -z "${KV_TARGET_NAMESPACE_ID}" ]]; then
    echo "No KV namespace id found. Set KV_NAMESPACE_ID or configure STATIC_ASSETS in wrangler.jsonc"
    exit 1
  fi

  echo "assetsPath: ${ASSETS_PATH}"
  echo "namespaceId: ${KV_TARGET_NAMESPACE_ID}"
  echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler kv bulk put ${ASSETS_PATH} --namespace-id ${KV_TARGET_NAMESPACE_ID} --remote"
  npm exec --package="${WRANGLER_PACKAGE}" -- wrangler kv bulk put "${ASSETS_PATH}" --namespace-id "${KV_TARGET_NAMESPACE_ID}" --remote
  echo "Step 4 completed"
else
  echo "assets.json not found, skipping KV upload"
fi
echo

echo "[5/6] Deploying Workers..."
echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler deploy"
npm exec --package="${WRANGLER_PACKAGE}" -- wrangler deploy
echo "Step 5 completed"
echo

run_smoke_tests "${DEPLOY_BASE_URL_RESOLVED}"

echo "Updating pubspec version..."
update_pubspec_version "${PUBSPEC}" "${VERSION}"
echo "Pubspec version is now: ${VERSION}"
echo

echo "======================================"
echo "Deployment successful"
echo "Version: ${VERSION}"
echo "Access: ${DEPLOY_BASE_URL_RESOLVED}"
echo "======================================"
