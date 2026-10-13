#!/usr/bin/env bash
set -e

echo "=== V31 MACD + Adaptive SuperTrend Strategy Verification ==="

echo "1. Checking TypeScript Compilation..."
npx tsc --noEmit
echo "✓ TypeScript type checking passed."

echo "2. Running Unit Test Suites..."
npm run test
echo "✓ All test suites passed."

echo "3. Checking Production Build..."
npm run build
echo "✓ Build succeeded."

echo "=== All V31 checks passed successfully! ==="
