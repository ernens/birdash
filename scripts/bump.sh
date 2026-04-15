#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# bump.sh — Bump the semver version in package.json
#
# Usage:
#   bash scripts/bump.sh patch    # 1.6.0 → 1.6.1  (bug fix, polish)
#   bash scripts/bump.sh minor    # 1.6.1 → 1.7.0  (new feature, screen)
#   bash scripts/bump.sh major    # 1.7.0 → 2.0.0  (breaking change)
#   bash scripts/bump.sh          # auto from last commit message:
#                                 #   feat!: → major
#                                 #   feat:  → minor
#                                 #   *      → patch
#
# Follows Semantic Versioning (semver.org):
#   MAJOR — incompatible/breaking changes
#   MINOR — new functionality, backward compatible
#   PATCH — bug fixes, polish, small adjustments
# ══════════════════════════════════════════════════════════════════════════

set -e

REPO_DIR="${BIRDASH_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PKG="$REPO_DIR/package.json"

if [ ! -f "$PKG" ]; then
    echo "Error: $PKG not found" >&2
    exit 1
fi

# Read current version
CURRENT=$(grep -o '"version": *"[^"]*"' "$PKG" | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*')
if [ -z "$CURRENT" ]; then
    echo "Error: could not parse version from $PKG" >&2
    exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Determine bump type
BUMP="${1:-auto}"

if [ "$BUMP" = "auto" ]; then
    # Infer from the last commit message
    LAST_MSG=$(git -C "$REPO_DIR" log -1 --format=%s 2>/dev/null || echo "")
    if echo "$LAST_MSG" | grep -qE '^[a-z]+(\([^)]*\))?!:'; then
        BUMP="major"
    elif echo "$LAST_MSG" | grep -qE '^feat(\([^)]*\))?:'; then
        BUMP="minor"
    else
        BUMP="patch"
    fi
    echo "Auto-detected: $BUMP (from: $LAST_MSG)"
fi

case "$BUMP" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
    *)
        echo "Usage: bump.sh [patch|minor|major]" >&2
        exit 1
        ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"

# Update package.json
sed -i "s/\"version\": *\"$CURRENT\"/\"version\": \"$NEW\"/" "$PKG"

echo "$CURRENT → $NEW"
