#!/usr/bin/env bash

# Shared Conventional Commit rules for deploy version bumping
# and commit message suggestions.

CC_MINOR_TYPES=(
  feat
)

CC_PATCH_TYPES=(
  fix
  perf
  refactor
)

CC_NONE_TYPES=(
  docs
  test
  build
  ci
  chore
  style
  revert
)

CC_VERSION_IGNORED_PATHS=(
  assets.json
  pubspec.lock
  package-lock.json
)

CC_VERSION_MINOR_PATHS=(
  migrations/*
  src/auth.js
  src/attendance.js
  src/customers.js
  src/discovery.js
  src/employees.js
  src/index.js
  src/quote.js
  src/users.js
  lib/main.dart
  lib/models/*
  lib/pages/*
  web/*
)

CC_VERSION_PATCH_PATHS=(
  deploy.sh
  deploy.ps1
  conventional_commit_rules.sh
  wrangler.jsonc
  upload.js
  logout_and_login.sh
  tool/*
  test/*
  src/*
  lib/constants/*
  lib/services/*
  lib/utils/*
  lib/widgets/*
  pubspec.yaml
  package.json
)

CC_SCOPE_RULES=(
  "migrations/*|db|feat|更新資料庫 schema"
  "src/auth.js|auth|fix|改善登入驗證流程"
  "src/attendance.js|attendance|feat|更新出勤流程"
  "src/customers.js|customer|feat|更新客戶管理流程"
  "src/discovery.js|discovery|feat|更新設備設定流程"
  "src/employees.js|staff|feat|更新員工管理流程"
  "src/quote.js|quote|feat|更新報價流程"
  "src/users.js|profile|feat|更新個人資料流程"
  "src/index.js|api|refactor|重整 Worker 路由與靜態資產流程"
  "src/utils.js|api|fix|改善 API 共用工具"
  "src/*|api|fix|改善後端行為"
  "lib/pages/staff/*|staff|feat|更新員工後台體驗"
  "lib/pages/customer/*|customer|feat|更新客戶與報價體驗"
  "lib/pages/general/auth_page.dart|auth|feat|更新登入體驗"
  "lib/pages/general/ble_page.dart|ble|feat|更新藍牙流程"
  "lib/pages/general/privacy_policy_page.dart|legal|docs|更新隱私政策頁面"
  "lib/pages/general/*|app|feat|更新通用頁面體驗"
  "lib/models/quote/*|quote|feat|調整報價模型"
  "lib/models/*|app|feat|調整前端資料模型"
  "lib/widgets/login_frame.dart|auth|feat|更新登入元件體驗"
  "lib/widgets/profile_ui_settings_section.dart|profile|feat|更新個人化設定體驗"
  "lib/widgets/attendance*|attendance|feat|更新出勤檢視體驗"
  "lib/widgets/*|ui|fix|改善共用元件互動"
  "lib/services/auth_service.dart|auth|fix|改善登入服務流程"
  "lib/services/attendance*|attendance|fix|改善出勤服務流程"
  "lib/services/customer_service.dart|customer|fix|改善客戶服務流程"
  "lib/services/discovery_service.dart|discovery|fix|改善設備設定服務流程"
  "lib/services/quote_service.dart|quote|fix|改善報價服務流程"
  "lib/services/theme_provider.dart|ui|fix|改善主題切換流程"
  "lib/services/ui_settings_provider.dart|ui|fix|改善介面偏好流程"
  "lib/services/user_data_service.dart|profile|fix|改善使用者資料流程"
  "lib/services/*|app|fix|改善前端服務流程"
  "lib/constants/*|app|chore|更新前端常數設定"
  "lib/utils/*|app|refactor|整理前端工具函式"
  "lib/main.dart|app|feat|更新應用程式入口流程"
  "web/privacy.html|legal|docs|更新隱私政策文件"
  "web/*|web|feat|更新 Web 靜態資源"
  "deploy.sh|deploy|chore|改善部署流程"
  "deploy.ps1|deploy|chore|改善 PowerShell 部署流程"
  "conventional_commit_rules.sh|tooling|chore|調整 Conventional Commit 規則"
  "tool/*|tooling|chore|改善開發工具"
  "wrangler.jsonc|deploy|chore|調整 Wrangler 設定"
  "upload.js|deploy|chore|調整靜態資產上傳流程"
  "logout_and_login.sh|tooling|chore|調整本機登入輔助腳本"
  "test/*|test|test|補強自動化測試"
  "assets.json|deploy|chore|更新靜態資產清單"
  "pubspec.yaml|app|chore|更新前端依賴與版本"
  "package.json|tooling|chore|更新 Node 工具設定"
  "package-lock.json|tooling|chore|更新 Node 鎖定依賴"
  "pubspec.lock|app|chore|更新 Flutter 鎖定依賴"
  "*|app|chore|更新專案檔案"
)
